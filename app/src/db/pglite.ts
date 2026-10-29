import { PGlite, types } from '@electric-sql/pglite';
import type { Db } from './types';

/** Open a PGlite database. bigint columns (money in cents) come back as JS numbers; numeric stays a string for Decimal. */
export function createPglite(dataDir?: string, extra: Record<string, unknown> = {}): PGlite {
  const opts = { parsers: { [types.INT8]: (v: string) => safe(v) }, ...extra };
  return dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
}
export function safe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${v} does not fit a safe integer`);
  return n;
}

export function fromPglite(pg: PGlite): Db {
  const wrap = (c: { query: PGlite['query']; exec: PGlite['exec'] }, tx: boolean): Db => ({
    exec: async (sql) => { await c.exec(sql); },
    query: async (sql, params) => (await c.query(sql, params as any[])).rows as any[],
    transaction: async (fn) => (tx ? fn(wrap(c, true)) : pg.transaction((t) => fn(wrap(t as any, true)))),
  });
  return wrap(pg as any, false);
}
