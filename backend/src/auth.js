// HS256 JWT (hand-rolled: header alg is pinned, alg:none / tampered / expired are rejected).
const crypto = require('crypto');
const { err } = require('./errors');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const secret = () => process.env.JWT_SECRET || 'change-me-local-jwt-secret';

function signJwt(claims, ttlSeconds = 12 * 3600) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', secret()).update(header + '.' + body).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  const unauth = () => err(401, 'UNAUTHENTICATED', 'Missing or invalid token.');
  if (typeof token !== 'string') throw unauth();
  const parts = token.split('.');
  if (parts.length !== 3) throw unauth();
  let header, body;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) { throw unauth(); }
  if (!header || header.alg !== 'HS256') throw unauth();
  const expected = crypto.createHmac('sha256', secret()).update(parts[0] + '.' + parts[1]).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw unauth();
  if (typeof body.exp !== 'number' || body.exp <= Math.floor(Date.now() / 1000)) throw unauth();
  return body;
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return verifyJwt(m ? m[1].trim() : undefined);
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}

function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const got = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

module.exports = { signJwt, verifyJwt, bearer, hashPassword, checkPassword };
