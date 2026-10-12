import type { Db } from '../src/db/types';
import { applyChanges, type Change } from '../src/sync/apply';
import { getMeta, setMeta } from '../src/domain/store';
import { migrate } from '../src/db/migrate';

export async function initServerDb(db: Db) {
  await migrate(db);
  if (!(await getMeta(db, 'device_id'))) await setMeta(db, 'device_id', 'server');
}

export interface Reply { status: number; body: unknown }

export function createHandlers(db: Db, token: string) {
  const authed = (auth?: string | null) => auth === `Bearer ${token}`;

  async function register(b: { deviceId: string; name: string; orderPrefix: string }): Promise<Reply> {
    return db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(7001)');
      const [mine] = await tx.query('SELECT id FROM devices WHERE id=$1', [b.deviceId]);
      if (mine) return { status: 200, body: { ok: true } };
      const [clash] = await tx.query('SELECT id FROM devices WHERE order_prefix=$1', [b.orderPrefix]);
      if (clash) return { status: 409, body: { error: 'prefix_taken' } };
      await tx.query("SELECT set_config('tillbox.origin',$1,true)", [b.deviceId]);
      await tx.query('INSERT INTO devices(id,name,order_prefix) VALUES($1,$2,$3)', [b.deviceId, b.name, b.orderPrefix]);
      return { status: 200, body: { ok: true } };
    });
  }

  async function push(b: { deviceId: string; changes: Change[] }): Promise<Reply> {
    const [dev] = await db.query('SELECT id FROM devices WHERE id=$1', [b.deviceId]);
    if (!dev) return { status: 403, body: { error: 'device_not_registered' } };
    await applyChanges(db, b.changes, { as: 'server', origin: b.deviceId });
    return { status: 200, body: { ok: true, applied: b.changes.length } };
  }

  async function pull(since: number, device: string, limit: number): Promise<Reply> {
    // One statement = one snapshot: the page and the high-water mark cannot disagree, so no change is skipped.
    const rows = await db.query<{ seq: number; table_name: string; op: string; payload: Record<string, unknown>; origin: string; mx: number | null }>(
      `SELECT seq, table_name, op, payload, origin, (SELECT max(seq) FROM outbox)::bigint AS mx
         FROM outbox WHERE seq > $1 AND origin <> $2 ORDER BY seq LIMIT $3`, [since, device, limit + 1]);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    let cursor = page.length ? Number(page[page.length - 1].seq) : since;
    if (!hasMore) {
      const mx = rows.length ? Number(rows[0].mx) : Number((await db.query<{ mx: number | null }>('SELECT max(seq)::bigint AS mx FROM outbox'))[0].mx ?? since);
      cursor = Math.max(cursor, mx);
    }
    return { status: 200, body: { changes: page.map((r) => ({ seq: Number(r.seq), table: r.table_name, op: r.op, payload: r.payload, origin: r.origin })), hasMore, cursor } };
  }

  return { authed, register, push, pull };
}
