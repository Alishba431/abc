const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

let h;
let tok;
test.before(async () => {
  h = await start('day2_roles');
  await h.call('POST', '/audit/v1/reset', {});
  tok = {};
  for (const r of ['player', 'viewer', 'manager', 'organizer', 'admin']) {
    tok[r] = (await h.call('POST', '/api/v1/auth/login', { email: `${r}@nascon.test`, password: 'Nascon@26' })).body.token;
  }
});
test.after(async () => h.stop());

test('player home: own athlete profile with season record and upcoming matches', async () => {
  const me = await h.call('GET', '/api/v1/me/profile', undefined, tok.player);
  assert.strictEqual(me.status, 200);
  assert.deepStrictEqual([me.body.player_id, me.body.club.club_id, me.body.can_edit], ['player-alpha-1', 'club-alpha-1', true]);
  assert.deepStrictEqual(me.body.career, { played: 2, won: 1, drawn: 0, lost: 1, scored: 3, conceded: 4 });
  assert.ok(me.body.upcoming.some((m) => m.match_id === 'match-m1' && m.status === 'in_progress'));
  assert.strictEqual((await h.call('GET', '/api/v1/me/profile', undefined, tok.viewer)).status, 404);
});

test('profile edit follows the P5 policy matrix (self / own-club manager / admin only)', async () => {
  const patch = (id, who, body = { bio: 'Striker' }) => h.call('PATCH', `/api/v1/players/${id}`, body, tok[who]);
  assert.strictEqual((await patch('player-alpha-1', 'player')).status, 200);
  assert.strictEqual((await patch('player-alpha-1', 'player')).body.bio, 'Striker');
  assert.strictEqual((await patch('player-alpha-2', 'player')).status, 403);
  assert.strictEqual((await patch('player-alpha-1', 'viewer')).status, 403);
  assert.strictEqual((await patch('player-alpha-1', 'organizer')).status, 403);
  assert.strictEqual((await patch('player-alpha-1', 'manager', { name: 'Ahmed Ali' })).status, 200);
  assert.strictEqual((await patch('player-alpha-2', 'manager')).status, 403);
  assert.strictEqual((await patch('player-beta-1', 'admin', { social: '@beta' })).status, 200);
  assert.deepStrictEqual((await patch('player-alpha-1', 'player', { name: '', bio: 5, social: 'x'.repeat(61) })).body.error.details.fields, ['name', 'bio', 'social']);
});

test('viewer: browse clubs, view athletes in tenant only, idempotent follow / unfollow', async () => {
  assert.deepStrictEqual((await h.call('GET', '/api/v1/clubs', undefined, tok.viewer)).body.map((c) => c.club_id), ['club-alpha-1', 'club-alpha-2']);
  assert.strictEqual((await h.call('GET', '/api/v1/clubs', undefined, tok.admin)).body.length, 3);
  const a = await h.call('GET', '/api/v1/athletes/player-alpha-1', undefined, tok.viewer);
  assert.deepStrictEqual([a.status, a.body.can_edit, a.body.following], [200, false, false]);
  assert.strictEqual((await h.call('GET', '/api/v1/athletes/player-beta-1', undefined, tok.viewer)).status, 403);
  assert.strictEqual((await h.call('GET', '/api/v1/athletes/nobody', undefined, tok.viewer)).status, 404);
  const follows = await Promise.all([...Array(10)].map(() => h.call('POST', '/api/v1/athletes/player-alpha-1/follow', { follow: true }, tok.viewer)));
  assert.ok(follows.every((f) => f.status === 200));
  assert.strictEqual((await h.call('GET', '/api/v1/athletes/player-alpha-1', undefined, tok.viewer)).body.followers, 1);
  const un = await h.call('POST', '/api/v1/athletes/player-alpha-1/follow', { follow: false }, tok.viewer);
  assert.deepStrictEqual([un.body.following, un.body.followers], [false, 0]);
  assert.strictEqual((await h.call('POST', '/api/v1/athletes/player-alpha-1/follow', {}, 'guest_anon_tok_7721')).status, 403);
});

test('go live: only athletes manage their own stream key', async () => {
  const g = await h.call('POST', '/api/v1/me/stream-key', { action: 'generate' }, tok.player);
  assert.deepStrictEqual([g.status, g.body.player_id, g.body.status], [201, 'player-alpha-1', 'active']);
  const v = await h.call('POST', '/api/v1/me/stream-key', { action: 'revoke' }, tok.player);
  assert.deepStrictEqual([v.status, v.body.status], [200, 'revoked']);
  assert.strictEqual((await h.call('POST', '/api/v1/me/stream-key', {}, tok.viewer)).status, 403);
  assert.strictEqual((await h.call('POST', '/api/v1/me/stream-key', {}, tok.player)).status, 201);
});
