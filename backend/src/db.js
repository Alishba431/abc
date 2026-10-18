const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 25 });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, branding JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS leagues_rbac (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clubs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS club_players (id TEXT PRIMARY KEY, club_id TEXT NOT NULL, tenant_id TEXT NOT NULL, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, claims JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS sports (id TEXT PRIMARY KEY, config JSONB NOT NULL, ord SERIAL);
CREATE TABLE IF NOT EXISTS leagues (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, sport_id TEXT NOT NULL, league_id TEXT, home TEXT NOT NULL, away TEXT NOT NULL, ord SERIAL);
CREATE TABLE IF NOT EXISTS events (
  match_id TEXT NOT NULL, seq INT NOT NULL, event_id TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
  payload JSONB NOT NULL, body_key TEXT NOT NULL, signature TEXT NOT NULL, compensates TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (match_id, seq));
CREATE TABLE IF NOT EXISTS roster_leagues (id TEXT PRIMARY KEY, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS squads (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, league_id TEXT NOT NULL, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS audit (n SERIAL PRIMARY KEY, player_id TEXT NOT NULL, entry JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS roster_requests (request_id TEXT PRIMARY KEY, body_key TEXT NOT NULL, response JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, club_id TEXT, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, price_minor INT NOT NULL,
  stock INT NOT NULL CHECK (stock >= 0), reserved INT NOT NULL DEFAULT 0 CHECK (reserved >= 0), data JSONB NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS discount_codes (code TEXT PRIMARY KEY, percent INT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, body_key TEXT NOT NULL, status TEXT NOT NULL,
  response JSONB NOT NULL, pdf BYTEA, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS offline_actions (device_id TEXT NOT NULL, action_id TEXT NOT NULL, result JSONB NOT NULL,
  PRIMARY KEY (device_id, action_id));
CREATE TABLE IF NOT EXISTS stream_keys (n SERIAL, stream_key TEXT PRIMARY KEY, player_id TEXT NOT NULL, label TEXT NOT NULL,
  status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS costream_sessions (session_id TEXT PRIMARY KEY, body_key TEXT NOT NULL, state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS qr_codes (entity_id TEXT PRIMARY KEY, short_code TEXT UNIQUE NOT NULL, scan_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS qr_scans (n SERIAL PRIMARY KEY, entity_id TEXT NOT NULL, device_family TEXT NOT NULL, bucket TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS guest_tokens (token TEXT PRIMARY KEY, status TEXT NOT NULL, merge_key TEXT, merged_user_id TEXT,
  merged_response JSONB, linked_user_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS guest_carts (token TEXT PRIMARY KEY, items JSONB NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS carts (user_id TEXT PRIMARY KEY, items JSONB NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS chat_rooms (room_id TEXT PRIMARY KEY, kicked JSONB NOT NULL DEFAULT '[]', muted JSONB NOT NULL DEFAULT '[]',
  seq INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS chat_messages (room_id TEXT NOT NULL, seq INT NOT NULL, message_id TEXT NOT NULL, sender TEXT NOT NULL,
  text TEXT NOT NULL, flagged BOOLEAN NOT NULL, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (room_id, seq));
CREATE TABLE IF NOT EXISTS dlq (n SERIAL PRIMARY KEY, event JSONB NOT NULL, attempts INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS follows (follower_id TEXT NOT NULL, athlete_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, athlete_id));
`;

const WIPE = `TRUNCATE meta, tenants, leagues_rbac, clubs, club_players, users, sports, leagues, matches, events,
  roster_leagues, squads, players, audit, roster_requests, products, variants, discount_codes, orders, offline_actions,
  stream_keys, costream_sessions, qr_codes, qr_scans, guest_tokens, guest_carts, carts, chat_rooms, chat_messages, dlq, follows
  RESTART IDENTITY`;

async function waitForDb(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { await pool.query('SELECT 1'); return; } catch (e) { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error('database not reachable');
}

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { pool, SCHEMA, WIPE, waitForDb, tx };
