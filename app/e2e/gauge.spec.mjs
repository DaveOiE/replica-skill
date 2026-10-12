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
const openProject = async (page) => { await page.getByRole('link', { name: 'Projects' }).click(); await page.getByRole('link', { name: 'Website refresh' }).click(); };

test('GAUGE-1 expired session: the next action sends the person back to sign-in with a plain message', async ({ page }) => {
  await signIn(page, 'member');
  await openProject(page);
  await expect(page.getByLabel('Task title: To do')).toBeVisible(); // wait for the project to finish loading first
  await page.context().clearCookies(); // the session ends (expiry, sign-out elsewhere, deactivation)
  await page.getByLabel('Task title: To do').fill('Written after the session ended');
  await page.getByRole('button', { name: 'Add task' }).first().click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('You were signed out')).toBeVisible();
});

test('GAUGE-2 double submit: a fast double click on Add task makes one task, not two', async ({ page }) => {
  await signIn(page, 'member');
  await openProject(page);
  await page.getByLabel('Task title: To do').fill('Only once please');
  await page.getByRole('button', { name: 'Add task' }).first().dblclick();
  await expect(page.getByRole('link', { name: 'Only once please' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Only once please' })).toHaveCount(1);
});

test('GAUGE-3 awkward text: emoji, accents and a very long title keep the page usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'member');
  await openProject(page);
  const long = 'Réunion équipe 🚀 ' + 'Ångström '.repeat(30);
  await page.getByLabel('Task title: To do').fill(long.slice(0, 300));
  await page.getByRole('button', { name: 'Add task' }).first().click();
  await expect(page.getByRole('link', { name: /Réunion équipe 🚀/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('GAUGE-4 markup typed as a title is shown as text and never runs', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => { errors.push('dialog ' + d.message()); d.dismiss(); });
  await signIn(page, 'member');
  await openProject(page);
  await page.getByLabel('Task title: To do').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Add task' }).first().click();
  await expect(page.getByRole('link', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('GAUGE-5 the back button after sign-out does not reveal the app', async ({ page }) => {
  await signIn(page, 'member');
  await openProject(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Website refresh')).toHaveCount(0);
});

// Accessibility scan (axe, WCAG 2 A and AA rules) on every screen a person reaches.
const screens = [
  ['sign-in', null, async () => {}],
  ['my tasks', 'member', async () => {}],
  ['projects', 'member', async (p) => { await p.getByRole('link', { name: 'Projects' }).click(); await expect(p.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible(); }],
  ['list view', 'member', async (p) => { await openProject(p); await expect(p.getByRole('heading', { name: 'Website refresh' })).toBeVisible(); }],
  ['board', 'member', async (p) => { await openProject(p); await p.getByRole('link', { name: 'Board', exact: true }).click(); await expect(p.locator('.board')).toBeVisible(); }],
  ['task drawer', 'member', async (p) => { await openProject(p); await p.getByRole('link', { name: 'Choose a new colour palette' }).click(); await expect(p.getByRole('dialog')).toBeVisible(); }],
  ['project settings', 'admin', async (p) => { await openProject(p); await p.getByRole('link', { name: 'Settings' }).click(); await expect(p.getByRole('heading', { name: /Project settings/ })).toBeVisible(); }],
  ['people', 'admin', async (p) => { await p.getByRole('link', { name: 'People' }).click(); await expect(p.getByRole('heading', { name: 'People', exact: true })).toBeVisible(); }],
  ['dashboard', 'member', async (p) => { await p.getByRole('link', { name: 'Dashboard' }).click(); await expect(p.getByRole('heading', { name: 'Dashboard' })).toBeVisible(); }],
  ['account', 'member', async (p) => { await p.getByRole('link', { name: 'Account' }).click(); await expect(p.getByRole('heading', { name: 'Account' })).toBeVisible(); }],
];
for (const [name, who, go] of screens) {
  test(`GAUGE-A11Y ${name}: no axe violations`, async ({ page }) => {
    if (who) await signIn(page, who); else await page.goto(base);
    await go(page);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`)).toEqual([]);
  });
}
