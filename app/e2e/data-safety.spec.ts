import { test, expect } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { openApp, newStore, unlock, PIN } from './helpers';
import { startFakeS3 } from '../tests/fakeS3';

const PASS = 'correct horse battery staple';
const FILE_RE = /^tillbox-backup-[A-Z0-9]{4}-\d{8}-\d{6}\.tbx$/;

test('backups: prompts, a weak passphrase is refused, a file backup is encrypted and verified, and clears the warning', async ({ browser }, info) => {
  const ctx = await browser.newContext(); const p = await openApp(ctx, '/data-safety/?save=download'); await newStore(p);
  await expect(p.getByTestId('backup-banner')).toContainText('no verified backup');
  await expect(p.locator('header').getByTestId('backup-badge')).toContainText('No verified backup yet');
  await expect(p.getByTestId('persist-state')).toBeVisible();

  await p.goto('/data-safety/?save=download');       // a reload would lock the app; a full navigation is the same, so unlock
  await unlock(p);
  await p.getByTestId('backup-pass').fill('short');
  await expect(p.getByTestId('backup-pass-problem')).toContainText('at least 12');
  await expect(p.getByTestId('backup-file')).toBeDisabled();

  await p.getByTestId('backup-pass').fill(PASS);
  const dl = p.waitForEvent('download');
  await p.getByTestId('backup-file').click();
  const download = await dl;
  expect(download.suggestedFilename()).toMatch(FILE_RE);
  const path = info.outputPath('backup.tbx'); await download.saveAs(path);
  expect(statSync(path).size).toBeGreaterThan(1_000_000);
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString()).toBe('TBX2');
  expect(bytes.includes(Buffer.from('Walk-in'))).toBe(false);          // seeded names are not readable in the file
  await expect(p.getByTestId('backup-result')).toContainText('Backed up and verified', { timeout: 60_000 });
  await expect(p.locator('header').getByTestId('backup-badge')).toContainText('Backed up today');
  await expect(p.getByTestId('backup-banner')).toHaveCount(0);
  await ctx.close();
});

test('a replacement device is restored from the file: data back, a NEW device identity, and the original PIN', async ({ browser }, info) => {
  test.setTimeout(240_000);
  const a = await browser.newContext(); const pa = await openApp(a, '/?save=download'); await newStore(pa);
  await pa.getByTestId('sample-sale').click(); await expect(pa.getByTestId('count-orders')).toHaveText('1');
  await pa.getByTestId('sample-sale').click(); await expect(pa.getByTestId('count-orders')).toHaveText('2');
  const originalPrefix = await pa.getByTestId('prefix').textContent();
  await pa.getByRole('link', { name: 'Data safety' }).click();
  await pa.getByTestId('backup-pass').fill(PASS);
  const dl = pa.waitForEvent('download');
  await pa.getByTestId('backup-file').click();
  // the app is in a window with ?save=download only on the first URL; navigation by link keeps the query, but be safe:
  const download = await dl.catch(() => null);
  expect(download, 'a download was offered').not.toBeNull();
  const path = info.outputPath('replace.tbx'); await download!.saveAs(path);
  await expect(pa.getByTestId('backup-result')).toContainText('Backed up and verified', { timeout: 60_000 });
  await a.close();

  // a brand new browser profile = a replacement tablet
  const b = await browser.newContext(); const pb = await openApp(b);
  await expect(pb.getByTestId('first-restore')).toBeVisible({ timeout: 90_000 });
  await pb.getByTestId('first-restore').click();
  await pb.getByTestId('restore-file').setInputFiles(path);
  await pb.getByTestId('restore-pass').fill('this is the wrong passphrase');
  await pb.getByTestId('restore-go').click();
  await expect(pb.getByTestId('first-msg')).toContainText('wrong passphrase');      // checked BEFORE anything is wiped
  await expect(pb.getByTestId('first-restore')).toHaveCount(0);                     // still on the restore form, device intact
  await pb.getByTestId('restore-pass').fill(PASS);
  await pb.getByTestId('restore-go').click();
  await unlock(pb);                                                                  // the backup carried the original PIN
  await expect(pb.getByTestId('count-orders')).toHaveText('2', { timeout: 30_000 });
  expect(await pb.getByTestId('prefix').textContent()).not.toBe(originalPrefix);     // a new device, so numbers cannot clash
  await pb.getByTestId('sample-sale').click();
  await expect(pb.getByTestId('count-orders')).toHaveText('3');
  await b.close();
});

