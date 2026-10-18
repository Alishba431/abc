const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_qr'); });
test.after(async () => h.stop());
const canon = (o) => require(h.src + '/sign').canonical(o);
const sig2 = (id, p) => crypto.createHmac('sha256', process.env.DAY2_SALT).update(`${id}|${canon(p)}`).digest('hex');
const qr = (id, q = '') => h.call('GET', `/audit/v1/qr/${id}${q}`);
let n = 0;
const ev = (match_id, type, payload = {}) => h.call('POST', '/audit/v1/events', { event_id: `q${++n}`, match_id, type, payload });

test('match-m1 metadata, inspect does not count, scans count, signature', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  let r = await qr('match-m1', '?inspect=true');
  assert.strictEqual(r.status, 200);
  const route = '/web/matches/match-m1/live';
  assert.deepStrictEqual(r.body, {
    entity_id: 'match-m1', entity_type: 'match', entity_status: 'in_progress', short_url: 'http://localhost:8080/q/m1-live',
    target_route: route, deep_link_uri: 'nascon://entity/match-m1', scan_count: 0,
    export_formats: { svg: 'http://localhost:8080/audit/v1/qr/match-m1/export.svg', png: 'http://localhost:8080/audit/v1/qr/match-m1/export.png',
      pdf: 'http://localhost:8080/audit/v1/qr/match-m1/export.pdf' },
    signature: sig2('match-m1', { entity_id: 'match-m1', short_url: 'http://localhost:8080/q/m1-live', target_route: route }),
  });
  assert.strictEqual((await qr('match-m1')).body.scan_count, 1);
  assert.strictEqual((await qr('match-m1')).body.scan_count, 2);
  assert.strictEqual((await qr('match-m1', '?inspect=true')).body.scan_count, 2);
});

