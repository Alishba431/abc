// Fixture generation (Section 5.7). Pure computation, custom implementations only.
const { err } = require('../errors');
const { Checker, isObj, isId, isInt } = require('../validate');

// ---------- Round robin (circle method) ----------
// Orientation that keeps |home - away| <= 1 for every team within a leg.
function homeOf(i, j, m) {
  // i < j are indexes into the real team list, m = number of real teams
  if (m % 2 === 1) return j - i <= (m - 1) / 2 ? i : j;
  const last = m - 1;
  if (j === last) return i % 2 === 0 ? last : i;
  return j - i <= (m - 2) / 2 ? i : j;
}

function roundRobin(teams, params) {
  const c = new Checker();
  const legs = params.legs === undefined ? 1 : params.legs;
  c.check(legs === 1 || legs === 2, 'params.legs');
  const policy = params.withdrawal_policy === undefined ? 'forfeit_remaining' : params.withdrawal_policy;
  c.check(policy === 'forfeit_remaining' || policy === 'void_all', 'params.withdrawal_policy');
  const withdrawals = params.withdrawals === undefined ? [] : params.withdrawals;
  c.check(Array.isArray(withdrawals), 'params.withdrawals');
  c.done();

  const n = teams.length;
  const perLeg = n % 2 === 0 ? n - 1 : n;
  const roundCount = perLeg * legs;
  const w = {};
  withdrawals.forEach((x, i) => {
    c.check(isObj(x) && teams.includes(x.team_id) && !(x.team_id in w)
      && isInt(x.after_round) && x.after_round >= 0 && x.after_round <= roundCount, `params.withdrawals[${i}]`);
    if (isObj(x)) w[x.team_id] = x.after_round;
  });
  c.done();

  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const slots = n % 2 === 0 ? [...teams] : [...teams, null];
  const N = slots.length;
  const rounds = [];
  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };
  for (let leg = 1; leg <= legs; leg++) {
    let arr = [...slots];
    for (let r = 0; r < N - 1; r++) {
      const roundNo = (leg - 1) * perLeg + r + 1;
      const matches = [];
      const byes = [];
      for (let i = 0; i < N / 2; i++) {
        const a = arr[i], b = arr[N - 1 - i];
        if (a === null || b === null) { byes.push(a === null ? b : a); continue; }
        const [lo, hi] = idx[a] < idx[b] ? [a, b] : [b, a];
        let home = homeOf(idx[lo], idx[hi], n) === idx[lo] ? lo : hi;
        let away = home === lo ? hi : lo;
        if (leg === 2) [home, away] = [away, home];
        let status = 'scheduled', awardedTo = null;
        const wh = home in w, wa = away in w;
        if (policy === 'void_all') {
          if (wh || wa) status = 'voided';
        } else {
          const outH = wh && roundNo > w[home], outA = wa && roundNo > w[away];
          if (outH && outA) status = 'voided';
          else if (outH) { status = 'forfeit'; awardedTo = away; }
          else if (outA) { status = 'forfeit'; awardedTo = home; }
        }
        summary.total++;
        summary[status]++;
        matches.push({ match_id: `RR-L${leg}-R${roundNo}-M${matches.length + 1}`, leg, home, away, status, awarded_to: awardedTo });
      }
      rounds.push({ round: roundNo, matches, byes });
      arr = [arr[0], arr[N - 1], ...arr.slice(1, N - 1)];
    }
  }
  return { format: 'round_robin', legs, team_count: n, round_count: roundCount, rounds, summary };
}

