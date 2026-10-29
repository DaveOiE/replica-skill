import type { Db } from '../db/types';
import { applyChanges, type Change } from './apply';
import { deviceId, getMeta, setMeta } from '../domain/store';
import { randomPrefix } from '../domain/ids';
import { SCHEMA_VERSION } from '../schema/migrations.generated';
import { reconcileDuplicateSkus } from './reconcile';

export type SyncState = 'standalone' | 'synced' | 'pending' | 'offline' | 'error' | 'update-required' | 'unauthorised';
export interface SyncStatus { mode: 'standalone' | 'connected'; pending: number; lastSyncAt: string | null; lastError: string | null; state: SyncState; storeId: string | null }

/** Connecting would mix this device's data into a server that holds a different shop's. Ask the human first. */
export class StoreMergeError extends Error {
  constructor(public reason: 'server_has_other_data' | 'different_store') { super(reason === 'different_store' ? 'This server belongs to a different store than this device was synced with.' : 'This device has its own sales history and the server already holds data.'); this.name = 'StoreMergeError'; }
}
export class SyncHttpError extends Error { constructor(public status: number, public body: any) { super(`sync ${status}: ${JSON.stringify(body)}`); this.name = 'SyncHttpError'; } }

type F = typeof fetch;
const bound = (f?: F): F => f ?? globalThis.fetch.bind(globalThis);

async function localHasHistory(db: Db): Promise<boolean> {
  const [{ n }] = await db.query<{ n: number }>('SELECT (SELECT count(*) FROM orders) + (SELECT count(*) FROM products) AS n');
  return Number(n) > 0;
}

/**
 * Mode 1 -> 2/3, or switching server. Nothing local is rewritten; the device's change log is simply pushed.
 * `confirm` is the human's explicit answer to a StoreMergeError:
 *   'join'     = this is a new device for the shop the server holds (it has no history of its own to protect)
 *   'merge'    = this device has its own history and the server has data too: combine them
 *   'migrate'  = this device is the source of truth for a NEW, empty server (or a server for a different store)
 */
