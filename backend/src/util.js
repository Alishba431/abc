// Small helpers shared by routes: async wrapper, per-key mutex, time formatting.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const chains = new Map();
// Serialises work per key inside this process (single API container).
async function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const chained = prev.then(() => mine);
  chains.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (chains.get(key) === chained) chains.delete(key);
  }
}

const isoNow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const today = () => new Date().toISOString().slice(0, 10);

module.exports = { wrap, withLock, isoNow, today };
