import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const status = (p: Page) => p.getByTestId('status');
const stock = (p: Page, sku: string) => p.getByTestId(`stock-${sku}`);
async function open(ctx: BrowserContext) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await p.goto('/');
  await expect(p.getByTestId('prefix')).toBeVisible({ timeout: 60_000 });
  return p;
}
async function sell(p: Page, sku: string, n: number) {
  for (let i = 0; i < n; i++) await p.getByTestId(`add-${sku}`).click();
  await expect(p.getByTestId('cart-qty')).toHaveText(String(n));   // wait for the UI to catch up with the taps
  await p.getByTestId('pay').click();
  await expect(p.getByTestId('cart-qty')).toHaveText('0');
}
async function swReady(p: Page) {
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => p.evaluate(async () => (await caches.keys()).length), { timeout: 60_000 }).toBeGreaterThan(0);
  await p.reload();  // from here on the service worker controls the page
  await expect(p.getByTestId('prefix')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => p.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('mode 1: standalone, data survives a reload, checkout works with the network cut, even after a reload', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await open(ctx);
  await p.getByTestId('seed-demo').click();
  await expect(status(p)).toHaveText('standalone');
  await expect(stock(p, 'FW')).toHaveText('50');

  await sell(p, 'FW', 2);
  await expect(p.getByTestId('last-order')).toContainText(/Order [A-Z0-9]{4}-000001 \$9\.00/);
  await expect(stock(p, 'FW')).toHaveText('48');

  await p.reload();                                   // persisted in IndexedDB
  await expect(stock(p, 'FW')).toHaveText('48');
  await expect(p.getByTestId('orders-count')).toHaveText('1');

  await swReady(p);
  await ctx.setOffline(true);
  await p.reload();                                   // app shell + wasm served from the cache
  await expect(stock(p, 'FW')).toHaveText('48', { timeout: 60_000 });
  await sell(p, 'CR', 1);
  await expect(p.getByTestId('last-order')).toContainText(/-000002 \$5\.20/);
  await expect(stock(p, 'CR')).toHaveText('49');
  console.log('persistent storage granted:', await p.getByTestId('persisted').textContent());
  await ctx.close();
});

test('mode 1 -> 2/3 with no data loss, then two offline tills converge', async ({ browser }) => {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await open(ctxA);
  await a.getByTestId('seed-demo').click();
  await sell(a, 'FW', 2);
  await sell(a, 'WA', 3);
  await expect(status(a)).toHaveText('standalone');

  // switch to server mode later: nothing is rewritten, the local history is pushed
  await a.getByTestId('connect').click();
  await expect(status(a)).toHaveText('synced', { timeout: 30_000 });

  // a second device JOINS: connects first, then receives the catalogue, stock and orders
  const b = await open(ctxB);
  await b.getByTestId('connect').click();
  await expect(status(b)).toHaveText('synced', { timeout: 30_000 });
  await expect(stock(b, 'FW')).toHaveText('48');
  await expect(stock(b, 'WA')).toHaveText('47');
  await expect(b.getByTestId('orders-count')).toHaveText('2');

  // both tills lose the network; each sells 30 of the 48 coffees
  await ctxA.setOffline(true); await ctxB.setOffline(true);
  await sell(a, 'FW', 30); await sell(b, 'FW', 30);
  await expect(status(a)).toHaveText(/pending|offline/);
  await expect(status(b)).toHaveText(/pending|offline/);
  await expect(stock(a, 'FW')).toHaveText('18');
  await expect(stock(b, 'FW')).toHaveText('18');     // each till only knows its own sales

  await ctxA.setOffline(false); await ctxB.setOffline(false);
  await a.getByTestId('sync-now').click(); await b.getByTestId('sync-now').click(); await a.getByTestId('sync-now').click();
  await expect(status(a)).toHaveText('synced', { timeout: 30_000 });
  await expect(status(b)).toHaveText('synced', { timeout: 30_000 });
  await expect(stock(a, 'FW')).toHaveText('-12');
  await expect(stock(b, 'FW')).toHaveText('-12');
  await expect(a.getByTestId('exceptions')).toHaveText('FW');
  await expect(b.getByTestId('exceptions')).toHaveText('FW');
  const prefA = await a.getByTestId('prefix').textContent(), prefB = await b.getByTestId('prefix').textContent();
  expect(prefA).not.toBe(prefB);
  await ctxA.close(); await ctxB.close();
});

test('mode 1 backup is created, encrypted, restored into a scratch database and verified, in the browser', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await open(ctx);
  await p.getByTestId('seed-demo').click();
  await sell(p, 'FW', 1);
  await p.getByTestId('backup-pass').fill('a long passphrase');
  await p.getByTestId('backup').click();
  await expect(p.getByTestId('backup-result')).toContainText(/verified backup \d+ bytes, 1 orders/, { timeout: 90_000 });
  console.log(await p.getByTestId('backup-result').textContent());
  await ctx.close();
});
