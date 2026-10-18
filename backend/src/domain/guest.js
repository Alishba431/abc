// Zero-account guests (FR-4.2/4.3/4.4): read-only tokens, server-side write block, guest cart staging, atomic merge.
const crypto = require('crypto');
const { pool, tx } = require('../db');
const { err, errorBody, validation } = require('../errors');
const { canonical, signDay2 } = require('../sign');
const { withLock } = require('../util');
const { isObj } = require('../validate');

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GUEST_ALLOWED = [/^\/api\/v1\/guest\/(token|cart)$/];
const MEMBER_WRITES = [/^\/api\/v1\/(chat|events|store\/checkout|roster\/transfer|offline-sync|guest\/cart\/merge)$/,
  /^\/api\/v1\/athletes\/[^/]+\/follow$/];

function guestTokenOf(req) {
  const m = /^Bearer\s+(\S+)\s*$/i.exec((req.headers && req.headers.authorization) || '');
  return m && m[1].startsWith('guest_') ? m[1] : null;
}

const forbidden = (token) => err(403, 'GUEST_WRITE_FORBIDDEN', 'Anonymous guest tokens cannot perform write mutations.', { guest_token: token });

// Runs before routing, body parsing and validation, so hiding buttons is never the only protection.
function guestWriteGuard(req, res, next) {
  if (!WRITE.has(req.method)) return next();
  const token = guestTokenOf(req);
  if (token && !GUEST_ALLOWED.some((re) => re.test(req.path))) return res.status(403).json(errorBody(forbidden(token)));
  if (!token && !(req.headers && req.headers.authorization) && MEMBER_WRITES.some((re) => re.test(req.path))) {
    return res.status(403).json(errorBody(forbidden(null)));
  }
  return next();
}

// Pushes a synthetic chat post through the real guard and reports the status it produced.
function simulateGuestWrite(token) {
  let status = 200;
  const req = { method: 'POST', path: '/api/v1/chat', headers: { authorization: `Bearer ${token}` } };
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  guestWriteGuard(req, res, () => {});
  return status;
}

async function issueGuestToken() {
  const token = `guest_anon_tok_${crypto.randomBytes(6).toString('hex')}`;
  await pool.query("INSERT INTO guest_tokens(token, status, expires_at) VALUES ($1, 'active', now() + interval '2 hours')", [token]);
  return { guest_token: token, role: 'guest', scopes: ['stream:read', 'score:subscribe', 'cart:stage'], expires_in: 7200 };
}

async function activeGuest(token) {
  const r = await pool.query('SELECT * FROM guest_tokens WHERE token = $1', [token]);
  const g = r.rows[0];
  if (!g || g.status === 'anonymized' || (g.expires_at && g.expires_at < new Date())) {
    throw err(401, 'UNAUTHENTICATED', 'Your guest session has expired. Reload the page to continue.');
  }
  return g;
}

async function prices(ids) {
  const r = await pool.query('SELECT id, price_minor, stock FROM variants WHERE id = ANY($1)', [ids]);
  return Object.fromEntries(r.rows.map((v) => [v.id, v]));
}

function cartView(userId, items, price) {
  const lines = items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: price[i.variant_id].price_minor }));
  return {
    user_id: userId, currency: 'PKR',
    total_items: lines.reduce((s, i) => s + i.quantity, 0),
    subtotal_minor: lines.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0),
    items: lines,
  };
}

// ---------- guest cart staging (allowed for guests) ----------
async function guestCart(token) {
  await activeGuest(token);
  const r = await pool.query('SELECT items FROM guest_carts WHERE token = $1', [token]);
  const items = r.rowCount ? r.rows[0].items : [];
  return { guest_token: token, items, total_items: items.reduce((s, i) => s + i.quantity, 0) };
}

