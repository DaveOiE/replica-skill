// A sale that has been CONFIRMED on screen must survive the browser being killed outright (kill -9).
// This covers a crashed or force-closed app. It does not cover a power cut: that also depends on the operating
// system and the tablet's storage, which no web page can promise.
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PIN, setPin, unlock } from './helpers';

const launch = (dir: string): Promise<BrowserContext> =>
  chromium.launchPersistentContext(dir, { executablePath: process.env.PW_CHROMIUM, args: ['--no-sandbox'], baseURL: 'http://127.0.0.1:3100' });

function killBrowser(dir: string) {
  const lines = execSync('ps -eo pid=,args=').toString().split('\n').filter((l) => l.includes(`--user-data-dir=${dir}`));
  for (const l of lines) { try { process.kill(Number(l.trim().split(/\s+/)[0]), 'SIGKILL'); } catch { /* already gone */ } }
  return lines.length;
}

for (const mode of (process.env.CRASH_MODES ?? 'relaxed,strict').split(',')) test(`confirmed sales survive the browser being killed, three times in a row (${mode})`, async () => {
  test.setTimeout(300_000);
  const dir = mkdtempSync(join(tmpdir(), 'tb-crash-'));
  try {
    for (let round = 1; round <= 3; round++) {
      const ctx = await launch(dir); const p = ctx.pages()[0] ?? await ctx.newPage();
      await p.addInitScript((m) => { if (m === 'strict') localStorage.setItem('tb-durability', 'strict'); }, mode);
      await p.goto('/');
      if (round === 1) {
        await expect(p.getByTestId('first-new')).toBeVisible({ timeout: 90_000 });
        await p.getByTestId('first-new').click(); await setPin(p, PIN);
      } else {
        await unlock(p);
        await expect(p.getByTestId('count-orders')).toHaveText(String(round - 1), { timeout: 30_000 });   // everything confirmed before the kill is here
      }
      await p.getByTestId('sample-sale').click();
      await expect(p.getByTestId('sample-msg')).toContainText('recorded', { timeout: 30_000 });            // shown only after the durability barrier
      expect(killBrowser(dir)).toBeGreaterThan(0);                                                          // hard kill, no shutdown hooks
      await ctx.close().catch(() => {});
    }
    // a burst: ten sales as fast as a person could not tap, then the browser is killed in the middle of the flushes
    let ctx = await launch(dir); let p = ctx.pages()[0] ?? await ctx.newPage(); await p.goto('/'); await unlock(p);
    await expect(p.getByTestId('count-orders')).toHaveText('3', { timeout: 30_000 });
    for (let i = 0; i < 10; i++) { await p.getByTestId('sample-sale').click(); await p.waitForTimeout(40); }
    await expect(p.getByTestId('count-orders')).toHaveText('13', { timeout: 60_000 });
    await expect(p.getByTestId('sample-msg')).toContainText('recorded', { timeout: 60_000 });
    killBrowser(dir); await ctx.close().catch(() => {});

    // after the burst and the kill: every confirmed sale is there, and the database is whole (a full backup restores and matches)
    ctx = await launch(dir); p = ctx.pages()[0] ?? await ctx.newPage(); await p.goto('/data-safety/?save=download'); await unlock(p);
    await p.getByRole('link', { name: 'Home' }).click();
    await expect(p.getByTestId('count-orders')).toHaveText('13', { timeout: 30_000 });
    await p.goto('/data-safety/?save=download'); await unlock(p);   // the plain download route (a save dialog cannot be driven headless)
    await p.getByTestId('backup-pass').fill('correct horse battery staple');
    const dl = p.waitForEvent('download'); await p.getByTestId('backup-file').click(); await dl;
    await expect(p.getByTestId('backup-result')).toContainText('Backed up and verified', { timeout: 90_000 });
    await ctx.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
