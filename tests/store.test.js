const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('store'); });
test.after(async () => h.stop());
const order = (id, extra = {}) => ({ order_id: id, customer_id: 'cust-001', items: [{ variant_id: 'var-jersey-001-M', quantity: 1 }],
  discount_code: null, payment: { token: 'tok_success' }, ...extra });
const co = (b) => h.call('POST', '/audit/v1/checkout', b);

test('20 simultaneous buyers for the last unit: exactly one succeeds, stock never negative', async () => {
  await h.call('POST', '/audit/v1/reset', { stock: { 'var-jersey-001-M': 1 } });
  const res = await Promise.all([...Array(20)].map((_, i) => co(order(`burst-${i}`))));
  const codes = res.map((r) => r.status);
  assert.strictEqual(codes.filter((c) => c === 201).length, 1);
  assert.strictEqual(codes.filter((c) => c === 409).length, 19);
  assert.ok(res.filter((r) => r.status === 409).every((r) => r.body.error.code === 'OUT_OF_STOCK' && r.body.error.details.variant_id === 'var-jersey-001-M'));
  assert.deepStrictEqual((await h.call('GET', '/audit/v1/inventory/var-jersey-001-M')).body, { variant_id: 'var-jersey-001-M', stock: 0, reserved: 0 });
});

test('receipt: signature, totals, PDF text, idempotent replay, duplicate id', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const r = await co(order('ord-001', { customer_id: `c'"<script>` }));
  assert.strictEqual(r.status, 201);
  const p = r.body.receipt.payload;
  assert.strictEqual(p.customer_id, `c'"<script>`);
  const { canonical } = require(h.src + '/sign');
  const sig = crypto.createHmac('sha256', process.env.DAY1_SALT).update(`ord-001|${canonical(p)}`).digest('hex');
  assert.strictEqual(r.body.receipt.signature, sig);
  assert.strictEqual(p.total_minor, p.subtotal_minor - p.discount_minor);
  const pdf = Buffer.from(r.body.receipt.pdf_base64, 'base64').toString('latin1');
  assert.ok(pdf.startsWith('%PDF'));
  assert.ok(pdf.includes('PKR 4500.00') && pdf.includes('ord-001'));
  const again = await co(order('ord-001', { customer_id: `c'"<script>` }));
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(again.body, r.body);
  assert.strictEqual((await co(order('ord-001'))).body.error.code, 'DUPLICATE_ORDER_ID');
});

test('discounts, mock gateway failures release stock, validation order', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const L = (id, token, qty = 2, code = null) => co(order(id, { items: [{ variant_id: 'var-jersey-001-L', quantity: qty }], discount_code: code, payment: { token } }));
  assert.strictEqual((await L('d1', 'tok_declined')).body.error.code, 'PAYMENT_DECLINED');
  assert.strictEqual((await L('d2', 'tok_capture_fail')).body.error.code, 'PAYMENT_CAPTURE_FAILED');
  assert.deepStrictEqual((await h.call('GET', '/audit/v1/inventory/var-jersey-001-L')).body, { variant_id: 'var-jersey-001-L', stock: 5, reserved: 0 });
  const ok = await L('d3', 'tok_success', 3, 'WELCOME10');
  assert.deepStrictEqual([ok.body.subtotal_minor, ok.body.discount_minor, ok.body.total_minor], [1350000, 135000, 1215000]);
  assert.strictEqual((await L('d4', 'tok_success', 3)).body.error.code, 'OUT_OF_STOCK');
  assert.strictEqual((await L('d5', 'tok_success', 1, 'NOPE')).body.error.code, 'INVALID_DISCOUNT_CODE');
  assert.strictEqual((await co(order('d6', { items: [{ variant_id: 'var-x', quantity: 1 }] }))).body.error.code, 'VARIANT_NOT_FOUND');
  assert.strictEqual((await co(order('d7', { items: [] }))).status, 400);
  assert.strictEqual((await co(order('d8', { items: [{ variant_id: 'var-jersey-001-L', quantity: 11 }] }))).status, 400);
  assert.strictEqual((await co(order('d9', { payment: { token: 'tok_magic' } }))).status, 400);
  assert.strictEqual((await co('x')).status, 400);
  assert.strictEqual((await h.call('GET', '/audit/v1/inventory/nope')).status, 404);
  const big = await h.call('POST', '/audit/v1/checkout', undefined, null, JSON.stringify({ pad: 'x'.repeat(1100000) }));
  assert.strictEqual(big.status, 413);
  assert.strictEqual(big.body.error.code, 'PAYLOAD_TOO_LARGE');
  assert.strictEqual((await h.call('POST', '/audit/v1/checkout', undefined, null, '{bad')).status, 400);
});

test('reset is repeatable and validates input', async () => {
  const a = await h.call('POST', '/audit/v1/reset', { seed: 7, stock: { 'var-jersey-001-M': 3 } });
  assert.deepStrictEqual(a.body.stock, { 'var-jersey-001-M': 3, 'var-jersey-001-L': 5 });
  const b = await h.call('POST', '/audit/v1/reset', { seed: 7, stock: { 'var-jersey-001-M': 3 } });
  assert.deepStrictEqual(a.body, b.body);
  assert.strictEqual((await h.call('POST', '/audit/v1/reset', { seed: 'x', stock: { a: -1 } })).status, 400);
  assert.strictEqual((await h.call('GET', '/health')).body.status, 'ok');
  assert.strictEqual((await h.call('GET', '/nope')).status, 404);
});
