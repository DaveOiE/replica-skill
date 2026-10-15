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
const watch = (page) => {
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|404|409)/.test(m.text())) problems.push(m.text()); });
  return problems;
};
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`member: open a project, add a task, change it, comment, add a subtask: ${name}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'member');
    await expect(page.getByText('Draft new homepage copy')).toBeVisible(); // My tasks, real data
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: 'Website refresh' }).click();
    await expect(page.getByRole('heading', { name: 'Website refresh' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0); // members are not project admins
    const title = `Order cards ${size.width}`;
    await page.getByLabel('Task title: To do').fill(title);
    await page.getByRole('button', { name: 'Add task' }).first().click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await page.getByLabel(`Status: ${title}`).selectOption('in_progress');
    await expect(page.getByLabel(`Status: ${title}`)).toHaveValue('in_progress');
    await page.getByRole('link', { name: title }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await drawer.getByLabel('Add comment').first().fill('Ordered, arriving Friday.');
    await drawer.getByRole('button', { name: 'Add comment' }).click();
    await expect(drawer.getByText('Ordered, arriving Friday.')).toBeVisible();
    await drawer.getByLabel('Add subtask').fill('Pick a paper stock');
    await drawer.getByRole('button', { name: 'Add subtask' }).click();
    await expect(drawer.getByRole('link', { name: 'Pick a paper stock' })).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: `.local/m2-${size.width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
}

test('view-only: sees the project but every control is read-only and there is no add form', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'viewonly');
  await expect(page.getByText('View-only seat')).toBeVisible();
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.getByRole('link', { name: 'Payroll cleanup' })).toHaveCount(0); // private
  await page.getByRole('link', { name: 'Website refresh' }).click();
  await expect(page.getByLabel('Status: Draft new homepage copy')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add task' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'New project' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Draft new homepage copy' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Delete task' })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Add comment' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('admin: adds a person and sees the temporary password once; the guest then signs in and sees only their project', async ({ page, browser }) => {
  const problems = watch(page);
  await signIn(page, 'admin');
  await page.getByRole('link', { name: 'People' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Jamie Fox');
  await page.locator('#n-email').fill('jamie.fox@example.test');
  await page.locator('#n-role').selectOption('guest');
  await page.getByRole('button', { name: 'Add person' }).click();
  const secret = page.locator('code.secret');
  await expect(secret).toBeVisible();
  const temp = (await secret.textContent()).trim();
  expect(temp.length).toBeGreaterThanOrEqual(12);
  await page.getByRole('link', { name: 'Projects' }).click();
  await page.getByRole('link', { name: 'Website refresh' }).click();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByLabel('Name', { exact: true }).selectOption({ label: 'Jamie Fox' });
  await page.getByRole('button', { name: 'Add to project' }).click();
  await expect(page.getByLabel('Role: Jamie Fox')).toBeVisible();
  const guest = await browser.newPage();
  await guest.goto(base);
  await guest.getByLabel('Email').fill('jamie.fox@example.test');
  await guest.getByLabel('Password').fill(temp);
  await guest.getByRole('button', { name: 'Sign in' }).click();
  // a temporary password only gets as far as choosing your own
  await expect(guest.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(guest.getByText('Choose your own now')).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Projects' })).toHaveCount(0);
  await guest.getByLabel('Current password').fill(temp);
  await guest.getByLabel('New password').fill('my own chosen phrase 42');
  await guest.getByRole('button', { name: 'Change password' }).click();
  await expect(guest.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(guest.getByRole('link', { name: 'People' })).toHaveCount(0);
  await guest.getByRole('link', { name: 'Projects' }).click();
  await expect(guest.getByRole('link', { name: 'Website refresh' })).toBeVisible();
  await expect(guest.getByRole('link', { name: 'Payroll cleanup' })).toHaveCount(0);
  await guest.close();
  expect(problems).toEqual([]);
});
