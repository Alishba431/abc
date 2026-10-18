const express = require('express');
const { AppError, err, errorBody } = require('./errors');
const { pool } = require('./db');
const { wrap } = require('./util');
const { rateLimit } = require('./ratelimit');
const { resetAll } = require('./seed');
const audit = require('./routes/audit');
const api = require('./routes/api');
const media = require('./media');
const metrics = require('./metrics');
const { redis } = require('./queue');
const { authorizeIngest } = require('./domain/streaming');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(express.json({ limit: '1mb', strict: false, type: () => true }));

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// Ready only when the database is seeded and (when configured) Redis and the media server answer.
app.get('/health', wrap(async (req, res) => {
  try {
    const r = await pool.query("SELECT 1 FROM meta WHERE key = 'seeded'");
    if (r.rowCount === 0) return res.status(503).json({ status: 'starting' });
  } catch (e) {
    return res.status(503).json({ status: 'db_unavailable' });
  }
  if (process.env.REDIS_URL) {
    try { await withTimeout(redis().ping(), 1000); } catch (e) { return res.status(503).json({ status: 'redis_unavailable' }); }
  }
  if (!(await media.healthy())) return res.status(503).json({ status: 'media_unavailable' });
  res.json({ status: 'ok' });
}));

app.get('/metrics', wrap(async (req, res) => {
  const body = await metrics.render();
  res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
  res.end(body);
}));

// MediaMTX HTTP auth hook: publishing to live/{key} requires an active (non-revoked) stream key.
app.post('/internal/media/auth', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.action !== 'publish') return res.status(200).end();
  const out = await authorizeIngest(b.path);
  if (out.ok) return res.status(200).end();
  res.status(out.status).json({ error: { code: out.code, message: 'Stream key is not valid for publishing.', details: { path: b.path } } });
}));

app.use('/audit/v1', audit);
app.use('/api/v1', rateLimit, api);

app.use((req, res) => res.status(404).json(errorBody(err(404, 'NOT_FOUND', 'Route not found.'))));

// eslint-disable-next-line no-unused-vars
app.use((e, req, res, next) => {
  if (e instanceof AppError) return res.status(e.status).json(errorBody(e));
  if (e.type === 'entity.too.large') {
    return res.status(413).json(errorBody(err(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MB.')));
  }
  if (e.type === 'entity.parse.failed') {
    return res.status(400).json(errorBody(err(400, 'VALIDATION_ERROR', 'Malformed JSON body.', { fields: ['body'] })));
  }
  console.error(e);
  res.status(500).json(errorBody(err(500, 'INTERNAL_ERROR', 'Something went wrong on the server.')));
});

module.exports = { app, resetAll };
