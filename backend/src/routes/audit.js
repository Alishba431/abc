// Mandatory autograder interface (/audit/v1/*).
const express = require('express');
const { pool } = require('../db');
const { wrap } = require('../util');
const { resetAll } = require('../seed');
const { err, validation } = require('../errors');
const { validateSport } = require('../domain/sports');
const { appendEvent, scoreView } = require('../domain/events');
const { createLeague, standings } = require('../domain/leagues');
const { generate } = require('../domain/fixtures');
const { checkout, inventory } = require('../domain/store');
const { authorize } = require('../domain/rbac');
const roster = require('../domain/roster');
const { offlineSync } = require('../domain/offline');
const { signJwt, bearer } = require('../auth');
const { streamKey } = require('../domain/streaming');
const { costreamSession } = require('../domain/costream');

const r = express.Router();

r.post('/reset', wrap(async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const bad = [];
  if (body.seed !== undefined && body.seed !== null && !Number.isInteger(body.seed)) bad.push('seed');
  if (body.stock !== undefined && body.stock !== null) {
    if (typeof body.stock !== 'object' || Array.isArray(body.stock)) bad.push('stock');
    else for (const [k, v] of Object.entries(body.stock)) if (!Number.isInteger(v) || v < 0) bad.push(`stock.${k}`);
  }
  if (bad.length) throw validation(bad);
  const out = await resetAll({ seed: body.seed ?? 42, stock: body.stock || {} });
  res.status(200).json(out);
}));

r.post('/sports', wrap(async (req, res) => {
  const config = validateSport(req.body);
  const ins = await pool.query('INSERT INTO sports(id, config) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [config.sport_id, config]);
  if (!ins.rowCount) throw err(409, 'SPORT_EXISTS', `Sport ${config.sport_id} already exists.`, { sport_id: config.sport_id });
  res.status(201).json({ sport_id: config.sport_id, status: 'created', config });
}));

r.post('/events', wrap(async (req, res) => {
  const out = await appendEvent(req.body);
  res.status(out.status).json(out.body);
}));

r.get('/score/:matchId', wrap(async (req, res) => res.json(await scoreView(req.params.matchId))));

r.post('/leagues', wrap(async (req, res) => res.status(201).json(await createLeague(req.body))));

r.get('/standings/:leagueId', wrap(async (req, res) => res.json(await standings(req.params.leagueId))));

r.post('/fixtures', wrap(async (req, res) => res.status(200).json(generate(req.body))));

r.post('/checkout', wrap(async (req, res) => {
  const out = await checkout(req.body);
  res.status(out.status).json(out.body);
}));

r.get('/inventory/:variantId', wrap(async (req, res) => res.json(await inventory(req.params.variantId))));

r.post('/roster/setup', wrap(async (req, res) => res.status(201).json(await roster.setup(req.body))));

r.post('/roster/transfer', wrap(async (req, res) => {
  const out = await roster.transfer(req.body);
  res.status(out.status).json(out.body);
}));

r.get('/roster/history/:playerId', wrap(async (req, res) => res.json(await roster.history(req.params.playerId, req.query.as_of))));

r.post('/rbac-matrix', wrap(async (req, res) => {
  const users = (await pool.query('SELECT id, role, claims FROM users')).rows;
  const token = (role) => {
    const u = users.find((x) => x.role === role);
    return signJwt({ sub: u.id, role: u.role, ...u.claims });
  };
  res.json({
    tokens: {
      super_admin: token('super_admin'), league_organizer: token('league_organizer'),
      club_manager: token('club_manager'), player: token('player'), viewer: token('viewer'),
    },
    context: {
      tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
      own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
      own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
      own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
    },
  });
}));

// Probe routes: authenticate, then authorize; no mutation, body ignored.
const probe = (action, kind, param) => wrap(async (req, res) => {
  const user = bearer(req);
  await authorize(user, action, kind, kind ? req.params[param] : null);
  res.json({ authorized: true });
});
r.post('/rbac/tenants', probe('tenants:create'));
r.post('/rbac/leagues/:id/fixtures', probe('league:fixtures:write', 'league', 'id'));
r.post('/rbac/clubs/:id/roster', probe('club:roster:write', 'club', 'id'));
r.post('/rbac/clubs/:id/products', probe('club:products:write', 'club', 'id'));
r.patch('/rbac/players/:id', probe('player:update', 'player', 'id'));
r.get('/rbac/clubs/:id', probe('club:read', 'club', 'id'));
r.get('/rbac/platform/config', probe('platform:config:read'));

r.post('/offline-sync', wrap(async (req, res) => res.status(200).json(await offlineSync(req.body))));

// ---------- Phase II ----------
r.post('/stream/key', wrap(async (req, res) => {
  const out = await streamKey(req.body);
  res.status(out.status).json(out.body);
}));

r.post('/costream/session', wrap(async (req, res) => {
  const out = await costreamSession(req.body);
  res.status(out.status).json(out.body);
}));

module.exports = r;