// ---------- Swiss ----------
function swiss(teams, params) {
  const n = teams.length;
  const c = new Checker();
  const totalRounds = params.total_rounds === undefined ? Math.ceil(Math.log2(n)) : params.total_rounds;
  c.check(isInt(totalRounds) && totalRounds >= 1 && totalRounds <= n - 1, 'params.total_rounds');
  const round = params.round === undefined ? 1 : params.round;
  c.check(isInt(round) && round >= 1 && (!isInt(totalRounds) || round <= totalRounds), 'params.round');
  const history = params.history === undefined ? [] : params.history;
  c.check(Array.isArray(history), 'params.history');
  c.done();
  const set = new Set(teams);
  const seen = new Set();
  history.forEach((h, i) => {
    const ok = isObj(h) && isInt(h.round) && h.round >= 1 && h.round < round && !seen.has(h.round)
      && (h.bye === null || h.bye === undefined || set.has(h.bye)) && Array.isArray(h.matches)
      && h.matches.every((m) => isObj(m) && set.has(m.home) && set.has(m.away) && m.home !== m.away
        && ['home', 'away', 'draw'].includes(m.result));
    c.check(ok, `params.history[${i}]`);
    if (isObj(h)) seen.add(h.round);
  });
  c.check(history.length === round - 1, 'params.history');
  c.done();

  const idx = Object.fromEntries(teams.map((t, i) => [t, i]));
  const score = Object.fromEntries(teams.map((t) => [t, 0]));
  const opps = Object.fromEntries(teams.map((t) => [t, []]));
  const hadBye = new Set();
  const met = new Set();
  const key = (a, b) => (idx[a] < idx[b] ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const h of history) {
    if (h.bye) { score[h.bye] += 1; hadBye.add(h.bye); }
    for (const m of h.matches) {
      opps[m.home].push(m.away); opps[m.away].push(m.home);
      met.add(key(m.home, m.away));
      if (m.result === 'home') score[m.home] += 1;
      else if (m.result === 'away') score[m.away] += 1;
      else { score[m.home] += 0.5; score[m.away] += 0.5; }
    }
  }
  const buch = Object.fromEntries(teams.map((t) => [t, opps[t].reduce((s, o) => s + score[o], 0)]));
  const ranked = [...teams].sort((a, b) => score[b] - score[a] || buch[b] - buch[a] || idx[a] - idx[b]);
  const standings = ranked.map((t, i) => ({ rank: i + 1, team_id: t, score: score[t], buchholz: buch[t] }));

  let pairs = null, bye = null;
  if (round === 1) {
    const m = Math.floor(n / 2);
    pairs = [];
    for (let i = 0; i < m; i++) pairs.push([teams[i], teams[i + m]]);
    if (n % 2 === 1) bye = teams[n - 1];
  } else {
    let candidates = [null];
    if (n % 2 === 1) {
      const pool = teams.filter((t) => !hadBye.has(t));
      candidates = (pool.length ? pool : [...teams]).sort((a, b) => score[a] - score[b] || idx[b] - idx[a]);
    }
    for (const cand of candidates) {
      const rest = ranked.filter((t) => t !== cand);
      const found = minCostPairing(rest, score, met, key);
      if (found) { pairs = found; bye = cand; break; }
    }
    if (!pairs) throw err(409, 'NO_VALID_PAIRING', `No rematch-free pairing exists for round ${round}.`, { round });
  }
  const pairings = pairs.map(([a, b], i) => {
    const [home, away] = round === 1 ? [a, b] : ranked.indexOf(a) <= ranked.indexOf(b) ? [a, b] : [b, a];
    return { match_id: `SW-R${round}-M${i + 1}`, home, away };
  });
  return { format: 'swiss', round, total_rounds: totalRounds, pairings, bye, standings };
}

