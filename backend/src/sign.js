const crypto = require('crypto');

// Section 5.3: keys sorted by Unicode code point, no whitespace, non-ASCII not escaped.
function cpCompare(a, b) {
  const A = Array.from(a), B = Array.from(b);
  const n = Math.min(A.length, B.length);
  for (let i = 0; i < n; i++) {
    const d = A[i].codePointAt(0) - B[i].codePointAt(0);
    if (d !== 0) return d;
  }
  return A.length - B.length;
}

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort(cpCompare);
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

function salt() {
  return process.env.DAY1_SALT || '';
}

function sign(id, payload, key = salt()) {
  return crypto.createHmac('sha256', Buffer.from(key, 'utf8'))
    .update(Buffer.from(id + '|' + canonical(payload), 'utf8'))
    .digest('hex');
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

module.exports = { canonical, sign, sha256hex, cpCompare };
