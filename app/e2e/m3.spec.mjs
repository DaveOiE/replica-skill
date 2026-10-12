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
const watch = (page) => { const p = []; page.on('pageerror', (e) => p.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text())) p.push(m.text()); }); return p; };
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const columnOf = (page, name) => page.getByRole('region', { name, exact: true });

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`board: move a card with the menu, open it, switch views: ${name}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'member');
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: 'Website refresh' }).click();
    await page.getByRole('link', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(columnOf(page, 'To do').getByRole('link', { name: 'Scratch task to delete' })).toBeVisible();
    await page.getByLabel('Move to: Scratch task to delete').selectOption({ label: 'In progress' });
    await expect(columnOf(page, 'In progress').getByRole('link', { name: 'Scratch task to delete' })).toBeVisible();
    await expect(columnOf(page, 'To do').getByRole('link', { name: 'Scratch task to delete' })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `.local/board-${size.width}.png` });
    await columnOf(page, 'In progress').getByRole('link', { name: 'Scratch task to delete' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/board\/t\//);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#\/p\/[\w-]+\/board$/);
    await page.getByLabel('Move to: Scratch task to delete').selectOption({ label: 'To do' }); // put it back
    await expect(columnOf(page, 'To do').getByRole('link', { name: 'Scratch task to delete' })).toBeVisible();
    await page.getByRole('link', { name: 'List', exact: true }).click();
    await expect(page.getByLabel('Status: Draft new homepage copy')).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test('board: dragging a card to another column works (mouse), and view-only cannot drag or move', async ({ page }) => {
  const problems = watch(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'admin');
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Website refresh' }).click();
  await page.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible(); // the list view has regions with the same names, so wait for the board itself
  const card = page.locator('article.bcard', { hasText: 'Launch day' });
  // As a person would: bring the target column into view first, then drop on its heading.
  const target = columnOf(page, 'Done').getByRole('heading');
  await target.scrollIntoViewIfNeeded();
  await card.scrollIntoViewIfNeeded();
  await card.dragTo(target);
  await expect(columnOf(page, 'Done').getByRole('link', { name: 'Launch day' })).toBeVisible();
  await page.getByLabel('Move to: Launch day').selectOption({ label: 'To do' });
  await expect(columnOf(page, 'To do').getByRole('link', { name: 'Launch day' })).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, 'viewonly');
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Website refresh' }).click();
  await page.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.getByLabel(/Move to:/)).toHaveCount(0);
  await expect(page.locator('article.bcard[draggable="true"]')).toHaveCount(0);
  expect(problems).toEqual([]);
});

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`dashboard: tiles, charts and progress show the real numbers: ${name}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'member');
    await page.getByRole('link', { name: 'Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page).toHaveTitle(/^Dashboards · /);
    await expect(page.locator('.tile', { hasText: 'Open tasks' }).locator('.tile-value')).not.toHaveText('0');
    await expect(page.getByRole('img', { name: 'Tasks by status' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Open tasks by person' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: /Website refresh: \d+ of \d+ done/ })).toBeVisible();
    await expect(page.getByText('Payroll cleanup')).toHaveCount(0); // private project, not visible to a member
    await page.getByText('Show the numbers').first().click();
    await expect(page.getByRole('row', { name: /To do/ }).first()).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `.local/dash-${size.width}.png` });
    expect(problems).toEqual([]);
  });
}
