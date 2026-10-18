const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_guest'); });
test.after(async () => h.stop());
const canon = (o) => require(h.src + '/sign').canonical(o);
const sig2 = (id, p) => crypto.createHmac('sha256', process.env.DAY2_SALT).update(`${id}|${canon(p)}`).digest('hex');
const merge = (b) => h.call('POST', '/audit/v1/guest/cart-merge', b);
const GUEST = 'guest_anon_tok_7721';
const L = (q = 1) => [{ variant_id: 'var-jersey-001-L', quantity: q }];

test('direct write enforcement: guest token -> 403 GUEST_WRITE_FORBIDDEN on chat, checkout, events', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  for (const p of ['/api/v1/chat', '/audit/v1/checkout', '/audit/v1/events', '/audit/v1/roster/transfer', '/api/v1/athletes/player-alpha-1/follow']) {
    const r = await h.call('POST', p, {}, GUEST);
    assert.deepStrictEqual([r.status, r.body.error.code, r.body.error.details.guest_token], [403, 'GUEST_WRITE_FORBIDDEN', GUEST], p);
  }
  assert.strictEqual((await h.call('POST', '/audit/v1/checkout', undefined, GUEST, '{broken')).status, 403);
  assert.strictEqual((await h.call('DELETE', '/audit/v1/privacy/user/player-alpha-1', undefined, GUEST)).status, 403);
  assert.strictEqual((await h.call('GET', '/audit/v1/score/match-m1', undefined, GUEST)).status, 200);
  const anon = await h.call('POST', '/api/v1/chat', { chat_room_id: 'r', text: 'hi' });
  assert.deepStrictEqual([anon.status, anon.body.error.code, anon.body.error.details.guest_token], [403, 'GUEST_WRITE_FORBIDDEN', null]);
  const { simulateGuestWrite } = require(h.src + '/domain/guest');
  assert.strictEqual(simulateGuestWrite(GUEST), 403);
});

test('cart merge: spec example, signature, network-migration replay, already merged', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const body = { guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: L(), test_write_block: true };
  const r = await merge(body);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, {
    guest_token: GUEST, write_block_verified: true, write_rejection_code: 403, cart_merged: true,
    active_cart: { user_id: 'player-alpha-1', currency: 'PKR', total_items: 1, subtotal_minor: 450000,
      items: [{ variant_id: 'var-jersey-001-L', quantity: 1, unit_price_minor: 450000 }] },
    signature: sig2(GUEST, { cart_merged: true, guest_token: GUEST, registered_user_id: 'player-alpha-1', total_items: 1, write_rejection_code: 403 }),
  });
  const replays = await Promise.all([merge(body), merge(body)]);
  for (const x of replays) assert.deepStrictEqual([x.status, x.body.active_cart.total_items], [200, 1]);
  assert.deepStrictEqual((await h.call('GET', '/audit/v1/inventory/var-jersey-001-L')).body, { variant_id: 'var-jersey-001-L', stock: 5, reserved: 0 });
  assert.strictEqual((await merge({ ...body, guest_cart: L(2) })).body.error.code, 'GUEST_TOKEN_ALREADY_MERGED');
  assert.strictEqual((await merge({ ...body, registered_user_id: 'player-alpha-2' })).body.error.code, 'GUEST_TOKEN_ALREADY_MERGED');
});

test('edge case 4: two simultaneous identical merges never double the quantity', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const body = { guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: L() };
  const both = await Promise.all([merge(body), merge(body)]);
  assert.deepStrictEqual(both.map((x) => [x.status, x.body.active_cart.total_items]), [[200, 1], [200, 1]]);
});

