// Consumes domain events from the Redis Stream (order status changes, roster changes, ...).
const Redis = require('ioredis');

const r = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
r.on('error', () => {});

async function run() {
  let last = '$';
  for (;;) {
    try {
      const res = await r.xread('BLOCK', 5000, 'STREAMS', 'domain-events', last);
      if (!res) continue;
      for (const [, entries] of res) {
        for (const [id, fields] of entries) {
          last = id;
          console.log(JSON.stringify({ stream_id: id, type: fields[1], data: JSON.parse(fields[3]) }));
        }
      }
    } catch (e) {
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}
run();
