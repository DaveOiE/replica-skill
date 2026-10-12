import type { Db } from '../db/types';

export interface Change { seq: number; table: string; op: string; payload: Record<string, unknown>; origin?: string }

type Strategy = 'append' | 'lww' | 'owner';
// How each synced table converges. Anything not listed is not synced.
const TABLES: Record<string, Strategy> = {
  devices: 'owner',            // only the owning device writes its own row
  products: 'lww',             // versioned last-write-wins
  stock_movements: 'append',   // immutable ledger
  orders: 'append',
  order_lines: 'append',
  order_payments: 'append',
};
export const SYNCED_TABLES = Object.keys(TABLES);

const LWW_COLS = ['sku', 'name', 'price_cents', 'active', 'version', 'updated_at', 'updated_by_device'];

function sqlFor(table: string): string {
  const base = `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(null::${table}, $1::jsonb)`;
  switch (TABLES[table]) {
    case 'append': return `${base} ON CONFLICT (id) DO NOTHING`;
    case 'owner': return `${base} ON CONFLICT (id) DO UPDATE SET name=excluded.name, order_prefix=excluded.order_prefix`;
    case 'lww': return `${base} ON CONFLICT (id) DO UPDATE SET ${LWW_COLS.map((c) => `${c}=excluded.${c}`).join(', ')}
      WHERE (excluded.version, excluded.updated_at, excluded.updated_by_device::text) > (${table}.version, ${table}.updated_at, ${table}.updated_by_device::text)`;
    default: throw new Error(`table ${table} is not synced`);
  }
}

/**
 * Apply remote changes. Idempotent: replaying a batch changes nothing.
 * device: suppress change capture (do not echo back). server: record who each change came from.
 */
export async function applyChanges(db: Db, changes: Change[], opts: { as: 'device' } | { as: 'server'; origin: string }) {
  await db.transaction(async (tx) => {
    if (opts.as === 'device') await tx.query("SELECT set_config('tillbox.suppress','on',true)");
    else {
      // Serialise server writes so outbox sequence numbers become visible in order; a puller can then never skip one.
      await tx.query('SELECT pg_advisory_xact_lock(7001)');
      await tx.query("SELECT set_config('tillbox.origin',$1,true)", [opts.origin]);
    }
    for (const c of changes) await tx.query(sqlFor(c.table), [JSON.stringify(c.payload)]);
  });
}
