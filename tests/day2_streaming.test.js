const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_streaming'); });
test.after(async () => h.stop());
const key = (b) => h.call('POST', '/audit/v1/stream/key', b);
const canon = (o) => require(h.src + '/sign').canonical(o);
const sig2 = (id, p) => crypto.createHmac('sha256', process.env.DAY2_SALT).update(`${id}|${canon(p)}`).digest('hex');

test('Appendix A DAY2 vectors (reference salt T01D27ad7ffff12e)', () => {
  const { signDay2 } = require(h.src + '/sign');
  assert.strictEqual(signDay2('sk_live_9f83a1b2c3d4e5f6', { action: 'rotate', player_id: 'player-alpha-1', status: 'active',
    stream_key: 'sk_live_9f83a1b2c3d4e5f6' }), '9bd054eb746844b4701c6f158209c315ef2b16f392efd733bdf0715940610289');
  assert.strictEqual(signDay2('sk_live_101', { action: 'rotate', player_id: 'player-alpha-1' }),
    '830b24eb2c795c02c54c17516b0e96870f5b65d98d28c2f0a15619ec3e076188');
});

test('Day 2 reset seed: match-m1 live 1-0, player-beta-2, QR maps, guest token, empty cart', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const s = (await h.call('GET', '/audit/v1/score/match-m1')).body;
  assert.deepStrictEqual([s.status, s.home.team_id, s.home.score, s.away.team_id, s.away.score, s.league_id],
    ['in_progress', 'club-alpha-1', 1, 'club-alpha-2', 0, 'league-alpha-1']);
  const { pool } = require(h.src + '/db');
  const qr = (await pool.query('SELECT entity_id, short_code, scan_count FROM qr_codes ORDER BY entity_id')).rows;
  assert.deepStrictEqual(qr.map((r) => [r.entity_id, r.short_code, r.scan_count]),
    [['club-alpha-1', 'c-alpha-1', 0], ['match-m1', 'm1-live', 0], ['player-alpha-1', 'p-alpha-1', 0]]);
  assert.strictEqual((await pool.query("SELECT status FROM guest_tokens WHERE token = 'guest_anon_tok_7721'")).rows[0].status, 'active');
  assert.deepStrictEqual((await pool.query("SELECT items FROM carts WHERE user_id = 'player-alpha-1'")).rows[0].items, []);
  assert.strictEqual((await pool.query("SELECT club_id FROM club_players WHERE id = 'player-beta-2'")).rows[0].club_id, 'club-beta-1');
});

test('stream key: rotate with override reproduces Appendix A vector 1 exactly', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const r = await key({ action: 'rotate', player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key_override: 'sk_live_9f83a1b2c3d4e5f6' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, {
    player_id: 'player-alpha-1', label: 'OBS-Main-Desk', stream_key: 'sk_live_9f83a1b2c3d4e5f6', status: 'active',
    ingest_endpoints: { rtmp: 'rtmp://localhost:1935/live/sk_live_9f83a1b2c3d4e5f6',
      webrtc: 'http://localhost:8889/live/sk_live_9f83a1b2c3d4e5f6/whip' },
    playback_url: 'http://localhost:8888/live/sk_live_9f83a1b2c3d4e5f6/index.m3u8',
    signature: '9bd054eb746844b4701c6f158209c315ef2b16f392efd733bdf0715940610289',
  });
});

