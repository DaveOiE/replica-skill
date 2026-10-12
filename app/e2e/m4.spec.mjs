import { test, expect, request } from '@playwright/test';
import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:4010';
const creds = JSON.parse(readFileSync('.local/e2e-credentials.json', 'utf8'));
async function signIn(page, who, password) {
  await page.goto(base);
  await page.getByLabel('Email').fill(creds[who].email);
  await page.getByLabel('Password').fill(password || creds[who].password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
}
const watch = (page) => { const p = [];  page.on('pageerror', (e) => p.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|429)/.test(m.text())) p.push(m.text()); }); return p; };
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const people = async (page) => { await page.getByRole('link', { name: 'People' }).click(); await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible(); };

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`invite: admin makes a link, the new person joins from it and is signed in: ${name}`, async ({ page, browser }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'admin');
    await people(page);
    const email = `pat.${size.width}@example.test`;
    await page.locator('#i-email').fill(email);
    await page.locator('#i-role').selectOption('guest');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    const secret = page.locator('code.secret');
    await expect(secret).toBeVisible();
    const link = (await secret.textContent()).trim();
    expect(link).toContain('/#/invite/');
    await expect(page.getByText(email).first()).toBeVisible(); // listed as pending
    await noOverflow(page);
    await page.screenshot({ path: `.local/people-${size.width}.png`, fullPage: true });
    const guest = await browser.newPage({ viewport: size });
    const gp = watch(guest);
    await guest.goto(link);
    await expect(guest.getByRole('heading', { name: /Join Brightside/ })).toBeVisible();
    await guest.getByLabel('Your name').fill('Pat Lee');
    await guest.getByLabel('New password').fill('short');
    await guest.getByRole('button', { name: 'Set password' }).click();
    await expect(guest.getByRole('alert')).toContainText('at least 12');
    await guest.getByLabel('New password').fill('a-long-enough-password-1');
    await guest.getByRole('button', { name: 'Set password' }).click();
    await expect(guest.getByRole('heading', { name: 'My tasks' })).toBeVisible();
    await expect(guest.locator('.topbar .badge')).toHaveText('Guest');
    await noOverflow(guest);
    await guest.goto(link); // used up
    await expect(guest.getByText('not valid any more')).toBeVisible();
    await guest.close();
    expect(problems).toEqual([]); expect(gp).toEqual([]);
  });
}

test('reset and unlock: a locked person is unlocked, then gets a reset link and signs in with a new password', async ({ page, browser }) => {
  const raw = await request.newContext({ baseURL: base }); // its own cookie jar, so it cannot replace the admin's session
  const problems = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (let i = 0; i < 5; i++) await raw.post('/api/v1/auth/signin', { data: { email: creds.member2.email, password: 'wrong-password-1' } });
  const locked = await raw.post('/api/v1/auth/signin', { data: { email: creds.member2.email, password: creds.member2.password } });
  expect(locked.status()).toBe(429);
  await signIn(page, 'admin');
  await people(page);
  await page.getByRole('button', { name: 'Unlock: Priya Nair' }).click();
  await expect(page.getByText('Unlocked.')).toBeVisible();
  expect((await raw.post('/api/v1/auth/signin', { data: { email: creds.member2.email, password: creds.member2.password } })).status()).toBe(200);
  await page.getByRole('button', { name: 'Reset password: Priya Nair' }).click();
  const secret = page.locator('code.secret');
  await expect(secret).toBeVisible();
  const link = (await secret.textContent()).trim();
  expect(link).toContain('/#/reset/');
  await expect(page.getByRole('button', { name: 'Reset password: Avery Quinn' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reset password: Jordan Reyes/ })).toHaveCount(0); // not yourself
  const them = await browser.newPage();
  await them.goto(link);
  await expect(them.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await them.getByLabel('New password').fill('brand-new-password-9');
  await them.getByRole('button', { name: 'Set password' }).click();
  await expect(them.getByText('Password changed. Sign in with the new one.')).toBeVisible();
  await them.getByLabel('Email').fill(creds.member2.email);
  await them.getByLabel('Password').fill('brand-new-password-9');
  await them.getByRole('button', { name: 'Sign in' }).click();
  await expect(them.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await them.close();
  expect(problems).toEqual([]);
});

test('a dead link says so plainly and offers a way back', async ({ page }) => {
  await page.goto(`${base}/#/reset/not-a-real-token`);
  await expect(page.getByRole('alert')).toContainText('not valid any more');
  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
