import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PRODUCT_NAME } from '../shared/brand.js';

const base = 'http://127.0.0.1:4010';
const creds = JSON.parse(readFileSync('.local/e2e-credentials.json', 'utf8'));

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`sign in, see My tasks, sign out: ${name}`, async ({ page }) => {
    const problems = [];
    // Chromium logs every 401 as a console error. This flow causes exactly three, all expected:
    // the signed-out session check on load, the deliberate wrong password, the check after sign-out.
    let expected401 = 0;
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/status of 401/.test(m.text())) expected401 += 1; else problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
    await page.setViewportSize(size);
    await page.goto(base);
    await expect(page).toHaveTitle(`Sign in · ${PRODUCT_NAME}`);
    // wrong password: plain message, stays on sign-in
    await page.getByLabel('Email').fill(creds.member.email);
    await page.getByLabel('Password').fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText("don't match");
    // right password
    await page.getByLabel('Password').fill(creds.member.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
    await expect(page).toHaveTitle(`My tasks · ${PRODUCT_NAME}`);
    await expect(page.getByText('Demo workspace. Everything here is fake.')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(0);
    await page.screenshot({ path: `.local/shell-${size.width}.png` });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(problems, JSON.stringify(problems)).toEqual([]);
    expect(expected401, 'only the three expected 401s').toBe(3);
  });
}

test('keyboard only: tab reaches the sign-in controls in order and Enter submits', async ({ page }) => {
  await page.goto(base);
  await page.keyboard.press('Tab'); // focus starts on the email field (set by the app)
  await page.getByLabel('Email').fill(creds.viewonly.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(creds.viewonly.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByText('View-only seat')).toBeVisible();
});
