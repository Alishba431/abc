const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('scoring'); });
test.after(async () => h.stop());
let n = 0;
const ev = (match_id, type, payload, event_id = `e${++n}`) => h.call('POST', '/audit/v1/events', { event_id, match_id, type, payload });
const init = (id, sport, home = 'A', away = 'B') => ev(id, 'match_init', { sport_id: sport, home_team_id: home, away_team_id: away });

test('signature recipe matches Appendix A test vector 1', () => {
  const { sign, canonical } = require(h.src + '/sign');
  assert.strictEqual(canonical({ team_id: 't1', event_type: 'goal' }), '{"event_type":"goal","team_id":"t1"}');
  assert.strictEqual(sign('evt-1', { team_id: 't1', event_type: 'goal' }, 'demo-salt'),
    '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501');
  assert.strictEqual(canonical({ b: [1, { d: null, c: true }], a: 'ü' }), '{"a":"ü","b":[1,{"c":true,"d":null}]}');
});

test('mystery sport: create, duplicate, validation, injection', async () => {
  const kabaddi = { sport_id: 'kabaddi', name: 'Kabaddi', scoring_model: 'event', periods: { count: 2, duration_minutes: 20 },
    scoring_events: { raid_point: { points: 1 }, all_out: { points: 2 } }, draw_allowed: false,
    overtime: { policy: 'golden_score', duration_minutes: 5 }, tie_break_order: ['h2h_points', 'scored'],
    roster: { min_squad_size: 7, max_squad_size: 12, required_positions: { raider: 2 } } };
  let r = await h.call('POST', '/audit/v1/sports', kabaddi);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.config.sport_id, 'kabaddi');
  assert.strictEqual((await h.call('POST', '/audit/v1/sports', kabaddi)).body.error.code, 'SPORT_EXISTS');
  r = await h.call('POST', '/audit/v1/sports', { ...kabaddi, sport_id: "x'; DROP TABLE sports;--" });
  assert.strictEqual(r.status, 400);
  assert.deepStrictEqual(r.body.error.details.fields, ['sport_id']);
  r = await h.call('POST', '/audit/v1/sports', { sport_id: 'zz', name: '', scoring_model: 'innings', periods: { innings_per_team: 0 },
    scoring_events: { 'Bad Key': {} }, draw_allowed: 'no', overtime: { policy: 'x', duration_minutes: -1 },
    tie_break_order: ['scored', 'scored'], roster: { min_squad_size: 5, max_squad_size: 2, required_positions: { a: -1 } } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.error.details.fields.length >= 8);
  assert.strictEqual((await h.call('POST', '/audit/v1/sports', { ...kabaddi, sport_id: 'rr', scoring_model: 'round', periods: { best_of: 4 } })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/sports', [])).status, 400);
  await init('k1', 'kabaddi');
  await ev('k1', 'match_start', {});
  await ev('k1', 'score', { team_id: 'A', event_type: 'all_out' });
  assert.strictEqual((await h.call('GET', '/audit/v1/score/k1')).body.home.score, 2);
});

test('event model: lifecycle, errors, idempotency, compensation, tie rules', async () => {
  assert.strictEqual((await ev('nope', 'match_start', {})).body.error.code, 'MATCH_NOT_FOUND');
  assert.strictEqual((await init('x0', 'curling')).body.error.code, 'SPORT_NOT_FOUND');
  let r = await init('b1', 'basketball');
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.sequence, 1);
  const salt = process.env.DAY1_SALT;
  const expected = crypto.createHmac('sha256', salt).update(`${r.body.event_id}|{"away_team_id":"B","home_team_id":"A","sport_id":"basketball"}`).digest('hex');
  assert.strictEqual(r.body.signature, expected);
  assert.strictEqual((await init('b1', 'basketball')).body.error.code, 'MATCH_EXISTS');
  assert.strictEqual((await ev('b1', 'score', { team_id: 'A', event_type: 'three_pointer' })).body.error.code, 'MATCH_NOT_IN_PROGRESS');
  assert.strictEqual((await ev('b1', 'match_end', {})).body.error.code, 'ILLEGAL_TRANSITION');
  assert.strictEqual((await ev('b1', 'match_start', {}, 'start-b1')).status, 201);
  assert.strictEqual((await ev('b1', 'match_start', {}, 'start-b1')).status, 200);
  assert.strictEqual((await ev('b1', 'match_end', {}, 'start-b1')).body.error.code, 'DUPLICATE_EVENT_ID');
  assert.strictEqual((await ev('b1', 'match_start', {})).body.error.code, 'ILLEGAL_TRANSITION');
  assert.strictEqual((await ev('b1', 'score', { team_id: 'C', event_type: 'free_throw' })).status, 400);
  assert.strictEqual((await ev('b1', 'score', { team_id: 'A', event_type: 'goal' })).body.error.code, 'UNKNOWN_EVENT_TYPE');
  assert.strictEqual((await ev('b1', 'score', { team_id: 'A' })).body.error.code, 'VALIDATION_ERROR');
  const three = await ev('b1', 'score', { team_id: 'A', event_type: 'three_pointer' });
  await ev('b1', 'score', { team_id: 'B', event_type: 'two_pointer' });
  await ev('b1', 'score', { team_id: 'B', event_type: 'free_throw' });
  await ev('b1', 'discipline', { team_id: 'B', points: -2 });
  assert.strictEqual((await ev('b1', 'match_end', {})).body.error.code, 'TIE_NOT_ALLOWED');
  const tb = await ev('b1', 'tiebreak_winner', { team_id: 'B' });
  assert.strictEqual((await ev('b1', 'match_end', {})).status, 201);
  let s = (await h.call('GET', '/audit/v1/score/b1')).body;
  assert.strictEqual(s.outcome, 'away_win');
  assert.strictEqual(s.winner_team_id, 'B');
  assert.strictEqual(s.tiebreak_winner_team_id, 'B');
  assert.strictEqual(s.away.fair_play, -2);
  r = await ev('b1', 'compensation', { compensates: tb.body.event_id, reason: 'review' });
  assert.strictEqual(r.status, 201);
  s = (await h.call('GET', '/audit/v1/score/b1')).body;
  assert.strictEqual(s.outcome, 'undecided');
  assert.strictEqual(s.winner_team_id, null);
  assert.strictEqual(s.events.find((e) => e.event_id === tb.body.event_id).compensated_by, r.body.event_id);
  assert.strictEqual((await ev('b1', 'compensation', { compensates: tb.body.event_id, reason: 'x' })).body.error.code, 'INVALID_COMPENSATION');
  assert.strictEqual((await ev('b1', 'compensation', { compensates: 'start-b1', reason: 'x' })).body.error.code, 'INVALID_COMPENSATION');
  assert.strictEqual((await ev('b1', 'compensation', { compensates: 'ghost', reason: 'x' })).body.error.code, 'EVENT_NOT_FOUND');
  await ev('b1', 'compensation', { compensates: three.body.event_id, reason: 'foot on line' });
  s = (await h.call('GET', '/audit/v1/score/b1')).body;
  assert.strictEqual(s.home.score, 0);
  assert.strictEqual(s.outcome, 'away_win');
  assert.strictEqual(s.version, s.events.length);
  assert.strictEqual((await h.call('GET', '/audit/v1/score/ghost')).status, 404);
  await init('f1', 'football');
  await ev('f1', 'match_start', {});
  await ev('f1', 'match_end', {});
  assert.strictEqual((await h.call('GET', '/audit/v1/score/f1')).body.outcome, 'draw');
});

test('innings model: overs, wickets, INNINGS_COMPLETE', async () => {
  await h.call('POST', '/audit/v1/sports', { sport_id: 'mini-cricket', name: 'Mini', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 1, balls_per_over: 6, wickets_per_innings: 2 },
    scoring_events: { hit: { runs: 4, legal_ball: true, wicket: false }, extra: { runs: 1, legal_ball: false, wicket: false },
      out: { runs: 0, legal_ball: true, wicket: true } },
    draw_allowed: true, overtime: { policy: 'super_over' }, roster: { min_squad_size: 2, max_squad_size: 5, required_positions: {} } });
  await init('c1', 'mini-cricket');
  await ev('c1', 'match_start', {});
  await ev('c1', 'score', { team_id: 'A', event_type: 'hit' });
  await ev('c1', 'score', { team_id: 'A', event_type: 'extra' });
  await ev('c1', 'score', { team_id: 'A', event_type: 'out' });
  let s = (await h.call('GET', '/audit/v1/score/c1')).body;
  assert.deepStrictEqual([s.home.score, s.home.wickets, s.home.balls, s.home.overs], [5, 1, 2, '0.2']);
  await ev('c1', 'score', { team_id: 'A', event_type: 'out' });
  assert.strictEqual((await ev('c1', 'score', { team_id: 'A', event_type: 'hit' })).body.error.code, 'INNINGS_COMPLETE');
  for (let i = 0; i < 6; i++) await ev('c1', 'score', { team_id: 'B', event_type: 'hit' });
  assert.strictEqual((await ev('c1', 'score', { team_id: 'B', event_type: 'hit' })).body.error.code, 'INNINGS_COMPLETE');
  s = (await h.call('GET', '/audit/v1/score/c1')).body;
  assert.strictEqual(s.away.overs, '1.0');
});

test('round model: SERIES_ALREADY_DECIDED and compensated rounds do not count', async () => {
  await init('es1', 'esports');
  await ev('es1', 'match_start', {});
  const first = await ev('es1', 'score', { team_id: 'A', event_type: 'round_win' });
  await ev('es1', 'score', { team_id: 'A', event_type: 'round_win' });
  assert.strictEqual((await ev('es1', 'score', { team_id: 'B', event_type: 'round_win' })).body.error.code, 'SERIES_ALREADY_DECIDED');
  await ev('es1', 'compensation', { compensates: first.body.event_id, reason: 'replay' });
  assert.strictEqual((await ev('es1', 'score', { team_id: 'B', event_type: 'round_win' })).status, 201);
  const s = (await h.call('GET', '/audit/v1/score/es1')).body;
  assert.deepStrictEqual([s.home.score, s.away.score, s.home.wickets], [1, 1, null]);
});
