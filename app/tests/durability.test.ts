import { describe, it, expect } from 'vitest';
import { flush } from '../src/db/durability';
import { pgliteOptions } from '../src/db/pglite';
import { createLogicalExport } from '../src/backup/backup';
import { createSimpleProduct } from '../src/services/catalogue';
import { syncOnce } from '../src/sync/client';
import type { Db } from '../src/db/types';
import { makeDevice, makeServer, connect } from './helpers';

/** A database that records every statement, so a test can see the ORDER things happen in. */
function spy(db: Db, log: string[]): Db {
  return {
    exec: db.exec.bind(db),
    query: async (sql, p) => { log.push(sql.replace(/\s+/g, ' ').trim().slice(0, 40)); return db.query(sql, p); },
    transaction: (f) => { log.push('BEGIN'); return db.transaction((tx) => f(spy(tx, log))); },
    ...(db.durable ? { durable: async () => { log.push('DURABLE'); await db.durable!(); } } : {}),
  };
}

describe('durability rules for browser storage', () => {
  it('only browser-stored databases use the relaxed flush; memory and file stores keep the default', () => {
    expect(pgliteOptions('idb://tillbox')).toMatchObject({ relaxedDurability: true });
    expect(pgliteOptions(undefined)).not.toHaveProperty('relaxedDurability');
    expect(pgliteOptions('idb://x', { relaxedDurability: false })).toMatchObject({ relaxedDurability: false }); // the benchmark compares both
  });
  it('on the device, flush asks the engine for a strict write; elsewhere it is a no-op query', async () => {
    const d = await makeDevice('flush');
    const log: string[] = []; await flush(spy(d.db, log));
    expect(log).toEqual(['DURABLE']);
    expect(d.db.durable).toBeTypeOf('function');
    const plain: Db = { exec: d.db.exec, query: d.db.query, transaction: d.db.transaction };   // like the server's database
    const log2: string[] = []; await flush(spy(plain, log2));
    expect(log2).toEqual(['SELECT 1 AS durable']);
  });
  it('a transaction handle has no durable(): flushing inside a transaction would wait on itself', async () => {
    const d = await makeDevice('tx');
    await d.db.transaction(async (tx) => { expect(tx.durable).toBeUndefined(); });
  });
  it('a device makes its writes durable BEFORE it sends anything to a server (so a crash cannot reuse an order number)', async () => {
    const server = await makeServer();
    try {
      const d = await makeDevice('barrier', { seed: true });
      await createSimpleProduct(d.ctx, { sku: 'D1', name: 'd', priceCents: 100, openingStock: 1, taxGroupId: null });
      await connect(d, server);
      const log: string[] = [];
      await syncOnce(spy(d.db, log) as Db);
      const firstFlush = log.indexOf('DURABLE'), firstPush = log.findIndex((s) => s.startsWith('SELECT o.seq'));
      expect(firstFlush).toBeGreaterThanOrEqual(0); expect(firstPush).toBeGreaterThan(firstFlush);
    } finally { await server.close(); }
  });
  it('a logical export reads the whole shop in ONE transaction: one consistent snapshot, one storage flush', async () => {
    const d = await makeDevice('snap', { seed: true });
    const log: string[] = [];
    await createLogicalExport(spy(d.db, log), 'a long passphrase here', { iterations: 1000 });
    expect(log.filter((s) => s === 'BEGIN')).toHaveLength(1);
    expect(log.indexOf('BEGIN')).toBeLessThan(log.findIndex((s) => s.startsWith('SELECT id::text')));
  });
});
