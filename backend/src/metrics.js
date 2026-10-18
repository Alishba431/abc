// Prometheus text exposition (NFR-6). Media stats are sampled from MediaMTX every 2 s when it is configured.
const { pool } = require('./db');
const media = require('./media');
const realtime = require('./realtime');

const stats = { active: 0, kbps: 0, lastBytes: null, lastAt: 0 };

async function sampleMedia() {
  try {
    const items = await media.listPaths();
    const ready = items.filter((p) => p.ready);
    require('./domain/vod').onPaths(items).catch(() => {});
    const bytes = ready.reduce((sum, p) => sum + (p.bytesReceived || 0), 0);
    const now = Date.now();
    if (stats.lastBytes !== null && now > stats.lastAt) {
      stats.kbps = Math.max(0, Math.round(((bytes - stats.lastBytes) * 8) / 1000 / ((now - stats.lastAt) / 1000)));
    }
    stats.lastBytes = bytes;
    stats.lastAt = now;
    stats.active = ready.length;
  } catch (e) {
    stats.active = 0;
    stats.kbps = 0;
  }
}

function startSampler() {
  if (!process.env.MEDIA_API_URL) return;
  sampleMedia();
  setInterval(sampleMedia, 2000).unref();
}

async function render() {
  const dlq = (await pool.query('SELECT count(*)::int AS n FROM dlq')).rows[0].n;
  const scans = (await pool.query('SELECT coalesce(sum(scan_count), 0)::int AS n FROM qr_codes')).rows[0].n;
  const metric = (name, type, help, value) => `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
  return [
    metric('nascon_active_ws_connections', 'gauge', 'Open WebSocket connections.', realtime.connectionCount()),
    metric('nascon_active_streams_total', 'gauge', 'Live streams currently publishing to the media server.', stats.active),
    metric('nascon_stream_bitrate_kbps', 'gauge', 'Aggregate inbound stream bitrate in kbps.', stats.kbps),
    metric('nascon_dlq_depth', 'gauge', 'Notifications waiting in the dead-letter queue.', dlq),
    metric('nascon_qr_scans_total', 'counter', 'Total dynamic QR scans.', scans),
  ].join('');
}

module.exports = { render, startSampler, sampleMedia, stats };
