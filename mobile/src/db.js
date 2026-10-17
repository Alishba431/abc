// Local SQLite: read-through cache for screens + persistent offline action queue (Section 5.14 format).
import * as SQLite from 'expo-sqlite';

let dbp = null;
export function db() {
  if (!dbp) {
    dbp = (async () => {
      const d = await SQLite.openDatabaseAsync('leagueops.db');
      await d.execAsync(`
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS queue (
          action_id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, queued_at TEXT NOT NULL,
          base_version INTEGER NOT NULL, payload TEXT NOT NULL, label TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', result TEXT);
      `);
      return d;
    })();
  }
  return dbp;
}

export async function cachePut(key, value) {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO cache(key, json, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), new Date().toISOString());
}

export async function cacheGet(key) {
  const d = await db();
  const row = await d.getFirstAsync('SELECT json, updated_at FROM cache WHERE key = ?', key);
  return row ? { value: JSON.parse(row.json), updatedAt: row.updated_at } : null;
}
