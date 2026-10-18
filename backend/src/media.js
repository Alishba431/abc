// Thin client for the self-hosted MediaMTX control API (enabled only inside the compose network).
const base = () => process.env.MEDIA_API_URL || '';

async function api(path, opts = {}) {
  if (!base()) return null;
  const res = await fetch(base() + path, { ...opts, signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`mediamtx ${path} -> ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function healthy() {
  if (!base()) return true;
  try { await api('/v3/config/global/get'); return true; } catch (e) { return false; }
}

async function listPaths() {
  const d = await api('/v3/paths/list?itemsPerPage=1000');
  return d && Array.isArray(d.items) ? d.items : [];
}

const KICK = { rtmpConn: 'rtmpconns', rtmpsConn: 'rtmpsconns', webRTCSession: 'webrtcsessions', rtspSession: 'rtspsessions',
  rtspsSession: 'rtspssessions', srtConn: 'srtconns' };

// Severs whatever is currently publishing on a path (used when a stream key is rotated or revoked).
async function kickPath(name) {
  const d = await api(`/v3/paths/get/${name}`).catch(() => null);
  const src = d && d.source;
  if (!src || !KICK[src.type]) return false;
  await api(`/v3/${KICK[src.type]}/kick/${src.id}`, { method: 'POST' });
  return true;
}

// Generic control-API call (used to switch recording / playback on at runtime).
function call(path, method = 'GET', body) {
  return api(path, body === undefined ? { method } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

module.exports = { healthy, listPaths, kickPath, call };
