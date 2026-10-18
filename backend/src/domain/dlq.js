// Notification delivery with bounded exponential retry; exhausted events land in a persistent dead-letter queue.
const { pool } = require('../db');

const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deliver(event, send, { baseDelayMs = 5 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await send(event);
      return { delivered: true, attempts: attempt };
    } catch (e) {
      lastError = e.message;
      if (attempt < MAX_ATTEMPTS) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  await pool.query('INSERT INTO dlq(event, attempts) VALUES ($1,$2)', [{ ...event, last_error: lastError }, MAX_ATTEMPTS]);
  return { delivered: false, attempts: MAX_ATTEMPTS };
}

async function status() {
  const rows = (await pool.query('SELECT event, attempts FROM dlq ORDER BY n LIMIT 200')).rows;
  const depth = (await pool.query('SELECT count(*)::int AS n FROM dlq')).rows[0].n;
  return { queue_depth: depth, undelivered_events: rows.map((r) => ({ ...r.event, attempts: r.attempts })) };
}

module.exports = { deliver, status, MAX_ATTEMPTS };
