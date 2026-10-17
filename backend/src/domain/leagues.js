// League registration (5.8) and standings assembly from event logs (5.10).
const { pool, tx } = require('../db');
const { err } = require('../errors');
const { Checker, isObj, isId, isInt } = require('../validate');
const { validTieBreak } = require('./sports');
const { project } = require('./scoring');
const { computeStandings } = require('./standings');

function validateLeague(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(isId(b.league_id), 'league_id');
  c.check(isId(b.sport_id), 'sport_id');
  const teamsOk = c.check(Array.isArray(b.teams) && b.teams.length >= 2 && b.teams.length <= 40
    && b.teams.every(isId) && new Set(b.teams).size === b.teams.length, 'teams');
  if (c.check(Array.isArray(b.fixtures), 'fixtures')) {
    const ts = new Set(teamsOk ? b.teams : []);
    b.fixtures.forEach((f, i) => {
      c.check(isObj(f) && isId(f.match_id) && isId(f.home) && isId(f.away) && f.home !== f.away
        && (!teamsOk || (ts.has(f.home) && ts.has(f.away))), `fixtures[${i}]`);
    });
  }
  if (b.points !== undefined) {
    if (c.check(isObj(b.points), 'points')) {
      for (const k of ['win', 'draw', 'loss']) if (b.points[k] !== undefined) c.check(isInt(b.points[k]), `points.${k}`);
    }
  }
  if (b.tie_break_order !== undefined) c.check(validTieBreak(b.tie_break_order), 'tie_break_order');
  c.check(isObj(b.qualification) && isInt(b.qualification.spots) && b.qualification.spots >= 1
    && (!teamsOk || b.qualification.spots <= b.teams.length), 'qualification.spots');
  if (b.lots_seed !== undefined && b.lots_seed !== null) c.check(isInt(b.lots_seed), 'lots_seed');
  c.done();
}

async function createLeague(b) {
  validateLeague(b);
  const sport = await pool.query('SELECT config FROM sports WHERE id = $1', [b.sport_id]);
  if (!sport.rowCount) throw err(404, 'SPORT_NOT_FOUND', `Sport ${b.sport_id} does not exist.`, { sport_id: b.sport_id });
  return tx(async (c) => {
    await c.query('LOCK TABLE leagues IN EXCLUSIVE MODE');
    if ((await c.query('SELECT 1 FROM leagues WHERE id = $1', [b.league_id])).rowCount) {
      throw err(409, 'LEAGUE_EXISTS', `League ${b.league_id} already exists.`, { league_id: b.league_id });
    }
    const ids = b.fixtures.map((f) => f.match_id);
    const dupInBody = ids.find((id, i) => ids.indexOf(id) !== i);
    const used = await c.query('SELECT id FROM matches WHERE id = ANY($1)', [ids]);
    if (dupInBody || used.rowCount) {
      const id = dupInBody || used.rows[0].id;
      throw err(409, 'MATCH_EXISTS', `Match ${id} already exists.`, { match_id: id });
    }
    const seed = b.lots_seed ?? (await c.query("SELECT value FROM meta WHERE key = 'reset_seed'")).rows[0]?.value ?? 42;
    const data = {
      league_id: b.league_id, sport_id: b.sport_id, teams: b.teams,
      fixtures: b.fixtures.map((f) => ({ match_id: f.match_id, home: f.home, away: f.away })),
      points: { win: 3, draw: 1, loss: 0, ...(b.points || {}) },
      tie_break_order: b.tie_break_order || null,
      spots: b.qualification.spots, lots_seed: seed,
    };
    await c.query('INSERT INTO leagues(id, data) VALUES ($1,$2)', [b.league_id, data]);
    for (const f of b.fixtures) {
      await c.query('INSERT INTO matches(id, sport_id, league_id, home, away) VALUES ($1,$2,$3,$4,$5)',
        [f.match_id, b.sport_id, b.league_id, f.home, f.away]);
    }
    return { league_id: b.league_id, status: 'created', team_count: b.teams.length, fixture_count: b.fixtures.length };
  });
}

async function standings(leagueId) {
  const l = await pool.query('SELECT data FROM leagues WHERE id = $1', [leagueId]);
  if (!l.rowCount) throw err(404, 'LEAGUE_NOT_FOUND', `League ${leagueId} does not exist.`, { league_id: leagueId });
  const league = l.rows[0].data;
  const sport = (await pool.query('SELECT config FROM sports WHERE id = $1', [league.sport_id])).rows[0].config;
  const matches = (await pool.query('SELECT * FROM matches WHERE league_id = $1 ORDER BY ord', [leagueId])).rows;
  const evRows = (await pool.query(
    'SELECT * FROM events WHERE match_id = ANY($1) ORDER BY match_id, seq', [matches.map((m) => m.id)])).rows;
  const byMatch = {};
  for (const e of evRows) (byMatch[e.match_id] = byMatch[e.match_id] || []).push(e);

  const results = [];
  const remaining = {};
  for (const t of league.teams) remaining[t] = 0;
  for (const m of matches) {
    const p = project(sport, m, byMatch[m.id] || []);
    if (p.status === 'completed' && p.outcome !== 'undecided') {
      const H = p.teams[m.home], A = p.teams[m.away];
      results.push({
        home: m.home, away: m.away, hs: H.score, as: A.score, hb: H.balls, ab: A.balls, hw: H.wickets, aw: A.wickets,
        hfp: H.fair_play, afp: A.fair_play, winner: p.winner,
      });
    } else {
      if (m.home in remaining) remaining[m.home]++;
      if (m.away in remaining) remaining[m.away]++;
    }
  }
  const { table, h2h } = computeStandings({
    leagueId, sport, teams: league.teams, results, remaining, points: league.points,
    tieBreak: league.tie_break_order || sport.tie_break_order, spots: league.spots, lotsSeed: league.lots_seed,
  });
  return { league_id: leagueId, sport_id: league.sport_id, qualification_spots: league.spots, table, h2h };
}

module.exports = { createLeague, standings };
