// Measurements and risk probes. They log numbers for the spike report; they assert only generous bounds.
import { test, expect } from '@playwright/test';

test('probe: opening the app in a second tab of the same browser profile', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p1 = await ctx.newPage(); await p1.goto('/');
  await expect(p1.getByTestId('prefix')).toBeVisible({ timeout: 60_000 });
  await p1.getByTestId('seed-demo').click();
  await expect(p1.getByTestId('stock-FW')).toHaveText('50');
  const p2 = await ctx.newPage();
  await p2.goto('/');
  await expect(p2.getByTestId('open-elsewhere')).toBeVisible({ timeout: 20_000 });
  console.log('SECOND TAB: shown the "open in another window" message, database untouched');
  await p1.getByTestId('add-FW').click(); await expect(p1.getByTestId('cart-qty')).toHaveText('1');
  await p1.getByTestId('pay').click();
  await expect(p1.getByTestId('stock-FW')).toHaveText('49');
  await p1.close();                                  // closing the owner frees the lock
  const p3 = await ctx.newPage(); await p3.goto('/');
  await expect(p3.getByTestId('stock-FW')).toHaveText('49', { timeout: 60_000 });
  await ctx.close();
});

test('probe: speed with a 5,000-product catalogue and 200 checkouts', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const t0 = Date.now();
  await p.goto('/');
  await expect(p.getByTestId('prefix')).toBeVisible({ timeout: 60_000 });
  console.log('cold open to ready (ms):', Date.now() - t0);
  const r = await p.evaluate(async () => {
    const tb = (window as any).__tb; const out: Record<string, number> = {};
    let t = performance.now();
    await tb.db.transaction(async (tx: any) => {
      const dev = (await tx.query("select value from meta where key='device_id'"))[0].value;
      for (let i = 0; i < 5000; i++) {
        const id = crypto.randomUUID();
        await tx.query('INSERT INTO products(id,sku,name,price_cents,version,updated_by_device) VALUES($1,$2,$3,$4,1,$5)', [id, 'SKU' + i, 'Product number ' + i, 100 + (i % 900), dev]);
        await tx.query("INSERT INTO stock_movements(id,product_id,qty,kind,device_id) VALUES($1,$2,100,'opening',$3)", [crypto.randomUUID(), id, dev]);
      }
    });
    out.insert5000ProductsMs = Math.round(performance.now() - t);
    t = performance.now();
    const rows = await tb.db.query("SELECT p.id,p.name,coalesce(sum(m.qty),0)::int stock FROM products p LEFT JOIN stock_movements m ON m.product_id=p.id WHERE p.name ILIKE $1 GROUP BY p.id ORDER BY p.name LIMIT 30", ['%number 49%']);
    out.searchWithStockMs = Math.round(performance.now() - t); out.searchRows = rows.length;
    t = performance.now(); const all = await tb.stockLevels(tb.db); out.fullGridWithStockMs = Math.round(performance.now() - t); out.gridRows = all.length;
    const first = all[0].id; const times: number[] = [];
    for (let i = 0; i < 200; i++) { const s = performance.now(); await tb.checkout(tb.db, [{ productId: first, qty: 1 }, { productId: all[1].id, qty: 2 }], 100000); times.push(performance.now() - s); }
    times.sort((a, b) => a - b);
    out.checkoutMedianMs = Math.round(times[100]); out.checkoutP95Ms = Math.round(times[190]);
    const est = await navigator.storage.estimate(); out.storageUsedMB = Math.round((est.usage ?? 0) / 1e6);
    return out;
  });
  console.log('PERF', JSON.stringify(r));
  expect(r.checkoutP95Ms).toBeLessThan(2000);
  await ctx.close();
});
