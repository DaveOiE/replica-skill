'use client';
import { PGlite } from '@electric-sql/pglite';
import { fromPglite } from '../db/pglite';
import { migrate } from '../db/migrate';
import { initDevice, addProduct, type DeviceInfo } from '../domain/store';
import type { Db } from '../db/types';

export interface Local { pg: PGlite; db: Db; info: DeviceInfo; persisted: boolean | null }
let opening: Promise<Local> | null = null;

/** Open (or create) the on-device database. Browser storage is evictable, so ask for persistence first. */
/** One window owns the database at a time (PGlite is single-connection). A second window is told so, instead of hanging. */
async function claimDatabase(): Promise<void> {
  if (!('locks' in navigator)) return;
  await new Promise<void>((resolve, reject) => {
    navigator.locks.request('tillbox-db', { ifAvailable: true }, (lock) => {
      if (!lock) { reject(new Error('OPEN_ELSEWHERE')); return; }
      resolve();
      return new Promise<void>(() => {}); // hold the lock until this tab closes
    });
  });
}

export function openLocal(dataDir = 'idb://tillbox'): Promise<Local> {
  opening ??= (async () => {
    await claimDatabase();
    let persisted: boolean | null = null;
    try { persisted = (await navigator.storage?.persist?.()) ?? null; } catch { /* unsupported */ }
    const pg = new PGlite(dataDir);
    await pg.waitReady;
    const db = fromPglite(pg);
    await migrate(db);
    const info = await initDevice(db, 'Till');
    return { pg, db, info, persisted };
  })();
  return opening;
}

/** "Start a new store" on the first device. A device that JOINS a store never seeds; it pulls the catalogue instead. */
export async function seedDemo(db: Db) {
  for (const [sku, name, price] of [['FW', 'Flat white', 450], ['CR', 'Croissant', 520], ['WA', 'Water', 300]] as const)
    await addProduct(db, { sku, name, priceCents: price, openingStock: 50 });
}
