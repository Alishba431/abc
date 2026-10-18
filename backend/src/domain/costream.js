// 4-way co-stream sessions with deterministic host-drop handoff (Part II Section 5.5).
const crypto = require('crypto');
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { canonical, signDay2 } = require('../sign');
const { withLock } = require('../util');
const { isObj } = require('../validate');
const { publish } = require('../queue');
const { missingPlayer } = require('./players');

const LAYOUTS = ['solo', 'grid_2', 'grid_4', 'spotlight'];
const MAX_PARTICIPANTS = 4;
const host = () => process.env.MEDIA_PUBLIC_HOST || 'localhost';
const isNonEmptyStr = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 128;

function validateSession(b) {
  const bad = [];
  if (!isObj(b)) throw validation(['body']);
  if (!isNonEmptyStr(b.session_id)) bad.push('session_id');
  if (!isNonEmptyStr(b.host_player_id)) bad.push('host_player_id');
  if (!Array.isArray(b.participants) || b.participants.length === 0 || !b.participants.every(isNonEmptyStr)
    || new Set(b.participants).size !== b.participants.length) bad.push('participants');
  if (b.simulate_host_drop !== undefined && typeof b.simulate_host_drop !== 'boolean') bad.push('simulate_host_drop');
  if (b.layout !== undefined && !LAYOUTS.includes(b.layout)) bad.push('layout');
  if (bad.length) throw validation(bad);
}

// Pure state machine: who hosts after an (optional) abrupt host drop.
function evaluate(b) {
  const layout = b.layout || 'grid_4';
  const drop = b.simulate_host_drop === true;
  let state;
  if (!drop) {
    state = { status: 'active', active_host: b.host_player_id, handoff_occurred: false, active_participants: [...b.participants] };
  } else if (b.participants.length >= 2) {
    const remaining = b.participants.filter((p) => p !== b.host_player_id);
    state = { status: 'active', active_host: remaining[0], handoff_occurred: true, active_participants: remaining };
  } else {
    state = { status: 'terminated', active_host: null, handoff_occurred: false, active_participants: [] };
  }
  state.participant_count = state.active_participants.length;
  state.layout = layout;
  return state;
}

function layoutFits(layout, count) {
  if (layout === 'solo') return count <= 1;
  if (layout === 'grid_2') return count <= 2;
  return true;
}

function view(sessionId, s) {
  return {
    session_id: sessionId,
    status: s.status,
    active_host: s.active_host,
    handoff_occurred: s.handoff_occurred,
    participant_count: s.participant_count,
    active_participants: s.active_participants,
    layout: s.layout,
    composite_playback_url: s.status === 'active' ? `http://${host()}:8888/costream/${sessionId}/index.m3u8` : null,
    chat_room_id: `chat-${sessionId}`,
    signature: signDay2(sessionId, {
      active_host: s.active_host, handoff_occurred: s.handoff_occurred, layout: s.layout,
      participant_count: s.participant_count, session_id: sessionId, status: s.status,
    }),
  };
}

const bodyKey = (b) => canonical({
  host_player_id: b.host_player_id, participants: b.participants, layout: b.layout || 'grid_4',
  simulate_host_drop: b.simulate_host_drop === true,
});

