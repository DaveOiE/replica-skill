import { PGlite, types } from '@electric-sql/pglite';
import type { Db } from './types';
import { installWriteBehind, type WriteBehind } from './writebehind';

export function safe(v: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${v} does not fit a safe integer`);
  return n;
}

/** Whether a data directory is stored in the browser, where the per-statement copy is too slow to leave on. */
export function usesWriteBehind(dataDir?: string, extra: Record<string, unknown> = {}): boolean {
  if (!dataDir?.startsWith('idb://') || extra.writeBehind === false) return false;
  // Support switch: localStorage 'tb-durability' = 'strict' forces the engine's own slow flush-after-every-statement mode.
  try { if (globalThis.localStorage?.getItem('tb-durability') === 'strict') return false; } catch { /* storage blocked */ }
  return true;
}

export function pgliteOptions(extra: Record<string, unknown> = {}) {
  const { writeBehind: _w, ...rest } = extra;
  return { parsers: { [types.INT8]: (v: string) => safe(v) }, ...rest };
}

const registry = new WeakMap<PGlite, WriteBehind>();
/** The write-behind controller of a database opened with createPglite, if it has one. */
export const writeBehindOf = (pg: PGlite): WriteBehind | undefined => registry.get(pg);

/** Open a PGlite database. bigint columns (money in cents) come back as JS numbers; numeric stays a string for Decimal. */
export function createPglite(dataDir?: string, extra: Record<string, unknown> = {}): PGlite {
  const opts = pgliteOptions(extra);
  const pg = dataDir ? new PGlite(dataDir, opts) : new PGlite(opts);
  if (usesWriteBehind(dataDir, extra)) registry.set(pg, installWriteBehind(pg as never));
  return pg;
}

/** Save everything, stop the background timer, then close. Use this instead of pg.close() for browser-stored databases. */
export async function closePglite(pg: PGlite): Promise<void> {
  await writeBehindOf(pg)?.stop();
  await pg.close();
}

export function fromPglite(pg: PGlite): Db {
  const wrap = (c: { query: PGlite['query']; exec: PGlite['exec'] }, tx: boolean): Db => ({
    // Save everything not yet saved, strictly. Not offered inside a transaction (it would wait on itself).
    ...(tx ? {} : { durable: async () => { const wb = writeBehindOf(pg); if (wb) await wb.commit(); else await pg.runExclusive(async () => { await pg.fs?.syncToFs(false); }); } }),
    exec: async (sql) => { await c.exec(sql); },
    query: async (sql, params) => (await c.query(sql, params as any[])).rows as any[],
    transaction: async (fn) => (tx ? fn(wrap(c, true)) : pg.transaction((t) => fn(wrap(t as any, true)))),
  });
  return wrap(pg as any, false);
}
