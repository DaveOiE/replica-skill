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

// INVENTED rows only. Same 13 columns as the register export.
const HEADER = 'Job No,Job Title / Folder,Start Date,Estimated Completion,Estimated Completion,Next Action Due,Client,Status,Team,Comment / Update / Action,Misc,Estimated Completion Date,Closed Date';
const csvFor = (w) => [HEADER,
  `J${w}1P,Shopfront signage ${w},01-Jul-24,2,Week(s),,Pinecrest Florist,Work in Progress,Sam Okafor,Waiting on proofs,signage,31-Aug-24,`,
  `J${w}2A,Backup review ${w},#REF!,,,,Marlow Accounting,Quoted,,,,,`,
  `J${w}3B,Finished job ${w},,,,,Delta Joinery,Completed,,Done,,10-Sep-24,12-Sep-24`,
  ',No number here,,,,,Nobody,Lead,,,,,'].join('\n');
const chooseAndPreview = async (page, text, vis) => {
  await page.locator('#imp-file').setInputFiles({ name: 'register.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  if (vis) await page.locator('#imp-vis').selectOption(vis);
  await page.getByRole('button', { name: 'Preview' }).click();
};

for (const [name, size] of [['phone 390px', { width: 390, height: 844 }], ['desktop 1440px', { width: 1440, height: 900 }]]) {
  test(`jobs: preview, confirm, then search and filter the register: ${name}`, async ({ page }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'Jobs' }).click();
    await page.getByRole('link', { name: 'Import jobs' }).click();
    await expect(page.getByRole('heading', { name: 'Import the Job Register' })).toBeVisible();
    await expect(page.getByText('never in a cloud session')).toBeVisible();
    await chooseAndPreview(page, csvFor(size.width), 'workspace');
    await expect(page.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(page.locator('dt', { hasText: 'New jobs' }).locator('+ dd')).toHaveText('3');
    await expect(page.locator('dt', { hasText: 'Skipped (no job number)' }).locator('+ dd')).toHaveText('1');
    await expect(page.getByRole('cell', { name: 'no job number' })).toBeVisible();
    await expect(page.getByText('unreadable start date')).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `.local/import-${size.width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Import 3' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished.' })).toBeVisible();
    await page.getByRole('link', { name: 'View jobs' }).click();
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
    await expect(page.getByRole('link', { name: `Shopfront signage ${size.width}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Finished job ${size.width}` })).toHaveCount(0); // Completed is hidden by default
    await page.getByLabel('Show Completed and Lost').check();
    await expect(page.getByRole('link', { name: `Finished job ${size.width}` })).toBeVisible();
    await page.getByLabel('Show Completed and Lost').uncheck();
    await expect(page.getByRole('link', { name: `Finished job ${size.width}` })).toHaveCount(0); // wait for the page to redraw before typing
    await page.getByLabel('Search by job number or title').fill(`J${size.width}2`);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: `Backup review ${size.width}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Shopfront signage ${size.width}` })).toHaveCount(0);
    await page.getByLabel('Search by job number or title').fill('');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: `Shopfront signage ${size.width}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Backup review ${size.width}` })).toBeVisible();
    await page.getByLabel('Client').selectOption('Pinecrest Florist');
    await expect(page.getByRole('link', { name: `Shopfront signage ${size.width}` })).toBeVisible();
    await expect(page.getByRole('link', { name: `Backup review ${size.width}` })).toHaveCount(0);
    await noOverflow(page);
    await page.screenshot({ path: `.local/jobs-${size.width}.png` });
    // run it again: nothing new, nothing duplicated
    await page.getByRole('link', { name: 'Import jobs' }).click();
    await chooseAndPreview(page, csvFor(size.width));
    await expect(page.locator('dt', { hasText: 'New jobs' }).locator('+ dd')).toHaveText('0');
    await expect(page.locator('dt', { hasText: 'Unchanged' }).locator('+ dd')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Import 0' })).toBeDisabled();
    expect(problems).toEqual([]);
  });
}

test('jobs: a member sees the register but has no import controls; a wrong file gets a plain reason', async ({ page }) => {
  const problems = watch(page);
  await signIn(page, 'admin');
  await page.goto(`${base}/#/import`);
  await chooseAndPreview(page, 'a,b,c\n1,2,3');
  await expect(page.getByRole('alert')).toContainText('header row has 3 columns');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'member');
  await page.getByRole('link', { name: 'Jobs' }).click();
  await expect(page.getByRole('link', { name: /Shopfront signage/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Import jobs' })).toHaveCount(0);
  await page.goto(`${base}/#/import`);
  await expect(page.getByText('We could not find that')).toBeVisible();
  expect(problems).toEqual([]);
});