test('stream key lifecycle: generate 201, rotate invalidates old, revoke, KEY_REVOKED, STREAM_NOT_FOUND', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  assert.strictEqual((await key({ action: 'revoke', player_id: 'player-alpha-2' })).body.error.code, 'STREAM_NOT_FOUND');
  const g = await key({ action: 'generate', player_id: 'player-alpha-2' });
  assert.strictEqual(g.status, 201);
  assert.match(g.body.stream_key, /^sk_live_[a-f0-9]{16}$/);
  assert.strictEqual(g.body.label, 'default');
  assert.strictEqual(g.body.signature, sig2(g.body.stream_key, { action: 'generate', player_id: 'player-alpha-2', status: 'active', stream_key: g.body.stream_key }));
  const r = await key({ action: 'rotate', player_id: 'player-alpha-2' });
  assert.strictEqual(r.status, 200);
  assert.notStrictEqual(r.body.stream_key, g.body.stream_key);
  const { authorizeIngest } = require(h.src + '/domain/streaming');
  assert.deepStrictEqual(await authorizeIngest(`live/${g.body.stream_key}`), { ok: false, status: 409, code: 'KEY_REVOKED' });
  assert.deepStrictEqual(await authorizeIngest(`live/${r.body.stream_key}`), { ok: true });
  assert.deepStrictEqual(await authorizeIngest('live/sk_live_nope'), { ok: false, status: 404, code: 'STREAM_NOT_FOUND' });
  assert.deepStrictEqual(await authorizeIngest('costream/cs-1'), { ok: true });
  const v = await key({ action: 'revoke', player_id: 'player-alpha-2' });
  assert.strictEqual(v.status, 200);
  assert.deepStrictEqual([v.body.status, v.body.ingest_endpoints, v.body.playback_url, v.body.stream_key],
    ['revoked', null, null, r.body.stream_key]);
  assert.strictEqual(v.body.signature, sig2(r.body.stream_key, { action: 'revoke', player_id: 'player-alpha-2', status: 'revoked', stream_key: r.body.stream_key }));
  assert.strictEqual((await key({ action: 'revoke', player_id: 'player-alpha-2' })).body.error.code, 'KEY_REVOKED');
  assert.strictEqual((await key({ action: 'generate', player_id: 'player-alpha-2', stream_key_override: r.body.stream_key })).body.error.code, 'KEY_REVOKED');
  const again = await key({ action: 'generate', player_id: 'player-beta-2', stream_key_override: 'sk_live_aaaaaaaaaaaaaaaa' });
  assert.strictEqual(again.status, 201);
  assert.strictEqual((await key({ action: 'generate', player_id: 'player-alpha-1', stream_key_override: 'sk_live_aaaaaaaaaaaaaaaa' })).body.error.code, 'KEY_REVOKED');
  const same = await key({ action: 'generate', player_id: 'player-beta-2', stream_key_override: 'sk_live_aaaaaaaaaaaaaaaa', label: 'Desk-2' });
  assert.deepStrictEqual([same.status, same.body.label], [201, 'Desk-2']);
});

test('stream key validation order: 400 then 404', async () => {
  let r = await key({ action: 'pause', player_id: 'player-alpha-1' });
  assert.deepStrictEqual([r.status, r.body.error.details.fields], [400, ['action']]);
  r = await key({ action: 'rotate' });
  assert.deepStrictEqual([r.status, r.body.error.details.fields], [400, ['player_id']]);
  r = await key({ action: 'rotate', player_id: 'player-alpha-1', label: '' });
  assert.deepStrictEqual(r.body.error.details.fields, ['label']);
  r = await key({ action: 'rotate', player_id: 'player-alpha-1', stream_key_override: 'bad key|x' });
  assert.deepStrictEqual(r.body.error.details.fields, ['stream_key_override']);
  assert.strictEqual((await key([])).status, 400);
  r = await key({ action: 'rotate', player_id: 'player-ghost' });
  assert.deepStrictEqual([r.status, r.body.error.code], [404, 'PLAYER_NOT_FOUND']);
});

test('media auth hook and metrics exposition', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const g = await key({ action: 'generate', player_id: 'player-alpha-1' });
  assert.strictEqual((await h.call('POST', '/internal/media/auth', { action: 'publish', path: `live/${g.body.stream_key}` })).status, 200);
  assert.strictEqual((await h.call('POST', '/internal/media/auth', { action: 'read', path: 'live/whatever' })).status, 200);
  await key({ action: 'revoke', player_id: 'player-alpha-1' });
  const denied = await h.call('POST', '/internal/media/auth', { action: 'publish', path: `live/${g.body.stream_key}` });
  assert.deepStrictEqual([denied.status, denied.body.error.code], [409, 'KEY_REVOKED']);
  const m = await h.call('GET', '/metrics');
  assert.strictEqual(m.status, 200);
  assert.strictEqual(m.headers.get('content-type'), 'text/plain; version=0.0.4');
  for (const name of ['nascon_active_ws_connections', 'nascon_active_streams_total', 'nascon_stream_bitrate_kbps', 'nascon_dlq_depth', 'nascon_qr_scans_total']) {
    assert.match(m.body, new RegExp(`^# TYPE ${name} (gauge|counter)$`, 'm'));
    assert.match(m.body, new RegExp(`^${name} \\d+$`, 'm'));
  }
  const metrics = require(h.src + '/metrics');
  await metrics.sampleMedia();
  metrics.startSampler();
  assert.strictEqual((await h.call('GET', '/health')).body.status, 'ok');
});

