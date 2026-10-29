import { describe, it, expect, vi } from 'vitest';
import { encrypt, decrypt, readHeader, validateBackupPassphrase } from '../src/backup/crypto';
import { createPhysicalBackup, restorePhysicalBackup, createVerifiedPhysicalBackup, createLogicalExport, importLogicalExport, fingerprint, backupStatus, shouldBackupNow, recordBackupRun, IncompatibleBackupError } from '../src/backup/backup';
import { backupFileName, saveToDevice, SaveCancelled } from '../src/backup/destinations/file';
import { backupToFile } from '../src/services/backups';
import { createSimpleProduct } from '../src/services/catalogue';
import { createSale } from '../src/services/sales';
import { restoreAsNewDevice, initDevice } from '../src/domain/store';
import { createPglite, fromPglite } from '../src/db/pglite';
import { migrate } from '../src/db/migrate';
import { SCHEMA_VERSION } from '../src/schema/migrations.generated';
import { makeDevice, makeServer, idOf, type TestDevice } from './helpers';
import { connectServer, syncOnce } from '../src/sync/client';

const PASS = 'correct horse battery staple';
const FAST = 5000;   // PBKDF2 iterations for tests; the real default is 600,000
const header = { kind: 'physical' as const, schemaVersion: SCHEMA_VERSION, createdAt: '2026-06-15T00:00:00Z', appVersion: 't' };

async function shopWithHistory(name: string): Promise<TestDevice & { pu: string }> {
  const d = await makeDevice(name, { seed: true });
  const p = await createSimpleProduct(d.ctx, { sku: 'B1', name: 'Backup me', priceCents: 450, openingStock: 40, taxGroupId: null });
  const card = await idOf(d.db, "SELECT id FROM payment_types WHERE key='card'");
  for (let i = 0; i < 4; i++) await createSale(d.ctx, { lines: [{ productUnitId: p.productUnitId, qty: 2 }], payments: [{ paymentTypeId: card, amountCents: 900 }] });
  return Object.assign(d, { pu: p.productUnitId });
}

