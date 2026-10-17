// Mandatory autograder interface (/audit/v1/*).
const express = require('express');
const { wrap } = require('../util');
const { resetAll } = require('../seed');
const { validation } = require('../errors');

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

module.exports = r;