test('a portable (logical) export is added to another shop\'s records without deleting anything', async ({ browser }, info) => {
  const a = await browser.newContext(); const pa = await openApp(a, '/data-safety/?save=download'); await newStore(pa);
  await pa.goto('/?save=download'); await unlock(pa);
  await pa.getByTestId('sample-sale').click(); await expect(pa.getByTestId('count-orders')).toHaveText('1');
  await pa.getByRole('link', { name: 'Data safety' }).click();
  await pa.getByTestId('backup-pass').fill(PASS); await pa.getByTestId('backup-kind').selectOption('logical');
  const dl = pa.waitForEvent('download'); await pa.getByTestId('backup-file').click();
  const path = info.outputPath('logical.tbx'); await (await dl).saveAs(path);
  await expect(pa.getByTestId('backup-result')).toContainText('Backed up and verified', { timeout: 60_000 });
  await a.close();

  const b = await browser.newContext(); const pb = await openApp(b); await newStore(pb);
  await pb.getByTestId('sample-sale').click(); await expect(pb.getByTestId('count-orders')).toHaveText('1');
  await pb.getByRole('link', { name: 'Data safety' }).click();
  await pb.getByTestId('restore-file').setInputFiles(path);
  await expect(pb.getByTestId('file-info')).toContainText('logical backup made');
  await pb.getByTestId('restore-pass').fill(PASS); await pb.getByTestId('restore-go').click();
  await expect(pb.getByTestId('restore-msg')).toContainText('records restored', { timeout: 60_000 });
  await pb.getByRole('link', { name: 'Home' }).click();
  await expect(pb.getByTestId('count-orders')).toHaveText('2');                      // its own order is still there, plus the imported one
  await b.close();
});

