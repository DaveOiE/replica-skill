import type { Db } from '../db/types';
import { applyChanges, type Change } from './apply';
import { deviceId, getMeta, setMeta, randomPrefix } from '../domain/store';

export interface SyncConfig { url: string; token: string; fetch?: typeof fetch }
export type SyncMode = 'standalone' | 'connected';
export interface SyncStatus {
  mode: SyncMode;
  pending: number;          // local changes not yet on the server
  lastSyncAt: string | null;
  lastError: string | null;
  state: 'standalone' | 'synced' | 'pending' | 'offline' | 'error';
}

/** Mode 1 -> 2/3: remember the server. Nothing is rewritten; the local change log is simply pushed from the start. */
export async function connectServer(db: Db, cfg: { url: string; token: string }) {
  await setMeta(db, 'sync_url', cfg.url.replace(/\/$/, ''));
  await setMeta(db, 'sync_token', cfg.token);
  await setMeta(db, 'sync_pushed_seq', (await getMeta(db, 'sync_pushed_seq')) ?? '0');
  await setMeta(db, 'sync_pulled_seq', (await getMeta(db, 'sync_pulled_seq')) ?? '0');
}

export async function getSyncStatus(db: Db, online = true): Promise<SyncStatus> {
  const url = await getMeta(db, 'sync_url');
  const lastSyncAt = await getMeta(db, 'sync_last_at');
  const lastError = await getMeta(db, 'sync_last_error');
  if (!url) return { mode: 'standalone', pending: 0, lastSyncAt: null, lastError: null, state: 'standalone' };
  const pushed = Number((await getMeta(db, 'sync_pushed_seq')) ?? 0);
  const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE seq > $1', [pushed]);
  const state = !online ? 'offline' : lastError ? 'error' : n > 0 ? 'pending' : 'synced';
  return { mode: 'connected', pending: n, lastSyncAt, lastError, state };
}

async function call(cfg: Required<SyncConfig>, path: string, init?: RequestInit) {
  const res = await cfg.fetch(cfg.url + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** One full cycle: register (first time), push everything pending, pull everything new. */
export async function syncOnce(db: Db, over: { fetch?: typeof fetch } = {}): Promise<{ pushed: number; pulled: number }> {
  const url = await getMeta(db, 'sync_url');
  const token = await getMeta(db, 'sync_token');
  if (!url || !token) throw new Error('not connected to a server');
  const cfg = { url, token, fetch: over.fetch ?? globalThis.fetch.bind(globalThis) } as Required<SyncConfig>;
  const me = await deviceId(db);
  try {
    // 1. register (reserves the order-number prefix; changes it if another device already has it)
    if (!(await getMeta(db, 'sync_registered'))) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const [d] = await db.query<{ name: string; order_prefix: string }>('SELECT name, order_prefix FROM devices WHERE id=$1', [me]);
        const r = await call(cfg, '/sync/register', { method: 'POST', body: JSON.stringify({ deviceId: me, name: d.name, orderPrefix: d.order_prefix }) });
        if (r.status === 200) { await setMeta(db, 'sync_registered', '1'); break; }
        if (r.status === 409) { await db.query('UPDATE devices SET order_prefix=$2 WHERE id=$1', [me, randomPrefix()]); continue; } // future orders only
        throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
      }
      if (!(await getMeta(db, 'sync_registered'))) throw new Error('could not reserve an order prefix');
    }
    // 2. push
    let pushed = 0;
    for (;;) {
      const from = Number((await getMeta(db, 'sync_pushed_seq')) ?? 0);
      // Mutable single-owner rows (the device's own record) are sent as their CURRENT state, never as stale history,
      // so a replayed or delayed change can never reintroduce an old value (e.g. a prefix that was since changed).
      const rows = await db.query<{ seq: number; table_name: string; op: string; payload: Record<string, unknown> }>(
        `SELECT o.seq, o.table_name, o.op,
                CASE WHEN o.table_name = 'devices' THEN coalesce((SELECT to_jsonb(d) FROM devices d WHERE d.id = o.row_id), o.payload) ELSE o.payload END AS payload
           FROM outbox o WHERE o.seq > $1 AND o.origin = $2 ORDER BY o.seq LIMIT 200`, [from, me]);
      if (!rows.length) break;
      const r = await call(cfg, '/sync/push', { method: 'POST', body: JSON.stringify({ deviceId: me, changes: rows.map((x) => ({ seq: x.seq, table: x.table_name, op: x.op, payload: x.payload })) }) });
      if (r.status !== 200) throw new Error(`push failed: ${r.status} ${JSON.stringify(r.body)}`);
      await setMeta(db, 'sync_pushed_seq', String(rows[rows.length - 1].seq));
      pushed += rows.length;
    }
    // 3. pull
    let pulled = 0;
    for (;;) {
      const since = Number((await getMeta(db, 'sync_pulled_seq')) ?? 0);
      const r = await call(cfg, `/sync/pull?since=${since}&device=${me}&limit=200`);
      if (r.status !== 200) throw new Error(`pull failed: ${r.status} ${JSON.stringify(r.body)}`);
      const changes = r.body.changes as Change[];
      if (changes.length) await applyChanges(db, changes, { as: 'device' });
      await setMeta(db, 'sync_pulled_seq', String(r.body.cursor));
      pulled += changes.length;
      if (!r.body.hasMore) break;
    }
    await setMeta(db, 'sync_last_at', new Date().toISOString());
    await setMeta(db, 'sync_last_error', '');
    return { pushed, pulled };
  } catch (e) {
    await setMeta(db, 'sync_last_error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}
