const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_observability'); await h.call('POST', '/audit/v1/reset', {}); });
test.after(async () => h.stop());

// Minimal RFC 6455 client: handshake, then collect text frames.
function ws(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(h.port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const msgs = [];
    let buf = Buffer.alloc(0);
    let open = false;
    sock.on('error', reject);
    sock.on('close', () => { if (!open) resolve({ closed: true, msgs }); });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!open) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        buf = buf.subarray(i + 4);
        open = true;
        resolve({ head, msgs, sock, close: () => sock.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0])) });
      }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) break;
        if ((buf[0] & 0x0f) === 1) msgs.push({ at: Date.now(), data: JSON.parse(buf.subarray(off, off + len).toString()) });
        buf = buf.subarray(off + len);
      }
    });
    sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('NFR-1: per-match WebSocket pushes the new score to 25 clients well under 500 ms', async () => {
  const clients = await Promise.all([...Array(25)].map(() => ws('/ws/matches/match-m1')));
  const other = await ws('/ws/matches/demo-a1-m4');
  const all = await ws('/ws');
  assert.match(clients[0].head, /101 Switching Protocols/);
  const m = await h.call('GET', '/metrics');
  assert.match(m.body, /^nascon_active_ws_connections 27$/m);
  const t0 = Date.now();
  await h.call('POST', '/audit/v1/events', { event_id: 'ws-goal', match_id: 'match-m1', type: 'score', payload: { team_id: 'club-alpha-1', event_type: 'goal' } });
  await wait(300);
  const lat = clients.map((c) => c.msgs[0].at - t0).sort((a, b) => a - b);
  assert.ok(lat[Math.floor(lat.length * 0.95) - 1] < 500, `p95 ${lat}`);
  const msg = clients[0].msgs[0].data;
  assert.deepStrictEqual([msg.type, msg.data.match_id, msg.data.score, msg.data.status], ['match.event_appended', 'match-m1', { home: 2, away: 0 }, 'in_progress']);
  assert.strictEqual(other.msgs.length, 0);
  assert.deepStrictEqual(all.msgs.map((x) => x.data.type), ['hello', 'match.event_appended']);
  [...clients, other, all].forEach((c) => c.close());
  await wait(100);
  const bad = await ws('/ws/elsewhere');
  assert.strictEqual(bad.closed, true);
});

test('chat room socket and SSE stream', async () => {
  const room = await ws('/ws/chat/chat-cs-session-101');
  await h.call('POST', '/audit/v1/moderation/test', { chat_room_id: 'chat-cs-session-101', incoming_messages: [{ message_id: 'c1', sender: 'u', text: 'hello' }] });
  const got = await new Promise((resolve) => {
    http.get(`${h.base}/api/v1/matches/match-m1/stream`, (res) => {
      assert.strictEqual(res.headers['content-type'], 'text/event-stream');
      let data = '';
      res.on('data', (d) => {
        data += d;
        if (data.includes('event: match.event_appended')) { res.destroy(); resolve(data); }
      });
      setTimeout(() => h.call('POST', '/audit/v1/events', { event_id: 'sse-goal', match_id: 'match-m1', type: 'score', payload: { team_id: 'club-alpha-2', event_type: 'goal' } }), 100);
    });
  });
  assert.match(got, /"score":\{"home":2,"away":1\}/);
  await wait(50);
  assert.strictEqual(room.msgs[0].data.type, 'chat.message');
  assert.strictEqual(room.msgs[0].data.data.text, 'hello');
  room.close();
});

test('privacy erasure wipes PII and unlinks guest tokens', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  await h.call('POST', '/audit/v1/guest/cart-merge', { guest_token: 'guest_anon_tok_7721', registered_user_id: 'player-alpha-1', guest_cart: [{ variant_id: 'var-jersey-001-L', quantity: 1 }] });
  const t0 = Date.now();
  const r = await h.call('DELETE', '/audit/v1/privacy/user/player-alpha-1');
  assert.ok(Date.now() - t0 < 1000);
  assert.deepStrictEqual(r.body, { user_id: 'player-alpha-1', status: 'anonymized', pii_retained: false, tokens_wiped: true });
  const { pool } = require(h.src + '/db');
  assert.strictEqual((await pool.query("SELECT data->>'name' AS n FROM club_players WHERE id = 'player-alpha-1'")).rows[0].n, 'Anonymized user');
  assert.strictEqual((await pool.query("SELECT status FROM guest_tokens WHERE token = 'guest_anon_tok_7721'")).rows[0].status, 'anonymized');
  assert.strictEqual((await h.call('POST', '/api/v1/auth/login', { email: 'player@nascon.test', password: 'Nascon@26' })).status, 401);
  assert.strictEqual((await h.call('DELETE', '/audit/v1/privacy/user/ghost')).status, 404);
});

test('MediaMTX integration: health, sampler, kick on revoke (fake control API)', async () => {
  const kicked = [];
  let bytes = 0;
  let up = true;
  const fake = http.createServer((req, res) => {
    if (!up) { res.writeHead(500); return res.end(); }
    if (req.url.startsWith('/v3/config/global/get')) return res.end('{}');
    if (req.url.startsWith('/v3/paths/list')) { bytes += 250000; return res.end(JSON.stringify({ items: [{ name: 'live/k', ready: true, bytesReceived: bytes }, { name: 'idle', ready: false }] })); }
    if (req.url.startsWith('/v3/paths/get/live/')) return res.end(JSON.stringify({ source: { type: 'rtmpConn', id: 'conn-1' } }));
    if (req.url.startsWith('/v3/rtmpconns/kick/')) { kicked.push(req.url); return res.end(); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.MEDIA_API_URL = `http://127.0.0.1:${fake.address().port}`;
  try {
    const metrics = require(h.src + '/metrics');
    await metrics.sampleMedia();
    await wait(50);
    await metrics.sampleMedia();
    assert.strictEqual(metrics.stats.active, 1);
    assert.ok(metrics.stats.kbps > 0);
    assert.strictEqual((await h.call('GET', '/health')).body.status, 'ok');
    await h.call('POST', '/audit/v1/stream/key', { action: 'generate', player_id: 'player-alpha-2' });
    await h.call('POST', '/audit/v1/stream/key', { action: 'revoke', player_id: 'player-alpha-2' });
    await wait(100);
    assert.deepStrictEqual(kicked, ['/v3/rtmpconns/kick/conn-1']);
    const media = require(h.src + '/media');
    assert.strictEqual(await media.kickPath('nothing-here'), false);
    up = false;
    assert.strictEqual(await media.healthy(), false);
    assert.strictEqual((await h.call('GET', '/health')).body.status, 'media_unavailable');
    await metrics.sampleMedia();
    assert.strictEqual(metrics.stats.active, 0);
  } finally {
    delete process.env.MEDIA_API_URL;
    fake.close();
  }
});
