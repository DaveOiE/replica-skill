// The only thing the shared engine needs from a database. PGlite (device) and pg (server) both fit.
export interface Db {
  exec(sql: string): Promise<void>;
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}
