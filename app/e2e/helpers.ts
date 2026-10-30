import { expect, type Page, type BrowserContext } from '@playwright/test';

export const PIN = '482916';
export const SYNC = 'http://127.0.0.1:4100';
export const ADMIN = 'e2e-admin-token-0123456789abcdef';

export async function pairingCode(): Promise<string> {
  const r = await fetch(`${SYNC}/admin/pairing-codes`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: '{}' });
  return (await r.json()).code;
}
export async function openApp(ctx: BrowserContext, path = '/'): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message, process.env.PAGE_STACK ? e.stack : ''));
  await p.goto(path);
  return p;
}
export async function setPin(p: Page, pin = PIN) {
  await expect(p.getByTestId('pin-1')).toBeVisible({ timeout: 90_000 });
  await p.getByTestId('pin-1').fill(pin); await p.getByTestId('pin-2').fill(pin); await p.getByTestId('pin-set').click();
  await expect(p.getByTestId('sync-badge')).toBeVisible();
}
/** First run on a new device: start a new store and set a PIN. */
export async function newStore(p: Page) {
  await expect(p.getByTestId('first-new')).toBeVisible({ timeout: 90_000 });
  await p.getByTestId('first-new').click();
  await setPin(p);
}
export async function unlock(p: Page, pin = PIN) {
  await expect(p.getByTestId('lock-screen')).toBeVisible({ timeout: 90_000 });
  await p.getByTestId('unlock-pin').fill(pin); await p.getByTestId('unlock-go').click();
  await expect(p.getByTestId('sync-badge')).toBeVisible();
}
export const nav = (p: Page, name: RegExp) => p.getByRole('link', { name }).first().click();
export async function waitServiceWorker(p: Page) {
  await p.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => p.evaluate(async () => (await caches.keys()).length), { timeout: 90_000 }).toBeGreaterThan(0);
}
