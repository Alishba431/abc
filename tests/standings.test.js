const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('standings'); });
test.after(async () => h.stop());
let n = 0;
const ev = (match_id, type, payload) => h.call('POST', '/audit/v1/events', { event_id: `s${++n}`, match_id, type, payload });
async function play(m, home, away, hs, as, ev2 = 'goal') {
  await ev(m, 'match_start', {});
  for (let i = 0; i < hs; i++) await ev(m, 'score', { team_id: home, event_type: ev2 });
  for (let i = 0; i < as; i++) await ev(m, 'score', { team_id: away, event_type: ev2 });
  return ev(m, 'match_end', {});
}

test('three-way H2H mini-league with restart-on-split, h2h matrix, qualification', async () => {
  const fixtures = [['m1', 't1', 't2'], ['m2', 't2', 't3'], ['m3', 't3', 't1'], ['m4', 't1', 't4'], ['m5', 't2', 't4'], ['m6', 't3', 't4']]
    .map(([match_id, home, away]) => ({ match_id, home, away }));
  let r = await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-1', sport_id: 'football', teams: ['t1', 't2', 't3', 't4'], fixtures, qualification: { spots: 2 } });
  assert.deepStrictEqual(r.body, { league_id: 'lg-1', status: 'created', team_count: 4, fixture_count: 6 });
  await play('m1', 't1', 't2', 1, 0);
  await play('m2', 't2', 't3', 2, 0);
  await play('m3', 't3', 't1', 3, 0);
  let s = (await h.call('GET', '/audit/v1/standings/lg-1')).body;
  assert.deepStrictEqual(s.table.map((x) => [x.team_id, x.resolved_by]), [['t2', 'h2h_points'], ['t3', 'h2h_diff'], ['t1', null], ['t4', null]]);
  assert.deepStrictEqual(s.h2h.t1.t2, { played: 1, points: 3, scored: 1, conceded: 0 });
  assert.deepStrictEqual(s.h2h.t4.t1, { played: 0, points: 0, scored: 0, conceded: 0 });
  assert.ok(s.table.every((x) => x.status === 'still_possible'));
  await play('m4', 't1', 't4', 5, 0);
  await play('m5', 't2', 't4', 5, 0);
  const last = await play('m6', 't3', 't4', 0, 1);
  s = (await h.call('GET', '/audit/v1/standings/lg-1')).body;
  const st = Object.fromEntries(s.table.map((x) => [x.team_id, x.status]));
  assert.strictEqual(st.t1, 'clinched');
  assert.strictEqual(st.t3, 'eliminated');
  assert.ok(last.status === 201);
  assert.strictEqual((await h.call('GET', '/audit/v1/standings/nope')).status, 404);
});

test('draw_lots ordering matches Appendix A test vector 2', async () => {
  const fixtures = [{ match_id: 'd1', home: 't1', away: 't2' }];
  await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-lots', sport_id: 'football', teams: ['t1', 't2', 't3'], fixtures, qualification: { spots: 1 }, lots_seed: 42 });
  const s = (await h.call('GET', '/audit/v1/standings/lg-lots')).body;
  const key = (t) => crypto.createHash('sha256').update(`42|lg-lots|${t}`).digest('hex');
  const expected = ['t1', 't2', 't3'].sort((a, b) => (key(a) < key(b) ? -1 : 1));
  assert.deepStrictEqual(s.table.map((x) => x.team_id), expected);
  assert.strictEqual(s.table[0].resolved_by, 'draw_lots');
  assert.strictEqual(s.table[2].resolved_by, null);
});

test('compensation after completion recomputes standings from scratch', async () => {
  await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-c', sport_id: 'football', teams: ['a', 'b'],
    fixtures: [{ match_id: 'c1', home: 'a', away: 'b' }], points: { win: 2, draw: 1, loss: 0 }, tie_break_order: ['scored'], qualification: { spots: 1 } });
  await ev('c1', 'match_start', {});
  const g = await ev('c1', 'score', { team_id: 'a', event_type: 'goal' });
  await ev('c1', 'match_end', {});
  let s = (await h.call('GET', '/audit/v1/standings/lg-c')).body;
  assert.strictEqual(s.table[0].team_id, 'a');
  assert.strictEqual(s.table[0].points, 2);
  await ev('c1', 'compensation', { compensates: g.body.event_id, reason: 'offside' });
  s = (await h.call('GET', '/audit/v1/standings/lg-c')).body;
  assert.ok(s.table.every((x) => x.points === 1 && x.drawn === 1));
});

test('innings NRR (all-out uses full overs) and round-model map differential', async () => {
  await h.call('POST', '/audit/v1/sports', { sport_id: 'sixes', name: 'Sixes', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 2, balls_per_over: 6, wickets_per_innings: 1 },
    scoring_events: { six: { runs: 6, legal_ball: true, wicket: false }, out: { runs: 0, legal_ball: true, wicket: true } },
    draw_allowed: true, overtime: { policy: 'none' }, roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} } });
  await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-i', sport_id: 'sixes', teams: ['x', 'y'], fixtures: [{ match_id: 'i1', home: 'x', away: 'y' }], qualification: { spots: 1 } });
  await ev('i1', 'match_start', {});
  for (let i = 0; i < 3; i++) await ev('i1', 'score', { team_id: 'x', event_type: 'six' });
  await ev('i1', 'score', { team_id: 'y', event_type: 'out' });
  await ev('i1', 'match_end', {});
  const s = (await h.call('GET', '/audit/v1/standings/lg-i')).body;
  const x = s.table.find((t) => t.team_id === 'x');
  // x: 18 runs / 0.5 overs - 0 / 2 overs (y all out) = 36
  assert.strictEqual(x.diff, 36);
  await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-e', sport_id: 'esports', teams: ['p', 'q'], fixtures: [{ match_id: 'r1', home: 'p', away: 'q' }], qualification: { spots: 1 } });
  await play('r1', 'p', 'q', 2, 1, 'round_win');
  const e = (await h.call('GET', '/audit/v1/standings/lg-e')).body;
  assert.strictEqual(e.table[0].diff, 1);
});

test('league validation and conflicts', async () => {
  const base = { league_id: 'lg-v', sport_id: 'football', teams: ['a', 'b'], fixtures: [{ match_id: 'v1', home: 'a', away: 'b' }], qualification: { spots: 1 } };
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, sport_id: 'polo' })).body.error.code, 'SPORT_NOT_FOUND');
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, teams: ['a'] })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, fixtures: [{ match_id: 'v1', home: 'a', away: 'a' }] })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, qualification: { spots: 3 } })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, points: { win: 'x' }, tie_break_order: ['bad'], lots_seed: 'x' })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', base)).status, 201);
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', base)).body.error.code, 'LEAGUE_EXISTS');
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', { ...base, league_id: 'lg-v2' })).body.error.code, 'MATCH_EXISTS');
  assert.strictEqual((await h.call('POST', '/audit/v1/leagues', 'x')).status, 400);
});