describe('the encrypted container', () => {
  it('round-trips, shows its header without the passphrase, and never contains the plaintext', async () => {
    const blob = await encrypt(new TextEncoder().encode('PLAINTEXT-MARKER'), PASS, header, FAST);
    expect(readHeader(blob)).toMatchObject({ v: 2, kind: 'physical', schemaVersion: SCHEMA_VERSION, kdfIterations: FAST });
    expect(new TextDecoder().decode(blob)).not.toContain('PLAINTEXT-MARKER');
    const { data, header: h } = await decrypt(blob, PASS);
    expect(new TextDecoder().decode(data)).toBe('PLAINTEXT-MARKER'); expect(h.createdAt).toBe('2026-06-15T00:00:00Z');
  });
  it('a wrong passphrase, a flipped ciphertext byte, or a tampered header all fail', async () => {
    const blob = await encrypt(new Uint8Array([1, 2, 3]), PASS, header, FAST);
    await expect(decrypt(blob, 'a different long passphrase')).rejects.toThrow('wrong passphrase or damaged backup');
    const flipped = blob.slice(); flipped[flipped.length - 3] ^= 1;
    await expect(decrypt(flipped, PASS)).rejects.toThrow('damaged');
    // the header is readable but authenticated: changing the claimed schema version breaks decryption
    const tampered = blob.slice(); const at = new TextDecoder().decode(blob).indexOf(SCHEMA_VERSION);
    tampered[at] = tampered[at] === 48 ? 49 : 48;
    await expect(decrypt(tampered, PASS)).rejects.toThrow('damaged');
  });
  it('refuses things that are not backups', async () => {
    for (const junk of [new Uint8Array(), new Uint8Array(100), new TextEncoder().encode('TBX2' + 'x'.repeat(60))]) expect(() => readHeader(junk)).toThrow('not a Tillbox backup file');
    const huge = new Uint8Array(100); huge.set([0x54, 0x42, 0x58, 0x32], 0); new DataView(huge.buffer).setUint32(4, 99999);
    expect(() => readHeader(huge)).toThrow('not a Tillbox backup file');
    await expect(decrypt(new Uint8Array(100), PASS)).rejects.toThrow('not a Tillbox backup file');
  });
  it('there is no way to make an unencrypted backup: a weak or empty passphrase is refused', async () => {
    for (const weak of ['', 'short', 'aaaaaaaaaaaaaaaa', 'abababababab']) await expect(encrypt(new Uint8Array([1]), weak, header, FAST)).rejects.toThrow('backup passphrase');
    expect(validateBackupPassphrase(PASS)).toBeNull();
  });
  it('every backup uses a fresh salt and nonce', async () => {
    const [a, b] = [await encrypt(new Uint8Array([1]), PASS, header, FAST), await encrypt(new Uint8Array([1]), PASS, header, FAST)];
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('physical backup (snapshot of the whole database)', () => {
  it('is verified by restoring into a scratch database, and the restored copy keeps working', async () => {
    const d = await shopWithHistory('phys');
    const before = await fingerprint(d.db);
    const { bytes, check } = await createVerifiedPhysicalBackup(d.pg, PASS, { iterations: FAST });
    expect(check).toEqual(before);
    const restored = await restorePhysicalBackup(bytes, PASS);
    const rdb = fromPglite(restored);
    expect(await fingerprint(rdb)).toEqual(before);
    expect((await rdb.query<any>('SELECT qty FROM stock_levels WHERE product_unit_id=$1', [d.pu]))[0].qty).toBe('32.00000');
    await restored.close();
  });
  it('rejects a wrong passphrase, a logical file, and a file from a different database layout', async () => {
    const d = await shopWithHistory('phys2');
    const bytes = await createPhysicalBackup(d.pg, PASS, { iterations: FAST });
    await expect(restorePhysicalBackup(bytes, 'not the right passphrase')).rejects.toThrow('wrong passphrase');
    const logical = (await createLogicalExport(d.db, PASS, { iterations: FAST })).bytes;
    await expect(restorePhysicalBackup(logical, PASS)).rejects.toThrow('logical export');
    const foreign = await encrypt(new Uint8Array([1, 2, 3]), PASS, { ...header, schemaVersion: 'deadbeefdeadbeef' }, FAST);
    await expect(restorePhysicalBackup(foreign, PASS)).rejects.toBeInstanceOf(IncompatibleBackupError);
  });
  it('restoring as a new device keeps the history but gives a fresh identity', async () => {
    const d = await shopWithHistory('phys3');
    const restored = await restorePhysicalBackup(await createPhysicalBackup(d.pg, PASS, { iterations: FAST }), PASS);
    const rdb = fromPglite(restored);
    const id = await restoreAsNewDevice(rdb, 'second tablet');
    expect(id.id).not.toBe(d.info.id); expect(id.prefix).not.toBe(d.info.prefix);
    expect((await rdb.query('SELECT 1 FROM orders')).length).toBe(4);
    await restored.close();
  });
});

describe('logical export (portable records)', () => {
  it('restores into a brand new device with an identical fingerprint, stock caches rebuilt, and its own identity', async () => {
    const d = await shopWithHistory('logical');
    const { bytes, rows, check } = await createLogicalExport(d.db, PASS, { iterations: FAST });
    expect(rows).toBeGreaterThan(200);
    expect(readHeader(bytes).kind).toBe('logical');

    const pg = createPglite(); const nb = fromPglite(pg); await migrate(nb);
    const id = await initDevice(nb, 'replacement');
    const res = await importLogicalExport(nb, bytes, PASS);
    expect(res.rows).toBe(rows);
    const noDevices = (f: Awaited<ReturnType<typeof fingerprint>>) => ({ ...f, counts: { ...f.counts, devices: 0 } });
    expect(noDevices(await fingerprint(nb))).toEqual(noDevices(check));   // the replacement also has its own device row
    expect((await nb.query<any>('SELECT qty FROM stock_levels WHERE product_unit_id=$1', [d.pu]))[0].qty).toBe('32.00000');
    expect((await nb.query<any>("SELECT payment_status FROM order_state LIMIT 1"))[0].payment_status).toBe('paid');
    expect(id.id).not.toBe(d.info.id);                       // a logical restore can never clone a device identity
    await importLogicalExport(nb, bytes, PASS);              // importing twice changes nothing
    expect(noDevices(await fingerprint(nb))).toEqual(noDevices(check));
    await pg.close();
  });
  it('what it restores is pushed to a (new) server, so a lost server can be rebuilt from a file', async () => {
    const d = await shopWithHistory('rebuild');
    const { bytes } = await createLogicalExport(d.db, PASS, { iterations: FAST });
    const pg = createPglite(); const nb = fromPglite(pg); await migrate(nb); await initDevice(nb, 'replacement');
    await importLogicalExport(nb, bytes, PASS);
    const s = await makeServer();
    try {
      await connectServer(nb, { url: s.url, pairingCode: await s.pairingCode(), confirm: 'merge' });
      await syncOnce(nb);
      expect((await s.db.query('SELECT 1 FROM orders')).length).toBe(4);
      expect((await s.db.query('SELECT 1 FROM settings')).length).toBeGreaterThan(5);
    } finally { await s.close(); await pg.close(); }
  });
  it('refuses a physical file, a wrong passphrase, a truncated export and a different layout', async () => {
    const d = await shopWithHistory('logical2');
    const phys = await createPhysicalBackup(d.pg, PASS, { iterations: FAST });
    const pg = createPglite(); const nb = fromPglite(pg); await migrate(nb);
    await expect(importLogicalExport(nb, phys, PASS)).rejects.toThrow('database snapshot');
    const { bytes } = await createLogicalExport(d.db, PASS, { iterations: FAST });
    await expect(importLogicalExport(nb, bytes, 'wrong wrong wrong wrong')).rejects.toThrow('wrong passphrase');
    const foreign = await encrypt(new Uint8Array([1]), PASS, { ...header, kind: 'logical', schemaVersion: 'deadbeefdeadbeef' }, FAST);
    await expect(importLogicalExport(nb, foreign, PASS)).rejects.toBeInstanceOf(IncompatibleBackupError);
    // a truncated export: drop the end marker
    const { data, header: h } = await decrypt(bytes, PASS);
    const gun = new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')));
    const lines = new TextDecoder().decode(await gun.arrayBuffer()).split('\n');
    const cut = new TextEncoder().encode(lines.slice(0, -1).join('\n'));
    const gz = new Uint8Array(await new Response(new Blob([cut]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    await expect(importLogicalExport(nb, await encrypt(gz, PASS, h, FAST), PASS)).rejects.toThrow('incomplete');
    // a damaged export: delete one row but keep the marker
    const dropped = new TextEncoder().encode([lines[0], ...lines.slice(2)].join('\n'));
    const gz2 = new Uint8Array(await new Response(new Blob([dropped]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    await expect(importLogicalExport(nb, await encrypt(gz2, PASS, h, FAST), PASS)).rejects.toThrow('damaged');
    await pg.close();
  });
});

describe('reminders and the "scheduled" rule', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 5, 15) + n * 86_400_000);
  it('levels: never, ok, due, warn, urgent', async () => {
    const d = await makeDevice('remind');
    expect((await backupStatus(d.db, 3, day(0))).level).toBe('never');
    await recordBackupRun(d.db, { destination: 'file', status: 'ok', verified: true });
    const [{ at }] = await d.db.query<{ at: string }>('SELECT created_at::text AS at FROM backup_runs LIMIT 1');
    const base = new Date(at).getTime();
    const at_ = (days: number) => new Date(base + days * 86_400_000);
    expect((await backupStatus(d.db, 3, at_(1))).level).toBe('ok');
    expect((await backupStatus(d.db, 3, at_(3.5))).level).toBe('due');
    expect((await backupStatus(d.db, 3, at_(7))).level).toBe('warn');
    expect((await backupStatus(d.db, 3, at_(11))).level).toBe('urgent');
  });
  it('a failed or unverified backup never counts as a good one', async () => {
    const d = await makeDevice('remind2');
    await recordBackupRun(d.db, { destination: 'file', status: 'failed', verified: false, detail: 'disk full' });
    await recordBackupRun(d.db, { destination: 's3', status: 'ok', verified: false });
    expect((await backupStatus(d.db, 3)).level).toBe('never');
  });
  it('a backup is due when the app is open past the interval, or a register has just closed', () => {
    const s = { lastVerifiedAt: '2026-06-15T00:00:00Z', ageDays: 0, level: 'ok' as const };
    const t = (h: number) => new Date(Date.parse('2026-06-15T00:00:00Z') + h * 3_600_000);
    expect(shouldBackupNow(s, { intervalHours: 24, now: t(12) })).toBe(false);
    expect(shouldBackupNow(s, { intervalHours: 24, now: t(25) })).toBe(true);
    expect(shouldBackupNow(s, { intervalHours: 24, now: t(1), registerJustClosed: true })).toBe(true);
    expect(shouldBackupNow({ lastVerifiedAt: null, ageDays: null, level: 'never' }, { intervalHours: 24 })).toBe(true);
  });
});

describe('saving to the device', () => {
  it('names files by device and time (UTC), safe on every filesystem', () => {
    expect(backupFileName('K7QM', new Date('2026-06-15T09:05:07Z'))).toBe('tillbox-backup-K7QM-20260615-090507.tbx');
    expect(backupFileName('a/b:c', new Date('2026-06-15T09:05:07Z'))).toBe('tillbox-backup-abc-20260615-090507.tbx');
  });
  const bytes = new Uint8Array([1, 2, 3]);
  it('uses the save dialog when the browser has one', async () => {
    const written: unknown[] = [];
    const env = { showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async (b: unknown) => { written.push(b); }, close: async () => {} }) }) };
    expect(await saveToDevice(bytes, 'x.tbx', { env })).toBe('picker'); expect(written).toHaveLength(1);
  });
  it('treats cancelling the dialog as a cancel, not an error or a silent download', async () => {
    const env = { showSaveFilePicker: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } };
    await expect(saveToDevice(bytes, 'x.tbx', { env })).rejects.toBeInstanceOf(SaveCancelled);
  });
  it('falls back to the share sheet, then to a download', async () => {
    const shared: string[] = [];
    const nav = { canShare: () => true, share: async (d: { files: File[] }) => { shared.push(d.files[0].name); } };
    expect(await saveToDevice(bytes, 'x.tbx', { env: { navigator: nav } })).toBe('share'); expect(shared).toEqual(['x.tbx']);
    const click = vi.fn(); const append = vi.fn();
    const doc = { createElement: () => ({ click, remove: vi.fn(), set href(_v: string) {}, set download(_v: string) {}, set rel(_v: string) {} }), body: { appendChild: append } } as unknown as Document;
    const url = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} } as unknown as typeof URL;
    expect(await saveToDevice(bytes, 'x.tbx', { env: { document: doc, URL: url } })).toBe('download'); expect(click).toHaveBeenCalledOnce();
    expect(await saveToDevice(bytes, 'x.tbx', { env: { navigator: { canShare: () => false, share: async () => {} }, document: doc, URL: url } })).toBe('download');
    await expect(saveToDevice(bytes, 'x.tbx', { env: {} })).rejects.toThrow('cannot save files');
  });
  it('a preferred route that fails is an error, not a silent switch', async () => {
    const env = { navigator: { canShare: () => true, share: async () => { throw new Error('share broke'); } } };
    await expect(saveToDevice(bytes, 'x.tbx', { prefer: 'share', env })).rejects.toThrow('share broke');
  });
});

describe('backup service: permission, audit and history', () => {
  it('needs the backups permission; a good run is recorded as verified, a failed one as failed', async () => {
    const d = await shopWithHistory('svc');
    const noPerm = { ...d.ctx, actor: { userId: 'u', isAdmin: false, permissions: new Set<string>() } };
    await expect(backupToFile(noPerm, d.pg, { passphrase: PASS, iterations: FAST, prefer: 'download' })).rejects.toThrow('permission denied');
    await expect(backupToFile(d.ctx, d.pg, { passphrase: 'weak', iterations: FAST, prefer: 'download' })).rejects.toThrow('backup passphrase');
    const runs = await d.db.query<any>('SELECT status, verified FROM backup_runs ORDER BY created_at');
    expect(runs).toEqual([{ status: 'failed', verified: false }]);
    // no browser here, so the "device" route throws and is recorded as a failure too
    await expect(backupToFile(d.ctx, d.pg, { passphrase: PASS, iterations: FAST, prefer: 'download' })).rejects.toThrow();
    expect((await d.db.query('SELECT 1 FROM backup_runs WHERE status = \'failed\'')).length).toBe(2);
    expect((await backupStatus(d.db, 3)).level).toBe('never');
  });
});
