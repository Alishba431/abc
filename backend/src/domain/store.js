// Concurrency-safe checkout (Section 5.12): atomic conditional reservation, mock gateway, signed receipt.
const { pool, tx } = require('../db');
const { err } = require('../errors');
const { canonical, sign } = require('../sign');
const { withLock, isoNow } = require('../util');
const { Checker, isObj, isId, isInt, isStr } = require('../validate');
const { publish } = require('../queue');
const { makePdf } = require('../pdf');

const TOKENS = ['tok_success', 'tok_declined', 'tok_capture_fail'];
let gatewaySeq = 0;

// Mock payment gateway: authorize -> capture, with deterministic failure tokens.
const gateway = {
  authorize(token) {
    gatewaySeq += 1;
    if (token === 'tok_declined') return { ok: false };
    return { ok: true, authorization_id: `auth_${gatewaySeq}` };
  },
  capture(token) {
    if (token === 'tok_capture_fail') return { ok: false };
    return { ok: true, capture_id: `cap_${gatewaySeq}` };
  },
  void() { return { ok: true }; },
};

function validateCheckout(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(isId(b.order_id), 'order_id');
  c.check(isStr(b.customer_id, 1, 256), 'customer_id');
  if (c.check(Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 10, 'items')) {
    b.items.forEach((it, i) => {
      c.check(isObj(it) && isId(it.variant_id) && isInt(it.quantity) && it.quantity >= 1 && it.quantity <= 10, `items[${i}]`);
    });
    const ids = b.items.map((it) => it && it.variant_id);
    c.check(new Set(ids).size === ids.length, 'items');
  }
  c.check(b.discount_code === null || b.discount_code === undefined || isStr(b.discount_code, 1, 64), 'discount_code');
  c.check(isObj(b.payment) && TOKENS.includes(b.payment.token), 'payment.token');
  c.done();
}

const bodyKey = (b) => canonical({ customer_id: b.customer_id, items: b.items, discount_code: b.discount_code ?? null, payment: b.payment });

const formatPkr = (minor) => `PKR ${(minor / 100).toFixed(2)}`;

async function checkout(b) {
  validateCheckout(b);
  return withLock('order:' + b.order_id, async () => {
    const prev = await pool.query('SELECT body_key, response FROM orders WHERE order_id = $1', [b.order_id]);
    if (prev.rowCount) {
      if (prev.rows[0].body_key !== bodyKey(b)) throw err(409, 'DUPLICATE_ORDER_ID', `Order ${b.order_id} already exists with a different body.`, { order_id: b.order_id });
      return { status: 200, body: prev.rows[0].response };
    }
    const vids = b.items.map((i) => i.variant_id);
    const vr = await pool.query('SELECT id, price_minor FROM variants WHERE id = ANY($1)', [vids]);
    const price = Object.fromEntries(vr.rows.map((v) => [v.id, v.price_minor]));
    const missing = vids.find((v) => !(v in price));
    if (missing) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${missing} does not exist.`, { variant_id: missing });
    let percent = 0;
    if (b.discount_code !== null && b.discount_code !== undefined) {
      const d = await pool.query('SELECT percent FROM discount_codes WHERE code = $1', [b.discount_code]);
      if (!d.rowCount) throw err(400, 'INVALID_DISCOUNT_CODE', 'Discount code is not valid.', { discount_code: b.discount_code });
      percent = d.rows[0].percent;
    }

    // 1) Reserve all items atomically; the conditional UPDATE can never drive stock negative.
    const sorted = [...b.items].sort((x, y) => (x.variant_id < y.variant_id ? -1 : 1));
    await tx(async (c) => {
      for (const it of sorted) {
        const u = await c.query(
          'UPDATE variants SET stock = stock - $2, reserved = reserved + $2 WHERE id = $1 AND stock >= $2', [it.variant_id, it.quantity]);
        if (!u.rowCount) throw err(409, 'OUT_OF_STOCK', `Variant ${it.variant_id} has no stock left.`, { variant_id: it.variant_id });
      }
    });
    const release = () => tx(async (c) => {
      for (const it of sorted) {
        await c.query('UPDATE variants SET stock = stock + $2, reserved = reserved - $2 WHERE id = $1', [it.variant_id, it.quantity]);
      }
    });

    // 2) Mock gateway.
    const token = b.payment.token;
    const auth = gateway.authorize(token);
    if (!auth.ok) {
      await release();
      publish('order.payment_declined', { order_id: b.order_id });
      throw err(402, 'PAYMENT_DECLINED', 'Payment authorization was declined.', { order_id: b.order_id });
    }
    const cap = gateway.capture(token);
    if (!cap.ok) {
      gateway.void(auth.authorization_id);
      await release();
      publish('order.payment_capture_failed', { order_id: b.order_id });
      throw err(402, 'PAYMENT_CAPTURE_FAILED', 'Payment capture failed; authorization voided.', { order_id: b.order_id });
    }

    // 3) Commit reservation and build the signed receipt.
    const items = b.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity, unit_price_minor: price[i.variant_id] }));
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price_minor, 0);
    const discount = Math.floor((subtotal * percent) / 100);
    const total = subtotal - discount;
    const payload = {
      order_id: b.order_id, customer_id: b.customer_id, items, subtotal_minor: subtotal,
      discount_minor: discount, total_minor: total, currency: 'PKR', paid_at: isoNow(),
    };
    const pdf = makePdf([
      { text: 'League Ops Store - Receipt', size: 18 },
      { text: `Order: ${b.order_id}` },
      { text: `Customer: ${b.customer_id}` },
      { text: `Paid at: ${payload.paid_at}` },
      ...items.map((i) => ({ text: `${i.variant_id} x${i.quantity} @ ${formatPkr(i.unit_price_minor)}` })),
      { text: `Subtotal: ${formatPkr(subtotal)}` },
      { text: `Discount: ${formatPkr(discount)}` },
      { text: `Total: ${formatPkr(total)}`, size: 14 },
    ]);
    const response = {
      order_id: b.order_id, status: 'paid', currency: 'PKR', items,
      subtotal_minor: subtotal, discount_minor: discount, total_minor: total,
      payment: { authorization_id: auth.authorization_id, capture_id: cap.capture_id, state: 'captured' },
      receipt: { payload, signature: sign(b.order_id, payload), pdf_base64: pdf.toString('base64') },
    };
    await tx(async (c) => {
      for (const it of sorted) await c.query('UPDATE variants SET reserved = reserved - $2 WHERE id = $1', [it.variant_id, it.quantity]);
      await c.query('INSERT INTO orders(order_id, body_key, status, response, pdf) VALUES ($1,$2,$3,$4,$5)',
        [b.order_id, bodyKey(b), 'paid', response, pdf]);
    });
    publish('order.status_changed', { order_id: b.order_id, from: 'pending', to: 'paid', total_minor: total });
    return { status: 201, body: response };
  });
}

async function inventory(variantId) {
  const v = await pool.query('SELECT id, stock, reserved FROM variants WHERE id = $1', [variantId]);
  if (!v.rowCount) throw err(404, 'VARIANT_NOT_FOUND', `Variant ${variantId} does not exist.`, { variant_id: variantId });
  return { variant_id: v.rows[0].id, stock: v.rows[0].stock, reserved: v.rows[0].reserved };
}

module.exports = { checkout, inventory };
