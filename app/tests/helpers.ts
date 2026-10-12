import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { fromPglite } from '../src/db/pglite';
import { migrate } from '../src/db/migrate';
import { initDevice } from '../src/domain/store';
import { startSyncServer } from '../server/index';
import { connectServer } from '../src/sync/client';

export const PG_ADMIN = process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5499/postgres';
export const TOKEN = 'test-token';

export async function makeDevice(name: string) {
  const pg = new PGlite();
  const db = fromPglite(pg);
  await migrate(db);
  const info = await initDevice(db, name);
  return { pg, db, info };
}
export type TestDevice = Awaited<ReturnType<typeof makeDevice>>;

export async function makeServer() {
  const dbName = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Pool({ connectionString: PG_ADMIN });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = PG_ADMIN.replace(/\/[^/]*$/, `/${dbName}`);
  const server = await startSyncServer({ databaseUrl: url, token: TOKEN, port: 0 });
  return {
    ...server,
    url: `http://127.0.0.1:${server.port}`,
    async close() { await server.close(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end(); },
  };
}

export async function connect(d: TestDevice, serverUrl: string) {
  await connectServer(d.db, { url: serverUrl, token: TOKEN });
}
