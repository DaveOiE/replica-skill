import { PGlite, types } from '@electric-sql/pglite';
import type { Db } from './types';

/** Open a PGlite database. bigint columns (money in cents) come back as JS numbers; numeric stays a string for Decimal. */
/** Stored in the browser: copy to IndexedDB in the background (see db/durability.ts for the rule that makes this safe). */
export function pgliteOptions(dataDir?: string, extra: Record<string, unknown> = {}) {
  // Support switch: localStorage 'tb-durability' = 'strict' forces the slow, flush-after-every-statement mode.
  let forced: string | null = null;
  try { forced = globalThis.localStorage?.getItem('tb-durability') ?? null; } catch { /* storage blocked */ }
  const relaxed = dataDir?.startsWith('idb://') && forced !== 'strict' ? { relaxedDurability: true } : {};
  return { parsers: { [types.INT8]: (v: string) => safe(v) }, ...relaxed, ...extra };
}
export function createPglite(dataDir?: string, extra: Record<string, unknown> = {}): PGlite {
  const opts = pgliteOptions(dataDir, extra);
  return dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
}
export function safe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${v} does not fit a safe integer`);
  return n;
}

export function fromPglite(pg: PGlite): Db {
  const wrap = (c: { query: PGlite['query']; exec: PGlite['exec'] }, tx: boolean): Db => ({
    // Take the engine's lock and write its files to storage with STRICT durability. Not offered inside a transaction.
    ...(tx ? {} : { durable: async () => { await pg.runExclusive(async () => { await pg.fs?.syncToFs(false); }); } }),
    exec: async (sql) => { await c.exec(sql); },
    query: async (sql, params) => (await c.query(sql, params as any[])).rows as any[],
    transaction: async (fn) => (tx ? fn(wrap(c, true)) : pg.transaction((t) => fn(wrap(t as any, true)))),
  });
  return wrap(pg as any, false);
}