test('FR-3.2 recording: an ended live stream is pulled from MediaMTX playback, stored in MinIO and indexed as a VOD', async () => {
  const http = require('http');
  const cfg = { playback: false, record: false };
  const patches = [];
  const objects = {};
  let s3Up = true;
  const read = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const mtx = http.createServer(async (req, res) => {
    const body = await read(req);
    if (req.url === '/v3/config/global/get') return res.end(JSON.stringify({ playback: cfg.playback }));
    if (req.url === '/v3/config/pathdefaults/get') return res.end(JSON.stringify({ record: cfg.record }));
    if (req.method === 'PATCH') { patches.push(req.url); Object.assign(cfg, JSON.parse(body)); return res.end(); }
    if (req.url.startsWith('/list?path=live%2F')) return res.end(JSON.stringify([{ start: '2026-10-18T07:50:00Z', duration: 4.2 }]));
    if (req.url.startsWith('/get?')) return res.end('fake-mp4-bytes');
    res.writeHead(404); return res.end();
  });
  const s3 = http.createServer(async (req, res) => {
    const body = await read(req);
    const auth = req.headers.authorization || '';
    if (!s3Up || !/^AWS4-HMAC-SHA256 Credential=nascon\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(auth)) {
      res.writeHead(403); return res.end();
    }
    if (req.method === 'PUT') {
      assert.strictEqual(req.headers['x-amz-content-sha256'], crypto.createHash('sha256').update(body).digest('hex'));
      objects[req.url] = body; return res.end();
    }
    if (objects[req.url]) return res.end(objects[req.url]);
    res.writeHead(404); return res.end();
  });
  await new Promise((r) => mtx.listen(0, r));
  await new Promise((r) => s3.listen(0, r));
  Object.assign(process.env, { MEDIA_API_URL: `http://127.0.0.1:${mtx.address().port}`, MEDIA_PLAYBACK_URL: `http://127.0.0.1:${mtx.address().port}`,
    MINIO_ENDPOINT: `http://127.0.0.1:${s3.address().port}`, MINIO_ROOT_USER: 'nascon', MINIO_ROOT_PASSWORD: 'test-secret', VOD_SETTLE_MS: '5' });
  const vod = require(h.src + '/domain/vod');
  vod._reset();
  try {
    const k = (await key({ action: 'generate', player_id: 'player-alpha-1' })).body.stream_key;
    assert.deepStrictEqual(await vod.onPaths([{ name: `live/${k}`, ready: true }, { name: 'costream/x', ready: true }]), []);
    assert.deepStrictEqual(patches, ['/v3/config/global/patch', '/v3/config/pathdefaults/patch']);
    const [[vodId]] = await vod.onPaths([]); // the stream stopped publishing
    assert.match(vodId, /^vod-[0-9a-f]{12}$/);
    assert.deepStrictEqual(Object.keys(objects), [`/recordings/vod/${k}/${vodId}.mp4`]);
    assert.deepStrictEqual(await vod.finalize(`live/${k}`, { settleMs: 0 }), []); // already indexed: idempotent
    assert.deepStrictEqual(await vod.finalize('live/not-a-key', { settleMs: 0 }), []);

    const admin = (await h.call('POST', '/api/v1/auth/login', { email: 'admin@nascon.test', password: 'Nascon@26' })).body.token;
    const profile = (await h.call('GET', '/api/v1/athletes/player-alpha-1', undefined, admin)).body;
    assert.deepStrictEqual(profile.vods.map((v) => [v.vod_id, v.duration_s, v.bytes, v.playback_url]),
      [[vodId, 4.2, 14, `/api/v1/public/vods/${vodId}`]]);
    const play = await h.rawCall('GET', `/api/v1/public/vods/${vodId}`);
    assert.deepStrictEqual([play.status, play.headers.get('content-type'), await play.text()], [200, 'video/mp4', 'fake-mp4-bytes']);
    assert.strictEqual((await h.call('GET', '/api/v1/public/vods/vod-nope')).body.error.code, 'STREAM_NOT_FOUND');

    // Object store down: the finalize failure is logged and never escapes the sampler.
    s3Up = false;
    const k2 = (await key({ action: 'generate', player_id: 'player-alpha-2' })).body.stream_key;
    await vod.onPaths([{ name: `live/${k2}`, ready: true }]);
    assert.deepStrictEqual(await vod.onPaths([]), [[]]);
    assert.strictEqual((await h.rawCall('GET', `/api/v1/public/vods/${vodId}`)).status, 500);
    // Already-enabled media server is left untouched.
    vod._reset();
    await vod.enableRecording();
    assert.strictEqual(patches.length, 2);
  } finally {
    for (const v of ['MEDIA_API_URL', 'MEDIA_PLAYBACK_URL', 'MINIO_ENDPOINT', 'MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'VOD_SETTLE_MS']) delete process.env[v];
    vod._reset();
    mtx.close();
    s3.close();
  }
});
