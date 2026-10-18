const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start('day2_costream'); await h.call('POST', '/audit/v1/reset', {}); });
test.after(async () => h.stop());
const cs = (b) => h.call('POST', '/audit/v1/costream/session', b);
const canon = (o) => require(h.src + '/sign').canonical(o);
const sig2 = (id, p) => crypto.createHmac('sha256', process.env.DAY2_SALT).update(`${id}|${canon(p)}`).digest('hex');
const FOUR = ['player-alpha-1', 'player-alpha-2', 'player-beta-1', 'player-beta-2'];

test('spec example: host drop hands off to participants[1], replay is idempotent', async () => {
  const body = { session_id: 'cs-session-101', host_player_id: 'player-alpha-1', participants: FOUR, layout: 'grid_4', simulate_host_drop: true };
  const r = await cs(body);
  assert.strictEqual(r.status, 201);
  const expectSig = sig2('cs-session-101', { active_host: 'player-alpha-2', handoff_occurred: true, layout: 'grid_4',
    participant_count: 3, session_id: 'cs-session-101', status: 'active' });
  assert.deepStrictEqual(r.body, {
    session_id: 'cs-session-101', status: 'active', active_host: 'player-alpha-2', handoff_occurred: true, participant_count: 3,
    active_participants: ['player-alpha-2', 'player-beta-1', 'player-beta-2'], layout: 'grid_4',
    composite_playback_url: 'http://localhost:8888/costream/cs-session-101/index.m3u8', chat_room_id: 'chat-cs-session-101',
    signature: expectSig,
  });
  const again = await cs(body);
  assert.strictEqual(again.status, 200);
  assert.deepStrictEqual(again.body, r.body);
  const { getSession } = require(h.src + '/domain/costream');
  assert.strictEqual((await getSession('cs-session-101')).active_host, 'player-alpha-2');
  assert.strictEqual(await getSession('cs-nope'), null);
});

test('no drop keeps host; sole host drop terminates cleanly; default layout grid_4', async () => {
  let r = await cs({ session_id: 'cs-2', host_player_id: 'player-beta-1', participants: ['player-alpha-1', 'player-beta-1'] });
  assert.deepStrictEqual([r.status, r.body.active_host, r.body.handoff_occurred, r.body.participant_count, r.body.layout],
    [201, 'player-beta-1', false, 2, 'grid_4']);
  r = await cs({ session_id: 'cs-3', host_player_id: 'player-alpha-1', participants: ['player-alpha-1'], layout: 'solo', simulate_host_drop: true });
  assert.deepStrictEqual([r.status, r.body.status, r.body.active_host, r.body.handoff_occurred, r.body.participant_count, r.body.active_participants],
    [201, 'terminated', null, false, 0, []]);
  assert.strictEqual(r.body.signature, sig2('cs-3', { active_host: null, handoff_occurred: false, layout: 'solo', participant_count: 0, session_id: 'cs-3', status: 'terminated' }));
  r = await cs({ session_id: 'cs-2', host_player_id: 'player-beta-1', participants: ['player-alpha-1', 'player-beta-1'], simulate_host_drop: true });
  assert.deepStrictEqual([r.status, r.body.active_host, r.body.participant_count], [201, 'player-alpha-1', 1]);
});

test('validation order: 400 schema, 404 player, 400 host not participant, 409 full, 400 layout', async () => {
  let r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: [] });
  assert.deepStrictEqual([r.status, r.body.error.details.fields], [400, ['participants']]);
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-1'] });
  assert.deepStrictEqual(r.body.error.details.fields, ['participants']);
  r = await cs({ host_player_id: 5, participants: ['player-alpha-1'], layout: 'grid_9', simulate_host_drop: 'yes' });
  assert.deepStrictEqual(r.body.error.details.fields, ['session_id', 'host_player_id', 'simulate_host_drop', 'layout']);
  assert.strictEqual((await cs('x')).status, 400);
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-ghost'] });
  assert.deepStrictEqual([r.status, r.body.error.code, r.body.error.details.player_id], [404, 'PLAYER_NOT_FOUND', 'player-ghost']);
  r = await cs({ session_id: 'x', host_player_id: 'player-beta-2', participants: ['player-alpha-1', 'player-alpha-2'] });
  assert.deepStrictEqual([r.status, r.body.error.code, r.body.error.details.fields], [400, 'VALIDATION_ERROR', ['host_player_id']]);
  const { pool } = require(h.src + '/db');
  await pool.query("INSERT INTO club_players(id, club_id, tenant_id, data) VALUES ('player-extra-1','club-alpha-1','tenant-alpha','{}')");
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: [...FOUR, 'player-extra-1'] });
  assert.deepStrictEqual([r.status, r.body.error.code], [409, 'COSTREAM_SESSION_FULL']);
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2'], layout: 'solo' });
  assert.deepStrictEqual([r.status, r.body.error.code], [400, 'UNSUPPORTED_LAYOUT']);
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: FOUR.slice(0, 3), layout: 'grid_2' });
  assert.deepStrictEqual([r.status, r.body.error.code], [400, 'UNSUPPORTED_LAYOUT']);
  r = await cs({ session_id: 'x', host_player_id: 'player-alpha-1', participants: FOUR.slice(0, 3), layout: 'grid_2', simulate_host_drop: true });
  assert.deepStrictEqual([r.status, r.body.participant_count], [201, 2]);
  r = await cs({ session_id: 'y', host_player_id: 'player-alpha-1', participants: ['player-alpha-1', 'player-alpha-2'], layout: 'solo', simulate_host_drop: true });
  assert.deepStrictEqual([r.status, r.body.layout, r.body.active_host], [201, 'solo', 'player-alpha-2']);
  r = await cs({ session_id: 'z', host_player_id: 'player-alpha-1', participants: FOUR, layout: 'spotlight' });
  assert.deepStrictEqual([r.status, r.body.layout], [201, 'spotlight']);
});
