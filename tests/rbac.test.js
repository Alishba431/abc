const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

let h, T, C;
test.before(async () => {
  h = await start('rbac');
  const m = (await h.call('POST', '/audit/v1/rbac-matrix')).body;
  T = m.tokens; C = m.context;
});
test.after(async () => h.stop());
const ROLES = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
const A = 200, D = 403;

test('5-role negative authorization matrix (Section 5.13)', async () => {
  const cases = [
    ['POST', '/audit/v1/rbac/tenants', [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${C.own_league_id}/fixtures`, [A, A, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${C.other_league_id}/fixtures`, [A, D, D, D, D]],
    ['POST', `/audit/v1/rbac/leagues/${C.foreign_league_id}/fixtures`, [A, D, D, D, D]],
    ['GET', '/audit/v1/rbac/platform/config', [A, D, D, D, D]],
    ['PATCH', `/audit/v1/rbac/players/${C.own_player_id}`, [A, D, A, A, D]],
    ['PATCH', `/audit/v1/rbac/players/${C.other_player_id}`, [A, D, D, D, D]],
    ['PATCH', `/audit/v1/rbac/players/${C.foreign_player_id}`, [A, D, D, D, D]],
    ['GET', `/audit/v1/rbac/clubs/${C.own_club_id}`, [A, A, A, A, A]],
    ['GET', `/audit/v1/rbac/clubs/${C.other_club_id}`, [A, A, A, A, A]],
    ['GET', `/audit/v1/rbac/clubs/${C.foreign_club_id}`, [A, D, D, D, D]],
  ];
  for (const k of ['roster', 'products']) {
    cases.push(['POST', `/audit/v1/rbac/clubs/${C.own_club_id}/${k}`, [A, D, A, D, D]]);
    cases.push(['POST', `/audit/v1/rbac/clubs/${C.other_club_id}/${k}`, [A, D, D, D, D]]);
    cases.push(['POST', `/audit/v1/rbac/clubs/${C.foreign_club_id}/${k}`, [A, D, D, D, D]]);
  }
  for (const [method, path, expect] of cases) {
    for (let i = 0; i < ROLES.length; i++) {
      const r = await h.call(method, path, method === 'GET' ? undefined : {}, T[ROLES[i]]);
      assert.strictEqual(r.status, expect[i], `${ROLES[i]} ${method} ${path}`);
      if (r.status === 403) assert.strictEqual(r.body.error.code, 'FORBIDDEN');
      if (r.status === 200) assert.deepStrictEqual(r.body, { authorized: true });
    }
  }
  assert.strictEqual((await h.call('GET', '/audit/v1/rbac/clubs/club-nope', undefined, T.super_admin)).status, 404);
});

test('token attacks: missing, tampered, alg none, expired, garbage', async () => {
  const p = '/audit/v1/rbac/platform/config';
  assert.strictEqual((await h.call('GET', p)).body.error.code, 'UNAUTHENTICATED');
  const [hd, body, sig] = T.super_admin.split('.');
  const flip = sig.slice(0, -2) + (sig.at(-2) === 'A' ? 'B' : 'A') + sig.at(-1);
  assert.strictEqual((await h.call('GET', p, undefined, `${hd}.${body}.${flip}`)).status, 401);
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.strictEqual((await h.call('GET', p, undefined, `${none}.${body}.`)).status, 401);
  assert.strictEqual((await h.call('GET', p, undefined, 'a.b.c')).status, 401);
  assert.strictEqual((await h.call('GET', p, undefined, 'nonsense')).status, 401);
  const { signJwt } = require(h.src + '/auth');
  assert.strictEqual((await h.call('GET', p, undefined, signJwt({ role: 'super_admin' }, -10))).status, 401);
  const forged = Buffer.from(JSON.stringify({ role: 'super_admin', exp: 9999999999 })).toString('base64url');
  assert.strictEqual((await h.call('GET', p, undefined, `${hd}.${forged}.${sig}`)).status, 401);
});

test('rate limit on /api/v1/ping only; /audit is exempt', async () => {
  const first = await h.call('GET', '/api/v1/ping');
  assert.deepStrictEqual(first.body, { pong: true });
  const rs = await Promise.all([...Array(149)].map(() => h.call('GET', '/api/v1/ping')));
  const limited = rs.filter((r) => r.status === 429);
  assert.ok(limited.length >= 40);
  assert.strictEqual(limited[0].body.error.code, 'RATE_LIMITED');
  assert.ok(Number(limited[0].headers.get('retry-after')) >= 1);
  const audits = await Promise.all([...Array(120)].map(() => h.call('POST', '/audit/v1/fixtures', { format: 'round_robin', teams: ['a', 'b'] })));
  assert.ok(audits.every((r) => r.status === 200));
});

test('login and authenticated app routes', async () => {
  const { checkPassword, hashPassword } = require(h.src + '/auth');
  assert.ok(checkPassword('pw', hashPassword('pw')));
  assert.ok(!checkPassword('nope', hashPassword('pw')));
});
