// The only thing the shared engine needs from a database. PGlite (device) and pg (server) both fit.
export interface Db {
  exec(sql: string): Promise<void>;
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  /**
   * Resolves once everything committed so far is safely in the device's storage (a strict write, not a hint).
   * Present only on the on-device database; the server's Postgres makes every commit durable by itself.
   */
  durable?(): Promise<void>;
}
