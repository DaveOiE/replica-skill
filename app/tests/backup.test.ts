import { describe, it, expect } from 'vitest';
import { addProduct, checkout, stockLevels } from '../src/domain/store';
import { createBackup, restoreBackup, createVerifiedBackup, fingerprint } from '../src/backup/backup';
import { decrypt } from '../src/backup/crypto';
import { fromPglite } from '../src/db/pglite';
import { makeDevice, makeServer, connect } from './helpers';
import { restoreAsNewDevice } from '../src/domain/store';
import { syncOnce } from '../src/sync/client';

describe('mode 1 backup and restore', () => {
  it('encrypts, restores to an identical database, and the restored device keeps working', async () => {
    const d = await makeDevice('till-backup');
    const p = await addProduct(d.db, { sku: 'B', name: 'Backup me', priceCents: 250, openingStock: 40 });
    for (let i = 0; i < 5; i++) await checkout(d.db, [{ productId: p, qty: 2 }], 500);
    const before = await fingerprint(d.pg);

    const bytes = await createBackup(d.pg, 'correct horse battery staple');
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('TBX1');
    expect(new TextDecoder().decode(bytes)).not.toContain('Backup me'); // ciphertext, not plaintext

    await expect(restoreBackup(bytes, 'wrong passphrase')).rejects.toThrow('wrong passphrase');
    const flipped = bytes.slice(); flipped[flipped.length - 5] ^= 1;
    await expect(decrypt(flipped, 'correct horse battery staple')).rejects.toThrow(); // tamper detection

    const restored = await restoreBackup(bytes, 'correct horse battery staple');
    expect(await fingerprint(restored)).toEqual(before);
    const rdb = fromPglite(restored);
    expect((await stockLevels(rdb))[0].stock).toBe(30);
    // identity survives: same device id, next order continues the sequence with no gap or repeat
    const next = await checkout(rdb, [{ productId: p, qty: 1 }], 250);
    expect(next.number).toBe(`${d.info.prefix}-000006`);
    await restored.close();
  });

  it('a backup is only reported good after it was restored into a scratch database and matched', async () => {
    const d = await makeDevice('till-verified');
    const p = await addProduct(d.db, { sku: 'V', name: 'V', priceCents: 100, openingStock: 3 });
    await checkout(d.db, [{ productId: p, qty: 1 }], 100);
    const { bytes, check } = await createVerifiedBackup(d.pg, 'pw');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(check.counts.orders).toBe(1);
  });

  it('restoring onto another device gives it a new identity, so order numbers can never clash with the original', async () => {
    const server = await makeServer();
    try {
      const original = await makeDevice('till-original');
      const p = await addProduct(original.db, { sku: 'X', name: 'X', priceCents: 100, openingStock: 20 });
      await checkout(original.db, [{ productId: p, qty: 1 }], 100);
      await connect(original, server.url); await syncOnce(original.db);
      const bytes = await createBackup(original.pg, 'pw');

      // the original keeps trading while the backup is restored on a second tablet
      const o2 = await checkout(original.db, [{ productId: p, qty: 1 }], 100);

      const copyPg = await restoreBackup(bytes, 'pw');
      const copy = fromPglite(copyPg);
      const id = await restoreAsNewDevice(copy, 'till-copy');
      expect(id.id).not.toBe(original.info.id);
      const c1 = await checkout(copy, [{ productId: p, qty: 1 }], 100);
      expect(c1.number).toBe(`${id.prefix}-000001`);        // fresh sequence under the new prefix
      expect(c1.number.startsWith(original.info.prefix)).toBe(false);

      await syncOnce(original.db); await syncOnce(copy); await syncOnce(original.db);
      const nums = (await server.db.query<{ number: string }>('SELECT number FROM orders ORDER BY number')).map((r) => r.number);
      expect(new Set(nums).size).toBe(nums.length);           // no duplicates anywhere
      expect(nums).toContain(o2.number); expect(nums).toContain(c1.number);
      expect((await stockLevels(original.db))[0].stock).toBe(17);   // 20 - 3 sales across both devices
      await copyPg.close();
    } finally { await server.close(); }
  });
});
