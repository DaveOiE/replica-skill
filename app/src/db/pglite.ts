import type { PGlite } from '@electric-sql/pglite';
import type { Db } from './types';

export function fromPglite(pg: PGlite): Db {
  const wrap = (c: { query: PGlite['query']; exec: PGlite['exec'] }, tx: boolean): Db => ({
    exec: async (sql) => { await c.exec(sql); },
    query: async (sql, params) => (await c.query(sql, params as any[])).rows as any[],
    transaction: async (fn) => (tx ? fn(wrap(c, true)) : pg.transaction((t) => fn(wrap(t as any, true)))),
  });
  return wrap(pg as any, false);
}