// Exact minimum sum of |score difference| over rematch-free perfect matchings (branch and bound).
function minCostPairing(list, score, met, key) {
  const n = list.length;
  if (n === 0) return [];
  const used = new Array(n).fill(false);
  let best = Infinity, bestPairs = null;
  const cur = [];
  const deadline = Date.now() + 3500;
  // Lower bound: half the sum, over unpaired teams, of the cheapest legal partner.
  function lowerBound() {
    let lb = 0;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      let m = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i || used[j] || met.has(key(list[i], list[j]))) continue;
        const d = Math.abs(score[list[i]] - score[list[j]]);
        if (d < m) m = d;
      }
      if (m === Infinity) return Infinity;
      lb += m;
    }
    return lb / 2;
  }
  function go(cost) {
    if (best === 0 || Date.now() > deadline) return;
    let i = used.indexOf(false);
    if (i === -1) { if (cost < best) { best = cost; bestPairs = cur.slice(); } return; }
    if (cost + lowerBound() >= best) return;
    used[i] = true;
    const opts = [];
    for (let j = i + 1; j < n; j++) {
      if (!used[j] && !met.has(key(list[i], list[j]))) opts.push([Math.abs(score[list[i]] - score[list[j]]), j]);
    }
    opts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [d, j] of opts) {
      if (cost + d >= best) break;
      used[j] = true;
      cur.push([list[i], list[j]]);
      go(cost + d);
      cur.pop();
      used[j] = false;
    }
    used[i] = false;
  }
  go(0);
  return bestPairs;
}

// ---------- Elimination brackets ----------
function seedOrder(B) {
  let o = [1, 2];
  while (o.length < B) {
    const k2 = o.length * 2;
    o = o.flatMap((s) => [s, k2 + 1 - s]);
  }
  return o;
}

const DEAD = Symbol('dead');
function mk(id, bracket, round, index) {
  return { match_id: id, bracket, round, index, home: null, away: null, home_seed: null, away_seed: null,
    bye: false, winner: null, loser: null, winner_to: null, loser_to: null };
}

// Shared engine: place teams, propagate byes/results along winner_to/loser_to.
function runBracket(all, seedOf, results) {
  const byId = Object.fromEntries(all.map((m) => [m.match_id, m]));
  const place = (to, team) => {
    if (!to) return;
    const m = byId[to.match_id];
    m[to.slot] = team;
    if (team !== DEAD) m[to.slot + '_seed'] = seedOf[team] || null;
  };
  const decide = (m, winner) => {
    m.winner = winner;
    const loser = m.home === winner ? m.away : m.home;
    m.loser = loser === DEAD ? null : loser;
    place(m.winner_to, winner);
    place(m.loser_to, loser === undefined || loser === null ? DEAD : loser);
  };
  // Auto-advance matches with exactly one live team (byes), repeatedly.
  const settleByes = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of all) {
        if (m.winner !== null || m.conditional) continue;
        const hDead = m.home === DEAD, aDead = m.away === DEAD;
        if (hDead && aDead) { m.winner = DEAD; place(m.winner_to, DEAD); place(m.loser_to, DEAD); changed = true; }
        else if (hDead && m.away) { m.bye = true; decide(m, m.away); changed = true; }
        else if (aDead && m.home) { m.bye = true; decide(m, m.home); changed = true; }
      }
    }
  };
  settleByes();
  const pending = [...results];
  results.forEach((r) => {
    if (!isObj(r) || !isId(r.match_id) || !isId(r.winner) || !byId[r.match_id]) {
      throw err(400, 'VALIDATION_ERROR', 'Unknown match in params.results.', { fields: ['params.results'] });
    }
  });
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const r = pending[i];
      const m = byId[r.match_id];
      if (m.home && m.away && m.home !== DEAD && m.away !== DEAD) {
        if (r.winner !== m.home && r.winner !== m.away) {
          throw err(400, 'VALIDATION_ERROR', `${r.winner} is not playing in ${r.match_id}.`, { fields: ['params.results'] });
        }
        if (m.winner === null) decide(m, r.winner);
        else if (m.winner !== r.winner) throw err(400, 'VALIDATION_ERROR', `Conflicting result for ${r.match_id}.`, { fields: ['params.results'] });
        pending.splice(i, 1); i--; progress = true;
        settleByes();
      } else if (m.bye && m.winner === r.winner) {
        pending.splice(i, 1); i--; progress = true;
      }
    }
  }
  if (pending.length) {
    throw err(400, 'VALIDATION_ERROR', `${pending[0].winner} is not a participant of ${pending[0].match_id}.`, { fields: ['params.results'] });
  }
  for (const m of all) {
    for (const k of ['home', 'away', 'winner']) if (m[k] === DEAD) m[k] = null;
  }
}

