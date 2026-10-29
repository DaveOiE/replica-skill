import { getTableColumns } from 'drizzle-orm';
import type { Db } from '../db/types';
import { REGISTRY, type SyncClass } from '../schema/helpers';
import '../schema/index';

export interface Change { seq: number; table: string; op: string; payload: Record<string, unknown>; origin?: string }

/** Every synced table converges by the rule its class dictates. Local tables are never synced. */
export const SYNCED_TABLES = [...REGISTRY.entries()].filter(([, v]) => v.cls !== 'local').map(([k]) => k).sort();
export const classOf = (table: string): SyncClass | undefined => REGISTRY.get(table)?.cls;

const cache = new Map<string, string>();
function sqlFor(table: string): string {
  const hit = cache.get(table); if (hit) return hit;
  const entry = REGISTRY.get(table);
  if (!entry || entry.cls === 'local') throw new Error(`table ${table} is not synced`);
  const base = `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(null::${table}, $1::jsonb)`;
  let sql: string;
  if (entry.cls === 'ledger') {
    sql = `${base} ON CONFLICT (id) DO NOTHING`;
  } else {
    const cols = Object.values(getTableColumns(entry.table)).map((c) => c.name).filter((n) => n !== 'id');
    if (entry.cls === 'lww') {
      // a higher (version, time, device) wins everywhere; an older edit can never overwrite a newer one
      sql = `${base} ON CONFLICT (id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}
        WHERE (excluded.version, excluded.updated_at, excluded.updated_by_device::text) > (${table}.version, ${table}.updated_at, ${table}.updated_by_device::text)`;
    } else { // owner: only the owning device writes it, so the latest state it sends is right
      sql = `${base} ON CONFLICT (id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}`;
    }
  }
  cache.set(table, sql);
  return sql;
}

/**
 * Apply remote changes. Idempotent: replaying a batch changes nothing.
 * device: suppress change capture (do not echo back).
 * import: a restore from a file; capture stays on so the restored data is pushed to the server.
 * server: record who each change came from, and serialise writes so outbox sequence numbers become visible in order.
 */
export async function applyChanges(db: Db, changes: Change[], opts: { as: 'device' } | { as: 'import' } | { as: 'server'; origin: string }) {
  await db.transaction(async (tx) => {
    if (opts.as === 'device') await tx.query("SELECT set_config('tillbox.suppress','on',true)");
    else if (opts.as === 'import') { /* capture stays ON: restored rows become pending and are pushed to the server */ }
    else {
      await tx.query('SELECT pg_advisory_xact_lock(7001)');
      await tx.query("SELECT set_config('tillbox.origin',$1,true)", [opts.origin]);
    }
    for (const c of changes) await tx.query(sqlFor(c.table), [JSON.stringify(c.payload)]);
  });
}
