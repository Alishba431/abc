// Boots the real Express app against an isolated per-file Postgres database.
const path = require('path');
const { Client } = require('pg');

process.env.DAY1_SALT = process.env.DAY1_SALT || 'test-salt';
process.env.JWT_SECRET = 'test-jwt-secret';
// Part II Appendix A reference salt, so tests can assert the published signature vectors exactly.
process.env.DAY2_SALT = process.env.DAY2_SALT || 'T01D27ad7ffff12e';

async function start(name) {
  const admin = process.env.TEST_ADMIN_URL || 'postgres://nascon:nascon@postgres:5432/nascon';
  const dbName = `test_${name}`;
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();
  process.env.DATABASE_URL = admin.replace(/\/[^/]+$/, '/' + dbName);
  const src = path.join(__dirname, '..', 'backend', 'src');
  const { bootstrap } = require(path.join(src, 'seed'));
  const { app } = require(path.join(src, 'app'));
  const { pool } = require(path.join(src, 'db'));
  await bootstrap();
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, p, body, token, raw) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + p, { method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  const stop = async () => { server.close(); await pool.end(); };
  return { call, stop, src };
}

module.exports = { start };
