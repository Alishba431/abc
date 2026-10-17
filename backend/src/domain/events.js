// Event store service: validation, idempotency, append-only writes with per-match serialisation.
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { canonical, sign } = require('../sign');
const { withLock } = require('../util');
const { Checker, isObj, isId, isInt, isStr } = require('../validate');
const { project, scoreLimitError } = require('./scoring');
const { publish } = require('../queue');

const TYPES = ['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation'];
const COMPENSABLE = ['score', 'discipline', 'tiebreak_winner'];

function validateEvent(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(isId(b.event_id), 'event_id');
  c.check(isId(b.match_id), 'match_id');
  c.check(TYPES.includes(b.type), 'type');
  const p = b.payload;
  if (c.check(isObj(p), 'payload') && TYPES.includes(b.type)) {
    switch (b.type) {
      case 'match_init':
        c.check(isId(p.sport_id), 'payload.sport_id');
        c.check(isId(p.home_team_id), 'payload.home_team_id');
        c.check(isId(p.away_team_id) && p.away_team_id !== p.home_team_id, 'payload.away_team_id');
        if (p.league_id !== undefined && p.league_id !== null) c.check(isId(p.league_id), 'payload.league_id');
        break;
      case 'score':
        c.check(isId(p.team_id), 'payload.team_id');
        c.check(isStr(p.event_type, 1, 64), 'payload.event_type');
        break;
      case 'discipline':
        c.check(isId(p.team_id), 'payload.team_id');
        c.check(isInt(p.points), 'payload.points');
        break;
      case 'tiebreak_winner':
        c.check(isId(p.team_id), 'payload.team_id');
        break;
      case 'compensation':
        c.check(isId(p.compensates), 'payload.compensates');
        c.check(typeof p.reason === 'string', 'payload.reason');
        break;
      default:
    }
  }
  c.done();
}

const bodyKey = (b) => canonical({ match_id: b.match_id, type: b.type, payload: b.payload });

async function loadMatch(q, matchId) {
  const m = await q.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  return m.rows[0] || null;
}

async function loadSport(q, sportId) {
  const s = await q.query('SELECT config FROM sports WHERE id = $1', [sportId]);
  return s.rows[0] ? s.rows[0].config : null;
}

async function loadEvents(q, matchId) {
  const r = await q.query('SELECT * FROM events WHERE match_id = $1 ORDER BY seq', [matchId]);
  return r.rows;
}

const respond = (row, version) => ({
  event_id: row.event_id, match_id: row.match_id, type: row.type, sequence: row.seq,
  match_version: version, signature: row.signature,
});

