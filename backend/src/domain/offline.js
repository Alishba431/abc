// Offline replay (Section 5.14): ordered by queued_at, per-action conflict resolution, idempotent per device.
const { pool } = require('../db');
const { AppError, err } = require('../errors');
const { withLock } = require('../util');
const { Checker, isObj, isId, isInt, isTs } = require('../validate');
const events = require('./events');
const roster = require('./roster');

const TYPES = ['score_event', 'roster_transfer'];

function validateEnvelope(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(isId(b.device_id), 'device_id');
  if (c.check(Array.isArray(b.actions) && b.actions.length >= 1 && b.actions.length <= 100, 'actions')) {
    const ids = new Set();
    b.actions.forEach((a, i) => {
      c.check(isObj(a) && isId(a.action_id) && !ids.has(a.action_id) && TYPES.includes(a.type) && isTs(a.queued_at)
        && isInt(a.base_version) && a.base_version >= 0 && isObj(a.payload), `actions[${i}]`);
      if (isObj(a)) ids.add(a.action_id);
    });
  }
  c.done();
}

async function currentVersion(a) {
  if (a.type === 'score_event') {
    const m = await pool.query('SELECT 1 FROM matches WHERE id = $1', [a.payload.match_id]);
    return m.rowCount ? events.matchVersion(a.payload.match_id) : null;
  }
  const p = await pool.query('SELECT 1 FROM players WHERE id = $1', [a.payload.player_id]);
  return p.rowCount ? roster.auditCount(a.payload.player_id) : null;
}

async function processAction(deviceId, a) {
  const prev = await pool.query('SELECT result FROM offline_actions WHERE device_id = $1 AND action_id = $2', [deviceId, a.action_id]);
  if (prev.rowCount) {
    return { status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await currentVersion(a), signature: null };
  }
  const reject = (code, version) => ({ status: 'rejected', resolution: 'server_wins', error_code: code, server_version: version, signature: null });
  const isScore = a.type === 'score_event';
  try {
    if (isScore) events.validateEvent(a.payload); else roster.validateTransfer(a.payload);
  } catch (e) {
    return reject(e.code, await currentVersion(a).catch(() => null));
  }
  if (isScore) {
    const same = await pool.query('SELECT body_key FROM events WHERE event_id = $1', [a.payload.event_id]);
    if (same.rowCount && same.rows[0].body_key === events.bodyKey(a.payload)) {
      return { status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await currentVersion(a), signature: null };
    }
  } else {
    const same = await pool.query('SELECT body_key FROM roster_requests WHERE request_id = $1', [a.payload.request_id]);
    if (same.rowCount && same.rows[0].body_key === roster.transferKey(a.payload)) {
      return { status: 'duplicate', resolution: 'skipped_duplicate', error_code: null, server_version: await currentVersion(a), signature: null };
    }
  }
  const before = await currentVersion(a);
  if (before === null && isScore && a.payload.type !== 'match_init') return reject('MATCH_NOT_FOUND', null);
  if (before === null && !isScore) return reject('PLAYER_NOT_FOUND', null);
  if (before !== null && a.base_version > before) return reject('INVALID_BASE_VERSION', before);
  try {
    const out = isScore ? await events.appendEvent(a.payload) : await roster.transfer(a.payload);
    return {
      status: 'applied', resolution: a.base_version === (before ?? 0) ? 'appended' : 'rebased_append', error_code: null,
      server_version: await currentVersion(a), signature: isScore ? out.body.signature : null,
    };
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    return reject(e.code, before);
  }
}

async function offlineSync(b) {
  validateEnvelope(b);
  return withLock('offline-sync', async () => {
    const order = b.actions.map((a, i) => ({ a, i })).sort((x, y) => (x.a.queued_at < y.a.queued_at ? -1 : x.a.queued_at > y.a.queued_at ? 1 : x.i - y.i));
    const results = new Array(b.actions.length);
    let n = 0;
    for (const { a, i } of order) {
      n += 1;
      const r = await processAction(b.device_id, a);
      results[i] = { action_id: a.action_id, ...r, processed_order: n };
      await pool.query('INSERT INTO offline_actions(device_id, action_id, result) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [b.device_id, a.action_id, results[i]]);
    }
    const ordered = results.map((r) => ({
      action_id: r.action_id, status: r.status, resolution: r.resolution, error_code: r.error_code,
      processed_order: r.processed_order, server_version: r.server_version, signature: r.signature,
    }));
    const summary = { applied: 0, rejected: 0, duplicate: 0 };
    for (const r of ordered) summary[r.status] += 1;
    return { device_id: b.device_id, results: ordered, summary };
  });
}

module.exports = { offlineSync, err };
