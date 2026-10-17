const { pool, SCHEMA, WIPE, tx } = require('./db');
const { hashPassword } = require('./auth');

// Seed sports are ordinary data (same schema as POST /audit/v1/sports).
const SEED_SPORTS = [
  { sport_id: 'football', name: 'Football', scoring_model: 'event',
    periods: { count: 2, duration_minutes: 45 }, scoring_events: { goal: { points: 1 } },
    draw_allowed: true, overtime: { policy: 'none' },
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } } },
  { sport_id: 'basketball', name: 'Basketball', scoring_model: 'event',
    periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } },
    draw_allowed: false, overtime: { policy: 'extra_time', duration_minutes: 5 },
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} } },
  { sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false }, single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false }, four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false }, wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false }, wicket: { runs: 0, legal_ball: true, wicket: true } },
    draw_allowed: true, overtime: { policy: 'super_over' },
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } } },
  { sport_id: 'esports', name: 'Esports', scoring_model: 'round',
    periods: { best_of: 3 }, scoring_events: { round_win: { rounds: 1 } },
    draw_allowed: false, overtime: { policy: 'none' },
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} } },
];

const TENANTS = [
  { id: 'tenant-alpha', name: 'Alpha Sports', branding: { primary: '#0B5FFF', accent: '#FFB800', logo: 'alpha' } },
  { id: 'tenant-beta', name: 'Beta Athletics', branding: { primary: '#0E8A5F', accent: '#F25C54', logo: 'beta' } },
];
const RBAC_LEAGUES = [
  { id: 'league-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha Premier League' },
  { id: 'league-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Championship' },
  { id: 'league-beta-1', tenant_id: 'tenant-beta', name: 'Beta League' },
];
const CLUBS = [
  { id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Alpha United', venue: { name: 'Alpha Arena', lat: 33.6844, lng: 73.0479 },
    social: { x: '@alphautd' }, staff: { coach: 'Imran Khan', manager: 'Sana Mir', physio: 'Dr. Ayesha' } },
  { id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Alpha Rovers', venue: { name: 'Rovers Ground', lat: 33.71, lng: 73.06 },
    social: { x: '@alpharovers' }, staff: { coach: 'Ali Raza', manager: 'Hina Shah', physio: 'Dr. Bilal' } },
  { id: 'club-beta-1', tenant_id: 'tenant-beta', name: 'Beta City', venue: { name: 'Beta Stadium', lat: 31.52, lng: 74.35 },
    social: { x: '@betacity' }, staff: { coach: 'Usman Tariq', manager: 'Zara Noor', physio: 'Dr. Kamran' } },
];
const CLUB_PLAYERS = [
  { id: 'player-alpha-1', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Ahmed Ali', position: 'fw' },
  { id: 'player-alpha-2', club_id: 'club-alpha-2', tenant_id: 'tenant-alpha', name: 'Bilal Hassan', position: 'gk' },
  { id: 'player-beta-1', club_id: 'club-beta-1', tenant_id: 'tenant-beta', name: 'Danish Iqbal', position: 'df' },
];
const DEMO_PASSWORD = 'Nascon@26';
const USERS = [
  { id: 'user-admin', email: 'admin@nascon.test', role: 'super_admin', claims: { tenant_id: null } },
  { id: 'user-organizer', email: 'organizer@nascon.test', role: 'league_organizer',
    claims: { tenant_id: 'tenant-alpha', league_ids: ['league-alpha-1'] } },
  { id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager',
    claims: { tenant_id: 'tenant-alpha', club_ids: ['club-alpha-1'] } },
  { id: 'user-player', email: 'player@nascon.test', role: 'player',
    claims: { tenant_id: 'tenant-alpha', player_id: 'player-alpha-1', club_ids: ['club-alpha-1'] } },
  { id: 'user-viewer', email: 'viewer@nascon.test', role: 'viewer', claims: { tenant_id: 'tenant-alpha' } },
];
const DEFAULT_STOCK = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };

// Password hashing is slow by design, so hash once per process and reuse on every reset.
let hashed = null;

async function seed(c, { seed: lotsSeed = 42, stock = {} } = {}) {
  if (!hashed) hashed = hashPassword(DEMO_PASSWORD);
  const q = (sql, params) => c.query(sql, params);
  await q('INSERT INTO meta(key, value) VALUES ($1, $2)', ['reset_seed', JSON.stringify(lotsSeed)]);
  await q('INSERT INTO meta(key, value) VALUES ($1, $2)', ['seeded', 'true']);
  for (const t of TENANTS) await q('INSERT INTO tenants(id, name, branding) VALUES ($1,$2,$3)', [t.id, t.name, t.branding]);
  for (const l of RBAC_LEAGUES) await q('INSERT INTO leagues_rbac(id, tenant_id, name) VALUES ($1,$2,$3)', [l.id, l.tenant_id, l.name]);
  for (const cl of CLUBS) await q('INSERT INTO clubs(id, tenant_id, data) VALUES ($1,$2,$3)', [cl.id, cl.tenant_id, cl]);
  for (const p of CLUB_PLAYERS) await q('INSERT INTO club_players(id, club_id, tenant_id, data) VALUES ($1,$2,$3,$4)', [p.id, p.club_id, p.tenant_id, p]);
  for (const u of USERS) await q('INSERT INTO users(id, email, password_hash, role, claims) VALUES ($1,$2,$3,$4,$5)', [u.id, u.email, hashed, u.role, u.claims]);
  for (const s of SEED_SPORTS) await q('INSERT INTO sports(id, config) VALUES ($1,$2)', [s.sport_id, s]);
  await q('INSERT INTO products(id, tenant_id, club_id, data) VALUES ($1,$2,$3,$4)', ['prod-jersey-001', 'tenant-alpha', 'club-alpha-1',
    { name: 'Alpha United Home Jersey', category: 'apparel', description: 'Official 2026 home jersey.' }]);
  const finalStock = { ...DEFAULT_STOCK, ...stock };
  for (const [vid, size] of [['var-jersey-001-M', 'M'], ['var-jersey-001-L', 'L']]) {
    await q('INSERT INTO variants(id, product_id, price_minor, stock, reserved, data) VALUES ($1,$2,$3,$4,0,$5)',
      [vid, 'prod-jersey-001', 450000, finalStock[vid], { size, color: 'blue' }]);
  }
  await q('INSERT INTO discount_codes(code, percent) VALUES ($1,$2)', ['WELCOME10', 10]);
  return {
    status: 'reset_complete', seed: lotsSeed,
    sports: SEED_SPORTS.map((s) => s.sport_id), tenants: TENANTS.map((t) => t.id),
    stock: { 'var-jersey-001-M': finalStock['var-jersey-001-M'], 'var-jersey-001-L': finalStock['var-jersey-001-L'] },
  };
}

async function resetAll(opts) {
  return tx(async (c) => {
    await c.query('LOCK TABLE meta IN ACCESS EXCLUSIVE MODE');
    await c.query(WIPE);
    return seed(c, opts);
  });
}

async function bootstrap() {
  await pool.query(SCHEMA);
  const r = await pool.query("SELECT 1 FROM meta WHERE key = 'seeded'");
  if (r.rowCount === 0) await resetAll({});
}

module.exports = { resetAll, bootstrap, SEED_SPORTS, DEFAULT_STOCK };
