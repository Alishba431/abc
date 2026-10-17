// Production-facing routes used by the mobile app (rate limited, JWT protected).
const express = require('express');
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { wrap } = require('../util');
const { signJwt, checkPassword, bearer } = require('../auth');
const { scoreView } = require('../domain/events');
const { standings } = require('../domain/leagues');
const { TEAM_NAMES, ROSTER_LEAGUE } = require('../demo');
const { appendEvent } = require('../domain/events');
const { checkout } = require('../domain/store');
const { authorize } = require('../domain/rbac');
const roster = require('../domain/roster');
const { offlineSync } = require('../domain/offline');
const { verifyJwt } = require('../auth');

const r = express.Router();

r.get('/ping', (req, res) => res.json({ pong: true }));

r.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw validation(['email', 'password']);
  const u = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  if (u.rowCount === 0 || !checkPassword(password, u.rows[0].password_hash)) {
    throw err(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
  }
  const user = u.rows[0];
  const token = signJwt({ sub: user.id, role: user.role, ...user.claims });
  const tenant = user.claims.tenant_id
    ? (await pool.query('SELECT id, name, branding FROM tenants WHERE id = $1', [user.claims.tenant_id])).rows[0] : null;
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, ...user.claims, tenant } });
}));

// PDF receipt download (token in query so the phone's browser / PDF viewer can open it).
r.get('/receipts/:orderId.pdf', wrap(async (req, res) => {
  const u = verifyJwt(req.query.t);
  const o = await pool.query('SELECT pdf, response FROM orders WHERE order_id = $1', [req.params.orderId]);
  if (!o.rowCount) throw err(404, 'NOT_FOUND', 'Receipt not found.');
  if (u.role !== 'super_admin' && o.rows[0].response.receipt.payload.customer_id !== u.sub) throw err(403, 'FORBIDDEN', 'Not your receipt.');
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${req.params.orderId}.pdf"`).send(o.rows[0].pdf);
}));

// Everything below needs a valid token.
r.use((req, res, next) => { try { req.user = bearer(req); next(); } catch (e) { next(e); } });

r.get('/me', (req, res) => res.json({ claims: req.user }));

const tenantOf = (u) => u.tenant_id || 'tenant-alpha';
const teamName = (id) => TEAM_NAMES[id] || id;

r.get('/leagues', wrap(async (req, res) => {
  const rows = (await pool.query('SELECT id, data FROM leagues ORDER BY id')).rows;
  const visible = await pool.query('SELECT id FROM leagues_rbac WHERE tenant_id = $1', [tenantOf(req.user)]);
  const allowed = new Set(visible.rows.map((x) => x.id));
  res.json(rows.filter((l) => req.user.role === 'super_admin' || allowed.has(l.id))
    .map((l) => ({ league_id: l.id, name: l.data.name || l.id, sport_id: l.data.sport_id, teams: l.data.teams })));
}));

r.get('/matches', wrap(async (req, res) => {
  const leagueId = req.query.league_id || 'league-alpha-1';
  const ms = (await pool.query('SELECT id FROM matches WHERE league_id = $1 ORDER BY ord', [leagueId])).rows;
  const kick = (await pool.query("SELECT key, value FROM meta WHERE key LIKE 'kickoff:%'")).rows;
  const kickoff = Object.fromEntries(kick.map((k) => [k.key.slice(8), k.value]));
  const out = [];
  for (const m of ms) {
    const s = await scoreView(m.id);
    out.push({
      match_id: s.match_id, league_id: s.league_id, sport_id: s.sport_id, status: s.status, outcome: s.outcome,
      kickoff: kickoff[m.id] || null, version: s.version,
      home: { ...s.home, name: teamName(s.home.team_id) }, away: { ...s.away, name: teamName(s.away.team_id) },
    });
  }
  res.json(out);
}));

r.get('/matches/:id', wrap(async (req, res) => {
  const s = await scoreView(req.params.id);
  const pin = await pool.query("SELECT value FROM meta WHERE key = $1", ['pin:' + req.params.id]);
  const productId = pin.rowCount ? pin.rows[0].value : 'prod-jersey-001';
  const prod = await pool.query('SELECT id, data FROM products WHERE id = $1', [productId]);
  const variants = await pool.query('SELECT id, price_minor, stock, data FROM variants WHERE product_id = $1 ORDER BY id', [productId]);
  const sport = (await pool.query('SELECT config FROM sports WHERE id = $1', [s.sport_id])).rows[0].config;
  res.json({
    ...s, scoring_events: Object.keys(sport.scoring_events), scoring_model: sport.scoring_model,
    home: { ...s.home, name: teamName(s.home.team_id) }, away: { ...s.away, name: teamName(s.away.team_id) },
    pinned_product: prod.rowCount ? { product_id: productId, ...prod.rows[0].data,
      variants: variants.rows.map((v) => ({ variant_id: v.id, price_minor: v.price_minor, stock: v.stock, ...v.data })) } : null,
  });
}));

