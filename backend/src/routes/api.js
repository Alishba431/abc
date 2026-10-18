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
const guest = require('../domain/guest');
const moderation = require('../domain/moderation');
const realtime = require('../realtime');
const { streamKey } = require('../domain/streaming');

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

// ---------- Guest (zero-account) access: read-only + cart staging ----------
const needGuest = (req) => {
  const t = guest.guestTokenOf(req);
  if (!t) throw err(401, 'UNAUTHENTICATED', 'A guest token is required.');
  return t;
};
r.post('/guest/token', wrap(async (req, res) => res.status(201).json(await guest.issueGuestToken())));
r.get('/guest/cart', wrap(async (req, res) => res.json(await guest.guestCart(needGuest(req)))));
r.post('/guest/cart', wrap(async (req, res) => res.status(201).json(await guest.stageItem(needGuest(req), req.body))));

// Public read models for the Guest Web Player (no account needed).
r.get('/public/matches/:id', wrap(async (req, res) => {
  const s = await scoreView(req.params.id);
  const prod = await pool.query('SELECT id, data FROM products WHERE id = $1', ['prod-jersey-001']);
  const variants = await pool.query('SELECT id, price_minor, stock, data FROM variants WHERE product_id = $1 ORDER BY id', ['prod-jersey-001']);
  res.json({
    match_id: s.match_id, status: s.status, league_id: s.league_id, version: s.version, events: s.events, outcome: s.outcome,
    home: { ...s.home, name: teamName(s.home.team_id) }, away: { ...s.away, name: teamName(s.away.team_id) },
    pinned_product: prod.rowCount ? { product_id: 'prod-jersey-001', ...prod.rows[0].data,
      variants: variants.rows.map((v) => ({ variant_id: v.id, price_minor: v.price_minor, stock: v.stock, ...v.data })) } : null,
  });
}));
// Mobile QR scanner: resolve a short code to the entity it points at (counts as a scan).
// Matches on air right now, for the guest "Live now" list on the mobile sign-in screen.
r.get('/public/live', wrap(async (req, res) => {
  const ms = (await pool.query('SELECT id FROM matches ORDER BY ord')).rows;
  const out = [];
  for (const m of ms) {
    const s = await scoreView(m.id);
    if (s.status !== 'in_progress') continue;
    out.push({ match_id: s.match_id, status: s.status,
      home: { ...s.home, name: teamName(s.home.team_id) }, away: { ...s.away, name: teamName(s.away.team_id) } });
  }
  res.json(out);
}));
r.get('/public/qr/:code', wrap(async (req, res) => {
  const v = await require('../domain/qr').resolveShortCode(req.params.code, req.get('user-agent'));
  res.json({ entity_id: v.entity_id, entity_type: v.entity_type, entity_status: v.entity_status, target_route: v.target_route });
}));
r.get('/public/costream/:id', wrap(async (req, res) => {
  const s = await require('../domain/costream').getSession(req.params.id);
  if (!s) throw err(404, 'STREAM_NOT_FOUND', 'That co-stream does not exist.', { session_id: req.params.id });
  res.json(s);
}));
r.get('/public/chat/:room', wrap(async (req, res) => res.json({ chat_room_id: req.params.room, messages: await moderation.history(req.params.room) })));
// SSE alternative to the per-match WebSocket (NFR-1).
r.get('/matches/:id/stream', (req, res) => realtime.sse(req, res, { matchId: req.params.id }));

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

// ---------- Role-aware athlete features (FR-3.1) ----------
async function kickoffs() {
  const kick = (await pool.query("SELECT key, value FROM meta WHERE key LIKE 'kickoff:%'")).rows;
  return Object.fromEntries(kick.map((k) => [k.key.slice(8), k.value]));
}

