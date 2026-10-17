// Production-facing routes used by the mobile app (rate limited).
const express = require('express');
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { wrap } = require('../util');
const { signJwt, checkPassword, bearer } = require('../auth');

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
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, ...user.claims } });
}));

r.get('/me', wrap(async (req, res) => res.json({ claims: bearer(req) })));

module.exports = r;
