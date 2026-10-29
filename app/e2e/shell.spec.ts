import { test, expect } from '@playwright/test';
import { openApp, newStore, unlock, waitServiceWorker, PIN } from './helpers';

test.describe('first run, PIN and lock', () => {
  test('a new device is set up, needs a PIN, and asks for it again after a reload', async ({ browser }) => {
    const ctx = await browser.newContext(); const p = await openApp(ctx);
    await expect(p.getByTestId('first-run')).toBeVisible({ timeout: 90_000 });
    await p.getByTestId('first-new').click();
    // the PIN is not optional, and weak ones are refused
    await expect(p.getByTestId('pin-1')).toBeVisible();
    await p.getByTestId('pin-1').fill('123456'); await p.getByTestId('pin-2').fill('123456'); await p.getByTestId('pin-set').click();
    await expect(p.getByTestId('pin-msg')).toContainText('consecutive');
    await p.getByTestId('pin-2').fill('999999'); await p.getByTestId('pin-set').click();
    await expect(p.getByTestId('pin-msg')).toContainText('do not match');
    await p.getByTestId('pin-1').fill(PIN); await p.getByTestId('pin-2').fill(PIN); await p.getByTestId('pin-set').click();
    await expect(p.getByTestId('sync-badge')).toBeVisible();
    await expect(p.getByTestId('mode')).toContainText('Standalone');
    await expect(p.getByTestId('prefix')).toHaveText(/^[A-Z0-9]{4}$/);

    await p.reload();
    await expect(p.getByTestId('lock-screen')).toBeVisible({ timeout: 90_000 });
    await expect(p.getByTestId('sync-badge')).toHaveCount(0);            // nothing behind the lock is shown
    await p.getByTestId('unlock-pin').fill('000111'); await p.getByTestId('unlock-go').click();
    await expect(p.getByTestId('lock-msg')).toContainText('not the PIN');
    await unlock(p);
    await ctx.close();
  });

  test('five wrong PINs make you wait, and the wait survives a reload', async ({ browser }) => {
    const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
    await p.getByTestId('lock-now').click();
    for (let i = 0; i < 5; i++) { await p.getByTestId('unlock-pin').fill('111222'); await p.getByTestId('unlock-go').click(); await expect(p.getByTestId('lock-msg')).not.toHaveText(''); }
    await expect(p.getByTestId('lock-msg')).toContainText('Wait');
    await p.reload();
    await p.getByTestId('unlock-pin').fill(PIN); await p.getByTestId('unlock-go').click();
    await expect(p.getByTestId('lock-msg')).toContainText('Wait');         // the right PIN does not help during the wait
    await ctx.close();
  });

  test('the app locks itself after the idle time', async ({ browser }) => {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.clock.install();
    await p.goto('/');
    await newStore(p);
    await p.clock.fastForward('04:30');
    await expect(p.getByTestId('sync-badge')).toBeVisible();
    await p.clock.fastForward('01:00');
    await expect(p.getByTestId('lock-screen')).toBeVisible();
    await ctx.close();
  });

  test('a second window on the same device is told, not left hanging', async ({ browser }) => {
    const ctx = await browser.newContext(); const a = await openApp(ctx); await newStore(a);
    const b = await openApp(ctx);
    await expect(b.getByTestId('open-elsewhere')).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });
});

test.describe('theme, language and direction', () => {
  test('dark mode changes the colours; Arabic flips the layout and uses Arabic plurals; both are remembered', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' }); const p = await openApp(ctx); await newStore(p);
    const bg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await p.getByTestId('theme').selectOption('dark');
    await expect.poll(bg).not.toBe(light);
    expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    const brand = p.locator('.brand');
    const leftEdge = async () => (await brand.boundingBox())!.x;
    const w = p.viewportSize()!.width;
    expect(await leftEdge()).toBeLessThan(w / 2);                                  // English: brand at the start (left)
    await p.getByTestId('lang').selectOption('ar');
    await expect(p.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(p.locator('html')).toHaveAttribute('lang', 'ar');
    expect(await leftEdge()).toBeGreaterThan(w / 2);                               // Arabic: brand at the start (right)
    await expect(p.getByTestId('sync-state')).toHaveText('مستقل');
    await expect(p.locator('h1').first()).toHaveText('متجرك على هذا الجهاز');

    await p.reload(); await unlock(p);
    await expect(p.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await p.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await ctx.close();
  });

  test('"match device" follows the operating system setting', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' }); const p = await openApp(ctx); await newStore(p);
    const dark = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await p.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => p.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(dark);
    await ctx.close();
  });

  test('tablet-sized screen: no sideways scroll, touch targets at least 44px', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true }); const p = await openApp(ctx); await newStore(p);
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    for (const id of ['sample-sale', 'lock-now', 'lang', 'theme']) {
      const box = (await p.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(36);                            // small buttons are 36px; primary actions are 44px
    }
    expect((await p.getByTestId('sample-sale').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const phone = await browser.newContext({ viewport: { width: 375, height: 700 } }); const q = await openApp(phone); await newStore(q);
    expect(await q.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await ctx.close(); await phone.close();
  });
});

test.describe('offline', () => {
  test('after one visit the app starts and trades with no network at all, and the data is still there', async ({ browser }) => {
    const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
    await p.getByTestId('sample-sale').click();
    await expect(p.getByTestId('sample-msg')).toContainText('recorded');
    await expect(p.getByTestId('count-orders')).toHaveText('1');
    await waitServiceWorker(p);
    await p.reload(); await unlock(p);
    expect(await p.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await ctx.setOffline(true);
    await p.reload();
    await unlock(p);                                                               // the lock still works offline
    await expect(p.getByTestId('count-orders')).toHaveText('1');
    await p.getByTestId('sample-sale').click();
    await expect(p.getByTestId('count-orders')).toHaveText('2');
    await p.getByRole('link', { name: 'Data safety' }).click();                    // another page, from the cache
    await expect(p.getByRole('heading', { name: 'Data safety' })).toBeVisible();
    await ctx.close();
  });
});
