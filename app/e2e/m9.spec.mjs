import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`an admin deactivates a person: they are marked, lose their buttons, and cannot sign in: ${name}`, async ({ page, browser }) => {
    await page.setViewportSize(size);
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'People' }).click();
    const who = `Leaver ${size.width}`, email = `leaver.${size.width}@example.test`;
    await page.locator('#n-name').fill(who); await page.locator('#n-email').fill(email);
    await page.getByRole('button', { name: 'Add person' }).click();
    const pw = (await page.locator('code.secret').first().textContent()).trim();
    await page.reload();   // the list is drawn again from the server
    const row = page.locator('li.row', { hasText: who });
    await expect(row).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: `Deactivate: ${who}` }).click();
    await expect(row.getByText('Deactivated')).toBeVisible();
    await expect(row.getByRole('button')).toHaveCount(0);
    await noOverflow(page);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    // the person can no longer get in
    const fresh = await browser.newContext(); const res = await fresh.request.post(`${base}/api/v1/auth/signin`, { data: { email, password: pw } });
    expect(res.status()).toBe(401); await fresh.close();
  });
}
