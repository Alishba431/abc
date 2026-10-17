const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('roster'); });
test.after(async () => h.stop());
const setup = () => h.call('POST', '/audit/v1/roster/setup', {
  league: { league_id: 'lg-r1', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-09-01', close: '2026-09-30' },
    max_squad_size: 3, required_positions: { gk: 1 } },
  squads: [{ squad_id: 'sq-a', club_id: 'club-a', tenant_id: 'tenant-alpha', name: 'A' },
    { squad_id: 'sq-b', club_id: 'club-b', tenant_id: 'tenant-alpha', name: 'B' },
    { squad_id: 'sq-x', club_id: 'club-x', tenant_id: 'tenant-beta', name: 'X' }],
  players: [{ player_id: 'p1', name: 'Ali', position: 'gk', squad_id: 'sq-a', role: 'captain' },
    { player_id: 'p2', name: 'Bilal', position: 'df', squad_id: 'sq-a', role: 'starter' },
    { player_id: 'p3', name: 'Cem', position: 'df', squad_id: 'sq-b', role: 'starter' },
    { player_id: 'p4', name: 'Dan', position: 'df', squad_id: 'sq-b' },
    { player_id: 'p5', name: 'Eli', position: 'mf', squad_id: 'sq-b' }],
  matches_in_progress: [{ match_id: 'm-live', home_squad_id: 'sq-a', away_squad_id: 'sq-x' }],
});
const tr = (request_id, extra = {}) => h.call('POST', '/audit/v1/roster/transfer', {
  request_id, league_id: 'lg-r1', player_id: 'p2', type: 'transfer', from_squad_id: 'sq-a', to_squad_id: 'sq-b',
  effective_date: '2026-09-15', loan_end_date: null, reason: 'Tactical move', requested_by: 'user-77', ...extra });
const code = async (p) => (await p).body.error.code;

