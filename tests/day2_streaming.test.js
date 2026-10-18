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
