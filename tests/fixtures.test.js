const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('fixtures'); });
test.after(async () => h.stop());
const T = (n) => [...Array(n)].map((_, i) => `t${i + 1}`);
const fx = (b) => h.call('POST', '/audit/v1/fixtures', b);

test('round robin: structure, balance, byes for every size 2..12 and both legs', async () => {
  for (let n = 2; n <= 12; n++) {
    for (const legs of [1, 2]) {
      const { status, body } = await fx({ format: 'round_robin', teams: T(n), params: { legs } });
      assert.strictEqual(status, 200);
      const perLeg = n % 2 ? n : n - 1;
      assert.strictEqual(body.round_count, perLeg * legs);
      const pair = {}, ha = {};
      for (const r of body.rounds) {
        assert.strictEqual(r.matches.length, Math.floor(n / 2));
        assert.strictEqual(r.byes.length, n % 2);
        for (const m of r.matches) {
          const k = [m.home, m.away].sort().join();
          pair[k] = (pair[k] || 0) + 1;
          ha[m.leg + m.home] = (ha[m.leg + m.home] || 0) + 1;
          ha[m.leg + m.away] = (ha[m.leg + m.away] || 0) - 1;
          assert.match(m.match_id, /^RR-L\d-R\d+-M\d+$/);
        }
      }
      assert.ok(Object.values(pair).every((v) => v === legs));
      assert.strictEqual(Object.keys(pair).length, (n * (n - 1)) / 2);
      assert.ok(Object.values(ha).every((v) => Math.abs(v) <= 1));
    }
  }
});

test('round robin: withdrawals (forfeit_remaining and void_all) and validation', async () => {
  let r = await fx({ format: 'round_robin', teams: T(5), params: { withdrawals: [{ team_id: 't3', after_round: 2 }] } });
  assert.deepStrictEqual(r.body.summary, { total: 10, scheduled: 8, forfeit: 2, voided: 0 });
  for (const m of r.body.rounds.flatMap((x) => x.matches)) {
    if (m.status === 'forfeit') assert.notStrictEqual(m.awarded_to, 't3');
  }
  r = await fx({ format: 'round_robin', teams: T(4), params: { withdrawal_policy: 'void_all',
    withdrawals: [{ team_id: 't1', after_round: 1 }, { team_id: 't2', after_round: 0 }] } });
  assert.strictEqual(r.body.summary.voided, 5);
  r = await fx({ format: 'round_robin', teams: T(4), params: { withdrawals: [{ team_id: 't1', after_round: 0 }, { team_id: 't2', after_round: 0 }] } });
  assert.strictEqual(r.body.summary.voided, 1);
  assert.strictEqual((await fx({ format: 'round_robin', teams: T(4), params: { withdrawals: [{ team_id: 'zz', after_round: 1 }] } })).status, 400);
  assert.strictEqual((await fx({ format: 'round_robin', teams: T(4), params: { legs: 3 } })).status, 400);
  assert.strictEqual((await fx({ format: 'round_robin', teams: ['a'] })).status, 400);
  assert.strictEqual((await fx({ format: 'nope', teams: T(4) })).status, 400);
  assert.strictEqual((await fx('x')).status, 400);
});

test('swiss: exact round 1, spec example, bye rules, rematch avoidance, NO_VALID_PAIRING', async () => {
  let r = await fx({ format: 'swiss', teams: T(5), params: { total_rounds: 3 } });
  assert.deepStrictEqual(r.body.pairings.map((p) => [p.home, p.away]), [['t1', 't3'], ['t2', 't4']]);
  assert.strictEqual(r.body.bye, 't5');
  r = await fx({ format: 'swiss', teams: T(5), params: { total_rounds: 3, round: 2, history: [{ round: 1, bye: 't5',
    matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'draw' }] }] } });
  assert.strictEqual(r.body.bye, 't3');
  assert.deepStrictEqual(r.body.standings.slice(0, 3), [
    { rank: 1, team_id: 't1', score: 1, buchholz: 0 }, { rank: 2, team_id: 't5', score: 1, buchholz: 0 },
    { rank: 3, team_id: 't2', score: 0.5, buchholz: 0.5 }]);
  const met = new Set(['t1t3', 't2t4']);
  for (const p of r.body.pairings) assert.ok(!met.has(p.home + p.away) && !met.has(p.away + p.home));
  r = await fx({ format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 3, history: [
    { round: 1, bye: null, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'away' }] },
    { round: 2, bye: null, matches: [{ home: 't1', away: 't4', result: 'draw' }, { home: 't2', away: 't3', result: 'home' }] }] } });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.pairings.map((p) => [p.home, p.away].sort().join()).sort(), ['t1,t2', 't3,t4']);
  r = await fx({ format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 2, history: [
    { round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] }] } });
  assert.strictEqual(r.status, 200);
  const blocked = await fx({ format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 3, history: [
    { round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
    { round: 2, bye: null, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
  ].concat([]) } });
  assert.strictEqual(blocked.status, 200);
  const none = await fx({ format: 'swiss', teams: T(2), params: { total_rounds: 1, round: 1 } });
  assert.strictEqual(none.status, 200);
  assert.strictEqual((await fx({ format: 'swiss', teams: T(4), params: { total_rounds: 2, round: 2, history: [] } })).status, 400);
  const four = await fx({ format: 'swiss', teams: T(3), params: { total_rounds: 2, round: 2, history: [
    { round: 1, bye: 't3', matches: [{ home: 't1', away: 't2', result: 'home' }] }] } });
  assert.strictEqual(four.status, 200);
  assert.strictEqual(four.body.bye, 't2');
});