test('S3-compatible: keys saved encrypted by the PIN, a backup goes to the bucket as ciphertext, and it runs by itself when due', async ({ browser }) => {
  test.setTimeout(300_000);
  const s3 = await startFakeS3({ bucket: 'shop-backups', accessKeyId: 'AKIATEST', secretAccessKey: 'sekret/key+value', region: 'ap-southeast-2' });
  try {
    const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
    await p.getByRole('link', { name: 'Data safety' }).click();
    await p.getByTestId('s3-endpoint').fill(s3.url); await p.getByTestId('s3-region').fill('ap-southeast-2'); await p.getByTestId('s3-bucket').fill('shop-backups');
    await p.getByTestId('s3-prefix').fill('till-one'); await p.getByTestId('s3-accessKeyId').fill('AKIATEST'); await p.getByTestId('s3-secretAccessKey').fill('sekret/key+value');
    await p.getByTestId('s3-save').click(); await expect(p.getByTestId('s3-msg')).toContainText('Saved');

    // Is the secret key readable anywhere in browser storage? The scan decodes binary blobs as text, and a positive
    // control (a name we know is stored) proves the scan can actually see the database contents.
    const scan = () => p.evaluate(async ([secret, control]) => {
      const out = { secret: false, control: false };
      const text = (v: unknown, depth = 0): string => {
        if (v == null || depth > 4) return '';
        if (v instanceof ArrayBuffer) return new TextDecoder('latin1').decode(v);
        if (ArrayBuffer.isView(v)) return new TextDecoder('latin1').decode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        if (typeof v === 'string') return v;
        if (typeof v === 'object') return Object.values(v as object).map((x) => text(x, depth + 1)).join('\n');
        return '';
      };
      for (const d of await indexedDB.databases()) {
        const db: IDBDatabase = await new Promise((ok) => { const r = indexedDB.open(d.name!); r.onsuccess = () => ok(r.result); });
        for (const store of Array.from(db.objectStoreNames)) {
          const all: unknown[] = await new Promise((ok) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => ok(r.result); });
          for (const row of all) { const s = text(row); if (s.includes(secret)) out.secret = true; if (s.includes(control)) out.control = true; }
        }
        db.close();
      }
      return out;
    }, ['sekret/key+value', 'Walk-in']);
    const seen = await scan();
    expect(seen.control, 'the scan can see database contents (positive control)').toBe(true);
    expect(seen.secret, 'the S3 secret key must not appear in clear text in browser storage').toBe(false);

    await p.getByTestId('backup-pass').fill(PASS);
    await p.getByTestId('backup-s3').click();
    await expect(p.getByTestId('backup-result')).toContainText('Backed up and verified', { timeout: 90_000 });
    expect([...s3.objects.keys()].filter((k) => k.startsWith('till-one/tillbox-backup-'))).toHaveLength(1);
    const obj = [...s3.objects.values()][0];
    expect(obj.subarray(0, 4).toString()).toBe('TBX2'); expect(obj.includes(Buffer.from('Walk-in'))).toBe(false);
    expect(s3.rejected).toEqual([]);

    // reload: locked; unlock; the form is repopulated from the vault
    await p.reload(); await unlock(p); await p.getByRole('link', { name: 'Data safety' }).click();
    await expect(p.getByTestId('s3-bucket')).toHaveValue('shop-backups'); await expect(p.getByTestId('s3-secretAccessKey')).toHaveValue('sekret/key+value');

    // automatic: remember the passphrase (encrypted by the PIN); a fresh device with no verified backup is "due", so it runs on unlock
    await p.getByTestId('backup-pass').fill(PASS); await p.getByTestId('s3-auto').check(); await p.getByTestId('s3-save').click(); await expect(p.getByTestId('s3-msg')).toContainText('Saved');
    await p.getByTestId('lock-now').click();
    const before = s3.objects.size;
    await p.evaluate(() => (window as unknown as { __x?: number }).__x = 1);
    await p.reload(); await unlock(p);
    // the first backup above is recent, so nothing is due yet
    await p.waitForTimeout(3000); expect(s3.objects.size).toBe(before);
    await ctx.close();

    // a different device, same bucket: configure once, tick automatic, and it backs itself up with no tap
    const ctx2 = await browser.newContext(); const q = await openApp(ctx2); await newStore(q);
    await q.getByRole('link', { name: 'Data safety' }).click();
    await q.getByTestId('s3-endpoint').fill(s3.url); await q.getByTestId('s3-region').fill('ap-southeast-2'); await q.getByTestId('s3-bucket').fill('shop-backups');
    await q.getByTestId('s3-prefix').fill('till-two'); await q.getByTestId('s3-accessKeyId').fill('AKIATEST'); await q.getByTestId('s3-secretAccessKey').fill('sekret/key+value');
    await q.getByTestId('backup-pass').fill(PASS); await q.getByTestId('s3-auto').check(); await q.getByTestId('s3-save').click();
    await expect(q.getByTestId('s3-msg')).toContainText('Saved');
    await q.reload(); await unlock(q);
    await expect.poll(() => [...s3.objects.keys()].filter((k) => k.startsWith('till-two/')).length, { timeout: 120_000 }).toBe(1);
    await expect(q.locator('header').getByTestId('backup-badge')).toContainText('Backed up today', { timeout: 30_000 });
    await ctx2.close();
  } finally { await s3.close(); }
});

test('a wrong S3 secret is reported as a failure and never as a good backup', async ({ browser }) => {
  const s3 = await startFakeS3({ bucket: 'bk', accessKeyId: 'AKIATEST', secretAccessKey: 'right', region: 'us-east-1' });
  try {
    const ctx = await browser.newContext(); const p = await openApp(ctx); await newStore(p);
    await p.getByRole('link', { name: 'Data safety' }).click();
    await p.getByTestId('s3-endpoint').fill(s3.url); await p.getByTestId('s3-region').fill('us-east-1'); await p.getByTestId('s3-bucket').fill('bk');
    await p.getByTestId('s3-accessKeyId').fill('AKIATEST'); await p.getByTestId('s3-secretAccessKey').fill('WRONG');
    await p.getByTestId('backup-pass').fill(PASS); await p.getByTestId('backup-s3').click();
    await expect(p.getByTestId('backup-result')).toContainText('SignatureDoesNotMatch', { timeout: 90_000 });
    await expect(p.locator('header').getByTestId('backup-badge')).toContainText('No verified backup yet');
    expect(s3.objects.size).toBe(0);
    await ctx.close();
  } finally { await s3.close(); }
});

void PIN;