// Returns { status: 200|201, body }. Throws AppError on rejection.
async function appendEvent(b) {
  validateEvent(b);
  return withLock('match:' + b.match_id, async () => {
    const existing = await pool.query('SELECT * FROM events WHERE event_id = $1', [b.event_id]);
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.body_key !== bodyKey(b)) throw err(409, 'DUPLICATE_EVENT_ID', `Event ${b.event_id} already exists with a different body.`, { event_id: b.event_id });
      return { status: 200, body: respond(row, row.seq) };
    }
    const p = b.payload;
    let match = await loadMatch(pool, b.match_id);

    if (b.type === 'match_init') {
      const sport = await loadSport(pool, p.sport_id);
      if (!sport) throw err(404, 'SPORT_NOT_FOUND', `Sport ${p.sport_id} does not exist.`, { sport_id: p.sport_id });
      if (match) throw err(409, 'MATCH_EXISTS', `Match ${b.match_id} already exists.`, { match_id: b.match_id });
      await pool.query('INSERT INTO matches(id, sport_id, league_id, home, away) VALUES ($1,$2,$3,$4,$5)',
        [b.match_id, p.sport_id, p.league_id || null, p.home_team_id, p.away_team_id]);
      match = await loadMatch(pool, b.match_id);
    } else if (!match) {
      throw err(404, 'MATCH_NOT_FOUND', `Match ${b.match_id} does not exist.`, { match_id: b.match_id });
    }

    const sport = await loadSport(pool, match.sport_id);
    const events = await loadEvents(pool, match.id);
    const proj = project(sport, match, events);
    const teamCheck = () => {
      if (p.team_id !== match.home && p.team_id !== match.away) {
        throw err(400, 'VALIDATION_ERROR', `Team ${p.team_id} is not playing in this match.`, { fields: ['payload.team_id'] });
      }
    };
    const needInProgress = () => {
      if (proj.status !== 'in_progress') throw err(409, 'MATCH_NOT_IN_PROGRESS', 'Match is not in progress.', { match_id: match.id, status: proj.status });
    };

    let compensates = null;
    switch (b.type) {
      case 'match_start':
        if (proj.status !== 'upcoming') throw err(409, 'ILLEGAL_TRANSITION', `Cannot start a match that is ${proj.status}.`, { from: proj.status, to: 'in_progress' });
        break;
      case 'score':
        teamCheck();
        if (!Object.prototype.hasOwnProperty.call(sport.scoring_events, p.event_type)) {
          throw err(400, 'UNKNOWN_EVENT_TYPE', `Event type ${p.event_type} is not defined for ${sport.sport_id}.`, { event_type: p.event_type });
        }
        needInProgress();
        {
          const code = scoreLimitError(sport, proj, p.team_id);
          if (code) throw err(409, code, 'No further scoring is allowed for this team.', { team_id: p.team_id });
        }
        break;
      case 'discipline':
      case 'tiebreak_winner':
        teamCheck();
        needInProgress();
        break;
      case 'match_end':
        if (proj.status !== 'in_progress') throw err(409, 'ILLEGAL_TRANSITION', `Cannot end a match that is ${proj.status}.`, { from: proj.status, to: 'completed' });
        if (proj.home.score === proj.away.score && !sport.draw_allowed && !proj.tiebreak) {
          throw err(409, 'TIE_NOT_ALLOWED', 'Scores are level and this sport does not allow draws.', { match_id: match.id });
        }
        break;
      case 'compensation': {
        const t = await pool.query('SELECT * FROM events WHERE event_id = $1', [p.compensates]);
        if (!t.rowCount) throw err(404, 'EVENT_NOT_FOUND', `Event ${p.compensates} does not exist.`, { event_id: p.compensates });
        const target = t.rows[0];
        if (target.match_id !== match.id || !COMPENSABLE.includes(target.type) || proj.compBy[target.event_id]) {
          throw err(409, 'INVALID_COMPENSATION', `Event ${p.compensates} cannot be compensated.`, { event_id: p.compensates });
        }
        compensates = target.event_id;
        break;
      }
      default:
    }

    const seq = events.length + 1;
    const signature = sign(b.event_id, p);
    const ins = await pool.query(
      `INSERT INTO events(match_id, seq, event_id, type, payload, body_key, signature, compensates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [match.id, seq, b.event_id, b.type, p, bodyKey(b), signature, compensates]);
    publish('match.event_appended', { match_id: match.id, event_id: b.event_id, type: b.type, version: seq });
    return { status: 201, body: respond(ins.rows[0], seq) };
  });
}

async function matchVersion(matchId) {
  const r = await pool.query('SELECT count(*)::int AS n FROM events WHERE match_id = $1', [matchId]);
  return r.rows[0].n;
}

async function scoreView(matchId) {
  const match = await loadMatch(pool, matchId);
  if (!match) throw err(404, 'MATCH_NOT_FOUND', `Match ${matchId} does not exist.`, { match_id: matchId });
  const sport = await loadSport(pool, match.sport_id);
  const events = await loadEvents(pool, match.id);
  const proj = project(sport, match, events);
  return {
    match_id: match.id, sport_id: match.sport_id, league_id: match.league_id || null,
    status: proj.status, outcome: proj.outcome, winner_team_id: proj.winner,
    tiebreak_winner_team_id: proj.tiebreak,
    home: proj.home, away: proj.away, version: events.length,
    events: events.map((e) => ({
      sequence: e.seq, event_id: e.event_id, type: e.type, payload: e.payload, signature: e.signature,
      compensated: !!proj.compBy[e.event_id], compensated_by: proj.compBy[e.event_id] || null,
    })),
  };
}

module.exports = { appendEvent, scoreView, matchVersion, validateEvent, bodyKey, loadSport, loadEvents };