test('setup and each ordered rule check', async () => {
  const s = await setup();
  assert.deepStrictEqual(s.body, { league_id: 'lg-r1', status: 'configured', squad_counts: { 'sq-a': 2, 'sq-b': 3, 'sq-x': 0 } });
  assert.strictEqual(await code(tr('v1', { effective_date: '2026-13-01' })), 'VALIDATION_ERROR');
  assert.strictEqual(await code(tr('v2', { type: 'loan', loan_end_date: '2026-09-01' })), 'VALIDATION_ERROR');
  assert.strictEqual(await code(tr('v3', { to_squad_id: null })), 'VALIDATION_ERROR');
  assert.strictEqual(await code(tr('v4', { league_id: 'nope' })), 'LEAGUE_NOT_FOUND');
  assert.strictEqual(await code(tr('v5', { player_id: 'nope' })), 'PLAYER_NOT_FOUND');
  assert.strictEqual(await code(tr('v6', { to_squad_id: 'sq-nope' })), 'SQUAD_NOT_FOUND');
  assert.strictEqual(await code(tr('v7', { to_squad_id: 'sq-x' })), 'CROSS_TENANT_TRANSFER');
  assert.strictEqual(await code(tr('v8', { from_squad_id: 'sq-b' })), 'NOT_IN_SQUAD');
  assert.strictEqual(await code(tr('v9', { effective_date: '2026-10-01' })), 'TRANSFER_WINDOW_CLOSED');
  assert.strictEqual(await code(tr('v10')), 'SQUAD_FULL');
  assert.strictEqual(await code(tr('v11', { player_id: 'p1', to_squad_id: 'sq-b' })), 'SQUAD_FULL');
  assert.strictEqual((await tr('v12', { player_id: 'p3', from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2026-09-30' })).status, 201);
});

test('transfer on last window day with live match is deferred; replay and history', async () => {
  await setup();
  const r = await tr('tr-001', { player_id: 'p3', from_squad_id: 'sq-b', to_squad_id: 'sq-a', effective_date: '2026-09-30' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.state, 'active');
  const live = await tr('tr-002', { effective_date: '2026-09-30', player_id: 'p4', from_squad_id: 'sq-b', to_squad_id: 'sq-a' });
  assert.strictEqual(live.body.error.code, 'SQUAD_FULL');
  await setup();
  const d = await tr('tr-003', { effective_date: '2026-09-30', to_squad_id: 'sq-b', player_id: 'p2' });
  assert.strictEqual(d.body.error.code, 'SQUAD_FULL');
  const rel = await h.call('POST', '/audit/v1/roster/transfer', { request_id: 'rel-1', league_id: 'lg-r1', player_id: 'p5', type: 'release',
    from_squad_id: 'sq-b', to_squad_id: null, effective_date: '2026-11-11', reason: 'free', requested_by: 'u' });
  assert.strictEqual(rel.status, 201);
  assert.strictEqual(rel.body.registration, null);
  const dd = await tr('tr-004', { effective_date: '2026-09-30' });
  assert.strictEqual(dd.status, 201);
  assert.strictEqual(dd.body.state, 'deferred_until_match_end');
  assert.strictEqual(dd.body.blocking_match_id, 'm-live');
  assert.strictEqual(dd.body.registration.role, 'substitute');
  assert.strictEqual(dd.body.audit_entry.who, 'user-77');
  assert.strictEqual((await tr('tr-004', { effective_date: '2026-09-30' })).status, 200);
  assert.strictEqual((await tr('tr-004', { effective_date: '2026-09-29' })).status, 409);
  const hist = (await h.call('GET', '/audit/v1/roster/history/p2?as_of=2026-10-01')).body;
  assert.strictEqual(hist.current_squad_id, 'sq-b');
  assert.strictEqual(hist.history.length, 1);
  assert.strictEqual((await h.call('GET', '/audit/v1/roster/history/p2?as_of=2026-09-01')).body.current_squad_id, 'sq-a');
  assert.strictEqual((await h.call('GET', '/audit/v1/roster/history/ghost')).status, 404);
  assert.strictEqual((await h.call('GET', '/audit/v1/roster/history/p2?as_of=bad')).status, 400);
});

test('loan, PLAYER_ON_LOAN, automatic return written once, MIN_POSITION_VIOLATION', async () => {
  await setup();
  await h.call('POST', '/audit/v1/roster/transfer', { request_id: 'rel-x', league_id: 'lg-r1', player_id: 'p5', type: 'release',
    from_squad_id: 'sq-b', to_squad_id: null, effective_date: '2026-09-02', reason: 'x', requested_by: 'u' });
  const loan = await tr('ln-1', { type: 'loan', loan_end_date: '2026-12-31' });
  assert.strictEqual(loan.status, 201);
  assert.strictEqual(loan.body.registration.parent_squad_id, 'sq-a');
  assert.strictEqual(loan.body.registration.registration_type, 'loan');
  assert.strictEqual(await code(h.call('POST', '/audit/v1/roster/transfer', { request_id: 'ln-2', league_id: 'lg-r1', player_id: 'p2', type: 'release',
    from_squad_id: 'sq-b', to_squad_id: null, effective_date: '2026-10-01', reason: 'x', requested_by: 'u' })), 'PLAYER_ON_LOAN');
  let hist = (await h.call('GET', '/audit/v1/roster/history/p2?as_of=2026-11-01')).body;
  assert.deepStrictEqual([hist.current_squad_id, hist.parent_squad_id], ['sq-b', 'sq-a']);
  hist = (await h.call('GET', '/audit/v1/roster/history/p2?as_of=2027-01-05')).body;
  await h.call('GET', '/audit/v1/roster/history/p2?as_of=2027-01-06');
  hist = (await h.call('GET', '/audit/v1/roster/history/p2?as_of=2027-01-05')).body;
  assert.deepStrictEqual(hist.history.map((e) => e.action), ['loan', 'loan_return']);
  assert.strictEqual(hist.current_squad_id, 'sq-a');
  assert.strictEqual(hist.history[1].who, 'system');
  assert.strictEqual(await code(tr('mp-1', { player_id: 'p1', type: 'release', to_squad_id: null })), 'MIN_POSITION_VIOLATION');
  assert.strictEqual((await h.call('POST', '/audit/v1/roster/setup', { league: {} })).status, 400);
  assert.strictEqual((await h.call('POST', '/audit/v1/roster/setup', { league: { league_id: 'z', tenant_id: 't', sport_id: 'polo',
    transfer_window: { open: '2026-01-01', close: '2026-02-01' } }, squads: [], players: [] })).body.error.code, 'SPORT_NOT_FOUND');
});

test('offline sync: ordering, rebased, duplicates, server_wins, resend', async () => {
  await setup();
  await h.call('POST', '/audit/v1/leagues', { league_id: 'lg-o', sport_id: 'football', teams: ['t1', 't2'], fixtures: [{ match_id: 'om1', home: 't1', away: 't2' }], qualification: { spots: 1 } });
  await h.call('POST', '/audit/v1/events', { event_id: 'o1', match_id: 'om1', type: 'match_start', payload: {} });
  const body = { device_id: 'dev-1', actions: [
    { action_id: 'a2', type: 'roster_transfer', queued_at: '2026-10-17T11:01:00Z', base_version: 0,
      payload: { request_id: 'otr', league_id: 'lg-r1', player_id: 'p4', type: 'transfer', from_squad_id: 'sq-b', to_squad_id: 'sq-a',
        effective_date: '2026-09-10', loan_end_date: null, reason: 'r', requested_by: 'u' } },
    { action_id: 'a1', type: 'score_event', queued_at: '2026-10-17T11:00:00Z', base_version: 0,
      payload: { event_id: 'evt-9', match_id: 'om1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'a3', type: 'score_event', queued_at: '2026-10-17T11:02:00Z', base_version: 2,
      payload: { event_id: 'evt-10', match_id: 'om1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'a4', type: 'score_event', queued_at: '2026-10-17T11:03:00Z', base_version: 99,
      payload: { event_id: 'evt-11', match_id: 'om1', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'a5', type: 'score_event', queued_at: '2026-10-17T11:04:00Z', base_version: 0,
      payload: { event_id: 'evt-12', match_id: 'ghost', type: 'score', payload: { team_id: 't1', event_type: 'goal' } } },
    { action_id: 'a6', type: 'score_event', queued_at: '2026-10-17T11:05:00Z', base_version: 3,
      payload: { event_id: 'evt-13', match_id: 'om1', type: 'score', payload: { team_id: 't1', event_type: 'nope' } } },
    { action_id: 'a7', type: 'roster_transfer', queued_at: '2026-10-17T11:06:00Z', base_version: 0,
      payload: { request_id: 'otr2', league_id: 'lg-r1', player_id: 'ghost', type: 'release', from_squad_id: 'sq-b', to_squad_id: null,
        effective_date: '2026-09-10', reason: 'r', requested_by: 'u' } },
    { action_id: 'a8', type: 'score_event', queued_at: '2026-10-17T11:07:00Z', base_version: 3, payload: { bad: true } },
  ] };
  const r = (await h.call('POST', '/audit/v1/offline-sync', body)).body;
  const by = Object.fromEntries(r.results.map((x) => [x.action_id, x]));
  assert.deepStrictEqual(r.results.map((x) => x.action_id), ['a2', 'a1', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
  assert.deepStrictEqual([by.a1.processed_order, by.a2.processed_order], [1, 2]);
  assert.deepStrictEqual([by.a1.status, by.a1.resolution, by.a1.server_version], ['applied', 'rebased_append', 2]);
  assert.match(by.a1.signature, /^[0-9a-f]{64}$/);
  assert.deepStrictEqual([by.a2.status, by.a2.resolution, by.a2.signature], ['applied', 'appended', null]);
  assert.deepStrictEqual([by.a3.status, by.a3.resolution], ['applied', 'appended']);
  assert.strictEqual(by.a4.error_code, 'INVALID_BASE_VERSION');
  assert.strictEqual(by.a5.error_code, 'MATCH_NOT_FOUND');
  assert.strictEqual(by.a6.error_code, 'UNKNOWN_EVENT_TYPE');
  assert.strictEqual(by.a7.error_code, 'PLAYER_NOT_FOUND');
  assert.strictEqual(by.a8.status, 'rejected');
  const again = (await h.call('POST', '/audit/v1/offline-sync', body)).body;
  assert.ok(again.results.every((x) => x.status === 'duplicate' && x.resolution === 'skipped_duplicate'));
  const other = (await h.call('POST', '/audit/v1/offline-sync', { device_id: 'dev-2', actions: [body.actions[1]] })).body;
  assert.strictEqual(other.results[0].status, 'duplicate');
  assert.strictEqual((await h.call('POST', '/audit/v1/offline-sync', { device_id: 'dev-1', actions: [] })).status, 400);
});
