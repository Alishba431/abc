// Production-facing routes used by the mobile app (rate limited, JWT protected).
const express = require('express');
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { wrap } = require('../util');
const { signJwt, checkPassword, bearer } = require('../auth');
const { scoreView } = require('../domain/events');
const { standings } = require('../domain/leagues');
const { TEAM_NAMES } = require('../demo');

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
  res.json({
    ...s,
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

module.exports = r;
