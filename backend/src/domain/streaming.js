// Stream key lifecycle (Part II Section 5.4): generate / rotate / revoke, signed with DAY2_SALT.
const crypto = require('crypto');
const { pool, tx } = require('../db');
const { err } = require('../errors');
const { signDay2 } = require('../sign');
const { withLock } = require('../util');
const { Checker, isObj, isStr } = require('../validate');
const { publish } = require('../queue');
const media = require('../media');
const { playerExists } = require('./players');

const ACTIONS = ['generate', 'rotate', 'revoke'];
const KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const host = () => process.env.MEDIA_PUBLIC_HOST || 'localhost';

function validateStreamKey(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(ACTIONS.includes(b.action), 'action');
  c.check(isStr(b.player_id, 1, 64), 'player_id');
  if (b.label !== undefined && b.label !== null) c.check(isStr(b.label, 1, 64), 'label');
  if (b.stream_key_override !== undefined && b.stream_key_override !== null) {
    c.check(typeof b.stream_key_override === 'string' && KEY_RE.test(b.stream_key_override), 'stream_key_override');
  }
  c.done();
}

const newKey = () => 'sk_live_' + crypto.randomBytes(8).toString('hex');

function view(action, row) {
  const active = row.status === 'active';
  const h = host();
  return {
    player_id: row.player_id,
    label: row.label,
    stream_key: row.stream_key,
    status: row.status,
    ingest_endpoints: active
      ? { rtmp: `rtmp://${h}:1935/live/${row.stream_key}`, webrtc: `http://${h}:8889/live/${row.stream_key}/whip` }
      : null,
    playback_url: active ? `http://${h}:8888/live/${row.stream_key}/index.m3u8` : null,
    signature: signDay2(row.stream_key, { action, player_id: row.player_id, status: row.status, stream_key: row.stream_key }),
  };
}

const sever = (keys) => keys.forEach((k) => media.kickPath(`live/${k}`).catch(() => {}));

async function streamKey(b) {
  validateStreamKey(b);
  return withLock('stream:' + b.player_id, async () => {
    if (!(await playerExists(pool, b.player_id))) {
      throw err(404, 'PLAYER_NOT_FOUND', `Player ${b.player_id} does not exist.`, { player_id: b.player_id });
    }
    if (b.action === 'revoke') {
      const cur = await pool.query('SELECT * FROM stream_keys WHERE player_id = $1 ORDER BY n DESC LIMIT 1', [b.player_id]);
      if (!cur.rowCount) throw err(404, 'STREAM_NOT_FOUND', `Player ${b.player_id} has no stream key.`, { player_id: b.player_id });
      const row = cur.rows[0];
      if (row.status !== 'active') throw err(409, 'KEY_REVOKED', 'This stream key has already been revoked.', { stream_key: row.stream_key });
      await pool.query("UPDATE stream_keys SET status = 'revoked', revoked_at = now() WHERE stream_key = $1", [row.stream_key]);
      sever([row.stream_key]);
      publish('stream.key_revoked', { player_id: row.player_id, stream_key: row.stream_key });
      return { status: 200, body: view('revoke', { ...row, status: 'revoked' }) };
    }

    const key = b.stream_key_override || newKey();
    const label = b.label || 'default';
    const out = await tx(async (c) => {
      const existing = await c.query('SELECT * FROM stream_keys WHERE stream_key = $1 FOR UPDATE', [key]);
      if (existing.rowCount && existing.rows[0].status !== 'active') {
        throw err(409, 'KEY_REVOKED', 'This stream key was revoked and cannot be reused.', { stream_key: key });
      }
      if (existing.rowCount && existing.rows[0].player_id !== b.player_id) {
        throw err(409, 'KEY_REVOKED', 'This stream key belongs to another player.', { stream_key: key });
      }
      // Rotating (or re-generating) invalidates every other key the player still holds.
      const old = await c.query(
        "UPDATE stream_keys SET status = 'revoked', revoked_at = now() WHERE player_id = $1 AND status = 'active' AND stream_key <> $2 RETURNING stream_key",
        [b.player_id, key]);
      if (existing.rowCount) await c.query('UPDATE stream_keys SET label = $2 WHERE stream_key = $1', [key, label]);
      else await c.query("INSERT INTO stream_keys(stream_key, player_id, label, status) VALUES ($1,$2,$3,'active')", [key, b.player_id, label]);
      return old.rows.map((r) => r.stream_key);
    });
    sever(out);
    publish('stream.key_' + (b.action === 'generate' ? 'generated' : 'rotated'), { player_id: b.player_id, stream_key: key });
    return {
      status: b.action === 'generate' ? 201 : 200,
      body: view(b.action, { player_id: b.player_id, label, stream_key: key, status: 'active' }),
    };
  });
}

// Called by MediaMTX before it accepts a publisher: only active keys may push to live/{key}.
async function authorizeIngest(path) {
  const m = /^live\/(.+)$/.exec(path || '');
  if (!m) return { ok: true };
  const r = await pool.query('SELECT status FROM stream_keys WHERE stream_key = $1', [m[1]]);
  if (!r.rowCount) return { ok: false, status: 404, code: 'STREAM_NOT_FOUND' };
  if (r.rows[0].status !== 'active') return { ok: false, status: 409, code: 'KEY_REVOKED' };
  return { ok: true };
}

module.exports = { streamKey, authorizeIngest, validateStreamKey };
