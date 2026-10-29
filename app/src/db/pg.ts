import pg, { type Pool, type PoolClient } from 'pg';
import type { Db } from './types';
import { safe } from './pglite';

let configured = false;
/** Same rule as the device: bigint -> number, numeric stays a string. Call once at start-up. */
export function configurePg() {
  if (configured) return;
  pg.types.setTypeParser(20, safe);
  configured = true;
}

export function fromPool(pool: Pool): Db {
  configurePg();
  const wrap = (c: Pool | PoolClient, inTx: boolean): Db => ({
    exec: async (sql) => { await c.query(sql); },
    query: async (sql, params) => (await c.query(sql, params as any[])).rows as any[],
    transaction: async (fn) => {
      if (inTx) return fn(wrap(c, true));
      const client = await (c as Pool).connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client, true));
        await client.query('COMMIT');
        return out;
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    },
  });
  return wrap(pool, false);
}