export async function connectServer(db: Db, cfg: { url: string; pairingCode: string; confirm?: 'merge' | 'migrate'; fetch?: F }): Promise<{ storeId: string }> {
  const f = bound(cfg.fetch);
  const url = cfg.url.replace(/\/$/, '');
  const info = await (await f(`${url}/sync/info`)).json() as { storeId: string; schemaVersion: string; hasData: boolean };
  if (info.schemaVersion !== SCHEMA_VERSION) throw new SyncHttpError(426, { error: 'schema_mismatch', server: info.schemaVersion, client: SCHEMA_VERSION });
  const remembered = await getMeta(db, 'store_id');
  const mine = await localHasHistory(db);
  if (remembered && remembered !== info.storeId && cfg.confirm !== 'migrate') throw new StoreMergeError('different_store');
  if (!remembered && mine && info.hasData && !cfg.confirm) throw new StoreMergeError('server_has_other_data');

  const me = await deviceId(db);
  for (let attempt = 0; attempt < 5; attempt++) {
    const [d] = await db.query<{ name: string; order_prefix: string }>('SELECT name, order_prefix FROM devices WHERE id=$1', [me]);
    const res = await f(`${url}/sync/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: cfg.pairingCode, deviceId: me, name: d.name, orderPrefix: d.order_prefix, schemaVersion: SCHEMA_VERSION }) });
    const body = await res.json() as any;
    if (res.status === 409) { await db.query('UPDATE devices SET order_prefix=$2 WHERE id=$1', [me, randomPrefix()]); continue; } // future orders only
    if (res.status !== 200) throw new SyncHttpError(res.status, body);
    await setMeta(db, 'sync_url', url);
    await setMeta(db, 'device_token', body.token);
    await setMeta(db, 'store_id', body.storeId);
    if (remembered && remembered !== body.storeId) { await setMeta(db, 'sync_pushed_seq', '0'); await setMeta(db, 'sync_pulled_seq', '0'); } // a new server starts from scratch
    await setMeta(db, 'sync_pushed_seq', (await getMeta(db, 'sync_pushed_seq')) ?? '0');
    await setMeta(db, 'sync_pulled_seq', (await getMeta(db, 'sync_pulled_seq')) ?? '0');
    await setMeta(db, 'sync_last_error', '');
    return { storeId: body.storeId };
  }
  throw new Error('could not reserve an order prefix');
}

/** Back to mode 1. The device keeps its full local copy. */
export async function disconnectServer(db: Db) {
  for (const k of ['sync_url', 'device_token', 'sync_last_error']) await db.query('DELETE FROM meta WHERE key = $1', [k]);
}

export async function getSyncStatus(db: Db, online = true): Promise<SyncStatus> {
  const url = await getMeta(db, 'sync_url');
  const storeId = await getMeta(db, 'store_id');
  if (!url) return { mode: 'standalone', pending: 0, lastSyncAt: null, lastError: null, state: 'standalone', storeId };
  const lastSyncAt = (await getMeta(db, 'sync_last_at')) || null;
  const lastError = (await getMeta(db, 'sync_last_error')) || null;
  const pushed = Number((await getMeta(db, 'sync_pushed_seq')) ?? 0);
  const [{ n }] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM outbox WHERE seq > $1', [pushed]);
  const state: SyncState = !online ? 'offline' : lastError?.startsWith('schema_mismatch') ? 'update-required' : lastError?.startsWith('unauthorized') ? 'unauthorised' : lastError ? 'error' : n > 0 ? 'pending' : 'synced';
  return { mode: 'connected', pending: n, lastSyncAt, lastError, state, storeId };
}

/** One full cycle: push everything pending, pull everything new, then apply the reconcile rules. */
export async function syncOnce(db: Db, over: { fetch?: F } = {}): Promise<{ pushed: number; pulled: number }> {
  const url = await getMeta(db, 'sync_url');
  const token = await getMeta(db, 'device_token');
  if (!url || !token) throw new Error('not connected to a server');
  const f = bound(over.fetch);
  const me = await deviceId(db);
  const call = async (path: string, init?: RequestInit) => {
    const res = await f(url + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-schema-version': SCHEMA_VERSION, ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 200) throw new SyncHttpError(res.status, body);
    return body as any;
  };
  try {
    let pushed = 0;
    for (;;) {
      const from = Number((await getMeta(db, 'sync_pushed_seq')) ?? 0);
      // Mutable single-owner rows are sent as their CURRENT state, never as stale history, so a replayed or delayed
      // change can never reintroduce an old value (for example an order prefix that has since changed).
      const rows = await db.query<{ seq: number; table_name: string; op: string; payload: Record<string, unknown> }>(
        `SELECT o.seq, o.table_name, o.op,
                CASE WHEN o.table_name IN ('devices', 'register_sessions')
                     THEN coalesce(CASE o.table_name WHEN 'devices' THEN (SELECT to_jsonb(d) FROM devices d WHERE d.id = o.row_id)
                                                     ELSE (SELECT to_jsonb(s) FROM register_sessions s WHERE s.id = o.row_id) END, o.payload)
                     ELSE o.payload END AS payload
           FROM outbox o WHERE o.seq > $1 AND o.origin = $2 ORDER BY o.seq LIMIT 200`, [from, me]);
      if (!rows.length) break;
      await call('/sync/push', { method: 'POST', body: JSON.stringify({ changes: rows.map((x) => ({ seq: Number(x.seq), table: x.table_name, op: x.op, payload: x.payload })) }) });
      await setMeta(db, 'sync_pushed_seq', String(rows[rows.length - 1].seq));
      pushed += rows.length;
    }
    let pulled = 0;
    for (;;) {
      const since = Number((await getMeta(db, 'sync_pulled_seq')) ?? 0);
      const body = await call(`/sync/pull?since=${since}&limit=200`);
      const changes = body.changes as Change[];
      if (changes.length) await applyChanges(db, changes, { as: 'device' });
      await setMeta(db, 'sync_pulled_seq', String(body.cursor));
      pulled += changes.length;
      if (!body.hasMore) break;
    }
    if (pulled) await reconcileDuplicateSkus(db, me);
    await setMeta(db, 'sync_last_at', new Date().toISOString());
    await setMeta(db, 'sync_last_error', '');
    return { pushed, pulled };
  } catch (e) {
    const msg = e instanceof SyncHttpError ? `${e.body?.error ?? 'http_' + e.status}${e.body?.error === 'schema_mismatch' ? ` (server ${e.body.server}, this device ${e.body.client})` : ''}` : e instanceof Error ? e.message : String(e);
    await setMeta(db, 'sync_last_error', msg);
    throw e;
  }
}
