'use client';
import type { PGlite } from '@electric-sql/pglite';
import { createPglite, fromPglite } from '../db/pglite';
import { migrate } from '../db/migrate';
import { initDevice, getMeta, type DeviceInfo } from '../domain/store';
import type { Db } from '../db/types';

export interface Local { pg: PGlite; db: Db; info: DeviceInfo; persisted: boolean | null; openMs: number; dataDir: string }
export const DATA_DIR = 'idb://tillbox';

/** One window owns the database at a time (the engine has one connection). A second window is told so, not left hanging. */
export class OpenElsewhereError extends Error { constructor() { super('OPEN_ELSEWHERE'); this.name = 'OpenElsewhereError'; } }

async function claimDatabase(): Promise<void> {
  if (!('locks' in navigator)) return;
  await new Promise<void>((resolve, reject) => {
    navigator.locks.request('tillbox-db', { ifAvailable: true }, (lock) => {
      if (!lock) { reject(new OpenElsewhereError()); return; }
      resolve();
      return new Promise<void>(() => {}); // held until this tab closes
    });
  });
}

let opening: Promise<Local> | null = null;
/** Browser storage can be evicted, so ask for persistence before the first byte is written. */
export function openLocal(dataDir = DATA_DIR): Promise<Local> {
  opening ??= (async () => {
    const t0 = performance.now();
    await claimDatabase();
    let persisted: boolean | null = null;
    try { persisted = (await navigator.storage?.persist?.()) ?? null; } catch { /* unsupported */ }
    const pg = createPglite(dataDir);
    await pg.waitReady;
    const db = fromPglite(pg);
    await migrate(db);
    const info = await initDevice(db, 'Till');
    return { pg, db, info, persisted, openMs: Math.round(performance.now() - t0), dataDir };
  })();
  return opening;
}

/** Has this device been set up (a new store started, or joined to a server)? */
export async function isSetUp(db: Db): Promise<boolean> {
  return !!(await getMeta(db, 'seed_version')) || !!(await getMeta(db, 'store_id'));
}

/** Throw away the (empty, not yet set up) database so a backup can be restored in its place. */
export async function wipeLocal(local: Local): Promise<void> {
  await local.pg.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('/pglite/' + local.dataDir.replace('idb://', ''));
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error); req.onblocked = () => resolve();
  });
  opening = null;
}
