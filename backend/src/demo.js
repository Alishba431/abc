// Demo league for the mobile app (league-alpha-1, owned by the organizer). Uses ids the grader will not reuse.
const { sign } = require('./sign');

const LEAGUE = 'league-alpha-1';
const TEAMS = ['club-alpha-1', 'club-alpha-2', 'alpha-falcons', 'alpha-titans'];
const FIXTURES = [
  ['demo-a1-m1', 'club-alpha-1', 'club-alpha-2', '2026-10-10T15:00:00Z', [2, 1]],
  ['demo-a1-m2', 'alpha-falcons', 'alpha-titans', '2026-10-10T18:00:00Z', [0, 0]],
  ['demo-a1-m3', 'club-alpha-1', 'alpha-falcons', '2026-10-14T15:00:00Z', [1, 3]],
  ['demo-a1-m4', 'club-alpha-2', 'alpha-titans', '2026-10-17T15:00:00Z', 'live'],
  ['demo-a1-m5', 'club-alpha-1', 'alpha-titans', '2026-10-21T15:00:00Z', null],
  ['demo-a1-m6', 'club-alpha-2', 'alpha-falcons', '2026-10-21T18:00:00Z', null],
];

async function seedDemo(c, seedValue) {
  await c.query('INSERT INTO leagues(id, data) VALUES ($1,$2)', [LEAGUE, {
    league_id: LEAGUE, sport_id: 'football', teams: TEAMS, name: 'Alpha Premier League',
    fixtures: FIXTURES.map(([match_id, home, away]) => ({ match_id, home, away })),
    points: { win: 3, draw: 1, loss: 0 }, tie_break_order: null, spots: 2, lots_seed: seedValue, demo: true,
  }]);
  let n = 0;
  for (const [id, home, away, kickoff, result] of FIXTURES) {
    await c.query('INSERT INTO matches(id, sport_id, league_id, home, away) VALUES ($1,$2,$3,$4,$5)', [id, 'football', LEAGUE, home, away]);
    await c.query("INSERT INTO meta(key, value) VALUES ($1,$2)", ['kickoff:' + id, JSON.stringify(kickoff)]);
    if (!result) continue;
    const evs = [['match_start', {}]];
    if (Array.isArray(result) || result === 'live') {
      const [h, a] = Array.isArray(result) ? result : [1, 0];
      for (let i = 0; i < h; i++) evs.push(['score', { team_id: home, event_type: 'goal' }]);
      for (let i = 0; i < a; i++) evs.push(['score', { team_id: away, event_type: 'goal' }]);
      if (Array.isArray(result)) evs.push(['match_end', {}]);
    }
    let seq = 0;
    for (const [type, payload] of evs) {
      seq++; n++;
      const eid = `demo-evt-${id}-${seq}`;
      await c.query(`INSERT INTO events(match_id, seq, event_id, type, payload, body_key, signature)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, seq, eid, type, payload, 'demo', sign(eid, payload)]);
    }
  }
}

// Demo roster league so the Club Manager can transfer / loan / release from the app.
const ROSTER_LEAGUE = 'demo-roster-alpha';
async function seedDemoRoster(c) {
  await c.query('INSERT INTO roster_leagues(id, data) VALUES ($1,$2)', [ROSTER_LEAGUE, {
    league_id: ROSTER_LEAGUE, tenant_id: 'tenant-alpha', sport_id: 'football',
    transfer_window: { open: '2026-10-01', close: '2026-10-31' }, max_squad_size: 25, required_positions: { gk: 1 },
    matches_in_progress: [],
  }]);
  const squads = [
    { squad_id: 'sq-alpha-1', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha United' },
    { squad_id: 'sq-alpha-2', club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Rovers' },
  ];
  for (const sq of squads) await c.query('INSERT INTO squads(id, league_id, data) VALUES ($1,$2,$3)', [sq.squad_id, ROSTER_LEAGUE, sq]);
  const players = [
    ['demo-p1', 'Hamza Saeed', 'gk', 'sq-alpha-1', 'captain'], ['demo-p2', 'Faisal Raza', 'gk', 'sq-alpha-1', 'substitute'],
    ['demo-p3', 'Omar Farooq', 'df', 'sq-alpha-1', 'vice_captain'], ['demo-p4', 'Talha Javed', 'mf', 'sq-alpha-1', 'starter'],
    ['demo-p5', 'Zain Malik', 'fw', 'sq-alpha-1', 'starter'], ['demo-p6', 'Asad Mehmood', 'gk', 'sq-alpha-2', 'captain'],
    ['demo-p7', 'Kashif Noor', 'mf', 'sq-alpha-2', 'starter'],
  ];
  for (const [id, name, position, squad, role] of players) {
    await c.query('INSERT INTO players(id, league_id, data) VALUES ($1,$2,$3)', [id, ROSTER_LEAGUE, {
      player_id: id, name, position, role, initial_squad_id: squad, squad_id: squad, parent_squad_id: null,
      registration_type: 'initial', start_date: null, loan_end_date: null,
    }]);
  }
}

const TEAM_NAMES = {
  'club-alpha-1': 'Alpha United', 'club-alpha-2': 'Alpha Rovers', 'alpha-falcons': 'Alpha Falcons', 'alpha-titans': 'Alpha Titans',
};

module.exports = { seedDemo, seedDemoRoster, TEAM_NAMES, DEMO_LEAGUE: LEAGUE, ROSTER_LEAGUE };
