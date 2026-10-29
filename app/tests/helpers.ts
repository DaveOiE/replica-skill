import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { createPglite, fromPglite } from '../src/db/pglite';
import { migrate } from '../src/db/migrate';
import { initDevice, type DeviceInfo } from '../src/domain/store';
import { installDefaults } from '../src/seed';
import { startSyncServer } from '../server/index';
import { connectServer } from '../src/sync/client';
import { createBus } from '../src/events/bus';
import type { Ctx } from '../src/services/runner';
import type { Db } from '../src/db/types';

export const PG_ADMIN = process.env.TEST_PG_URL ?? 'postgres://postgres@127.0.0.1:5499/postgres';
export const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';

export interface TestDevice { pg: PGlite; db: Db; info: DeviceInfo; ctx: Ctx }

/** A device. `seed: true` is the first device of a shop ("start a new store"); a joining device does not seed. */
export async function makeDevice(name: string, opts: { seed?: boolean } = {}): Promise<TestDevice> {
  const pg = createPglite();
  const db = fromPglite(pg);
  await migrate(db);
  const info = await initDevice(db, name);
  if (opts.seed) await installDefaults(db, info.id);
  return { pg, db, info, ctx: { db, bus: createBus(), deviceId: info.id, actor: 'system' } };
}

export async function makeServer() {
  const dbName = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new Pool({ connectionString: PG_ADMIN });
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = PG_ADMIN.replace(/\/[^/]*$/, `/${dbName}`);
  const server = await startSyncServer({ databaseUrl: url, adminToken: ADMIN_TOKEN, port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${server.port}`;
  const adminPost = async (path: string, body: unknown = {}) =>
    (await fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
  return {
    ...server, url: base, adminPost, dbName,
    pairingCode: async (label = 'test') => (await adminPost('/admin/pairing-codes', { label })).code as string,
    async close() { await server.close(); await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`); await admin.end(); },
  };
}
export type TestServer = Awaited<ReturnType<typeof makeServer>>;

/** Pair a device with the server (what an admin does by typing a one-time code). */
/** Most tests mean "this device belongs to this shop", so they confirm the merge. The guard has its own tests. */
export async function connect(d: TestDevice, s: TestServer, confirm: 'merge' | 'migrate' | null = 'merge') {
  return connectServer(d.db, { url: s.url, pairingCode: await s.pairingCode(d.info.name), confirm: confirm ?? undefined });
}

import { insertRow } from '../src/db/sql';
import { newId } from '../src/domain/ids';
import { loadAccess, type Access } from '../src/auth/access';

/** Create a user holding a seeded role and return their access (what a signed-in session carries). */
export async function makeUser(d: { db: Db; info: DeviceInfo }, username: string, roleKey: string | null): Promise<Access> {
  const id = newId();
  await insertRow(d.db, 'users', { id, username, display_name: username, password_hash: 'x', updated_by_device: d.info.id });
  if (roleKey) {
    const [r] = await d.db.query<{ id: string }>('SELECT id FROM roles WHERE key = $1', [roleKey]);
    await insertRow(d.db, 'user_roles', { id: newId(), user_id: id, role_id: r.id, updated_by_device: d.info.id });
  }
  return loadAccess(d.db, id);
}

/** Edit a versioned (last-write-wins) row the way every service does: bump version and stamp device and time. */
export async function bump(d: { db: Db; info: DeviceInfo }, table: string, id: string, set: Record<string, unknown>) {
  const cols = Object.keys(set);
  await d.db.query(`UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $2 WHERE id = $1`, [id, d.info.id, ...cols.map((c) => set[c])]);
}
export const idOf = async (db: Db, sql: string, params: unknown[] = []): Promise<string> => (await db.query<{ id: string }>(sql, params))[0].id;
