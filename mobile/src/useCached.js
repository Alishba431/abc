// Network-first fetch that falls back to the SQLite cache when offline.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { cacheGet, cachePut } from './db';

export function useCached(key, path, { pollMs } = {}) {
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

  return { ...state, reload: () => load() };
}

export function savedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `Showing saved data from ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
