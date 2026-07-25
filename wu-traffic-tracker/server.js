require('dotenv').config();
const express = require('express');
const cors = require('cors');
const basicAuth = require('express-basic-auth');
const path = require('path');
const { logEvent, getEvents } = require('./db');

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
    callback(new Error('Not allowed by CORS'));
  },
};

// --- Public: the tracking snippet itself, served with open CORS so any allowed page can fetch it ---
app.get('/tracker.js', cors(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'tracker.js'));
});

// --- Public: where the tracker posts events ---
app.post('/api/track', cors(corsOptions), (req, res) => {
  const { label, event_type, session_id, page_url, referrer, meta } = req.body || {};

  if (!label || typeof label !== 'string') {
    return res.status(400).json({ ok: false, error: 'label is required' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

  logEvent({
    ip_address: ip,
    session_id,
    event_type: event_type || 'event',
    label,
    page_url,
    referrer,
    meta,
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

app.use('/admin', adminAuth, express.static(path.join(__dirname, 'views')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`WU traffic tracker running on port ${PORT}`);
});
