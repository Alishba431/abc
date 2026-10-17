const express = require('express');
const { AppError, err, errorBody } = require('./errors');
const { pool } = require('./db');
const { wrap } = require('./util');
const { rateLimit } = require('./ratelimit');
const { resetAll } = require('./seed');
const audit = require('./routes/audit');
const api = require('./routes/api');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);
app.use(express.json({ limit: '1mb', strict: false, type: () => true }));

app.get('/health', wrap(async (req, res) => {
  try {
    const r = await pool.query("SELECT 1 FROM meta WHERE key = 'seeded'");
    if (r.rowCount === 0) return res.status(503).json({ status: 'starting' });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(503).json({ status: 'db_unavailable' });
  }
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
