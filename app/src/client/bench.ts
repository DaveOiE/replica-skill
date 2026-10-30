// Device speed test. Builds a TEMPORARY shop in its own database (never the real one), does the things a till does,
// and reports timings plus what the device is. Run on the actual tablet or PC; results are only meaningful there.
import { createPglite, closePglite, fromPglite } from '../db/pglite';
import { migrate } from '../db/migrate';
import { initDevice } from '../domain/store';
import { startNewStore } from '../installer';
import { stockGrid } from '../services/catalogue';
import { createSale, quoteSale } from '../services/sales';
import { createBus } from '../events/bus';
import { insertRow } from '../db/sql';
import { newId } from '../domain/ids';
import { createLogicalExport, createPhysicalBackup } from '../backup/backup';
import { setupLock, unlock } from '../security/lock';
import type { Ctx } from '../services/runner';
import { flush } from '../db/durability';

export interface BenchResult {
  when: string; products: number; checkouts: number; durability: 'strict' | 'relaxed';
  device: { userAgent: string; cores: number | null; memoryGb: number | null; screen: string; online: boolean; storageUsedMb: number | null; storageQuotaMb: number | null; persisted: boolean | null; heapUsedMb: number | null };
  ms: Record<string, number>;
  notes: string[];
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const round = (n: number) => Math.round(n * 10) / 10;

async function timeIt<T>(f: () => Promise<T>): Promise<[T, number]> { const t = performance.now(); const r = await f(); return [r, performance.now() - t]; }

export async function runBench(opts: { products: number; checkouts?: number; onStep?: (s: string) => void; dataDir?: string; durability?: 'strict' | 'relaxed' }): Promise<BenchResult> {
  const mode = opts.durability ?? 'relaxed';
  const step = opts.onStep ?? (() => {});
  const checkouts = opts.checkouts ?? 100;
  const ms: Record<string, number> = {}; const notes: string[] = [];
  const dir = opts.dataDir ?? 'idb://tillbox-bench';
  step('open');
  const [pg, openMs] = await timeIt(async () => { const p = createPglite(dir, { writeBehind: mode === 'relaxed' }); await p.waitReady; return p; });
  ms.engineStart = round(openMs);
  const db = fromPglite(pg);
  const [, migMs] = await timeIt(() => migrate(db)); ms.migrate = round(migMs);
  const info = await initDevice(db, 'Bench');
  const [, seedMs] = await timeIt(() => startNewStore(db, info.id)); ms.seedDefaults = round(seedMs);
  const ctx: Ctx = { db, bus: createBus(), deviceId: info.id, actor: 'system' };
  const manual: Ctx = { ...ctx, deferDurable: true };   // 'visible' = what the cashier waits for if confirmation could wait

  // What does one committed write cost on this device? Everything else is built from these.
  const commits: number[] = [];
  for (let i = 0; i < 30; i++) commits.push((await timeIt(() => db.query("INSERT INTO meta(key,value) VALUES($1,'x') ON CONFLICT (key) DO UPDATE SET value = excluded.value", ['bench' + (i % 3)])))[1]);
  ms.commitMedian = round(q(commits, 0.5)); ms.commitMax = round(Math.max(...commits));

  step('products');
  const unit = (await db.query<{ id: string }>("SELECT u.id FROM units u WHERE u.name = 'Each'"))[0].id;
  const group = (await db.query<{ id: string }>("SELECT id FROM tax_groups LIMIT 1"))[0].id;
  const [, insMs] = await timeIt(() => db.transaction(async (tx) => {
    for (let i = 0; i < opts.products; i++) {
      const pid = newId(), pu = newId();
      await insertRow(tx, 'products', { id: pid, sku: 'SKU' + i, name: 'Sample product number ' + i, tax_group_id: group, updated_by_device: info.id });
      await insertRow(tx, 'product_units', { id: pu, product_id: pid, unit_id: unit, price_sale_cents: 100 + (i % 900), barcode: String(9300000000000 + i), updated_by_device: info.id });
      await insertRow(tx, 'stock_movements', { id: newId(), device_id: info.id, product_unit_id: pu, qty: '1000', kind: 'opening' });
    }
  }));
  ms.insertProducts = round(insMs); ms.insertPerProduct = round(insMs / opts.products);

  step('queries');
  const grid: number[] = [], search: number[] = [], barcode: number[] = [];
  for (let i = 0; i < 5; i++) {
    grid.push((await timeIt(() => stockGrid(db, { limit: 60 })))[1]);
    search.push((await timeIt(() => stockGrid(db, { search: 'number 4' + i, limit: 30 })))[1]);
    barcode.push((await timeIt(() => stockGrid(db, { search: String(9300000000000 + 123 + i), limit: 5 })))[1]);
  }
  ms.gridFirst60Median = round(q(grid, 0.5)); ms.searchNameMedian = round(q(search, 0.5)); ms.scanBarcodeMedian = round(q(barcode, 0.5));

  step('checkouts');
  const some = await stockGrid(db, { limit: 20 });
  const card = (await db.query<{ id: string }>("SELECT id FROM payment_types WHERE key='card'"))[0].id;
  const oneSale = async (i: number, c: Ctx = manual) => {
    const a = some[i % some.length], b = some[(i + 7) % some.length];
    const lines = [{ productUnitId: a.product_unit_id, qty: 2 }, { productUnitId: b.product_unit_id, qty: 1 }];
    const quote = await quoteSale(db, { lines });
    await createSale(c, { lines, payments: [{ paymentTypeId: card, amountCents: quote.grossCents }] });
  };
  // visible: the sale without waiting for storage. durable: the real path, where the service flushes before it returns.
  const visible: number[] = [], durable: number[] = [];
  for (let i = 0; i < checkouts; i++) { visible.push((await timeIt(() => oneSale(i)))[1]); await flush(db); }
  for (let i = 0; i < checkouts; i++) durable.push((await timeIt(() => oneSale(i + 3, ctx)))[1]);   // the real path: durable before it returns
  ms.checkoutMedian = round(q(visible, 0.5)); ms.checkoutP95 = round(q(visible, 0.95)); ms.checkoutMax = round(Math.max(...visible));
  ms.checkoutDurableMedian = round(q(durable, 0.5)); ms.checkoutDurableP95 = round(q(durable, 0.95));

  step('security');
  const [, pbk] = await timeIt(async () => { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('x'), 'PBKDF2', false, ['deriveBits']); await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(16), iterations: 100_000, hash: 'SHA-256' }, k, 256); });
  ms.pbkdf2_100k = round(pbk);
  const [, lockMs] = await timeIt(async () => { await setupLock(db, '482916'); await unlock(db, '482916'); });
  ms.lockSetupAndUnlock = round(lockMs);
  if (pbk > 400) notes.push('PBKDF2 is slow on this device: unlocking costs about ' + Math.round(pbk * 3) + ' ms at the default strength.');

  step('backup');
  await flush(db);
  const [lg, lgMs] = await timeIt(() => createLogicalExport(db, 'bench passphrase long', { iterations: 100_000 }));
  ms.logicalExport = round(lgMs); ms.logicalExportKb = Math.round(lg.bytes.length / 1024);
  const [ph, phMs] = await timeIt(() => createPhysicalBackup(pg, 'bench passphrase long', { iterations: 100_000 }));
  ms.physicalBackup = round(phMs); ms.physicalBackupKb = Math.round(ph.length / 1024);

  await flush(db);
  const est = await navigator.storage?.estimate?.().catch(() => undefined);
  const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
  await closePglite(pg);
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase('/pglite/' + dir.replace('idb://', '')); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  if (!heap) notes.push('This browser does not report JavaScript memory; the WebAssembly engine memory is not visible to the page either.');
  return {
    when: new Date().toISOString(), products: opts.products, checkouts, durability: mode,
    device: {
      userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency ?? null, memoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
      screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, online: navigator.onLine, storageUsedMb: est?.usage != null ? Math.round(est.usage / 1e6) : null,
      storageQuotaMb: est?.quota != null ? Math.round(est.quota / 1e6) : null, persisted: (await navigator.storage?.persisted?.().catch(() => null)) ?? null,
      heapUsedMb: heap ? Math.round(heap / 1e6) : null,
    },
    ms, notes,
  };
}
