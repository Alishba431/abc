const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_moderation'); });
test.after(async () => h.stop());
const canon = (o) => require(h.src + '/sign').canonical(o);
const sig2 = (id, p) => crypto.createHmac('sha256', process.env.DAY2_SALT).update(`${id}|${canon(p)}`).digest('hex');
const mod = (b) => h.call('POST', '/audit/v1/moderation/test', b);
const SPEC = {
  chat_room_id: 'chat-cs-session-101',
  incoming_messages: [
    { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary' },
    { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
    { message_id: 'msg-3', sender: 'user-flooder', text: 'GOAL! AAAA!!!' },
  ],
  check_dlq: true, simulate_failed_notifications: 0,
};

test('spec example: masking, kick, flood drop + mute, empty DLQ, signature', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const r = await mod(SPEC);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.filtered_messages, [
    { message_id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary', flagged: false, reason: null },
    { message_id: 'msg-2', sender: 'user-spammer', text: 'Watch this illegal stream *** now!', flagged: true, reason: 'profanity_leetspeak' },
  ]);
  assert.deepStrictEqual([r.body.kicked_users, r.body.muted_users, r.body.dlq_status], [['user-spammer'], ['user-flooder'], { queue_depth: 0, undelivered_events: [] }]);
  assert.strictEqual(r.body.signature, sig2('chat-cs-session-101', { chat_room_id: 'chat-cs-session-101', flagged_count: r.body.flagged_count,
    kicked_users: ['user-spammer'], queue_depth: 0 }));
});

test('leetspeak dictionary and flood rules', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const texts = ['p.0.r.n link', 'total s!c@m', 'f*u*c*k this', 'a$$h0le', 'idiot_spam!', 'sh1t', 'b1tch', 'bad_word', 'scampi is great'];
  const r = await mod({ chat_room_id: 'room-x', incoming_messages: texts.map((t, i) => ({ message_id: `m${i}`, sender: `u${i}`, text: t })) });
  assert.deepStrictEqual(r.body.filtered_messages.map((m) => m.text),
    ['*** link', 'total ***', '*** this', '***', '***', '***', '***', '***', 'scampi is great']);
  assert.strictEqual(r.body.kicked_users.length, 8);
  const f = await mod({ chat_room_id: 'room-y', incoming_messages: [
    { message_id: 'a', sender: 's1', text: 'what???' }, { message_id: 'b', sender: 's2', text: 'nooooo' },
    { message_id: 'c', sender: 's1', text: 'Great goal!' }] });
  assert.deepStrictEqual([f.body.filtered_messages.length, f.body.muted_users], [1, ['s1', 's2']]);
  const { isFlood, isProfane } = require(h.src + '/domain/moderation');
  assert.ok(!isFlood('Nice pass !!') && isProfane('Scam!') && !isProfane('classic'));
});

test('edge case 3: 10 concurrent kicks of the same spammer stay deduplicated, no 500s', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const body = { chat_room_id: 'chat-cs-session-101', incoming_messages: [{ message_id: 'x', sender: 'user-spammer', text: 'b@d_w0rd' }], simulate_failed_notifications: 1 };
  const all = await Promise.all([...Array(10)].map(() => mod(body)));
  assert.ok(all.every((r) => r.status === 200));
  assert.ok(all.every((r) => JSON.stringify(r.body.kicked_users) === '["user-spammer"]'));
  const last = await mod({ chat_room_id: 'chat-cs-session-101', incoming_messages: [] });
  assert.strictEqual(last.body.dlq_status.queue_depth, 10);
  assert.ok(last.body.dlq_status.undelivered_events.every((e) => e.attempts === 3 && e.type === 'chat.notification'));
  const m = await h.call('GET', '/metrics');
  assert.match(m.body, /^nascon_dlq_depth 10$/m);
});

test('validation and DLQ delivery success path', async () => {
  assert.deepStrictEqual((await mod({ incoming_messages: 'x', check_dlq: 1, simulate_failed_notifications: -1 })).body.error.details.fields,
    ['chat_room_id', 'incoming_messages', 'check_dlq', 'simulate_failed_notifications']);
  assert.strictEqual((await mod([])).status, 400);
  const dlq = require(h.src + '/domain/dlq');
  assert.deepStrictEqual(await dlq.deliver({ event_id: 'ok' }, async () => {}), { delivered: true, attempts: 1 });
  let tries = 0;
  assert.deepStrictEqual(await dlq.deliver({ event_id: 'flaky' }, async () => { tries += 1; if (tries < 2) throw new Error('x'); }), { delivered: true, attempts: 2 });
});

test('member chat: masking, flood drop then mute, 3-per-2s rate limit, public history', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const tok = async (email) => (await h.call('POST', '/api/v1/auth/login', { email, password: 'Nascon@26' })).body.token;
  const viewer = await tok('viewer@nascon.test');
  const chat = (text, t = viewer, room = 'chat-cs-session-101') => h.call('POST', '/api/v1/chat', { chat_room_id: room, text }, t);
  let r = await chat('What a match');
  assert.deepStrictEqual([r.status, r.body.accepted, r.body.message.text], [201, true, 'What a match']);
  r = await chat('total sc@m');
  assert.deepStrictEqual([r.status, r.body.message.text, r.body.message.flagged], [201, 'total ***', true]);
  assert.strictEqual((await chat('next')).body.error.code, 'FORBIDDEN');
  const manager = await tok('manager@nascon.test');
  r = await chat('GOAL!!!', manager);
  assert.deepStrictEqual([r.status, r.body.accepted, r.body.reason], [200, false, 'flood_character_repeat']);
  assert.strictEqual((await chat('hello', manager)).status, 403);
  const player = await tok('player@nascon.test');
  for (let i = 0; i < 3; i++) assert.strictEqual((await chat(`msg ${i}`, player, 'room-fast')).status, 201);
  r = await chat('one more', player, 'room-fast');
  assert.deepStrictEqual([r.status, r.body.error.code], [429, 'RATE_LIMITED']);
  assert.strictEqual((await chat('', player)).status, 400);
  const hist = await h.call('GET', '/api/v1/public/chat/chat-cs-session-101');
  assert.deepStrictEqual(hist.body.messages.map((m) => m.text), ['What a match', 'total ***']);
  require(h.src + '/cache').clearAll();
  await new Promise((res) => setTimeout(res, 200));
  const fromDb = await h.call('GET', '/api/v1/public/chat/chat-cs-session-101');
  assert.deepStrictEqual(fromDb.body.messages.map((m) => [m.seq, m.text]), [[1, 'What a match'], [2, 'total ***']]);
});
