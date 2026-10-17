// Internal job queue: Redis Streams. Publishing never blocks or fails a request.
const Redis = require('ioredis');

let client = null;
function redis() {
  if (!client && process.env.REDIS_URL) {
    client = new Redis(process.env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on('error', () => {});
  }
  return client;
}

function publish(type, data) {
  const r = redis();
  if (!r) return;
  r.xadd('domain-events', 'MAXLEN', '~', '10000', '*', 'type', type, 'data', JSON.stringify(data)).catch(() => {});
}

module.exports = { publish, redis };
