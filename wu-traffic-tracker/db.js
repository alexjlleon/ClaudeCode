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
    meta TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
`);

const insertEvent = db.prepare(`
  INSERT INTO events (ip_address, session_id, event_type, label, page_url, referrer, meta)
  VALUES (@ip_address, @session_id, @event_type, @label, @page_url, @referrer, @meta)
`);

function logEvent(evt) {
  insertEvent.run({
    ip_address: evt.ip_address || null,
    session_id: evt.session_id || null,
    event_type: evt.event_type || 'custom',
    label: evt.label,
    page_url: evt.page_url || null,
    referrer: evt.referrer || null,
    meta: evt.meta ? JSON.stringify(evt.meta) : null,
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

module.exports = { db, logEvent, getEvents };
