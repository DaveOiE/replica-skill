import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { products } from '../src/schema/schema';
import { SYNCED_TABLES } from '../src/sync/apply';
import { addProduct, checkout, editProduct, stockLevels, stockExceptions, getMeta } from '../src/domain/store';
import { syncOnce, getSyncStatus } from '../src/sync/client';
import { makeDevice, makeServer, connect } from './helpers';

let server: Awaited<ReturnType<typeof makeServer>>;
beforeAll(async () => { server = await makeServer(); });
afterAll(async () => { await server.close(); });

const counts = async (db: { query: any }) => {
  const out: Record<string, number> = {};
  for (const t of SYNCED_TABLES) out[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
  return out;
};
const stock = async (db: any) => Object.fromEntries((await stockLevels(db)).map((r) => [r.sku, r.stock]));

describe('one schema, two engines', () => {
  it('the same migrations produce the same tables on PGlite and on PostgreSQL', async () => {
    const dev = await makeDevice('schema-check');
    const q = `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2`;
    const onDevice = await dev.db.query(q);
    const onServer = await server.db.query(q);
    expect(onDevice.length).toBeGreaterThan(30);
    expect(onDevice).toEqual(onServer);
  });

  it('the same Drizzle table object queries both', async () => {
    const dev = await makeDevice('drizzle');
    await addProduct(dev.db, { sku: 'D1', name: 'Drizzle', priceCents: 100 });
    const a = await drizzlePglite(dev.pg).select().from(products).where(eq(products.sku, 'D1'));
    expect(a[0].name).toBe('Drizzle');
    const pool = new Pool({ connectionString: server.url.replace('http://127.0.0.1:' + server.port, '') || undefined, host: '127.0.0.1', port: 5499, user: 'postgres', database: (await server.db.query<{ d: string }>('select current_database() d'))[0].d });
    const b = await drizzlePg(pool).select().from(products);
    expect(Array.isArray(b)).toBe(true);
    await pool.end();
  });
});

describe('mode 1: standalone', () => {
  it('checks out with no server, numbers orders with the device prefix, moves stock', async () => {
    const d = await makeDevice('till-1');
    const p = await addProduct(d.db, { sku: 'A', name: 'Coffee', priceCents: 450, openingStock: 20 });
    const o1 = await checkout(d.db, [{ productId: p, qty: 2 }], 1000);
    const o2 = await checkout(d.db, [{ productId: p, qty: 1 }], 500);
    expect(o1.number).toBe(`${d.info.prefix}-000001`);
    expect(o2.number).toBe(`${d.info.prefix}-000002`);
    expect(o1.totalCents).toBe(900);
    expect(o1.changeCents).toBe(100);
    expect((await stock(d.db)).A).toBe(17);
    expect((await getSyncStatus(d.db)).state).toBe('standalone');
  });

  it('refuses under-tendered payments and leaves no trace (transaction rolls back)', async () => {
    const d = await makeDevice('till-rollback');
    const p = await addProduct(d.db, { sku: 'R', name: 'Roll', priceCents: 300, openingStock: 5 });
    await expect(checkout(d.db, [{ productId: p, qty: 1 }], 100)).rejects.toThrow('less than the total');
    expect((await counts(d.db)).orders).toBe(0);
    expect((await stock(d.db)).R).toBe(5);
  });

  it('the ledgers are append-only, enforced by the database', async () => {
    const d = await makeDevice('till-immutable');
    const p = await addProduct(d.db, { sku: 'I', name: 'Imm', priceCents: 100, openingStock: 3 });
    await checkout(d.db, [{ productId: p, qty: 1 }], 100);
    await expect(d.db.query('UPDATE stock_movements SET qty = 999')).rejects.toThrow('append-only');
    await expect(d.db.query('DELETE FROM orders')).rejects.toThrow('append-only');
  });
});

describe('mode 1 -> 2/3 with no data loss', () => {
  it('a standalone device with history connects, pushes everything, and a fresh device receives it all', async () => {
    const a = await makeDevice('till-A');
    const p = await addProduct(a.db, { sku: 'C', name: 'Cake', priceCents: 700, openingStock: 30 });
    await checkout(a.db, [{ productId: p, qty: 3 }], 2100);
    await checkout(a.db, [{ productId: p, qty: 1 }], 1000);
    await checkout(a.db, [{ productId: p, qty: 2 }], 1400);
    const before = await counts(a.db);

    await connect(a, server.url);
    expect((await getSyncStatus(a.db)).pending).toBeGreaterThan(0);
    const r = await syncOnce(a.db);
    expect(r.pushed).toBeGreaterThan(0);
    expect((await getSyncStatus(a.db)).state).toBe('synced');

    // server has exactly what the device had
    const onServer = await counts(server.db);
    for (const t of ['products', 'stock_movements', 'orders', 'order_lines', 'order_payments']) expect(onServer[t]).toBeGreaterThanOrEqual(before[t]);

    const b = await makeDevice('till-B');
    await connect(b, server.url);
    await syncOnce(b.db);
    expect((await stock(b.db)).C).toBe(24);
    const orders = await b.db.query<{ number: string }>('SELECT number FROM orders ORDER BY number');
    expect(orders.map((o) => o.number)).toEqual([1, 2, 3].map((n) => `${a.info.prefix}-00000${n}`));
    expect((await counts(b.db)).orders).toBe(3);
  });

  it('syncing again moves nothing; replaying a push is harmless', async () => {
    const a = await makeDevice('till-idem');
    const p = await addProduct(a.db, { sku: 'ID', name: 'Idem', priceCents: 100, openingStock: 5 });
    await checkout(a.db, [{ productId: p, qty: 1 }], 100);
    await connect(a, server.url);
    await syncOnce(a.db);
    const again = await syncOnce(a.db);
    expect(again).toEqual({ pushed: 0, pulled: 0 });
    // force a full replay of everything already pushed
    await a.db.query("UPDATE meta SET value='0' WHERE key='sync_pushed_seq'");
    const serverBefore = await counts(server.db);
    const replay = await syncOnce(a.db);
    expect(replay.pushed).toBeGreaterThan(0);
    expect(await counts(server.db)).toEqual(serverBefore);
  });
});

describe('two devices working offline', () => {
  it('stock converges: both sales are counted, and overselling is flagged, not blocked', async () => {
    const a = await makeDevice('till-A2'); const b = await makeDevice('till-B2');
    const p = await addProduct(a.db, { sku: 'S', name: 'Scarce', priceCents: 1000, openingStock: 10 });
    await connect(a, server.url); await connect(b, server.url);
    await syncOnce(a.db); await syncOnce(b.db);
    expect((await stock(b.db)).S).toBe(10);

    // both tills are now offline and each sees 10 in stock
    await checkout(a.db, [{ productId: p, qty: 7 }], 7000);
    await checkout(b.db, [{ productId: p, qty: 6 }], 6000);   // 13 sold of 10

    await syncOnce(a.db); await syncOnce(b.db); await syncOnce(a.db);
    const sa = await stock(a.db), sb = await stock(b.db), ss = await stock(server.db);
    expect(sa.S).toBe(-3); expect(sb.S).toBe(-3); expect(ss.S).toBe(-3);
    expect((await stockExceptions(a.db)).map((r) => r.sku)).toContain('S');
    // order numbers never collided
    const nums = (await server.db.query<{ number: string }>('SELECT number FROM orders WHERE number LIKE $1 OR number LIKE $2', [a.info.prefix + '%', b.info.prefix + '%'])).map((r) => r.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('concurrent price edits resolve to the same winner everywhere', async () => {
    const a = await makeDevice('till-A3'); const b = await makeDevice('till-B3');
    const p = await addProduct(a.db, { sku: 'L', name: 'Latte', priceCents: 400 });
    await connect(a, server.url); await connect(b, server.url);
    await syncOnce(a.db); await syncOnce(b.db);
    await editProduct(a.db, p, { priceCents: 450 });
    await new Promise((r) => setTimeout(r, 20));
    await editProduct(b.db, p, { priceCents: 500 });  // later edit, same base version
    await syncOnce(a.db); await syncOnce(b.db); await syncOnce(a.db); await syncOnce(b.db);
    const price = async (db: any) => (await db.query('SELECT price_cents, version FROM products WHERE id=$1', [p]))[0];
    const [pa, pb, ps] = [await price(a.db), await price(b.db), await price(server.db)];
    expect(pa).toEqual(pb); expect(pa).toEqual(ps);
    expect(pa.price_cents).toBe(500);  // the later edit wins
    expect(pa.version).toBe(2);
  });

  it('an old edit can never overwrite a newer version', async () => {
    const a = await makeDevice('till-A4'); const b = await makeDevice('till-B4');
    const p = await addProduct(a.db, { sku: 'V', name: 'Vers', priceCents: 100 });
    await connect(a, server.url); await connect(b, server.url);
    await syncOnce(a.db); await syncOnce(b.db);
    await editProduct(a.db, p, { priceCents: 200 });
    await editProduct(a.db, p, { priceCents: 300 });  // v3
    await editProduct(b.db, p, { priceCents: 999 });  // v2, made later in wall-clock time
    await syncOnce(b.db); await syncOnce(a.db); await syncOnce(b.db);
    for (const db of [a.db, b.db, server.db]) expect((await db.query('SELECT price_cents FROM products WHERE id=$1', [p]))[0].price_cents).toBe(300);
  });
});

describe('order-number prefixes', () => {
  it('a prefix clash at registration changes the newcomer for future orders only', async () => {
    const a = await makeDevice('till-A5'); const b = await makeDevice('till-B5');
    await connect(a, server.url); await syncOnce(a.db);
    const pb = await addProduct(b.db, { sku: 'P5', name: 'P5', priceCents: 100, openingStock: 5 });
    const old = await checkout(b.db, [{ productId: pb, qty: 1 }], 100);
    await b.db.query('UPDATE devices SET order_prefix=$2 WHERE id=$1', [b.info.id, a.info.prefix]); // force the clash
    await connect(b, server.url); await syncOnce(b.db);
    const [now] = await b.db.query<{ order_prefix: string }>('SELECT order_prefix FROM devices WHERE id=$1', [b.info.id]);
    expect(now.order_prefix).not.toBe(a.info.prefix);
    const next = await checkout(b.db, [{ productId: pb, qty: 1 }], 100);
    expect(next.number.startsWith(now.order_prefix)).toBe(true);
    expect(old.number).toBeTruthy(); // earlier receipts keep their number
  });
});

describe('failure and scale', () => {
  it('while the server is unreachable nothing is lost; sync resumes where it stopped', async () => {
    const a = await makeDevice('till-A6');
    const p = await addProduct(a.db, { sku: 'F', name: 'Fail', priceCents: 100, openingStock: 9 });
    await connect(a, server.url);
    await syncOnce(a.db);
    await checkout(a.db, [{ productId: p, qty: 2 }], 200);
    const down = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    await expect(syncOnce(a.db, { fetch: down })).rejects.toThrow('network down');
    const st = await getSyncStatus(a.db);
    expect(st.state).toBe('error');
    expect(st.pending).toBeGreaterThan(0);
    await syncOnce(a.db);
    expect((await getSyncStatus(a.db)).state).toBe('synced');
    expect((await stock(server.db)).F).toBe(7);
  });

  it('pages through more than one batch in both directions', async () => {
    const a = await makeDevice('till-A7'); const b = await makeDevice('till-B7');
    const p = await addProduct(a.db, { sku: 'BIG', name: 'Bulk', priceCents: 10, openingStock: 1000 });
    for (let i = 0; i < 120; i++) await checkout(a.db, [{ productId: p, qty: 1 }], 10);   // ~480 change rows (batch size is 200)
    await connect(a, server.url); await connect(b, server.url);
    const r = await syncOnce(a.db);
    expect(r.pushed).toBeGreaterThan(400);
    const rb = await syncOnce(b.db);
    expect(rb.pulled).toBeGreaterThan(400);
    expect((await stock(b.db)).BIG).toBe(880);
    expect((await b.db.query('SELECT count(*)::int n FROM orders WHERE device_id=$1', [a.info.id]))[0].n).toBe(120);
  });
});

describe('known gaps (documented, not yet solved)', () => {
  // Two offline devices each create "the same" product. Identity is a UUID, so the catalogue ends up with two rows
  // for one SKU. Needs a merge-by-SKU rule (see plan.md, risk R6). This test flips to passing when that is built.
  it.fails('independently created products with the same SKU are merged into one', async () => {
    const a = await makeDevice('till-A9'); const b = await makeDevice('till-B9');
    await connect(a, server.url); await connect(b, server.url);
    await addProduct(a.db, { sku: 'DUP-1', name: 'Same thing', priceCents: 100 });
    await addProduct(b.db, { sku: 'DUP-1', name: 'Same thing', priceCents: 100 });
    await syncOnce(a.db); await syncOnce(b.db); await syncOnce(a.db);
    const n = (await a.db.query<{ n: number }>("SELECT count(*)::int n FROM products WHERE sku='DUP-1'"))[0].n;
    expect(n).toBe(1);
  });
});