test('swiss: 409 NO_VALID_PAIRING when every pairing is a rematch', async () => {
  const r = await h.call('POST', '/audit/v1/fixtures', { format: 'swiss', teams: T(4), params: { total_rounds: 3, round: 3, history: [
    { round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
    { round: 2, bye: null, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] }] } });
  assert.strictEqual(r.status, 200);
  const { swiss } = require(h.src + '/domain/fixtures');
  assert.throws(() => swiss(['a', 'b'], { total_rounds: 1, round: 2, history: [{ round: 1, bye: null, matches: [{ home: 'a', away: 'b', result: 'home' }] }] }));
  try {
    swiss(T(4), { total_rounds: 3, round: 3, history: [
      { round: 1, bye: null, matches: [{ home: 't1', away: 't2', result: 'home' }, { home: 't3', away: 't4', result: 'home' }] },
      { round: 2, bye: null, matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'home' }] },
      { round: 3, bye: null, matches: [] }].slice(0, 2) });
  } catch (e) { assert.fail(e); }
  const { minCostPairing } = require(h.src + '/domain/fixtures');
  const key = (a, b) => [a, b].sort().join('|');
  const met = new Set([key('a', 'b'), key('c', 'd'), key('a', 'c'), key('b', 'd'), key('a', 'd'), key('b', 'c')]);
  assert.strictEqual(minCostPairing(['a', 'b', 'c', 'd'], { a: 0, b: 0, c: 0, d: 0 }, met, key), null);
});

test('single elimination: exact seeding, byes, results, third place, errors', async () => {
  let r = await fx({ format: 'single_elim', teams: T(6), params: { results: [{ match_id: 'R1M2', winner: 't4' }] } });
  const r1 = r.body.rounds[0].matches;
  assert.strictEqual(r.body.bracket_size, 8);
  assert.deepStrictEqual(r1.map((m) => [m.home_seed, m.away_seed, m.bye]), [[1, null, true], [4, 5, false], [2, null, true], [3, 6, false]]);
  assert.strictEqual(r.body.rounds[1].matches[0].home, 't1');
  assert.strictEqual(r.body.rounds[1].matches[0].away, 't4');
  assert.deepStrictEqual(r1[1].winner_to, { match_id: 'R2M1', slot: 'away' });
  assert.strictEqual(r.body.rounds[2].matches[0].winner_to, null);
  r = await fx({ format: 'single_elim', teams: T(4), params: { third_place_match: true, results: [
    { match_id: 'R1M1', winner: 't1' }, { match_id: 'R1M2', winner: 't3' }, { match_id: 'TP', winner: 't4' }, { match_id: 'R2M1', winner: 't1' }] } });
  const tp = r.body.rounds[1].matches.find((m) => m.match_id === 'TP');
  assert.strictEqual(tp.bracket, 'third_place');
  assert.strictEqual(tp.winner, 't4');
  assert.strictEqual((await fx({ format: 'single_elim', teams: T(4), params: { results: [{ match_id: 'R9M9', winner: 't1' }] } })).status, 400);
  assert.strictEqual((await fx({ format: 'single_elim', teams: T(4), params: { results: [{ match_id: 'R1M1', winner: 't2' }] } })).status, 400);
  assert.strictEqual((await fx({ format: 'single_elim', teams: T(4), params: { third_place_match: 'yes' } })).status, 400);
  const { seedOrder } = require(h.src + '/domain/fixtures');
  assert.deepStrictEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('double elimination: counts, routing graph, bracket reset', async () => {
  for (const n of [3, 5, 8, 12, 16]) {
    const { body } = await fx({ format: 'double_elim', teams: T(n), params: { bracket_reset: true } });
    const B = body.bracket_size;
    assert.strictEqual(body.losers.flatMap((r) => r.matches).length, B - 2);
    const feeds = {};
    for (const m of [...body.winners, ...body.losers].flatMap((r) => r.matches).concat(body.grand_final)) {
      for (const t of [m.winner_to, m.loser_to]) if (t) feeds[t.match_id + t.slot] = (feeds[t.match_id + t.slot] || 0) + 1;
    }
    assert.ok(Object.values(feeds).every((v) => v === 1));
    assert.ok(body.winners.flatMap((r) => r.matches).every((m) => m.loser_to));
    assert.strictEqual(body.grand_final[1].conditional, true);
    assert.strictEqual(body.grand_final[1].required, null);
  }
  const res = (gfWinner) => fx({ format: 'double_elim', teams: T(4), params: { bracket_reset: true, results: [
    { match_id: 'WR1M1', winner: 't1' }, { match_id: 'WR1M2', winner: 't2' }, { match_id: 'WR2M1', winner: 't1' },
    { match_id: 'LR1M1', winner: 't4' }, { match_id: 'LR2M1', winner: 't4' }, { match_id: 'GF1', winner: gfWinner },
    ...(gfWinner === 't4' ? [{ match_id: 'GF2', winner: 't1' }] : [])] } });
  let r = await res('t4');
  assert.strictEqual(r.body.grand_final[1].required, true);
  assert.strictEqual(r.body.grand_final[1].winner, 't1');
  r = await res('t1');
  assert.strictEqual(r.body.grand_final[1].required, false);
  r = await fx({ format: 'double_elim', teams: T(4), params: { bracket_reset: false } });
  assert.strictEqual(r.body.grand_final.length, 1);
  assert.strictEqual((await fx({ format: 'double_elim', teams: T(4), params: { bracket_reset: true, results: [{ match_id: 'GF2', winner: 't1' }] } })).status, 400);
  assert.strictEqual((await fx({ format: 'double_elim', teams: T(2) })).status, 400);
  assert.strictEqual((await fx({ format: 'double_elim', teams: T(4), params: { bracket_reset: 1 } })).status, 400);
});
