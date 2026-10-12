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
  test(`forms: admin builds a form, a visitor sends a request from the public link, the assigned person gets the task: ${name}`, async ({ page, browser }) => {
    const problems = watch(page);
    await page.setViewportSize(size);
    await signIn(page, 'admin');
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: 'Website refresh' }).click();
    await page.getByRole('link', { name: 'Forms', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Request forms: Website refresh' })).toBeVisible();
    const formName = `Printer help ${size.width}`;
    await page.locator('#f-name').fill(formName);
    await page.locator('#f-assign').selectOption({ label: 'Sam Okafor' });
    await page.getByRole('button', { name: 'Create form' }).click();
    const item = page.locator('li.form-item', { hasText: formName });
    await expect(item).toBeVisible();
    await expect(item.getByText('0 requests received')).toBeVisible();
    const link = (await item.locator('code.secret').textContent()).trim();
    expect(link).toContain('/#/f/');
    await noOverflow(page);
    await page.screenshot({ path: `.local/forms-${size.width}.png`, fullPage: true });

    const visitor = await browser.newPage({ viewport: size });
    const vp = watch(visitor);
    await visitor.goto(link);
    await expect(visitor.getByRole('heading', { name: formName })).toBeVisible();
    await expect(visitor.getByRole('link', { name: 'Projects' })).toHaveCount(0); // no navigation, nothing from inside the workspace
    await expect(visitor.getByText('Website refresh')).toHaveCount(0);
    await expect(visitor.getByText('Brightside')).toHaveCount(0);
    await visitor.getByLabel(/What do you need help with/).fill(`Printer jam ${size.width}`);
    await visitor.getByLabel('Tell us more').fill('Second floor, since this morning');
    await noOverflow(visitor);
    await visitor.screenshot({ path: `.local/public-form-${size.width}.png` });
    await visitor.getByRole('button', { name: 'Send request' }).click();
    await expect(visitor.getByRole('heading', { name: 'Thanks, your request was sent.' })).toBeVisible();
    await visitor.close();

    await page.reload();
    await expect(page.locator('li.form-item', { hasText: formName }).getByText('1 requests received')).toBeVisible();
    const sam = await browser.newPage({ viewport: size });
    await sam.goto(base);
    await sam.getByLabel('Email').fill(creds.member.email);
    await sam.getByLabel('Password').fill(creds.member.password);
    await sam.getByRole('button', { name: 'Sign in' }).click();
    await expect(sam.getByRole('link', { name: `Printer jam ${size.width}` })).toBeVisible(); // assigned by the rule
    await sam.close();
    expect(problems).toEqual([]); expect(vp).toEqual([]);
  });
}

test('forms: closing a form kills its link, and a bad link gives the same plain answer', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(`${base}/#/p/${(await (await page.request.get(`${base}/api/v1/projects`)).json()).projects.find((p) => p.name === 'Website refresh').id}/forms`);
  const item = page.locator('li.form-item', { hasText: 'Scratch form' });
  const link = (await item.locator('code.secret').textContent()).trim();
  await item.getByRole('button', { name: /Close form: Scratch form/ }).click();
  await expect(page.locator('li.form-item', { hasText: 'Scratch form' }).getByText('Closed')).toBeVisible();
  const visitor = await page.context().browser().newPage();
  await visitor.goto(link);
  await expect(visitor.getByRole('heading', { name: 'This form is not available.' })).toBeVisible();
  await visitor.goto(`${base}/#/f/not-a-real-form`);
  await expect(visitor.getByRole('heading', { name: 'This form is not available.' })).toBeVisible();
  await visitor.close();
});
