// Rolling-window limiter for /api/v1/*: 100 requests per 10 s per client IP.
const LIMIT = 100;
const WINDOW_MS = 10_000;
const hits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const log = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (log.length >= LIMIT) {
    hits.set(ip, log);
    const retry = Math.max(1, Math.ceil((WINDOW_MS - (now - log[0])) / 1000));
    res.set('Retry-After', String(retry));
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.',
      details: { retry_after_seconds: retry } } });
  }
  log.push(now);
  hits.set(ip, log);
  next();
}

module.exports = { rateLimit };