async function costreamSession(b) {
  validateSession(b);
  return withLock('costream:' + b.session_id, async () => {
    const missing = await missingPlayer(pool, [b.host_player_id, ...b.participants]);
    if (missing) throw err(404, 'PLAYER_NOT_FOUND', `Player ${missing} does not exist.`, { player_id: missing });
    if (!b.participants.includes(b.host_player_id)) {
      throw err(400, 'VALIDATION_ERROR', 'host_player_id must be one of the participants.', { fields: ['host_player_id'] });
    }
    if (b.participants.length > MAX_PARTICIPANTS) {
      throw err(409, 'COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_PARTICIPANTS} broadcasters.`,
        { session_id: b.session_id, max_participants: MAX_PARTICIPANTS });
    }
    const state = evaluate(b);
    if (!layoutFits(state.layout, state.participant_count)) {
      throw err(400, 'UNSUPPORTED_LAYOUT', `Layout ${state.layout} cannot fit ${state.participant_count} participants.`,
        { layout: state.layout, participant_count: state.participant_count });
    }
    const key = bodyKey(b);
    const prev = await pool.query('SELECT body_key, state FROM costream_sessions WHERE session_id = $1', [b.session_id]);
    if (prev.rowCount && prev.rows[0].body_key === key) return { status: 200, body: view(b.session_id, prev.rows[0].state) };
    const stored = { ...state, host_player_id: b.host_player_id, participants: b.participants };
    await pool.query(`INSERT INTO costream_sessions(session_id, body_key, state) VALUES ($1,$2,$3)
      ON CONFLICT (session_id) DO UPDATE SET body_key = EXCLUDED.body_key, state = EXCLUDED.state, updated_at = now()`,
    [b.session_id, key, stored]);
    publish('costream.session_updated', { session_id: b.session_id, status: state.status, active_host: state.active_host });
    return { status: 201, body: view(b.session_id, stored) };
  });
}

// FR-3.3 host controls (signed invites, mute, spotlight, kick) live in state.controls, apart from the audited
// fields, so an identical /audit/v1/costream/session replay still returns exactly what it returned before.
function live(s) {
  const c = s.controls || {};
  const kicked = new Set(c.kicked || []);
  const joined = (c.joined || []).filter((p) => !s.active_participants.includes(p));
  const participants = [...s.active_participants, ...joined].filter((p) => !kicked.has(p));
  return {
    participants,
    muted: (c.muted || []).filter((p) => participants.includes(p)),
    spotlight: participants.includes(c.spotlight) ? c.spotlight : null,
  };
}

async function getSession(sessionId) {
  const r = await pool.query('SELECT state FROM costream_sessions WHERE session_id = $1', [sessionId]);
  if (!r.rowCount) return null;
  const s = r.rows[0].state;
  const l = live(s);
  const effective = { ...s, active_participants: l.participants, participant_count: l.participants.length,
    layout: l.spotlight ? 'spotlight' : s.layout };
  return { ...view(sessionId, effective), muted_participants: l.muted, spotlight: l.spotlight };
}

const INVITE_TTL_SEC = 15 * 60;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

function makeInvite(sessionId, playerId) {
  const claims = { exp: Math.floor(Date.now() / 1000) + INVITE_TTL_SEC, player_id: playerId, session_id: sessionId };
  const token = `${b64(claims)}.${signDay2(sessionId, claims)}`;
  return { invite_token: token, expires_at: new Date(claims.exp * 1000).toISOString(),
    deep_link_uri: `nascon://stream/${sessionId}?invite=${token}` };
}

function readInvite(token) {
  const [body, sig] = typeof token === 'string' ? token.split('.') : [];
  let claims;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch (_) { throw validation(['invite_token']); }
  if (!isObj(claims) || !isNonEmptyStr(claims.session_id) || !isNonEmptyStr(claims.player_id)) throw validation(['invite_token']);
  const want = Buffer.from(signDay2(claims.session_id, claims));
  const got = Buffer.from(String(sig || ''));
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want) || claims.exp * 1000 < Date.now()) {
    throw err(403, 'FORBIDDEN', 'This invite is invalid or has expired.');
  }
  return claims;
}

async function loadForUpdate(sessionId) {
  const r = await pool.query('SELECT state FROM costream_sessions WHERE session_id = $1', [sessionId]);
  if (!r.rowCount) throw err(404, 'STREAM_NOT_FOUND', 'That co-stream does not exist.', { session_id: sessionId });
  const s = r.rows[0].state;
  if (s.status !== 'active') throw err(404, 'STREAM_NOT_FOUND', 'This co-stream has ended.', { session_id: sessionId });
  return s;
}

async function saveControls(sessionId, s, controls, event) {
  await pool.query('UPDATE costream_sessions SET state = $2, updated_at = now() WHERE session_id = $1',
    [sessionId, { ...s, controls }]);
  publish('costream.session_updated', { session_id: sessionId, status: s.status, active_host: s.active_host, ...event });
  return { status: 200, body: await getSession(sessionId) };
}

