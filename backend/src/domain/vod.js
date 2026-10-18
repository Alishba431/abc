// FR-3.2 recording + VOD index. MediaMTX records every path (fmp4); when a live/* stream ends, its recording is pulled
// from the MediaMTX playback server, stored in MinIO (bucket `recordings`) and indexed for the athlete's profile.
const crypto = require('crypto');
const { pool } = require('../db');
const media = require('../media');
const { publish } = require('../queue');

const bucket = () => process.env.MINIO_BUCKET || 'recordings';
const playbackBase = () => process.env.MEDIA_PLAYBACK_URL || (process.env.MEDIA_API_URL || '').replace(/:9997$/, ':9996');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => crypto.createHmac('sha256', k).update(s).digest();

// Minimal AWS Signature V4 (path-style) for one-object PUT / GET against MinIO.
async function s3(method, key, body) {
  const url = new URL(`${String(process.env.MINIO_ENDPOINT).replace(/\/+$/, '')}/${bucket()}/${key}`);
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payload = sha(body || '');
  const headers = { host: url.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const request = [method, url.pathname, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payload].join('\n');
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(request)].join('\n');
  const signingKey = ['us-east-1', 's3', 'aws4_request'].reduce(hmac, hmac(`AWS4${process.env.MINIO_ROOT_PASSWORD || ''}`, day));
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex');
  return fetch(url, {
    method,
    body: method === 'PUT' ? body : undefined,
    headers: {
      'x-amz-content-sha256': payload, 'x-amz-date': amzDate, ...(method === 'PUT' ? { 'content-type': 'video/mp4' } : {}),
      authorization: `AWS4-HMAC-SHA256 Credential=${process.env.MINIO_ROOT_USER}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
    },
    signal: AbortSignal.timeout(30000),
  });
}

let recording = false;
let checkedAt = 0;

// Turns on MediaMTX recording + playback at runtime (re-checked every 30 s in case the media server restarted);
// changes nothing when they are already on, so live publishers are never disturbed.
async function enableRecording() {
  if (recording && Date.now() - checkedAt < 30000) return true;
  if (!process.env.MEDIA_API_URL || !process.env.MINIO_ENDPOINT) return false;
  try {
    if (!(await media.call('/v3/config/global/get')).playback) await media.call('/v3/config/global/patch', 'PATCH', { playback: true });
    if (!(await media.call('/v3/config/pathdefaults/get')).record) await media.call('/v3/config/pathdefaults/patch', 'PATCH', { record: true });
    recording = true;
    checkedAt = Date.now();
  } catch (e) { recording = false; /* media server not ready yet: the sampler tries again in 2 s */ }
  return recording;
}

const onAir = new Set();

// Called by the metrics sampler with MediaMTX's path list; finalizes every live/* path that stopped publishing.
async function onPaths(items) {
  if (!(await enableRecording())) return [];
  const ready = new Set(items.filter((p) => p.ready && /^live\//.test(p.name)).map((p) => p.name));
  ready.forEach((name) => onAir.add(name));
  const ended = [...onAir].filter((name) => !ready.has(name));
  ended.forEach((name) => onAir.delete(name));
  return Promise.all(ended.map((name) => finalize(name, { settleMs: Number(process.env.VOD_SETTLE_MS || 1500) }).catch((e) => { console.error('vod finalize failed', name, e.message); return []; })));
}

async function finalize(pathName, { settleMs = 1500 } = {}) {
  await new Promise((r) => setTimeout(r, settleMs)); // let MediaMTX close the last segment
  const streamKey = pathName.slice('live/'.length);
  const owner = await pool.query('SELECT player_id FROM stream_keys WHERE stream_key = $1', [streamKey]);
  if (!owner.rowCount) return [];
  const list = await fetch(`${playbackBase()}/list?path=${encodeURIComponent(pathName)}`, { signal: AbortSignal.timeout(5000) });
  const segments = list.ok ? await list.json() : [];
  const indexed = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    const vodId = `vod-${sha(`${pathName}|${seg.start}`).slice(0, 12)}`;
    if ((await pool.query('SELECT 1 FROM vods WHERE vod_id = $1', [vodId])).rowCount) continue;
    const q = `path=${encodeURIComponent(pathName)}&start=${encodeURIComponent(seg.start)}&duration=${seg.duration}&format=fmp4`;
    const got = await fetch(`${playbackBase()}/get?${q}`, { signal: AbortSignal.timeout(30000) });
    if (!got.ok) continue;
    const body = Buffer.from(await got.arrayBuffer());
    const objectKey = `vod/${streamKey}/${vodId}.mp4`;
    const put = await s3('PUT', objectKey, body);
    if (!put.ok) throw new Error(`object store PUT ${put.status}`);
    await pool.query(`INSERT INTO vods(vod_id, player_id, stream_key, object_key, bytes, duration_s, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (vod_id) DO NOTHING`,
    [vodId, owner.rows[0].player_id, streamKey, objectKey, body.length, Number(seg.duration) || 0, seg.start]);
    publish('vod.indexed', { vod_id: vodId, player_id: owner.rows[0].player_id });
    indexed.push(vodId);
  }
  return indexed;
}

async function listVods(playerId) {
  const rows = (await pool.query('SELECT * FROM vods WHERE player_id = $1 ORDER BY started_at DESC', [playerId])).rows;
  return rows.map((v) => ({ vod_id: v.vod_id, started_at: v.started_at, duration_s: v.duration_s, bytes: v.bytes,
    playback_url: `/api/v1/public/vods/${v.vod_id}` }));
}

// Streams a recording back out of MinIO (the bucket itself stays private).
async function readVod(vodId) {
  const r = await pool.query('SELECT object_key FROM vods WHERE vod_id = $1', [vodId]);
  if (!r.rowCount) return null;
  const got = await s3('GET', r.rows[0].object_key);
  if (!got.ok) throw new Error(`object store GET ${got.status}`);
  return Buffer.from(await got.arrayBuffer());
}

module.exports = { enableRecording, onPaths, finalize, listVods, readVod, s3, _reset: () => { recording = false; checkedAt = 0; onAir.clear(); } };
