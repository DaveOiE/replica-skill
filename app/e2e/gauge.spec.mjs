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

// ---- pilot additions: new screens and the new public surfaces
const REG_HEADER = 'Job No,Job Title / Folder,Start Date,Estimated Completion,Estimated Completion,Next Action Due,Client,Status,Team,Comment / Update / Action,Misc,Estimated Completion Date,Closed Date';
const REG = [REG_HEADER, 'J7001G,Gauge sample job,01-Jul-24,2,Week(s),,Gauge Test Client,Work in Progress,Sam Okafor,A note,gauge,31-Aug-24,',
  'J7002G,Markup job,,,,,<img src=x onerror=alert(1)> Client,Quoted,,,,,'].join('\n');
const importViaApi = async (page) => { const r = await page.request.post(`${base}/api/v1/jobs/import`, { data: { csv: REG, visibility: 'workspace' } }); expect(r.status()).toBe(200); };

const pilotScreens = [
  ['jobs', async (p) => { await importViaApi(p); await p.getByRole('link', { name: 'Jobs' }).click(); await expect(p.getByRole('link', { name: 'Gauge sample job' })).toBeVisible(); }],
  ['import (with a preview showing)', async (p) => { await p.goto(`${base}/#/import`); await p.locator('#imp-file').setInputFiles({ name: 'r.csv', mimeType: 'text/csv', buffer: Buffer.from(REG) }); await p.getByRole('button', { name: 'Preview' }).click(); await expect(p.getByRole('heading', { name: 'Preview' })).toBeVisible(); }],
  ['forms admin', async (p) => { await openProject(p); await p.getByRole('link', { name: 'Forms', exact: true }).click(); await expect(p.getByRole('heading', { name: /Request forms/ })).toBeVisible(); }],
  ['people with invites and reset', async (p) => { await p.getByRole('link', { name: 'People' }).click(); await p.locator('#i-email').fill('scan.me@example.test'); await p.getByRole('button', { name: 'Create invite link' }).click(); await expect(p.locator('code.secret')).toBeVisible(); }],
];
for (const [name, go] of pilotScreens) {
  test(`GAUGE-A11Y ${name}: no axe violations`, async ({ page }) => {
    await signIn(page, 'admin');
    await go(page);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes[0]?.target?.join(' ')}`)).toEqual([]);
  });
}
test('GAUGE-A11Y public form, join page and reset page: no axe violations', async ({ page, browser }) => {
  await signIn(page, 'admin');
  const inv = await (await page.request.post(`${base}/api/v1/invites`, { data: { email: 'axe.join@example.test', role: 'guest' } })).json();
  const rst = await (await page.request.post(`${base}/api/v1/members/${creds.viewonly.userId}/reset`)).json();
  for (const url of [`${base}/#/f/demo-support-form-slug-0001`, `${base}${inv.link}`, `${base}${rst.link}`]) {
    const ctx = await browser.newContext(); const v = await ctx.newPage(); await v.goto(url);
    await expect(v.getByRole('heading').first()).toBeVisible();
    const r = await new AxeBuilder({ page: v }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((x) => `${x.id}: ${x.help} ${x.nodes[0]?.target?.join(' ')}`), url.replace(/\/#\/.*/, '')).toEqual([]);
    await ctx.close();
  }
});

test('GAUGE-6 public form: a double click sends one request; the hidden trap box is skipped by keyboard and screen readers', async ({ page, browser }) => {
  await signIn(page, 'admin');
  const v = await browser.newPage(); await v.goto(`${base}/#/f/demo-support-form-slug-0001`);
  await expect(v.locator('.hp')).toHaveAttribute('aria-hidden', 'true');
  await expect(v.locator('#pq-website')).toHaveAttribute('tabindex', '-1');
  await v.getByLabel(/What do you need help with/).fill('Sent once only');
  await v.getByRole('button', { name: 'Send request' }).dblclick();
  await expect(v.getByRole('heading', { name: 'Thanks, your request was sent.' })).toBeVisible();
  await v.close();
  const tasks = await (await page.request.get(`${base}/api/v1/projects/${(await (await page.request.get(`${base}/api/v1/projects`)).json()).projects.find((p) => p.name === 'Website refresh').id}/tasks`)).json();
  expect(tasks.tasks.filter((t) => t.title === 'Sent once only')).toHaveLength(1);
});

test('GAUGE-7 jobs: markup in a client name is shown as text, and odd search text does not break the page', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('dialog', (d) => { errors.push('dialog ' + d.message()); d.dismiss(); });
  await signIn(page, 'member');
  await page.getByRole('link', { name: 'Jobs' }).click();
  await expect(page.locator('li.job').getByText('<img src=x onerror=alert(1)> Client')).toBeVisible();
  for (const odd of ["O'Brien \"quoted\"", '🚀 %_\\', 'x'.repeat(100)]) {
    await page.getByLabel('Search by job number or title').fill(odd);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No jobs match')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('GAUGE-8 import: a file that is not a register gets a plain reason and nothing is changed', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(`${base}/#/import`);
  await page.locator('#imp-file').setInputFiles({ name: 'photo.csv', mimeType: 'text/csv', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0xff]) });
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('alert')).toContainText(/header row has|file is empty/);
  await expect(page.getByRole('button', { name: /^Import \d+/ })).toHaveCount(0);
});