const CONTROL_ACTIONS = ['invite', 'mute', 'unmute', 'spotlight', 'kick'];

async function hostControl(user, sessionId, b) {
  const bad = [];
  if (!isObj(b) || !CONTROL_ACTIONS.includes(b.action)) bad.push('action');
  if (!isObj(b) || !isNonEmptyStr(b.player_id)) bad.push('player_id');
  if (bad.length) throw validation(bad);
  return withLock('costream:' + sessionId, async () => {
    const s = await loadForUpdate(sessionId);
    if (user.role !== 'super_admin' && user.player_id !== s.active_host) {
      throw err(403, 'FORBIDDEN', 'Only the co-stream host can do that.', { active_host: s.active_host });
    }
    const l = live(s);
    const c = { muted: [], kicked: [], joined: [], spotlight: null, ...(s.controls || {}) };
    if (b.action === 'invite') {
      const missing = await missingPlayer(pool, [b.player_id]);
      if (missing) throw err(404, 'PLAYER_NOT_FOUND', `Player ${missing} does not exist.`, { player_id: missing });
      if (!l.participants.includes(b.player_id) && l.participants.length >= MAX_PARTICIPANTS) {
        throw err(409, 'COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_PARTICIPANTS} broadcasters.`,
          { session_id: sessionId, max_participants: MAX_PARTICIPANTS });
      }
      c.kicked = c.kicked.filter((p) => p !== b.player_id);
      await pool.query('UPDATE costream_sessions SET state = $2 WHERE session_id = $1', [sessionId, { ...s, controls: c }]);
      publish('costream.invite', { session_id: sessionId, player_id: b.player_id });
      return { status: 201, body: makeInvite(sessionId, b.player_id) };
    }
    if (!l.participants.includes(b.player_id)) {
      throw err(404, 'PLAYER_NOT_FOUND', `${b.player_id} is not broadcasting in this co-stream.`, { player_id: b.player_id });
    }
    if (b.action === 'kick') {
      if (b.player_id === s.active_host) throw err(400, 'VALIDATION_ERROR', 'The host cannot remove themselves.', { fields: ['player_id'] });
      c.kicked = [...new Set([...c.kicked, b.player_id])];
    }
    if (b.action === 'mute') c.muted = [...new Set([...c.muted, b.player_id])];
    if (b.action === 'unmute') c.muted = c.muted.filter((p) => p !== b.player_id);
    if (b.action === 'spotlight') c.spotlight = b.player_id;
    return saveControls(sessionId, s, c, { action: b.action, player_id: b.player_id });
  });
}

async function joinWithInvite(user, sessionId, b) {
  if (!isObj(b) || typeof b.invite_token !== 'string') throw validation(['invite_token']);
  const claims = readInvite(b.invite_token);
  if (claims.session_id !== sessionId || (user.player_id !== claims.player_id && user.role !== 'super_admin')) {
    throw err(403, 'FORBIDDEN', 'This invite is for someone else.');
  }
  return withLock('costream:' + sessionId, async () => {
    const s = await loadForUpdate(sessionId);
    const l = live(s);
    const c = { muted: [], kicked: [], joined: [], spotlight: null, ...(s.controls || {}) };
    if (c.kicked.includes(claims.player_id)) throw err(403, 'FORBIDDEN', 'The host removed you from this co-stream.');
    if (l.participants.includes(claims.player_id)) return { status: 200, body: await getSession(sessionId) };
    if (l.participants.length >= MAX_PARTICIPANTS) {
      throw err(409, 'COSTREAM_SESSION_FULL', `A co-stream supports at most ${MAX_PARTICIPANTS} broadcasters.`,
        { session_id: sessionId, max_participants: MAX_PARTICIPANTS });
    }
    c.joined = [...new Set([...c.joined, claims.player_id])];
    return saveControls(sessionId, s, c, { action: 'join', player_id: claims.player_id });
  });
}

module.exports = { costreamSession, getSession, hostControl, joinWithInvite, evaluate, layoutFits };
