// Shared WebSocket subscription with auto-reconnect (ws://server/ws, /ws/matches/{id}, /ws/chat/{room}).
import { getServerUrl } from './config';

export function subscribe(path, onMessage) {
  let ws = null;
  let retry = null;
  let closed = false;
  const connect = async () => {
    const base = await getServerUrl();
    if (closed) return;
    try { ws = new WebSocket(base.replace(/^http/i, 'ws') + path); } catch (_) { return; }
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (_) { /* ignore */ } };
    ws.onclose = () => { if (!closed) retry = setTimeout(connect, 4000); };
    ws.onerror = () => {};
  };
  connect();
  return () => { closed = true; if (retry) clearTimeout(retry); if (ws) ws.close(); };
}