function buildWinnersRound1(teams, B, prefix, bracket) {
  const order = seedOrder(B);
  const n = teams.length;
  const ms = [];
  for (let i = 1; i <= B / 2; i++) {
    const m = mk(`${prefix}1M${i}`, bracket, 1, i);
    const s1 = order[2 * i - 2], s2 = order[2 * i - 1];
    const [hs, as] = s1 < s2 ? [s1, s2] : [s2, s1];
    m.home = teams[hs - 1]; m.home_seed = hs;
    if (as <= n) { m.away = teams[as - 1]; m.away_seed = as; } else { m.away = DEAD; }
    ms.push(m);
  }
  return ms;
}

function singleElim(teams, params) {
  const c = new Checker();
  const tp = params.third_place_match === undefined ? false : params.third_place_match;
  c.check(typeof tp === 'boolean', 'params.third_place_match');
  const results = params.results === undefined ? [] : params.results;
  c.check(Array.isArray(results), 'params.results');
  c.done();
  const n = teams.length;
  let B = 1; while (B < n) B *= 2;
  const k = Math.log2(B);
  const seedOf = Object.fromEntries(teams.map((t, i) => [t, i + 1]));
  const rounds = [{ round: 1, matches: buildWinnersRound1(teams, B, 'R', 'main') }];
  for (let r = 2; r <= k; r++) {
    const ms = [];
    for (let i = 1; i <= B / 2 ** r; i++) ms.push(mk(`R${r}M${i}`, 'main', r, i));
    rounds.push({ round: r, matches: ms });
  }
  for (let r = 1; r < k; r++) {
    rounds[r - 1].matches.forEach((m, i) => {
      m.winner_to = { match_id: `R${r + 1}M${Math.ceil((i + 1) / 2)}`, slot: (i + 1) % 2 === 1 ? 'home' : 'away' };
    });
  }
  const all = rounds.flatMap((r) => r.matches);
  if (tp && k >= 2) {
    const t = mk('TP', 'third_place', k, 1);
    rounds[k - 2].matches.forEach((m, i) => { m.loser_to = { match_id: 'TP', slot: i === 0 ? 'home' : 'away' }; });
    rounds[k - 1].matches.push(t);
    all.push(t);
  }
  runBracket(all, seedOf, results);
  return { format: 'single_elim', bracket_size: B, rounds };
}

