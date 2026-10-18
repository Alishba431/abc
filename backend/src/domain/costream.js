// 4-way co-stream sessions with deterministic host-drop handoff (Part II Section 5.5).
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

async function getSession(sessionId) {
  const r = await pool.query('SELECT state FROM costream_sessions WHERE session_id = $1', [sessionId]);
  return r.rowCount ? view(sessionId, r.rows[0].state) : null;
}

module.exports = { costreamSession, getSession, evaluate, layoutFits };
