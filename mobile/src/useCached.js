// Network-first fetch that falls back to the SQLite cache when offline.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getServerUrl } from './config';
import { cacheGet, cachePut } from './db';

// live: true = refresh on any match event pushed over the WebSocket; a match id = only that match's events.
export function useCached(key, path, { pollMs, live } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: '', stale: false, updatedAt: null });
  const alive = useRef(true);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: !s.data }));
    try {
      const data = await api(path);
      await cachePut(key, data);
      if (alive.current) setState({ data, loading: false, error: '', stale: false, updatedAt: new Date().toISOString() });
    } catch (e) {
      const cached = await cacheGet(key);
      if (!alive.current) return;
      if (cached) setState({ data: cached.value, loading: false, error: '', stale: true, updatedAt: cached.updatedAt });
      else setState({ data: null, loading: false, error: e.message, stale: false, updatedAt: null });
    }
  }, [key, path]);

  useEffect(() => {
    alive.current = true;
    load();
    let t = null;
    if (pollMs) t = setInterval(() => load(true), pollMs);
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, pollMs]);

  // Realtime push (ws://server/ws). Polling above stays as the fallback if the socket drops.
  useEffect(() => {
    if (!live) return undefined;
    let ws = null; let retry = null; let closed = false;
    const connect = async () => {
      const base = await getServerUrl();
      if (closed) return;
      try { ws = new WebSocket(base.replace(/^http/i, 'ws') + '/ws'); } catch (_) { return; }
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== 'match.event_appended') return;
          if (live === true || msg.data.match_id === live) load(true);
        } catch (_) {}
      };
      ws.onclose = () => { if (!closed) retry = setTimeout(connect, 5000); };
      ws.onerror = () => {};
    };
    connect();
    return () => { closed = true; if (retry) clearTimeout(retry); if (ws) ws.close(); };
  }, [live, load]);

  return { ...state, reload: () => load() };
}

export function savedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `Showing saved data from ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
