// Dynamic QR deep-links (Part II Section 5.6): stable short URL, state-driven target route, privacy-safe telemetry.
const crypto = require('crypto');
const QRCode = require('qrcode');
const { pool } = require('../db');
const { err } = require('../errors');
const { signDay2 } = require('../sign');
const cache = require('../cache');
const { makePdf } = require('../pdf');
const { scoreView } = require('./events');

const base = () => (process.env.PUBLIC_BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const FORMATS = ['svg', 'png', 'pdf'];
const NOTICE = ['postponed', 'cancelled', 'abandoned'];

// entity_id -> resolved state; short_code -> entity_id. Match/co-stream changes invalidate entries.
const views = new Map();
const codes = new Map();
cache.onInvalidate((key) => {
  if (key === null) { views.clear(); codes.clear(); } else views.delete(key);
});

async function resolveEntity(id) {
  if ((await pool.query('SELECT 1 FROM matches WHERE id = $1', [id])).rowCount) {
    return { type: 'match', status: (await scoreView(id)).status };
  }
  if ((await pool.query('SELECT 1 FROM clubs WHERE id = $1', [id])).rowCount) return { type: 'club', status: 'active' };
  const p = await pool.query('SELECT 1 FROM club_players WHERE id = $1 UNION ALL SELECT 1 FROM players WHERE id = $1 LIMIT 1', [id]);
  if (p.rowCount) return { type: 'player', status: 'active' };
  const cs = await pool.query('SELECT state FROM costream_sessions WHERE session_id = $1', [id]);
  if (cs.rowCount) return { type: 'costream', status: cs.rows[0].state.status };
  return null;
}

function targetRoute(type, id, status) {
  if (type === 'match') {
    if (status === 'in_progress') return `/web/matches/${id}/live`;
    if (status === 'completed') return `/web/matches/${id}/vod`;
    if (NOTICE.includes(status)) return `/web/matches/${id}/notice?state=${status}`;
    return `/web/matches/${id}/preview`;
  }
  if (type === 'player') return `/web/players/${id}`;
  if (type === 'club') return `/web/clubs/${id}`;
  return `/web/costream/${id}`;
}

async function state(id) {
  const hit = views.get(id);
  if (hit) return hit;
  const entity = await resolveEntity(id);
  if (!entity) throw err(404, 'QR_NOT_FOUND', `No dynamic QR code exists for ${id}.`, { entity_id: id });
  // Any existing match / club / player / co-stream gets a stable system-generated short code on first use.
  const code = crypto.createHash('sha256').update(id).digest('hex').slice(0, 10);
  await pool.query('INSERT INTO qr_codes(entity_id, short_code) VALUES ($1,$2) ON CONFLICT (entity_id) DO NOTHING', [id, code]);
  const row = (await pool.query('SELECT short_code, scan_count FROM qr_codes WHERE entity_id = $1', [id])).rows[0];
  const v = { entity_id: id, entity_type: entity.type, entity_status: entity.status, short_code: row.short_code, scan_count: row.scan_count };
  views.set(id, v);
  codes.set(v.short_code, id);
  return v;
}

function render(v) {
  const shortUrl = `${base()}/q/${v.short_code}`;
  const route = targetRoute(v.entity_type, v.entity_id, v.entity_status);
  const exp = (f) => `${base()}/audit/v1/qr/${v.entity_id}/export.${f}`;
  return {
    entity_id: v.entity_id,
    entity_type: v.entity_type,
    entity_status: v.entity_status,
    short_url: shortUrl,
    target_route: route,
    deep_link_uri: `nascon://entity/${v.entity_id}`,
    scan_count: v.scan_count,
    export_formats: { svg: exp('svg'), png: exp('png'), pdf: exp('pdf') },
    signature: signDay2(v.entity_id, { entity_id: v.entity_id, short_url: shortUrl, target_route: route }),
  };
}

// Telemetry keeps only a counter, the device family and an hourly UTC bucket: no IP, no User-Agent string.
const deviceFamily = (ua = '') => (/mobile|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop');
const hourBucket = () => `${new Date().toISOString().slice(0, 13)}:00:00Z`;

async function recordScan(v, ua) {
  const r = await pool.query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE entity_id = $1 RETURNING scan_count', [v.entity_id]);
  v.scan_count = r.rows[0].scan_count;
  await pool.query('INSERT INTO qr_scans(entity_id, device_family, bucket) VALUES ($1,$2,$3)', [v.entity_id, deviceFamily(ua), hourBucket()]);
}

async function qrView(id, { inspect = false, ua = '' } = {}) {
  const v = await state(id);
  if (!inspect) await recordScan(v, ua);
  return render(v);
}

async function resolveShortCode(code, ua) {
  let id = codes.get(code);
  if (!id) {
    const r = await pool.query('SELECT entity_id FROM qr_codes WHERE short_code = $1', [code]);
    if (!r.rowCount) throw err(404, 'QR_NOT_FOUND', `Short code ${code} is not registered.`, { short_code: code });
    id = r.rows[0].entity_id;
  }
  return qrView(id, { inspect: false, ua });
}

async function exportQr(id, fmt) {
  if (!FORMATS.includes(fmt)) throw err(400, 'VALIDATION_ERROR', 'Export format must be svg, png or pdf.', { fields: ['fmt'] });
  const v = await state(id);
  const url = `${base()}/q/${v.short_code}`;
  if (fmt === 'svg') return { type: 'image/svg+xml', body: await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }) };
  if (fmt === 'png') return { type: 'image/png', body: await QRCode.toBuffer(url, { type: 'png', margin: 2, width: 512, errorCorrectionLevel: 'M' }) };
  const { size, data } = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const cell = Math.floor(380 / size);
  const x0 = Math.round((595 - size * cell) / 2);
  const rects = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (data[r * size + c]) rects.push([x0 + c * cell, 120 + (size - 1 - r) * cell, cell, cell]);
  }
  const body = makePdf([
    { text: 'League Ops - Scan to watch', size: 22 },
    { text: `Entity: ${v.entity_id}`, size: 14 },
    { text: `Link: ${url}`, size: 12 },
  ], { rects });
  return { type: 'application/pdf', body };
}

module.exports = { qrView, resolveShortCode, exportQr, targetRoute, deviceFamily };