async function athleteProfile(id, viewer) {
  const p = await pool.query('SELECT * FROM club_players WHERE id = $1', [id]);
  if (!p.rowCount) throw err(404, 'PLAYER_NOT_FOUND', 'That athlete does not exist.', { player_id: id });
  const row = p.rows[0];
  if (viewer.role !== 'super_admin' && row.tenant_id !== viewer.tenant_id) throw err(403, 'FORBIDDEN', 'Not allowed.');
  const club = (await pool.query('SELECT data FROM clubs WHERE id = $1', [row.club_id])).rows[0];
  const kick = await kickoffs();
  const ms = (await pool.query('SELECT id FROM matches WHERE home = $1 OR away = $1 ORDER BY ord', [row.club_id])).rows;
  const career = { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0 };
  const upcoming = [];
  for (const m of ms) {
    const s = await scoreView(m.id);
    const home = s.home.team_id === row.club_id;
    const mine = home ? s.home : s.away;
    const other = home ? s.away : s.home;
    if (s.status === 'completed' && s.outcome !== 'undecided') {
      career.played += 1; career.scored += mine.score; career.conceded += other.score;
      if (s.outcome === 'draw') career.drawn += 1; else if (s.winner_team_id === row.club_id) career.won += 1; else career.lost += 1;
    } else if (s.status === 'upcoming' || s.status === 'in_progress') {
      upcoming.push({ match_id: s.match_id, status: s.status, home, opponent: teamName(other.team_id), kickoff: kick[m.id] || null,
        score: `${s.home.score} - ${s.away.score}` });
    }
  }
  const followers = (await pool.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id = $1', [id])).rows[0].n;
  const following = (await pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND athlete_id = $2', [viewer.sub, id])).rowCount > 0;
  return {
    player_id: id, name: row.data.name, position: row.data.position, bio: row.data.bio || '', social: row.data.social || '',
    club: { club_id: row.club_id, name: club ? club.data.name : row.club_id }, career, upcoming, followers, following,
    can_edit: viewer.role === 'super_admin' || viewer.player_id === id
      || (viewer.role === 'club_manager' && (viewer.club_ids || []).includes(row.club_id)),
    vods: [],
  };
}

r.get('/clubs', wrap(async (req, res) => {
  const rows = (await pool.query('SELECT id, tenant_id, data FROM clubs WHERE tenant_id = $1 OR $2 ORDER BY id',
    [tenantOf(req.user), req.user.role === 'super_admin'])).rows;
  res.json(rows.map((c) => ({ club_id: c.id, name: c.data.name, venue: c.data.venue.name })));
}));

r.get('/me/profile', wrap(async (req, res) => {
  if (!req.user.player_id) throw err(404, 'PLAYER_NOT_FOUND', 'This account has no athlete profile.');
  res.json(await athleteProfile(req.user.player_id, req.user));
}));

r.get('/athletes/:id', wrap(async (req, res) => res.json(await athleteProfile(req.params.id, req.user))));

// Follow / unfollow: idempotent per (follower, athlete); the primary key makes concurrent toggles drift-free.
r.post('/athletes/:id/follow', wrap(async (req, res) => {
  const want = !(req.body && req.body.follow === false);
  await athleteProfile(req.params.id, req.user);
  if (want) await pool.query('INSERT INTO follows(follower_id, athlete_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.sub, req.params.id]);
  else await pool.query('DELETE FROM follows WHERE follower_id = $1 AND athlete_id = $2', [req.user.sub, req.params.id]);
  const followers = (await pool.query('SELECT count(*)::int AS n FROM follows WHERE athlete_id = $1', [req.params.id])).rows[0].n;
  res.json({ athlete_id: req.params.id, following: want, followers });
}));

// Edit a player profile: same policy-matrix check as the P5 probe (player = self, manager = own club, admin = any).
r.patch('/players/:id', wrap(async (req, res) => {
  await authorize(req.user, 'player:update', 'player', req.params.id);
  const b = req.body || {};
  const bad = [];
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60)) bad.push('name');
  if (b.bio !== undefined && (typeof b.bio !== 'string' || b.bio.length > 280)) bad.push('bio');
  if (b.social !== undefined && (typeof b.social !== 'string' || b.social.length > 60)) bad.push('social');
  if (bad.length) throw validation(bad);
  const patch = {};
  for (const k of ['name', 'bio', 'social']) if (b[k] !== undefined) patch[k] = b[k].trim();
  await pool.query('UPDATE club_players SET data = data || $2 WHERE id = $1', [req.params.id, patch]);
  res.json(await athleteProfile(req.params.id, req.user));
}));

// Creator tools: an athlete manages their own stream key from the app (OBS / Larix / FFmpeg ingest).
r.post('/me/stream-key', wrap(async (req, res) => {
  if (!req.user.player_id) throw err(403, 'FORBIDDEN', 'Only athletes can go live.');
  const out = await streamKey({ action: (req.body && req.body.action) || 'generate', player_id: req.user.player_id, label: 'Mobile app' });
  res.status(out.status).json(out.body);
}));

r.post('/chat', wrap(async (req, res) => {
  const out = await moderation.postChat(req.user, req.body);
  res.status(out.status).json(out.body);
}));

r.post('/guest/cart/merge', wrap(async (req, res) => {
  const out = await guest.mergeStagedCart(req.user, req.body && req.body.guest_token);
  res.status(out.status).json(out.body);
}));

module.exports = r;
