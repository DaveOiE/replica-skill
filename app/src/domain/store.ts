import type { Db } from '../db/types';

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)
export const newId = () => crypto.randomUUID();
export function randomPrefix(len = 4): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
}

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
    const newDevice = newId();
    const prefix = randomPrefix();
    await setMeta(tx, 'device_id', newDevice);
    await tx.query('INSERT INTO devices(id,name,order_prefix) VALUES($1,$2,$3)', [newDevice, name, prefix]);
    return { id: newDevice, name, prefix };
  });
}

export async function deviceId(db: Db): Promise<string> {
  const id = await getMeta(db, 'device_id');
  if (!id) throw new Error('device not initialised');
  return id;
}

export async function addProduct(db: Db, p: { sku: string; name: string; priceCents: number; openingStock?: number }) {
  const dev = await deviceId(db);
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.query('INSERT INTO products(id,sku,name,price_cents,version,updated_by_device) VALUES($1,$2,$3,$4,1,$5)', [id, p.sku, p.name, p.priceCents, dev]);
    if (p.openingStock) await tx.query("INSERT INTO stock_movements(id,product_id,qty,kind,device_id) VALUES($1,$2,$3,'opening',$4)", [newId(), id, p.openingStock, dev]);
  });
  return id;
}

/** Catalogue edit: bump the version so the change wins over older versions everywhere. */
export async function editProduct(db: Db, id: string, patch: { name?: string; priceCents?: number; active?: boolean }) {
  const dev = await deviceId(db);
  await db.query(
    `UPDATE products SET name=coalesce($2,name), price_cents=coalesce($3,price_cents), active=coalesce($4,active),
       version=version+1, updated_at=clock_timestamp(), updated_by_device=$5 WHERE id=$1`,
    [id, patch.name ?? null, patch.priceCents ?? null, patch.active ?? null, dev],
  );
}

export interface CartItem { productId: string; qty: number }

/** Offline-safe checkout: everything happens in one local transaction, no network. */
export async function checkout(db: Db, items: CartItem[], tenderedCents: number) {
  const dev = await deviceId(db);
  return db.transaction(async (tx) => {
    const [d] = await tx.query<{ order_prefix: string }>('SELECT order_prefix FROM devices WHERE id=$1', [dev]);
    const [{ next }] = await tx.query<{ next: number }>('SELECT coalesce(max(number_seq),0)+1 AS next FROM orders WHERE device_id=$1', [dev]);
    const orderId = newId();
    let total = 0;
    const lines: { id: string; productId: string; name: string; qty: number; price: number; lineTotal: number }[] = [];
    for (const it of items) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error('quantity must be a positive whole number');
      const [p] = await tx.query<{ name: string; price_cents: number }>('SELECT name, price_cents FROM products WHERE id=$1 AND active', [it.productId]);
      if (!p) throw new Error('unknown or inactive product');
      const lineTotal = p.price_cents * it.qty;
      total += lineTotal;
      lines.push({ id: newId(), productId: it.productId, name: p.name, qty: it.qty, price: p.price_cents, lineTotal });
    }
    if (tenderedCents < total) throw new Error('tendered amount is less than the total');
    const number = `${d.order_prefix}-${String(next).padStart(6, '0')}`;
    await tx.query('INSERT INTO orders(id,device_id,number_seq,number,total_cents) VALUES($1,$2,$3,$4,$5)', [orderId, dev, next, number, total]);
    for (const l of lines) {
      await tx.query('INSERT INTO order_lines(id,order_id,product_id,name,qty,unit_price_cents,line_total_cents) VALUES($1,$2,$3,$4,$5,$6,$7)', [l.id, orderId, l.productId, l.name, l.qty, l.price, l.lineTotal]);
      await tx.query("INSERT INTO stock_movements(id,product_id,qty,kind,ref_type,ref_id,device_id) VALUES($1,$2,$3,'sale','order',$4,$5)", [newId(), l.productId, -l.qty, orderId, dev]);
    }
    await tx.query("INSERT INTO order_payments(id,order_id,kind,amount_cents,tendered_cents,change_cents) VALUES($1,$2,'cash',$3,$4,$5)", [newId(), orderId, total, tenderedCents, tenderedCents - total]);
    return { orderId, number, totalCents: total, changeCents: tenderedCents - total };
  });
}

export async function stockLevels(db: Db) {
  return db.query<{ id: string; sku: string; name: string; price_cents: number; version: number; stock: number }>(
    `SELECT p.id, p.sku, p.name, p.price_cents, p.version, coalesce(sum(m.qty),0)::int AS stock
       FROM products p LEFT JOIN stock_movements m ON m.product_id=p.id WHERE p.active GROUP BY p.id ORDER BY p.sku`);
}

/** Products that went below zero because offline devices sold the same stock. Flagged, never blocked. */
export async function stockExceptions(db: Db) {
  return (await stockLevels(db)).filter((r) => r.stock < 0);
}

export async function recentOrders(db: Db, limit = 20) {
  return db.query<{ id: string; number: string; total_cents: number; created_at: string }>(
    'SELECT id, number, total_cents, created_at FROM orders ORDER BY created_at DESC, number_seq DESC LIMIT $1', [limit]);
}

/**
 * After restoring a backup onto a DIFFERENT device (or while the original may still be running), the copy must not
 * keep the original's identity, or both would issue the same order numbers. History is kept; the identity is new.
 * Restoring in place after a disaster (the original is gone) may keep the identity and skip this.
 */
export async function restoreAsNewDevice(db: Db, name: string): Promise<DeviceInfo> {
  return db.transaction(async (tx) => {
    const old = await deviceId(tx);
    const id = newId();
    const prefix = randomPrefix();
    await setMeta(tx, 'device_id', id);
    await tx.query('INSERT INTO devices(id,name,order_prefix) VALUES($1,$2,$3)', [id, name, prefix]);
    await tx.query('UPDATE outbox SET origin=$2 WHERE origin=$1', [old, id]); // unpushed history is pushed under the new identity
    await tx.query("DELETE FROM meta WHERE key='sync_registered'");            // register the new identity with the server
    return { id, name, prefix };
  });
}
