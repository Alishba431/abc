// Minimal schema helpers that collect every offending field name for VALIDATION_ERROR.
const { validation } = require('./errors');

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const isInt = (v) => Number.isInteger(v);
const isStr = (v, min = 1, max = 10000) => typeof v === 'string' && v.length >= min && v.length <= max;
function isDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v;
}
const isTs = (v) => typeof v === 'string' && TS_RE.test(v) && !isNaN(new Date(v));

class Checker {
  constructor() { this.bad = []; }
  check(ok, field) { if (!ok && !this.bad.includes(field)) this.bad.push(field); return ok; }
  done() { if (this.bad.length) throw validation(this.bad); }
}

const body = (req) => (isObj(req.body) ? req.body : null);

module.exports = { isObj, isId, isInt, isStr, isDate, isTs, Checker, body, ID_RE };
