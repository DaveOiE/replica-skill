import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SYNCED_TABLES } from '../src/sync/apply';
import { connectServer, disconnectServer, getSyncStatus, syncOnce, StoreMergeError, SyncHttpError } from '../src/sync/client';
import { createSimpleProduct, editProduct, setUnitPrice, stockGrid, stockExceptions, stockOf } from '../src/services/catalogue';
import { createSale } from '../src/services/sales';
import { reconcileDuplicateSkus, keyExceptions } from '../src/sync/reconcile';
import { createHandlers } from '../server/handler';
import { SCHEMA_VERSION } from '../src/schema/migrations.generated';
import { getSetting, setSetting } from '../src/settings/service';
import { insertRow } from '../src/db/sql';
import { newId } from '../src/domain/ids';
import { getMeta, restoreAsNewDevice } from '../src/domain/store';
import { makeDevice, makeServer, connect, idOf, ADMIN_TOKEN, type TestDevice, type TestServer } from './helpers';

let server: TestServer;
beforeAll(async () => { server = await makeServer(); });
afterAll(async () => { await server.close(); });

const counts = async (db: TestDevice['db']) => {
  const out: Record<string, number> = {};
  for (const t of SYNCED_TABLES) out[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
  return out;
};
const cashId = (d: TestDevice) => idOf(d.db, "SELECT id FROM payment_types WHERE key='card'");
const product = (d: TestDevice, sku: string, price = 1000, stock = 10) => createSimpleProduct(d.ctx, { sku, name: sku, priceCents: price, openingStock: stock, taxGroupId: null });
const sell = async (d: TestDevice, pu: string, qty: number, price = 1000) =>
  createSale(d.ctx, { lines: [{ productUnitId: pu, qty }], payments: [{ paymentTypeId: await cashId(d), amountCents: price * qty }] });
const syncSeq = async (...ds: TestDevice[]) => { for (const d of ds) await syncOnce(d.db); };

describe('mode 1 -> server with no data loss', () => {
  it('a standalone shop with history pairs, pushes everything, and a joining device receives it all', async () => {
    const a = await makeDevice('till-A', { seed: true });
    const p = await product(a, 'C1', 700, 30);
    await sell(a, p.productUnitId, 3, 700); await sell(a, p.productUnitId, 1, 700);
    const before = await counts(a.db);

    expect((await getSyncStatus(a.db)).state).toBe('standalone');
    await connect(a, server);
    expect((await getSyncStatus(a.db)).pending).toBeGreaterThan(100);
    const r = await syncOnce(a.db);
    expect(r.pushed).toBeGreaterThan(100);
    expect((await getSyncStatus(a.db)).state).toBe('synced');
    const onServer = await counts(server.db);
    for (const t of SYNCED_TABLES) expect(onServer[t], t).toBeGreaterThanOrEqual(before[t]);

    const b = await makeDevice('till-B');            // a JOINING device: it never seeds
    await connect(b, server); await syncOnce(b.db);
    expect(await stockOf(b.db, p.productUnitId)).toBe('26.00000');
    expect((await b.db.query('SELECT 1 FROM orders WHERE device_id = $1', [a.info.id])).length).toBe(2);
    expect(await getSetting(b.db, 'rounding')).toEqual(await getSetting(a.db, 'rounding'));   // settings travel too
    expect((await b.db.query('SELECT 1 FROM roles')).length).toBe(3);
    const asB = (await stockGrid(b.db)).find((g) => g.sku === 'C1')!;
    expect(asB.stock).toBe('26.00000');
  });

  it('only synced tables ever leave a device', async () => {
    const tables = (await server.db.query<{ t: string }>('SELECT DISTINCT table_name AS t FROM outbox')).map((r) => r.t);
    expect(tables.every((t) => SYNCED_TABLES.includes(t))).toBe(true);
    expect((await server.db.query('SELECT 1 FROM held_orders')).length).toBe(0);
    expect((await server.db.query('SELECT 1 FROM device_secrets')).length).toBe(0);
  });

  it('seeded rows have deterministic ids, so two shops that each seeded independently merge without duplicates', async () => {
    const a = await makeDevice('seed-A', { seed: true }), b = await makeDevice('seed-B', { seed: true });
    const s = await makeServer();
    try {
      await connect(a, s, 'merge'); await connect(b, s, 'merge');
      await syncSeq(a, b, a);
      for (const t of ['categories', 'units', 'taxes', 'tax_groups', 'payment_types', 'order_types', 'roles', 'customer_groups']) {
        const [{ n }] = await a.db.query<{ n: number }>(`SELECT count(*)::int n FROM ${t}`);
        const [{ d }] = await a.db.query<{ d: number }>(`SELECT count(DISTINCT id)::int d FROM ${t}`);
        expect(n, t).toBe(d);
      }
      expect((await a.db.query("SELECT 1 FROM categories WHERE name = 'Drinks'")).length).toBe(1);
      expect(await counts(a.db)).toEqual(await counts(b.db));
    } finally { await s.close(); }
  });

  it('syncing again moves nothing; replaying a whole push is harmless', async () => {
    const a = await makeDevice('till-idem', { seed: true });
    const p = await product(a, 'ID1', 100, 5); await sell(a, p.productUnitId, 1, 100);
    await connect(a, server); await syncOnce(a.db);
    expect(await syncOnce(a.db)).toEqual({ pushed: 0, pulled: expect.any(Number) });
    await a.db.query("UPDATE meta SET value='0' WHERE key='sync_pushed_seq'");
    const before = await counts(server.db);
    const replay = await syncOnce(a.db);
    expect(replay.pushed).toBeGreaterThan(50);
    expect(await counts(server.db)).toEqual(before);
  });

  it('switching away and back: disconnect keeps the full local copy', async () => {
    const a = await makeDevice('till-back', { seed: true });
    const p = await product(a, 'BK1', 100, 5);
    await connect(a, server); await syncOnce(a.db);
    await disconnectServer(a.db);
    expect((await getSyncStatus(a.db)).state).toBe('standalone');
    await sell(a, p.productUnitId, 1, 100);
    expect(await stockOf(a.db, p.productUnitId)).toBe('4.00000');
  });
});

describe('two devices working offline', () => {
  it('stock converges, overselling is flagged and not blocked, numbers never collide', async () => {
    const a = await makeDevice('till-A2', { seed: true }); const b = await makeDevice('till-B2');
    const p = await product(a, 'S1', 1000, 10);
    await connect(a, server); await connect(b, server); await syncSeq(a, b);
    expect(await stockOf(b.db, p.productUnitId)).toBe('10.00000');
    await sell(a, p.productUnitId, 7); await sell(b, p.productUnitId, 6);         // both offline; each sees 10
    await syncSeq(a, b, a);
    for (const db of [a.db, b.db, server.db]) expect(await stockOf(db, p.productUnitId), 'every copy agrees').toBe('-3.00000');
    expect((await stockExceptions(a.db)).map((r) => r.sku)).toContain('S1');
    const nums = (await server.db.query<{ number: string }>('SELECT number FROM orders WHERE device_id = ANY($1)', [[a.info.id, b.info.id]])).map((r) => r.number);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('concurrent price edits resolve to the same winner on every copy; an older version never overwrites a newer one', async () => {
    const a = await makeDevice('till-A3', { seed: true }); const b = await makeDevice('till-B3');
    const p = await product(a, 'L1', 400, 5);
    await connect(a, server); await connect(b, server); await syncSeq(a, b);
    await setUnitPrice(a.ctx, p.productUnitId, 450);
    await new Promise((r) => setTimeout(r, 15));
    await setUnitPrice(b.ctx, p.productUnitId, 500);             // later, same base version
    await syncSeq(a, b, a, b);
    const price = async (db: TestDevice['db']) => (await db.query<any>('SELECT price_sale_cents, version FROM product_units WHERE id=$1', [p.productUnitId]))[0];
    expect(await price(a.db)).toEqual(await price(b.db)); expect(await price(a.db)).toEqual(await price(server.db));
    expect((await price(a.db)).price_sale_cents).toBe(500);

    const q = await product(a, 'V1', 100, 5);
    await syncSeq(a, b);
    await setUnitPrice(a.ctx, q.productUnitId, 200); await setUnitPrice(a.ctx, q.productUnitId, 300);   // v3
    await setUnitPrice(b.ctx, q.productUnitId, 999);                                                   // v2, made later in wall-clock time
    await syncSeq(b, a, b);
    for (const db of [a.db, b.db, server.db]) expect((await db.query<any>('SELECT price_sale_cents FROM product_units WHERE id=$1', [q.productUnitId]))[0].price_sale_cents).toBe(300);
  });

  it('a setting edited on one device reaches the others', async () => {
    const a = await makeDevice('till-A4', { seed: true }); const b = await makeDevice('till-B4');
    await connect(a, server); await connect(b, server); await syncSeq(a, b);
    const r = await getSetting(a.db, 'rounding');
    await setSetting(a.ctx, 'rounding', { ...r, mode: 'half_even' });
    await syncSeq(a, b);
    expect((await getSetting(b.db, 'rounding')).mode).toBe('half_even');
    await setSetting(a.ctx, 'rounding', r); await syncSeq(a, b);
  });

  it('the stock-level cache and order status on a receiving device follow the synced rows', async () => {
    const a = await makeDevice('till-A5', { seed: true }); const b = await makeDevice('till-B5');
    const p = await product(a, 'ST1', 100, 8); const o = await sell(a, p.productUnitId, 2, 100);
    await connect(a, server); await connect(b, server); await syncSeq(a, b);
    expect(await stockOf(b.db, p.productUnitId)).toBe('6.00000');
    expect((await b.db.query<any>('SELECT payment_status FROM order_state WHERE order_id=$1', [o.orderId]))[0].payment_status).toBe('paid');
  });
});

describe('order-number prefixes', () => {
  it('a prefix clash at pairing changes the newcomer for FUTURE orders only', async () => {
    const a = await makeDevice('till-A6', { seed: true }); const b = await makeDevice('till-B6', { seed: true });
    await connect(a, server); await syncOnce(a.db);
    const pb = await product(b, 'P6', 100, 5);
    const old = await sell(b, pb.productUnitId, 1, 100);
    await b.db.query('UPDATE devices SET order_prefix=$2 WHERE id=$1', [b.info.id, a.info.prefix]);      // force the clash
    await connect(b, server, 'merge'); await syncOnce(b.db);
    const [now] = await b.db.query<{ order_prefix: string }>('SELECT order_prefix FROM devices WHERE id=$1', [b.info.id]);
    expect(now.order_prefix).not.toBe(a.info.prefix);
    const next = await sell(b, pb.productUnitId, 1, 100);
    expect(next.number.startsWith(now.order_prefix)).toBe(true);
    expect((await b.db.query<any>('SELECT number FROM orders WHERE id=$1', [old.orderId]))[0].number).toBe(old.number);   // old receipts keep their number
  });
});

describe('failure and scale', () => {
  it('while the server is unreachable nothing is lost; sync resumes where it stopped', async () => {
    const a = await makeDevice('till-A7', { seed: true });
    const p = await product(a, 'F1', 100, 9);
    await connect(a, server); await syncOnce(a.db);
    await sell(a, p.productUnitId, 2, 100);
    const down = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    await expect(syncOnce(a.db, { fetch: down })).rejects.toThrow('network down');
    const st = await getSyncStatus(a.db);
    expect(st.state).toBe('error'); expect(st.pending).toBeGreaterThan(0);
    expect((await getSyncStatus(a.db, false)).state).toBe('offline');
    await syncOnce(a.db);
    expect((await getSyncStatus(a.db)).state).toBe('synced');
    expect(await stockOf(server.db, p.productUnitId)).toBe('7.00000');
  });

  it('pages through more than one batch in both directions (about 800 change rows, batches of 200)', async () => {
    const a = await makeDevice('till-A8', { seed: true }); const b = await makeDevice('till-B8');
    const p = await product(a, 'BIG', 10, 1000);
    for (let i = 0; i < 90; i++) await sell(a, p.productUnitId, 1, 10);
    await connect(a, server); await connect(b, server);
    const r = await syncOnce(a.db);
    expect(r.pushed).toBeGreaterThan(600);
    const rb = await syncOnce(b.db);
    expect(rb.pulled).toBeGreaterThan(600);
    expect(await stockOf(b.db, p.productUnitId)).toBe('910.00000');
    expect((await b.db.query<any>('SELECT count(*)::int n FROM orders WHERE device_id=$1', [a.info.id]))[0].n).toBe(90);
  });
});

describe('schema-version handshake', () => {
  const rewriteSchema = (version: string): typeof fetch => (async (url: any, init: any = {}) => {
    const h = { ...(init.headers ?? {}) }; if ('x-schema-version' in h) h['x-schema-version'] = version;
    const res = await fetch(url, { ...init, headers: h });
    if (String(url).endsWith('/sync/info')) { const body = await res.json(); return new Response(JSON.stringify({ ...body, schemaVersion: version }), { status: 200 }); }
    return res;
  }) as typeof fetch;

  it('a device on a different schema is told to update, not allowed to corrupt the store', async () => {
    const a = await makeDevice('till-old', { seed: true });
    await connect(a, server); await syncOnce(a.db);
    await sell(a, (await product(a, 'H1', 100, 3)).productUnitId, 1, 100);
    await expect(syncOnce(a.db, { fetch: rewriteSchema('0000000000000000') })).rejects.toBeInstanceOf(SyncHttpError);
    const st = await getSyncStatus(a.db);
    expect(st.state).toBe('update-required'); expect(st.lastError).toContain('schema_mismatch'); expect(st.pending).toBeGreaterThan(0);
    await syncOnce(a.db);                                  // after updating, everything flows
    expect((await getSyncStatus(a.db)).state).toBe('synced');
  });
  it('pairing is refused up front on a mismatch', async () => {
    const a = await makeDevice('till-old2');
    await expect(connectServer(a.db, { url: server.url, pairingCode: await server.pairingCode(), fetch: rewriteSchema('1111111111111111') })).rejects.toMatchObject({ status: 426 });
  });
  it('the server reports its own version', async () => {
    expect((await (await fetch(server.url + '/sync/info')).json()).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('store identity guard', () => {
  it('an empty joining device may connect to a server that has data without ceremony', async () => {
    await expect(connect(await makeDevice('join-ok'), server, null)).resolves.toBeTruthy();
  });
  it('a device with its own history will not silently merge into a server that already has a different shop\'s data', async () => {
    const mine = await makeDevice('has-history', { seed: true });
    await product(mine, 'MINE', 100, 1);
    await expect(connect(mine, server, null)).rejects.toBeInstanceOf(StoreMergeError);
    await expect(connect(mine, server, null)).rejects.toMatchObject({ reason: 'server_has_other_data' });
    expect(await getMeta(mine.db, 'sync_url')).toBeNull();                // nothing was changed by the refusal
    await expect(connect(mine, server, 'merge')).resolves.toBeTruthy();
  });
  it('a device that belongs to one store refuses a server of another unless told to migrate', async () => {
    const other = await makeServer();
    try {
      const a = await makeDevice('moves', { seed: true });
      const p = await product(a, 'MV', 100, 4); await sell(a, p.productUnitId, 1, 100);
      await connect(a, server, 'merge'); await syncOnce(a.db);
      const store1 = await getMeta(a.db, 'store_id');
      await expect(connect(a, other, null)).rejects.toMatchObject({ reason: 'different_store' });
      await connect(a, other, 'migrate');                           // the new, empty server receives the whole history from the start
      expect(await getMeta(a.db, 'store_id')).not.toBe(store1);
      await syncOnce(a.db);
      expect(await stockOf(other.db, p.productUnitId)).toBe('3.00000');
      expect((await other.db.query('SELECT 1 FROM orders')).length).toBeGreaterThanOrEqual(1);
    } finally { await other.close(); }
  });
});

describe('pairing codes and per-device tokens', () => {
  const clock = { t: new Date('2026-06-15T00:00:00Z') };
  const handlers = () => createHandlers(server.db, { adminToken: ADMIN_TOKEN, now: () => clock.t });
  const pairBody = (code: string, over: Record<string, string> = {}) => ({ code, deviceId: newId(), name: 'x', orderPrefix: Math.random().toString(36).slice(2, 6).toUpperCase().replace(/[^A-Z]/g, 'Q').padEnd(4, 'Q'), schemaVersion: SCHEMA_VERSION, ...over });

  it('a wrong code is refused and tells the caller nothing else', async () => {
    const r = await (await fetch(server.url + '/sync/pair', { method: 'POST', body: JSON.stringify(pairBody('AAAA-AAAA')) })).json();
    expect(r).toEqual({ error: 'invalid_or_expired_code' });
  });
  it('a code works once', async () => {
    const code = await server.pairingCode();
    const body = pairBody(code);
    const ok = await fetch(server.url + '/sync/pair', { method: 'POST', body: JSON.stringify(body) });
    expect(ok.status).toBe(200);
    const again = await fetch(server.url + '/sync/pair', { method: 'POST', body: JSON.stringify(pairBody(code)) });
    expect(again.status).toBe(403);
  });
  it('a code expires after 15 minutes', async () => {
    const h = handlers();
    const { body } = await h.createPairingCode('late');
    const code = (body as any).code as string;
    clock.t = new Date(clock.t.getTime() + 16 * 60_000);
    expect((await h.pair(pairBody(code))).status).toBe(403);
    clock.t = new Date('2026-06-15T00:00:00Z');
  });
  it('a prefix clash does not spend the code', async () => {
    const h = handlers();
    const code = ((await h.createPairingCode('p')).body as any).code as string;
    const taken = (await server.db.query<{ order_prefix: string }>('SELECT order_prefix FROM devices LIMIT 1'))[0].order_prefix;
    expect((await h.pair(pairBody(code, { orderPrefix: taken }))).status).toBe(409);
    expect((await h.pair(pairBody(code, { orderPrefix: 'ZZZZ' }))).status).toBe(200);
  });
  it('guessing is slowed: twenty bad codes in a minute and the door closes', async () => {
    const h = handlers();
    for (let i = 0; i < 20; i++) expect((await h.pair(pairBody('NOPE-NOPE'))).status).toBe(403);
    expect((await h.pair(pairBody('NOPE-NOPE'))).status).toBe(429);
    clock.t = new Date(clock.t.getTime() + 61_000);
    expect((await h.pair(pairBody('NOPE-NOPE'))).status).toBe(403);
    clock.t = new Date('2026-06-15T00:00:00Z');
  });
  it('sync needs a device token; none, a junk token, or the admin token is refused', async () => {
    for (const auth of [undefined, 'Bearer junk', `Bearer ${ADMIN_TOKEN}`]) {
      const res = await fetch(server.url + '/sync/pull?since=0', { headers: { ...(auth ? { authorization: auth } : {}), 'x-schema-version': SCHEMA_VERSION } });
      expect(res.status, String(auth)).toBe(401);
    }
  });
  it('admin routes need the admin token, and a device token cannot use them', async () => {
    const a = await makeDevice('tok', { seed: true }); await connect(a, server);
    const dev = await getMeta(a.db, 'device_token');
    const asDevice = await fetch(server.url + '/admin/pairing-codes', { method: 'POST', headers: { authorization: `Bearer ${dev}` }, body: '{}' });
    expect(asDevice.status).toBe(401);
    expect((await fetch(server.url + '/admin/pairing-codes', { method: 'POST', body: '{}' })).status).toBe(401);
  });
  it('a device cannot pass its changes off as another device\'s: origin comes from the token', async () => {
    const a = await makeDevice('honest', { seed: true }); const p = await product(a, 'ORI', 100, 1);
    await connect(a, server); await syncOnce(a.db);
    const rows = await server.db.query<{ origin: string }>('SELECT DISTINCT origin FROM outbox WHERE row_id = $1', [p.productId]);
    expect(rows.map((r) => r.origin)).toEqual([a.info.id]);
  });
  it('a revoked device is locked out and says so, but keeps its data and keeps trading', async () => {
    const a = await makeDevice('revoked', { seed: true });
    const p = await product(a, 'RV', 100, 3);
    await connect(a, server); await syncOnce(a.db);
    await server.adminPost(`/admin/devices/${a.info.id}/revoke`);
    await sell(a, p.productUnitId, 1, 100);
    await expect(syncOnce(a.db)).rejects.toMatchObject({ status: 401 });
    expect((await getSyncStatus(a.db)).state).toBe('unauthorised');
    expect(await stockOf(a.db, p.productUnitId)).toBe('2.00000');
  });
});

describe('duplicate keys across offline devices', () => {
  it('the same SKU created on two devices becomes one product on every copy, with the stock of both', async () => {
    const a = await makeDevice('dup-A', { seed: true }); const b = await makeDevice('dup-B');
    await connect(a, server); await connect(b, server); await syncSeq(a, b);
    const pa = await product(a, 'DUP-1', 100, 5), pb = await product(b, 'dup-1 ', 100, 3);   // case and spaces do not matter
    const sold = await sell(b, pb.productUnitId, 1, 100);
    await syncSeq(a, b, a, b);
    for (const d of [a, b]) {
      const grid = (await stockGrid(d.db)).filter((g) => g.sku.trim().toLowerCase() === 'dup-1');
      expect(grid, 'one product in the grid').toHaveLength(1);
      expect(grid[0].stock).toBe('7.00000');             // 5 + (3 - 1)
    }
    expect((await a.db.query('SELECT 1 FROM product_merges')).length).toBeGreaterThanOrEqual(1);
    expect(await reconcileDuplicateSkus(a.db, a.info.id)).toBe(0);   // nothing left to do
    expect((await a.db.query('SELECT 1 FROM order_lines WHERE order_id = $1', [sold.orderId])).length).toBe(1);   // history untouched
    const winner = [pa.productId, pb.productId].sort()[0];
    expect((await a.db.query<any>('SELECT winner_id FROM product_merges WHERE id <> $1 AND winner_id = $1 LIMIT 1', [winner])).length).toBe(1);
  });
  it('merges follow chains: a later product with a smaller id absorbs the earlier winner', async () => {
    const d = await makeDevice('chain', { seed: true });
    const mk = async (id: string, stock: number) => {
      await insertRow(d.db, 'products', { id, sku: 'CHAIN', name: 'c', updated_by_device: d.info.id });
      const pu = newId(); const unit = await idOf(d.db, "SELECT id FROM units WHERE name='Each'");
      await insertRow(d.db, 'product_units', { id: pu, product_id: id, unit_id: unit, price_sale_cents: 100, updated_by_device: d.info.id });
      await insertRow(d.db, 'stock_movements', { id: newId(), device_id: d.info.id, product_unit_id: pu, qty: String(stock), kind: 'opening' });
    };
    await mk('88888888-0000-4000-8000-000000000001', 1); await mk('ffffffff-0000-4000-8000-000000000002', 2);
    await reconcileDuplicateSkus(d.db, d.info.id);
    await mk('11111111-0000-4000-8000-000000000003', 4);          // arrives later, smaller id
    await reconcileDuplicateSkus(d.db, d.info.id);
    const grid = (await stockGrid(d.db)).filter((g) => g.sku === 'CHAIN');
    expect(grid).toHaveLength(1);
    expect(grid[0].product_id).toBe('11111111-0000-4000-8000-000000000003');
    expect(grid[0].stock).toBe('7.00000');
  });
  it('clashes that need a person are reported, never auto-fixed', async () => {
    const d = await makeDevice('exc', { seed: true });
    await product(d, 'X1', 100, 1); await product(d, 'X2', 100, 1);
    await d.db.query("UPDATE product_units SET barcode = '9300000000017'");
    await insertRow(d.db, 'users', { id: newId(), username: 'Sam', display_name: 's', password_hash: 'x', updated_by_device: d.info.id });
    await insertRow(d.db, 'users', { id: newId(), username: 'sam', display_name: 's', password_hash: 'x', updated_by_device: d.info.id });
    const reg = newId();
    await insertRow(d.db, 'registers', { id: reg, name: 'R1', updated_by_device: d.info.id });
    for (let i = 0; i < 2; i++) await insertRow(d.db, 'register_sessions', { id: newId(), device_id: d.info.id, register_id: reg });
    const ex = await keyExceptions(d.db);
    expect(ex.map((e) => e.kind).sort()).toEqual(['barcode', 'open_register_sessions', 'username']);
    expect(ex.find((e) => e.kind === 'barcode')!.key).toBe('9300000000017');
    expect((await d.db.query('SELECT 1 FROM users WHERE active')).length).toBe(2);     // nothing was changed
  });
});

describe('restoring a device', () => {
  it('a restored copy gets a new identity so order numbers cannot clash, and syncs under it', async () => {
    const orig = await makeDevice('orig', { seed: true });
    const p = await product(orig, 'RS', 100, 20); await sell(orig, p.productUnitId, 1, 100);
    await connect(orig, server); await syncOnce(orig.db);
    const copy = await makeDevice('copy');
    // simulate a physical restore: the copy holds the original's database and identity
    const dump = await orig.pg.dumpDataDir('gzip');
    const { createPglite, fromPglite } = await import('../src/db/pglite');
    const restored = createPglite(undefined, { loadDataDir: dump });
    const rdb = fromPglite(restored);
    const o2 = await sell(orig, p.productUnitId, 1, 100);
    const id = await restoreAsNewDevice(rdb, 'restored');
    expect(id.id).not.toBe(orig.info.id);
    const rctx = { ...orig.ctx, db: rdb, deviceId: id.id };
    const c1 = await createSale(rctx, { lines: [{ productUnitId: p.productUnitId, qty: 1 }], payments: [{ paymentTypeId: await idOf(rdb, "SELECT id FROM payment_types WHERE key='card'"), amountCents: 100 }] });
    expect(c1.number).toBe(`${id.prefix}-000001`);
    await connectServer(rdb, { url: server.url, pairingCode: await server.pairingCode('restored'), confirm: 'merge' });
    await syncOnce(rdb); await syncOnce(orig.db); await syncOnce(rdb);
    const nums = (await server.db.query<{ number: string }>('SELECT number FROM orders WHERE device_id = ANY($1)', [[orig.info.id, id.id]])).map((r) => r.number);
    expect(new Set(nums).size).toBe(nums.length); expect(nums).toContain(o2.number); expect(nums).toContain(c1.number);
    expect(await stockOf(orig.db, p.productUnitId)).toBe('17.00000');
    void copy; void editProduct;
  });
});