async function stageItem(token, b) {
  const bad = [];
  if (!isObj(b) || typeof b.variant_id !== 'string') bad.push('variant_id');
  const qty = isObj(b) && b.quantity !== undefined ? b.quantity : 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) bad.push('quantity');
  if (bad.length) throw validation(bad);
  await activeGuest(token);
  const price = await prices([b.variant_id]);
  if (!price[b.variant_id]) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${b.variant_id} does not exist.`, { variant_id: b.variant_id });
  return withLock('guest:' + token, async () => {
    const r = await pool.query('SELECT items FROM guest_carts WHERE token = $1', [token]);
    const items = r.rowCount ? r.rows[0].items : [];
    const line = items.find((i) => i.variant_id === b.variant_id);
    const next = (line ? line.quantity : 0) + qty;
    if (next > price[b.variant_id].stock) throw err(409, 'OUT_OF_STOCK', 'Not enough stock for that size.', { variant_id: b.variant_id });
    if (line) line.quantity = next; else items.push({ variant_id: b.variant_id, quantity: qty });
    await pool.query(`INSERT INTO guest_carts(token, items) VALUES ($1,$2)
      ON CONFLICT (token) DO UPDATE SET items = EXCLUDED.items`, [token, JSON.stringify(items)]);
    return { guest_token: token, items, total_items: items.reduce((s, i) => s + i.quantity, 0) };
  });
}

// ---------- atomic merge (Section 5.7) ----------
function validateMerge(b) {
  const bad = [];
  if (!isObj(b)) throw validation(['body']);
  if (typeof b.guest_token !== 'string' || !/^guest_\S+$/.test(b.guest_token)) bad.push('guest_token');
  if (typeof b.registered_user_id !== 'string' || !b.registered_user_id) bad.push('registered_user_id');
  if (!Array.isArray(b.guest_cart) || b.guest_cart.length < 1 || b.guest_cart.length > 10
    || !b.guest_cart.every((i) => isObj(i) && typeof i.variant_id === 'string' && Number.isInteger(i.quantity) && i.quantity >= 1)) {
    bad.push('guest_cart');
  }
  if (b.test_write_block !== undefined && typeof b.test_write_block !== 'boolean') bad.push('test_write_block');
  if (bad.length) throw validation(bad);
}

async function userExists(id) {
  const r = await pool.query(`SELECT 1 FROM users WHERE id = $1 UNION ALL SELECT 1 FROM club_players WHERE id = $1
    UNION ALL SELECT 1 FROM players WHERE id = $1 LIMIT 1`, [id]);
  return r.rowCount > 0;
}

async function mergeGuestCart(b) {
  validateMerge(b);
  if (!(await userExists(b.registered_user_id))) {
    throw err(404, 'PLAYER_NOT_FOUND', `User ${b.registered_user_id} does not exist.`, { registered_user_id: b.registered_user_id });
  }
  const ids = [...new Set(b.guest_cart.map((i) => i.variant_id))];
  const price = await prices(ids);
  const missing = ids.find((v) => !price[v]);
  if (missing) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${missing} does not exist.`, { variant_id: missing });
  const key = canonical({ guest_cart: b.guest_cart, registered_user_id: b.registered_user_id });

  return withLock('guest:' + b.guest_token, () => withLock('cart:' + b.registered_user_id, async () => {
    const g = (await pool.query('SELECT * FROM guest_tokens WHERE token = $1', [b.guest_token])).rows[0];
    if (g && g.status === 'merged') {
      // Network-migration replay: same request returns the already-merged cart; anything else is a conflict.
      if (g.merge_key === key) return { status: 200, body: g.merged_response };
      throw err(409, 'GUEST_TOKEN_ALREADY_MERGED', 'This guest cart has already been merged.', { guest_token: b.guest_token });
    }
    const cartRow = (await pool.query('SELECT items FROM carts WHERE user_id = $1', [b.registered_user_id])).rows[0];
    const items = cartRow ? cartRow.items.map((i) => ({ ...i })) : [];
    for (const add of b.guest_cart) {
      const line = items.find((i) => i.variant_id === add.variant_id);
      if (line) line.quantity += add.quantity; else items.push({ variant_id: add.variant_id, quantity: add.quantity });
    }
    for (const line of items) {
      const stock = (price[line.variant_id] || (await prices([line.variant_id]))[line.variant_id]).stock;
      if (ids.includes(line.variant_id) && line.quantity > stock) {
        throw err(409, 'OUT_OF_STOCK', `Variant ${line.variant_id} does not have enough stock.`, { variant_id: line.variant_id });
      }
    }
    const allPrices = await prices(items.map((i) => i.variant_id));
    const testBlock = b.test_write_block !== false;
    const rejection = testBlock ? simulateGuestWrite(b.guest_token) : null;
    const activeCart = cartView(b.registered_user_id, items, allPrices);
    const body = {
      guest_token: b.guest_token,
      write_block_verified: testBlock && rejection === 403,
      write_rejection_code: rejection,
      cart_merged: true,
      active_cart: activeCart,
      signature: signDay2(b.guest_token, {
        cart_merged: true, guest_token: b.guest_token, registered_user_id: b.registered_user_id,
        total_items: activeCart.total_items, write_rejection_code: rejection,
      }),
    };
    await tx(async (c) => {
      await c.query(`INSERT INTO carts(user_id, items) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET items = EXCLUDED.items`,
        [b.registered_user_id, JSON.stringify(items)]);
      await c.query(`INSERT INTO guest_tokens(token, status, merge_key, merged_user_id, merged_response, linked_user_id)
        VALUES ($1, 'merged', $2, $3, $4, $3)
        ON CONFLICT (token) DO UPDATE SET status = 'merged', merge_key = $2, merged_user_id = $3, merged_response = $4, linked_user_id = $3`,
      [b.guest_token, key, b.registered_user_id, body]);
      await c.query('DELETE FROM guest_carts WHERE token = $1', [b.guest_token]);
    });
    return { status: 200, body };
  }));
}

// App flow: a signed-in member merges whatever the guest staged in the browser.
async function mergeStagedCart(user, guestToken) {
  if (typeof guestToken !== 'string' || !guestToken.startsWith('guest_')) throw validation(['guest_token']);
  const staged = await guestCart(guestToken);
  const userId = user.player_id || user.sub;
  if (!staged.items.length) {
    const r = await pool.query('SELECT items FROM carts WHERE user_id = $1', [userId]);
    const items = r.rowCount ? r.rows[0].items : [];
    return { status: 200, body: { cart_merged: false, active_cart: cartView(userId, items, await prices(items.map((i) => i.variant_id))) } };
  }
  return mergeGuestCart({ guest_token: guestToken, registered_user_id: userId, guest_cart: staged.items, test_write_block: false });
}

module.exports = {
  guestWriteGuard, simulateGuestWrite, issueGuestToken, guestCart, stageItem, mergeGuestCart, mergeStagedCart, guestTokenOf,
};
