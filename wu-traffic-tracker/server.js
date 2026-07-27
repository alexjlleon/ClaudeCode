require('dotenv').config();
const express = require('express');
const cors = require('cors');
const basicAuth = require('express-basic-auth');
const path = require('path');
const { logEvent, getEvents, getVisitors, getEventsByIp, cachedGeo, cacheGeo } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Railway sits behind a proxy -- needed so req.ip is the real visitor IP, not Railway's.
app.set('trust proxy', true);

app.use(express.json({ limit: '100kb' }));

// --- CORS: only allow the tracking beacon to be POSTed from your own site(s) ---
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow no-origin requests (curl, server-to-server) and any allow-listed origin.
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
};

// --- Device classification from the User-Agent string ---
// Returns one of: 'Bot', 'Mobile', 'Tablet', 'Desktop', or null if no UA.
function parseDevice(ua) {
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/bot|crawl|spider|slurp|facebookexternalhit|snap url|preview|embedly|whatsapp|telegram|discord|pinterest|bingpreview|headless|python-requests|curl|wget|axios|monitor|uptime/.test(s)) {
    return 'Bot';
  }
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return 'Tablet';
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(s)) return 'Mobile';
  return 'Desktop';
}

// --- Geolocation: look up approx city/state for an IP, cached per-IP in the DB ---
// Uses ipapi.co free tier. Skips private/local IPs. Never throws into the request path.
function isPublicIp(ip) {
  if (!ip) return false;
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return false;
  return true;
}

async function lookupGeo(ip) {
  // Return cached result if we've seen this IP before.
  const cached = cachedGeo(ip);
  if (cached) return cached;
  if (!isPublicIp(ip)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const r = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const d = await r.json();
    if (d && (d.city || d.region || d.country_name)) {
      const geo = { city: d.city || null, region: d.region || null, country: d.country_name || d.country || null };
      cacheGeo(ip, geo);
      return geo;
    }
  } catch (e) {
    // Geo is best-effort; a failure must never block logging the event.
  }
  return null;
}

// --- Public: the tracking snippet itself, served with open CORS so any allowed page can fetch it ---
app.get('/tracker.js', cors(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracker.js'));
});

// --- Public: where the tracker posts events ---
app.options('/api/track', cors(corsOptions));
app.post('/api/track', cors(corsOptions), async (req, res) => {
  const { label, event_type, session_id, page_url, referrer, meta } = req.body || {};

  if (!label || typeof label !== 'string') {
    return res.status(400).json({ ok: false, error: 'label is required' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

  const userAgent = req.headers['user-agent'] || null;
  const deviceType = parseDevice(userAgent);

  // Best-effort geolocation; won't block or fail the event write.
  const geo = await lookupGeo(ip);

  logEvent({
    ip_address: ip,
    session_id,
    event_type: event_type || 'event',
    label,
    page_url,
    referrer,
    meta,
    geo_city: geo && geo.city,
    geo_region: geo && geo.region,
    geo_country: geo && geo.country,
    user_agent: userAgent,
    device_type: deviceType,
  });

  res.json({ ok: true });
});

// --- Everything below requires the admin login ---
const adminAuth = basicAuth({
  users: { [process.env.ADMIN_USER || 'admin']: process.env.ADMIN_PASS || 'change-me' },
  challenge: true,
  realm: 'WU Traffic',
});

app.get('/api/events', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const sessionId = req.query.session_id || null;
  const result = getEvents({ page, pageSize: 50, sessionId });
  res.json(result);
});

// Grouped "By Visitor" view -- one row per IP.
app.get('/api/visitors', adminAuth, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const result = getVisitors({ page, pageSize: 50 });
  res.json(result);
});

// All events for one IP (expanding a visitor row).
app.get('/api/visitor-events', adminAuth, (req, res) => {
  const ip = req.query.ip || '';
  if (!ip) return res.status(400).json({ ok: false, error: 'ip is required' });
  res.json({ rows: getEventsByIp(ip) });
});

app.use('/admin', adminAuth, express.static(path.join(__dirname, 'views')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`WU traffic tracker running on port ${PORT}`);
});

