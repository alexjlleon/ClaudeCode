const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || './data/traffic.db';

// Make sure the folder exists (needed the first time the container/volume boots)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ip_address TEXT,
    session_id TEXT,
    event_type TEXT NOT NULL,
    label TEXT NOT NULL,
    page_url TEXT,
    referrer TEXT,
    meta TEXT,
    geo_city TEXT,
    geo_region TEXT,
    geo_country TEXT,
    user_agent TEXT,
    device_type TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_ip ON events(ip_address);

  -- Per-IP geolocation cache so we only hit the geo API once per address.
  CREATE TABLE IF NOT EXISTS ip_geo (
    ip TEXT PRIMARY KEY,
    city TEXT,
    region TEXT,
    country TEXT,
    looked_up_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// --- Migration: add newer columns to an existing events table if they're missing ---
const cols = db.prepare(`PRAGMA table_info(events)`).all().map((c) => c.name);
for (const col of ['geo_city', 'geo_region', 'geo_country', 'user_agent', 'device_type']) {
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE events ADD COLUMN ${col} TEXT`);
  }
}

const insertEvent = db.prepare(`
  INSERT INTO events (ip_address, session_id, event_type, label, page_url, referrer, meta, geo_city, geo_region, geo_country, user_agent, device_type)
  VALUES (@ip_address, @session_id, @event_type, @label, @page_url, @referrer, @meta, @geo_city, @geo_region, @geo_country, @user_agent, @device_type)
`);

const getGeoCache = db.prepare(`SELECT city, region, country FROM ip_geo WHERE ip = ?`);
const setGeoCache = db.prepare(`
  INSERT INTO ip_geo (ip, city, region, country) VALUES (@ip, @city, @region, @country)
  ON CONFLICT(ip) DO UPDATE SET city=excluded.city, region=excluded.region, country=excluded.country, looked_up_at=datetime('now')
`);

function cachedGeo(ip) {
  if (!ip) return null;
  return getGeoCache.get(ip) || null;
}

function cacheGeo(ip, geo) {
  if (!ip || !geo) return;
  setGeoCache.run({ ip, city: geo.city || null, region: geo.region || null, country: geo.country || null });
}

function logEvent(evt) {
  insertEvent.run({
    ip_address: evt.ip_address || null,
    session_id: evt.session_id || null,
    event_type: evt.event_type || 'custom',
    label: evt.label,
    page_url: evt.page_url || null,
    referrer: evt.referrer || null,
    meta: evt.meta ? JSON.stringify(evt.meta) : null,
    geo_city: evt.geo_city || null,
    geo_region: evt.geo_region || null,
    geo_country: evt.geo_country || null,
    user_agent: evt.user_agent || null,
    device_type: evt.device_type || null,
  });
}

function getEvents({ page = 1, pageSize = 50, sessionId = null } = {}) {
  const offset = (page - 1) * pageSize;
  let rows, total;
  if (sessionId) {
    rows = db.prepare(
      `SELECT * FROM events WHERE session_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(sessionId, pageSize, offset);
    total = db.prepare(`SELECT COUNT(*) c FROM events WHERE session_id = ?`).get(sessionId).c;
  } else {
    rows = db.prepare(
      `SELECT * FROM events ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(pageSize, offset);
    total = db.prepare(`SELECT COUNT(*) c FROM events`).get().c;
  }
  return { rows, total, page, pageSize };
}

// Grouped-by-visitor view: one row per IP, with visit stats and best-known location/device.
function getVisitors({ page = 1, pageSize = 50 } = {}) {
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`
    SELECT
      ip_address,
      COUNT(*) AS event_count,
      COUNT(DISTINCT session_id) AS session_count,
      MIN(created_at) AS first_seen,
      MAX(created_at) AS last_seen,
      MAX(geo_city) AS geo_city,
      MAX(geo_region) AS geo_region,
      MAX(geo_country) AS geo_country,
      MAX(device_type) AS device_type
    FROM events
    GROUP BY ip_address
    ORDER BY MAX(created_at) DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, offset);
  const total = db.prepare(`SELECT COUNT(DISTINCT ip_address) c FROM events`).get().c;
  return { rows, total, page, pageSize };
}

// All events for a single IP (used when expanding a visitor).
function getEventsByIp(ip) {
  return db.prepare(`SELECT * FROM events WHERE ip_address = ? ORDER BY id DESC LIMIT 500`).all(ip);
}

module.exports = { db, logEvent, getEvents, getVisitors, getEventsByIp, cachedGeo, cacheGeo };
