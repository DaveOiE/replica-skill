// Device identity and the small amount of local state every device needs. Not business logic.
import type { Db } from '../db/types';
import { newId, randomPrefix } from './ids';

export async function getMeta(db: Db, key: string): Promise<string | null> {
  return (await db.query<{ value: string }>('SELECT value FROM meta WHERE key=$1', [key]))[0]?.value ?? null;
}
export async function setMeta(db: Db, key: string, value: string) {
  await db.query('INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=excluded.value', [key, value]);
}

export interface DeviceInfo { id: string; name: string; prefix: string }

/** First run on a device: create its identity. Safe to call again. */
export async function initDevice(db: Db, name: string): Promise<DeviceInfo> {
  return db.transaction(async (tx) => {
    const id = await getMeta(tx, 'device_id');
    if (id) {
      const [d] = await tx.query<{ name: string; order_prefix: string }>('SELECT name, order_prefix FROM devices WHERE id=$1', [id]);
      return { id, name: d.name, prefix: d.order_prefix };
    }
    const mine = newId();
    const prefix = randomPrefix();
    await setMeta(tx, 'device_id', mine);
    await tx.query('INSERT INTO devices(id,name,order_prefix,device_id) VALUES($1,$2,$3,$1)', [mine, name, prefix]);
    return { id: mine, name, prefix };
  });
}

export async function deviceId(db: Db): Promise<string> {
  const id = await getMeta(db, 'device_id');
  if (!id) throw new Error('device not initialised');
  return id;
}

/**
 * After restoring a backup onto a DIFFERENT device (or while the original may still be running), the copy must not
 * keep the original's identity, or both would issue the same order numbers. History is kept; the identity is new.
 * Restoring in place after a disaster (the original is gone) may keep the identity and skip this.
 */
export async function restoreAsNewDevice(db: Db, name: string): Promise<DeviceInfo> {
  return db.transaction(async (tx) => {
    const old = await deviceId(tx);
    const mine = newId();
    const prefix = randomPrefix();
    await setMeta(tx, 'device_id', mine);
    await tx.query('INSERT INTO devices(id,name,order_prefix,device_id) VALUES($1,$2,$3,$1)', [mine, name, prefix]);
    await tx.query('UPDATE outbox SET origin=$2 WHERE origin=$1', [old, mine]); // unpushed history is pushed under the new identity
    await tx.query("DELETE FROM meta WHERE key IN ('sync_registered','sync_token','device_token')"); // pair the new identity afresh
    return { id: mine, name, prefix };
  });
}