r.get('/standings/:leagueId', wrap(async (req, res) => {
  const s = await standings(req.params.leagueId);
  s.table = s.table.map((row) => ({ ...row, name: teamName(row.team_id) }));
  res.json(s);
}));

r.get('/clubs/:id', wrap(async (req, res) => {
  const c = await pool.query('SELECT * FROM clubs WHERE id = $1', [req.params.id]);
  if (!c.rowCount) throw err(404, 'NOT_FOUND', 'Club not found.');
  const club = c.rows[0];
  if (req.user.role !== 'super_admin' && club.tenant_id !== req.user.tenant_id) throw err(403, 'FORBIDDEN', 'Not allowed.');
  const roster = await pool.query('SELECT data FROM club_players WHERE club_id = $1 ORDER BY id', [req.params.id]);
  const tenant = await pool.query('SELECT id, name, branding FROM tenants WHERE id = $1', [club.tenant_id]);
  res.json({ ...club.data, tenant: tenant.rows[0], roster: roster.rows.map((x) => x.data) });
}));

r.get('/store/products', wrap(async (req, res) => {
  const ps = await pool.query('SELECT id, tenant_id, data FROM products WHERE tenant_id = $1 OR $2 ORDER BY id',
    [tenantOf(req.user), req.user.role === 'super_admin']);
  const out = [];
  for (const p of ps.rows) {
    const v = await pool.query('SELECT id, price_minor, stock, data FROM variants WHERE product_id = $1 ORDER BY id', [p.id]);
    out.push({ product_id: p.id, ...p.data, variants: v.rows.map((x) => ({ variant_id: x.id, price_minor: x.price_minor, stock: x.stock, ...x.data })) });
  }
  res.json(out);
}));

// Same code path as /audit/v1/checkout; the customer is always the signed-in user.
r.post('/store/checkout', wrap(async (req, res) => {
  const out = await checkout({ ...(req.body || {}), customer_id: req.user.sub });
  res.status(out.status).json(out.body);
}));

r.get('/roster', wrap(async (req, res) => {
  const squads = (await pool.query('SELECT data FROM squads WHERE league_id = $1 ORDER BY id', [ROSTER_LEAGUE])).rows.map((x) => x.data);
  const players = (await pool.query('SELECT data FROM players WHERE league_id = $1 ORDER BY id', [ROSTER_LEAGUE])).rows.map((x) => x.data);
  const counts = {};
  for (const p of players) counts[p.player_id] = await roster.auditCount(p.player_id);
  res.json({ league_id: ROSTER_LEAGUE, squads, players: players.map((p) => ({ ...p, version: counts[p.player_id] })) });
}));

async function authorizeTransfer(user, body) {
  const sq = await pool.query('SELECT data FROM squads WHERE id = $1', [body && body.from_squad_id]);
  if (!sq.rowCount) return;
  await authorize(user, 'club:roster:write', 'club', sq.rows[0].data.club_id);
}

async function authorizeEvent(user, body) {
  const m = await pool.query('SELECT league_id FROM matches WHERE id = $1', [body && body.match_id]);
  if (!m.rowCount || !m.rows[0].league_id) return;
  await authorize(user, 'league:fixtures:write', 'league', m.rows[0].league_id);
}

r.post('/roster/transfer', wrap(async (req, res) => {
  const body = { ...(req.body || {}), requested_by: req.user.sub };
  await authorizeTransfer(req.user, body);
  const out = await roster.transfer(body);
  res.status(out.status).json(out.body);
}));

r.post('/events', wrap(async (req, res) => {
  await authorizeEvent(req.user, req.body);
  const out = await appendEvent(req.body);
  res.status(out.status).json(out.body);
}));

// Production sync route backed by the same replay code as /audit/v1/offline-sync.
r.post('/offline-sync', wrap(async (req, res) => {
  const actions = (req.body && Array.isArray(req.body.actions)) ? req.body.actions : [];
  for (const a of actions) {
    if (a && a.type === 'score_event') await authorizeEvent(req.user, a.payload);
    else if (a && a.type === 'roster_transfer') { a.payload = { ...(a.payload || {}), requested_by: req.user.sub }; await authorizeTransfer(req.user, a.payload); }
  }
  res.json(await offlineSync(req.body));
}));

module.exports = r;
