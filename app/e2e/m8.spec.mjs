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
const watch = (page) => { const p = []; page.on('pageerror', (e) => p.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|429)/.test(m.text())) p.push(m.text()); }); return p; };
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const axe = async (page) => expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`service-created tasks carry a badge, and staff set lane and promised date: ${name}`, async ({ page, request }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    const title = `Send the revised quote ${size.width}`;
    const made = await request.post(`${base}/api/v1/ingest/tasks`, { headers: { authorization: `Bearer ${creds.svc.write.token}` },
      data: { idempotency_key: `e2e-m8-${size.width}-abcdefgh`, context: 'client_job', client_slug: 'brightwater-cafe', job_number: 'J9075P', title, source_call_id: `call-e2e-${size.width}`, inferred: true } });
    expect(made.status()).toBe(201);
    const pid = (await made.json()).project.id;
    await signIn(page, 'admin');
    await page.goto(`${base}/#/p/${pid}`);
    const row = page.locator('li.row', { hasText: title });
    await expect(row.getByText('AI/service-created')).toBeVisible();
    await expect(row.getByText(`Source call call-e2e-${size.width}`)).toBeVisible();
    await noOverflow(page); await axe(page);
    await page.getByRole('link', { name: 'Board', exact: true }).click();
    const card = page.locator('article.bcard', { hasText: title });
    await expect(card.getByText('AI/service-created')).toBeVisible();
    await noOverflow(page);
    await card.getByRole('link', { name: title }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('AI/service-created')).toBeVisible();
    await expect(drawer.getByText('Inferred')).toBeVisible();
    await drawer.getByLabel('Lane').fill('Client and project work');
    await drawer.getByLabel('Lane').press('Tab');
    await expect(page.getByText('Saved.').first()).toBeVisible();
    await page.getByRole('dialog').getByLabel('Promised date').fill('2026-12-01');
    await page.getByRole('dialog').getByLabel('Promised date').press('Tab');
    await page.reload();
    await expect(page.getByRole('dialog').getByLabel('Lane')).toHaveValue('Client and project work');
    await expect(page.getByRole('dialog').getByLabel('Promised date')).toHaveValue('2026-12-01');
    await noOverflow(page); await axe(page);
    expect(problems).toEqual([]);
  });

  test(`audit log: filters, load more, CSV download, owners and admins only: ${name}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'member');
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto(`${base}/#/audit`);
    await expect(page.getByText('We could not find that')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'owner');
    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.locator('li.audit-row').first()).toBeVisible();
    await noOverflow(page); await axe(page);
    await page.screenshot({ path: `.local/audit-${size.width}.png`, fullPage: true });
    const before = await page.locator('li.audit-row').count();
    await page.getByLabel('Action').selectOption('auth.signin');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.locator('li.audit-row').first()).toContainText('auth.signin');
    for (const t of await page.locator('li.audit-row strong').allTextContents()) expect(t).toBe('auth.signin');
    await page.getByLabel('From date').fill('2000-01-01'); await page.getByLabel('To date').fill('2000-01-02');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.getByText('No events match these filters.')).toBeVisible();
    await page.getByLabel('From date').fill(''); await page.getByLabel('To date').fill(''); await page.getByLabel('Action').selectOption('');
    await page.getByRole('button', { name: 'Apply filters' }).click();
    await expect(page.locator('li.audit-row')).toHaveCount(before);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(dl.suggestedFilename()).toBe('audit-log.csv');
    const csv = readFileSync(await dl.path(), 'utf8');
    expect(csv.startsWith('seq,time_utc,who,kind,action')).toBe(true);
    expect(csv).not.toMatch(/dsk_[A-Za-z0-9]|scrypt\$/);
    await page.reload();
    await expect(page.locator('li.audit-row', { hasText: 'audit.export' }).first()).toBeVisible();
    expect(problems).toEqual([]);
  });
}