function doubleElim(teams, params) {
  const c = new Checker();
  const reset = params.bracket_reset === undefined ? false : params.bracket_reset;
  c.check(typeof reset === 'boolean', 'params.bracket_reset');
  const results = params.results === undefined ? [] : params.results;
  c.check(Array.isArray(results), 'params.results');
  c.done();
  const n = teams.length;
  let B = 1; while (B < n) B *= 2;
  const k = Math.log2(B);
  const seedOf = Object.fromEntries(teams.map((t, i) => [t, i + 1]));

  const W = [{ round: 1, matches: buildWinnersRound1(teams, B, 'WR', 'winners') }];
  for (let r = 2; r <= k; r++) {
    const ms = [];
    for (let i = 1; i <= B / 2 ** r; i++) ms.push(mk(`WR${r}M${i}`, 'winners', r, i));
    W.push({ round: r, matches: ms });
  }
  const L = [];
  for (let r = 1; r <= 2 * (k - 1); r++) {
    const j = Math.ceil(r / 2);
    const ms = [];
    for (let i = 1; i <= B / 2 ** (j + 1); i++) ms.push(mk(`LR${r}M${i}`, 'losers', r, i));
    L.push({ round: r, matches: ms });
  }
  const gf1 = mk('GF1', 'grand_final', 1, 1);
  gf1.conditional = false; gf1.required = true;
  const GF = [gf1];
  let gf2 = null;
  if (reset) {
    gf2 = mk('GF2', 'grand_final', 2, 1);
    gf2.conditional = true; gf2.required = null;
    GF.push(gf2);
  }
  const to = (match_id, slot) => ({ match_id, slot });
  // Winners bracket advancement
  for (let r = 1; r < k; r++) {
    W[r - 1].matches.forEach((m, i) => { m.winner_to = to(`WR${r + 1}M${Math.ceil((i + 1) / 2)}`, (i + 1) % 2 ? 'home' : 'away'); });
  }
  W[k - 1].matches[0].winner_to = to('GF1', 'home');
  // WR1 losers meet each other in LR1
  W[0].matches.forEach((m, i) => { m.loser_to = to(`LR1M${Math.ceil((i + 1) / 2)}`, (i + 1) % 2 ? 'home' : 'away'); });
  // WRr (r>=2) losers drop into LR(2r-2) away slots (reversed order to delay rematches)
  for (let r = 2; r <= k; r++) {
    const cnt = W[r - 1].matches.length;
    W[r - 1].matches.forEach((m, i) => { m.loser_to = to(`LR${2 * r - 2}M${cnt - i}`, 'away'); });
  }
  // Losers bracket advancement
  for (let r = 1; r <= 2 * (k - 1); r++) {
    const ms = L[r - 1].matches;
    if (r === 2 * (k - 1)) { ms[0].winner_to = to('GF1', 'away'); continue; }
    if (r % 2 === 1) ms.forEach((m, i) => { m.winner_to = to(`LR${r + 1}M${i + 1}`, 'home'); });
    else ms.forEach((m, i) => { m.winner_to = to(`LR${r + 1}M${Math.ceil((i + 1) / 2)}`, (i + 1) % 2 ? 'home' : 'away'); });
  }
  const all = [...W.flatMap((r) => r.matches), ...L.flatMap((r) => r.matches), gf1];
  // GF2 replays the same two teams; it is resolved after GF1, so keep it out of the routing graph.
  const gf2Result = gf2 ? results.filter((r) => isObj(r) && r.match_id === 'GF2') : [];
  runBracket(all, seedOf, results.filter((r) => !(isObj(r) && r.match_id === 'GF2')));
  if (gf2) {
    gf2.home = gf1.home; gf2.away = gf1.away; gf2.home_seed = gf1.home_seed; gf2.away_seed = gf1.away_seed;
    if (gf1.winner) gf2.required = reset && gf1.winner === gf1.away;
    for (const r of gf2Result) {
      if (!gf2.required || (r.winner !== gf2.home && r.winner !== gf2.away)) {
        throw err(400, 'VALIDATION_ERROR', 'GF2 result is not valid.', { fields: ['params.results'] });
      }
      gf2.winner = r.winner;
      gf2.loser = r.winner === gf2.home ? gf2.away : gf2.home;
    }
  }
  return { format: 'double_elim', bracket_size: B, bracket_reset: reset, winners: W, losers: L, grand_final: GF };
}

const LIMITS = { round_robin: [2, 40], swiss: [2, 64], single_elim: [2, 128], double_elim: [3, 128] };

function generate(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  const lim = LIMITS[b.format];
  c.check(!!lim, 'format');
  c.check(Array.isArray(b.teams) && b.teams.every(isId) && new Set(b.teams).size === b.teams.length
    && (!lim || (b.teams.length >= lim[0] && b.teams.length <= lim[1])), 'teams');
  const params = b.params === undefined || b.params === null ? {} : b.params;
  c.check(isObj(params), 'params');
  c.done();
  if (b.format === 'round_robin') return roundRobin(b.teams, params);
  if (b.format === 'swiss') return swiss(b.teams, params);
  if (b.format === 'single_elim') return singleElim(b.teams, params);
  return doubleElim(b.teams, params);
}

module.exports = { generate, roundRobin, swiss, singleElim, doubleElim, seedOrder, minCostPairing };