test('GET /q/{code}: 302 to live route, counts the scan, stores no IP or user agent', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const res = await h.rawCall('GET', '/q/m1-live', { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Mobile' });
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.headers.get('location'), '/web/matches/match-m1/live');
  await h.rawCall('GET', '/q/m1-live', { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' });
  assert.strictEqual((await qr('match-m1', '?inspect=true')).body.scan_count, 2);
  const { pool } = require(h.src + '/db');
  const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'qr_scans' ORDER BY ordinal_position")).rows.map((c) => c.column_name);
  assert.deepStrictEqual(cols, ['n', 'entity_id', 'device_family', 'bucket']);
  const scans = (await pool.query('SELECT device_family, bucket FROM qr_scans ORDER BY n')).rows;
  assert.deepStrictEqual(scans.map((s) => s.device_family), ['mobile', 'desktop']);
  assert.match(scans[0].bucket, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
  assert.strictEqual((await h.rawCall('GET', '/q/nope')).status, 404);
  const { deviceFamily } = require(h.src + '/domain/qr');
  assert.strictEqual(deviceFamily(), 'desktop');
});

test('edge case 2: same short_url, new target_route and signature after match_end; notice states', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  const before = (await qr('match-m1', '?inspect=true')).body;
  assert.strictEqual((await ev('match-m1', 'match_end')).status, 201);
  const after = (await qr('match-m1', '?inspect=true')).body;
  assert.strictEqual(after.short_url, before.short_url);
  assert.deepStrictEqual([after.target_route, after.entity_status], ['/web/matches/match-m1/vod', 'completed']);
  assert.notStrictEqual(after.signature, before.signature);
  assert.strictEqual(after.signature, sig2('match-m1', { entity_id: 'match-m1', short_url: after.short_url, target_route: after.target_route }));
  const loc = (await h.rawCall('GET', '/q/m1-live')).headers.get('location');
  assert.strictEqual(loc, '/web/matches/match-m1/vod');

  await ev('mx-1', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' });
  assert.strictEqual((await qr('mx-1', '?inspect=true')).body.target_route, '/web/matches/mx-1/preview');
  assert.strictEqual((await ev('mx-1', 'match_postpone')).status, 201);
  assert.strictEqual((await qr('mx-1', '?inspect=true')).body.target_route, '/web/matches/mx-1/notice?state=postponed');
  assert.strictEqual((await ev('mx-1', 'match_status', { status: 'upcoming' })).status, 201);
  assert.strictEqual((await ev('mx-1', 'match_start')).status, 201);
  assert.strictEqual((await ev('mx-1', 'match_cancel')).body.error.code, 'ILLEGAL_TRANSITION');
  assert.strictEqual((await ev('mx-1', 'abandon')).status, 201);
  assert.strictEqual((await qr('mx-1', '?inspect=true')).body.target_route, '/web/matches/mx-1/notice?state=abandoned');
  await ev('mx-2', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' });
  await ev('mx-2', 'postpone');
  assert.strictEqual((await ev('mx-2', 'match_start')).status, 201);
  await ev('mx-3', 'match_init', { sport_id: 'football', home_team_id: 'a', away_team_id: 'b' });
  assert.strictEqual((await ev('mx-3', 'match_cancelled')).status, 201);
  assert.strictEqual((await qr('mx-3', '?inspect=true')).body.target_route, '/web/matches/mx-3/notice?state=cancelled');
  assert.strictEqual((await ev('mx-3', 'match_status', { status: 'live' })).status, 400);
  const sc = (await h.call('GET', '/audit/v1/score/mx-3')).body;
  assert.deepStrictEqual([sc.status, sc.outcome], ['cancelled', 'pending']);
});

test('player, club, co-stream and upcoming match routes; auto short codes; 404s', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  let r = (await qr('player-alpha-1', '?inspect=true')).body;
  assert.deepStrictEqual([r.entity_type, r.target_route, r.short_url], ['player', '/web/players/player-alpha-1', 'http://localhost:8080/q/p-alpha-1']);
  r = (await qr('club-alpha-1', '?inspect=true')).body;
  assert.deepStrictEqual([r.entity_type, r.target_route, r.short_url], ['club', '/web/clubs/club-alpha-1', 'http://localhost:8080/q/c-alpha-1']);
  r = (await qr('player-beta-2', '?inspect=true')).body;
  assert.match(r.short_url, /^http:\/\/localhost:8080\/q\/[0-9a-f]{10}$/);
  r = (await qr('demo-a1-m5', '?inspect=true')).body;
  assert.strictEqual(r.target_route, '/web/matches/demo-a1-m5/preview');
  await h.call('POST', '/audit/v1/costream/session', { session_id: 'cs-session-101', host_player_id: 'player-alpha-1',
    participants: ['player-alpha-1', 'player-alpha-2'] });
  r = (await qr('cs-session-101', '?inspect=true')).body;
  assert.deepStrictEqual([r.entity_type, r.entity_status, r.target_route], ['costream', 'active', '/web/costream/cs-session-101']);
  r = await qr('match-nope');
  assert.deepStrictEqual([r.status, r.body.error.code], [404, 'QR_NOT_FOUND']);
  const code = (await qr('player-beta-2', '?inspect=true')).body.short_url.split('/').pop();
  require(h.src + '/cache').clearAll();
  assert.strictEqual((await h.rawCall('GET', `/q/${code}`)).headers.get('location'), '/web/players/player-beta-2');
});

test('exports: SVG, PNG, PDF and errors', async () => {
  await h.call('POST', '/audit/v1/reset', {});
  let res = await h.rawCall('GET', '/audit/v1/qr/match-m1/export.svg');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(await res.text(), /^<svg/);
  res = await h.rawCall('GET', '/audit/v1/qr/match-m1/export.png');
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  res = await h.rawCall('GET', '/audit/v1/qr/club-alpha-1/export.pdf');
  assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
  const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-') && pdf.includes('club-alpha-1') && / re\n/.test(pdf));
  assert.strictEqual((await h.rawCall('GET', '/audit/v1/qr/match-m1/export.gif')).status, 400);
  assert.strictEqual((await h.rawCall('GET', '/audit/v1/qr/nope/export.svg')).status, 404);
});
