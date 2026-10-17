// Mandatory autograder interface (/audit/v1/*).
const express = require('express');
const { pool } = require('../db');
const { wrap } = require('../util');
const { resetAll } = require('../seed');
const { err, validation } = require('../errors');
const { validateSport } = require('../domain/sports');
const { appendEvent, scoreView } = require('../domain/events');
const { createLeague, standings } = require('../domain/leagues');

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

module.exports = r;