test('cart merge validation order, sums with existing cart, stock cap', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const bad = async (b, field) => assert.deepStrictEqual((await merge(b)).body.error.details.fields, [field]);
  await bad({ guest_token: 'anon_1', registered_user_id: 'player-alpha-1', guest_cart: L() }, 'guest_token');
  await bad({ guest_token: GUEST, registered_user_id: '', guest_cart: L() }, 'registered_user_id');
  await bad({ guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: [] }, 'guest_cart');
  await bad({ guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: L(0) }, 'guest_cart');
  await bad({ guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: L(), test_write_block: 'yes' }, 'test_write_block');
  assert.strictEqual((await merge('x')).status, 400);
  assert.strictEqual((await merge({ guest_token: GUEST, registered_user_id: 'player-ghost', guest_cart: L() })).body.error.code, 'PLAYER_NOT_FOUND');
  assert.strictEqual((await merge({ guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: [{ variant_id: 'var-x', quantity: 1 }] })).body.error.code, 'VARIANT_NOT_FOUND');
  const over = await merge({ guest_token: GUEST, registered_user_id: 'player-alpha-1', guest_cart: L(6) });
  assert.deepStrictEqual([over.status, over.body.error.code, over.body.error.details.variant_id], [409, 'OUT_OF_STOCK', 'var-jersey-001-L']);
  let r = await merge({ guest_token: 'guest_a', registered_user_id: 'user-manager', guest_cart: L(2), test_write_block: false });
  assert.deepStrictEqual([r.body.write_block_verified, r.body.write_rejection_code, r.body.active_cart.total_items], [false, null, 2]);
  r = await merge({ guest_token: 'guest_b', registered_user_id: 'user-manager', guest_cart: [...L(2), { variant_id: 'var-jersey-001-M', quantity: 1 }] });
  assert.deepStrictEqual(r.body.active_cart.items.map((i) => [i.variant_id, i.quantity]), [['var-jersey-001-L', 4], ['var-jersey-001-M', 1]]);
  assert.strictEqual(r.body.active_cart.subtotal_minor, 5 * 450000);
  assert.strictEqual((await merge({ guest_token: 'guest_c', registered_user_id: 'user-manager', guest_cart: L(2) })).body.error.code, 'OUT_OF_STOCK');
});

test('app flow: issue guest token, stage cart, sign in, merge staged cart', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const t = await h.call('POST', '/api/v1/guest/token');
  assert.strictEqual(t.status, 201);
  const tok = t.body.guest_token;
  assert.match(tok, /^guest_anon_tok_[0-9a-f]{12}$/);
  assert.strictEqual((await h.call('GET', '/api/v1/guest/cart', undefined, tok)).body.total_items, 0);
  let s = await h.call('POST', '/api/v1/guest/cart', { variant_id: 'var-jersey-001-L' }, tok);
  assert.deepStrictEqual([s.status, s.body.total_items], [201, 1]);
  s = await h.call('POST', '/api/v1/guest/cart', { variant_id: 'var-jersey-001-L', quantity: 2 }, tok);
  assert.strictEqual(s.body.total_items, 3);
  assert.strictEqual((await h.call('POST', '/api/v1/guest/cart', { variant_id: 'var-jersey-001-L', quantity: 5 }, tok)).body.error.code, 'OUT_OF_STOCK');
  assert.strictEqual((await h.call('POST', '/api/v1/guest/cart', { variant_id: 'nope' }, tok)).status, 404);
  assert.strictEqual((await h.call('POST', '/api/v1/guest/cart', { quantity: 50 }, tok)).status, 400);
  assert.strictEqual((await h.call('GET', '/api/v1/guest/cart')).status, 401);
  assert.strictEqual((await h.call('GET', '/api/v1/guest/cart', undefined, 'guest_unknown')).status, 401);
  const login = (await h.call('POST', '/api/v1/auth/login', { email: 'player@nascon.test', password: 'Nascon@26' })).body.token;
  assert.strictEqual((await h.call('POST', '/api/v1/guest/cart/merge', { guest_token: tok }, tok)).status, 403);
  const m = await h.call('POST', '/api/v1/guest/cart/merge', { guest_token: tok }, login);
  assert.deepStrictEqual([m.status, m.body.cart_merged, m.body.active_cart.user_id, m.body.active_cart.total_items], [200, true, 'player-alpha-1', 3]);
  const t2 = (await h.call('POST', '/api/v1/guest/token')).body.guest_token;
  const empty = await h.call('POST', '/api/v1/guest/cart/merge', { guest_token: t2 }, login);
  assert.deepStrictEqual([empty.body.cart_merged, empty.body.active_cart.total_items], [false, 3]);
  assert.strictEqual((await h.call('POST', '/api/v1/guest/cart/merge', { guest_token: 'x' }, login)).status, 400);
  const pub = await h.call('GET', '/api/v1/public/matches/match-m1');
  assert.deepStrictEqual([pub.status, pub.body.home.score, pub.body.away.score, pub.body.pinned_product.product_id], [200, 1, 0, 'prod-jersey-001']);
});
