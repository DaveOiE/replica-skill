import { test, expect, type Page } from '@playwright/test';
import { openApp, newStore, unlock, pairingCode, SYNC, PIN } from './helpers';

const orders = (p: Page) => p.getByTestId('count-orders');
const badge = (p: Page) => p.getByTestId('sync-state');
async function goSync(p: Page) { await p.getByRole('link', { name: 'Server & sync' }).click(); await expect(p.getByRole('heading', { name: 'Server & sync' })).toBeVisible(); }
async function goHome(p: Page) { await p.getByRole('link', { name: 'Home' }).click(); }
/** Press "Sync now" and wait until THAT sync has finished (the result line appears), not until some earlier status says "synced". */
async function syncNow(p: Page) {
  await p.getByTestId('sync-now').click();
  await expect(p.getByTestId('sync-msg')).toContainText('↑', { timeout: 60_000 });
  await expect(p.getByTestId('sync-detail-state')).toHaveText('synced');
}
/** Connect with a pairing code; if the server already holds data the person is asked, and says yes. Waits for whichever happens. */
async function connectAndSync(p: Page, code: string) {
  await p.getByTestId('server-url').fill(SYNC); await p.getByTestId('pairing-code').fill(code);
  await p.getByTestId('connect').click();
  const ask = p.getByTestId('merge-ask'), done = p.getByTestId('sync-detail-state').filter({ hasText: 'synced' });
  await ask.or(done).first().waitFor({ timeout: 60_000 });
  if (await ask.isVisible()) await p.getByTestId('merge-yes').click();
  await expect(done).toBeVisible({ timeout: 60_000 });
}

test('mode 1 -> server with no data loss, a second device joins, two offline tills converge', async ({ browser }) => {
  // --- device A trades standalone ---
  const ctxA = await browser.newContext(); const a = await openApp(ctxA); await newStore(a);
  await a.getByTestId('sample-sale').click(); await expect(orders(a)).toHaveText('1');
  await a.getByTestId('sample-sale').click(); await expect(orders(a)).toHaveText('2');
  await expect(badge(a)).toHaveText('Standalone');

  // --- later it is connected to a server: nothing is rewritten ---
  await goSync(a);
  await connectAndSync(a, await pairingCode());
  await expect(a.getByTestId('sync-pending')).toHaveText('0');
  await expect(badge(a)).toHaveText('Synced');
  await goHome(a);
  await expect(orders(a)).toHaveText('2');              // the same two orders: nothing lost, nothing duplicated

  // --- device B joins the shop from its first screen ---
  const ctxB = await browser.newContext(); const b = await openApp(ctxB);
  await expect(b.getByTestId('first-join')).toBeVisible({ timeout: 90_000 });
  await b.getByTestId('first-join').click();
  await b.getByTestId('join-url').fill(SYNC); await b.getByTestId('join-code').fill(await pairingCode()); await b.getByTestId('join-go').click();
  await b.getByTestId('pin-1').fill(PIN); await b.getByTestId('pin-2').fill(PIN); await b.getByTestId('pin-set').click();
  await expect(b.getByTestId('sync-badge')).toBeVisible();
  await goSync(b);
  await syncNow(b);
  await goHome(b);
  await expect.poll(async () => Number(await orders(b).textContent())).toBeGreaterThanOrEqual(2);
  await expect(b.getByTestId('count-products')).not.toHaveText('0');
  expect(await b.getByTestId('prefix').textContent()).not.toBe(await a.getByTestId('prefix').textContent());

  // --- both lose the network and keep selling ---
  await ctxA.setOffline(true); await ctxB.setOffline(true);
  await expect(badge(a)).toHaveText('Offline'); await expect(badge(b)).toHaveText('Offline');
  await expect(orders(a)).toHaveText(/^\d+$/); await expect(orders(b)).toHaveText(/^\d+$/);
  const [a0, b0] = [Number(await orders(a).textContent()), Number(await orders(b).textContent())];
  await a.getByTestId('sample-sale').click(); await a.getByTestId('sample-sale').click();
  await b.getByTestId('sample-sale').click();
  await expect(orders(a)).toHaveText(String(a0 + 2), { timeout: 30_000 }); await expect(orders(b)).toHaveText(String(b0 + 1), { timeout: 30_000 });

  // --- the network returns: everything flows, both end identical ---
  await ctxA.setOffline(false); await ctxB.setOffline(false);
  await expect(badge(a)).toHaveText(/changes? waiting/);
  for (const p of [a, b, a]) { await goSync(p); await syncNow(p); await goHome(p); }
  await expect(orders(a)).toHaveText(/^\d+$/); await expect(orders(b)).toHaveText(/^\d+$/);
  const total = Number(await orders(a).textContent());
  await expect(orders(b)).toHaveText(String(total), { timeout: 30_000 });      // both copies hold exactly the same orders
  expect(total).toBe(a0 + 2 + 1 + (b0 - a0));                                   // A's two new + B's one new + everything B had that A lacked
  expect(total).toBeGreaterThanOrEqual(5);
  await ctxA.close(); await ctxB.close();
});

test('a device with its own history asks before merging into a server that already has data', async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
  await p.getByTestId('sample-sale').click(); await expect(orders(p)).toHaveText('1');
  await goSync(p);
  await p.getByTestId('server-url').fill(SYNC); await p.getByTestId('pairing-code').fill(await pairingCode());
  await p.getByTestId('connect').click();
  await expect(p.getByTestId('merge-ask')).toBeVisible({ timeout: 30_000 });          // the e2e server already holds the earlier test's shop
  await expect(p.getByTestId('sync-mode')).toHaveText('standalone');                  // refusing changed nothing
  await p.getByTestId('merge-yes').click();
  await expect(p.getByTestId('sync-detail-state')).toHaveText('synced', { timeout: 60_000 });
  await ctx.close();
});

test('a wrong or reused pairing code is refused with a clear message', async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
  await goSync(p);
  await p.getByTestId('server-url').fill(SYNC); await p.getByTestId('pairing-code').fill('AAAA-AAAA');
  await p.getByTestId('connect').click();
  await expect(p.getByTestId('sync-msg')).toContainText('invalid_or_expired_code');
  await expect(p.getByTestId('sync-mode')).toHaveText('standalone');
  await ctx.close();
});

test('the same data after a lock and unlock: the connection survives', async ({ browser }) => {
  const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
  await goSync(p);
  await connectAndSync(p, await pairingCode());
  await p.reload(); await unlock(p);
  await expect(p.getByTestId('sync-state')).toHaveText(/Synced|changes? waiting/, { timeout: 30_000 });
  await ctx.close();
});
