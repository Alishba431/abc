// Phase II baseline (Part II Section 5.2): seeded on every /reset on top of the Day 1 baseline.
const { sign } = require('./sign');
const { bodyKey } = require('./domain/events');

const QR_SEED = [
  ['match-m1', 'm1-live'],
  ['player-alpha-1', 'p-alpha-1'],
  ['club-alpha-1', 'c-alpha-1'],
];

async function seedDay2(c) {
  const q = (sql, params) => c.query(sql, params);
  await q('INSERT INTO club_players(id, club_id, tenant_id, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
    ['player-beta-2', 'club-beta-1', 'tenant-beta', { id: 'player-beta-2', club_id: 'club-beta-1', tenant_id: 'tenant-beta', name: 'Faraz Qureshi', position: 'mf' }]);

  // match-m1: football, league-alpha-1, club-alpha-1 v club-alpha-2, in progress, 1 - 0 (built from real signed events).
  await q('INSERT INTO matches(id, sport_id, league_id, home, away) VALUES ($1,$2,$3,$4,$5)',
    ['match-m1', 'football', 'league-alpha-1', 'club-alpha-1', 'club-alpha-2']);
  await q('INSERT INTO meta(key, value) VALUES ($1,$2)', ['kickoff:match-m1', JSON.stringify('2026-10-18T09:00:00Z')]);
  const evs = [['match_start', {}], ['score', { team_id: 'club-alpha-1', event_type: 'goal' }]];
  for (let i = 0; i < evs.length; i++) {
    const [type, payload] = evs[i];
    const eventId = `seed-match-m1-${i + 1}`;
    await q(`INSERT INTO events(match_id, seq, event_id, type, payload, body_key, signature) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['match-m1', i + 1, eventId, type, payload, bodyKey({ match_id: 'match-m1', type, payload }), sign(eventId, payload)]);
  }

  for (const [entityId, code] of QR_SEED) {
    await q('INSERT INTO qr_codes(entity_id, short_code, scan_count) VALUES ($1,$2,0)', [entityId, code]);
  }
  await q("INSERT INTO guest_tokens(token, status, expires_at) VALUES ($1, 'active', now() + interval '1 day')", ['guest_anon_tok_7721']);
  await q("INSERT INTO carts(user_id, items) VALUES ($1, '[]')", ['player-alpha-1']);
}

module.exports = { seedDay2, QR_SEED };
