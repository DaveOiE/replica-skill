import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:4010';
const creds = JSON.parse(readFileSync('.local/e2e-credentials.json', 'utf8'));
async function signIn(page, who) {
  await page.goto(base);
  await page.getByLabel('Email').fill(creds[who].email);
  await page.getByLabel('Password').fill(creds[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
}
const watch = (page) => { const p = []; page.on('pageerror', (e) => p.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|429)/.test(m.text())) p.push(m.text()); }); return p; };
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`service accounts: an admin makes an account and a token, uses it once, then revokes it: ${name}`, async ({ page, request }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'People' }).click();
    await expect(page.getByRole('heading', { name: 'Service accounts' })).toBeVisible();
    const acct = `Zen test ${size.width}`;
    await page.locator('#sa-name').fill(acct);
    await page.getByRole('button', { name: 'Create account' }).click();
    const block = page.locator('li.form-item', { hasText: acct });
    await expect(block).toBeVisible();
    await block.getByLabel(/Token label/).fill('browser test');
    await block.getByLabel(/Read tasks and projects/).check();
    await block.getByRole('button', { name: /Create token/ }).click();
    const secret = page.locator('code.secret');
    await expect(secret).toBeVisible();
    const token = (await secret.textContent()).trim();
    expect(token).toMatch(/^dsk_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByText('cannot be seen again')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `.local/service-${size.width}.png`, fullPage: true });
    const ok = await request.get(`${base}/api/v1/service/whoami`, { headers: { authorization: `Bearer ${token}` } });
    expect(ok.status()).toBe(200);
    expect((await request.get(`${base}/api/v1/members`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(403);
    await page.reload();
    const after = page.locator('li.form-item', { hasText: acct });
    await expect(after.getByText(/last used 20/)).toBeVisible();
    await expect(page.locator('code.secret')).toHaveCount(0); // the token cannot be seen again
    await after.getByRole('button', { name: /Revoke: browser test/ }).click();
    await expect(page.locator('li.form-item', { hasText: acct }).getByText(/revoked/)).toBeVisible();
    expect((await request.get(`${base}/api/v1/service/whoami`, { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);
    expect(problems).toEqual([]);
  });
}

test('service accounts: a member cannot see the section', async ({ page }) => {
  await signIn(page, 'member');
  await page.goto(`${base}/#/people`);
  await expect(page.getByRole('heading', { name: 'Service accounts' })).toHaveCount(0);
});
