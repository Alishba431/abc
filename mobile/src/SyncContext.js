// Persistent offline queue (SQLite) + automatic sync when connectivity returns.
// Actions use exactly the Section 5.14 format: { action_id, type, queued_at, base_version, payload }.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, friendlyError } from './api';
import { db } from './db';

const Ctx = createContext(null);
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function deviceId() {
  let id = await AsyncStorage.getItem('device_id');
  if (!id) { id = uid('dev'); await AsyncStorage.setItem('device_id', id); }
  return id;
}

export function SyncProvider({ children }) {
  const [items, setItems] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const d = await db();
    const rows = await d.getAllAsync('SELECT * FROM queue ORDER BY queued_at DESC');
    setItems(rows.map((r) => ({ ...r, payload: JSON.parse(r.payload), result: r.result ? JSON.parse(r.result) : null })));
  }, []);

  const sync = useCallback(async () => {
    if (busy.current) return;
    const d = await db();
    const pending = await d.getAllAsync("SELECT * FROM queue WHERE status = 'pending' ORDER BY queued_at");
    if (!pending.length) return;
    busy.current = true;
    setSyncing(true);
    try {
      const body = {
        device_id: await deviceId(),
        actions: pending.map((r) => ({ action_id: r.action_id, type: r.type, queued_at: r.queued_at,
          base_version: r.base_version, payload: JSON.parse(r.payload) })),
      };
      const res = await api('/api/v1/offline-sync', { method: 'POST', body, timeoutMs: 15000 });
      for (const r of res.results) {
        const status = r.status === 'rejected' ? 'rejected' : 'done';
        const note = r.status === 'rejected' ? friendlyError(r.error_code, 'The server rejected this change.')
          : r.status === 'duplicate' ? 'Already saved earlier.'
            : r.resolution === 'rebased_append' ? 'Saved. Others had made changes too; yours was added on top.' : 'Saved.';
        await d.runAsync('UPDATE queue SET status = ?, result = ? WHERE action_id = ?', status,
          JSON.stringify({ ...r, note }), r.action_id);
      }
    } catch (e) {
      // stay pending; will retry on next connectivity change or manual sync
    } finally {
      busy.current = false;
      setSyncing(false);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    return NetInfo.addEventListener((s) => {
      const on = !!s.isConnected && s.isInternetReachable !== false;
      setOnline(on);
      if (on) sync();
    });
  }, [refresh, sync]);

  const enqueue = useCallback(async ({ type, payload, baseVersion, label }) => {
    const d = await db();
    const action_id = uid('act');
    await d.runAsync('INSERT INTO queue(action_id, type, queued_at, base_version, payload, label) VALUES (?,?,?,?,?,?)',
      action_id, type, new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), baseVersion, JSON.stringify(payload), label);
    await refresh();
    if (online) await sync();
    const row = await d.getFirstAsync('SELECT * FROM queue WHERE action_id = ?', action_id);
    return { status: row.status, result: row.result ? JSON.parse(row.result) : null };
  }, [online, refresh, sync]);

  const clearFinished = useCallback(async () => {
    const d = await db();
    await d.runAsync("DELETE FROM queue WHERE status != 'pending'");
    await refresh();
  }, [refresh]);

  const pending = items.filter((i) => i.status === 'pending').length;
  return (
    <Ctx.Provider value={{ items, pending, syncing, online, enqueue, sync, clearFinished, newId: uid }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSync = () => useContext(Ctx);
