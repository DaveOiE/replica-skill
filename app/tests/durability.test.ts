import { describe, it, expect, vi } from 'vitest';
import { flush } from '../src/db/durability';
import { usesWriteBehind } from '../src/db/pglite';
import { installWriteBehind, DEBOUNCE_MS } from '../src/db/writebehind';
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
  it('only browser-stored databases use write-behind; memory stores keep the engine default', () => {
    expect(usesWriteBehind('idb://tillbox')).toBe(true);
    expect(usesWriteBehind(undefined)).toBe(false);
    expect(usesWriteBehind('memory://x')).toBe(false);
    expect(usesWriteBehind('idb://x', { writeBehind: false })).toBe(false);     // the benchmark compares both
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

describe('write-behind (the part that decides when data reaches browser storage)', () => {
  const stub = () => {
    const writes: boolean[] = []; let failNext = false; let engineSyncs = 0;
    const pg = {
      syncToFs: async () => { engineSyncs++; },
      runExclusive: async <T>(fn: () => Promise<T>) => fn(),
      fs: { syncToFs: async (relaxed?: boolean) => { if (failNext) { failNext = false; throw new Error('quota'); } writes.push(!!relaxed); } },
    };
    return { pg, writes, failOnce: () => { failNext = true; }, engineSyncs: () => engineSyncs };
  };
  it('replaces the engine\'s per-statement copy: a statement only marks the database dirty', async () => {
    const s = stub(); const wb = installWriteBehind(s.pg, { setTimer: (() => 0) as never });
    await s.pg.syncToFs(); await s.pg.syncToFs(); await s.pg.syncToFs();
    expect(wb.dirty()).toBe(true); expect(s.writes).toEqual([]);                 // nothing written yet, however many statements
  });
  it('commit writes once, STRICTLY, however many statements ran; a second commit with nothing new writes nothing', async () => {
    const s = stub(); const wb = installWriteBehind(s.pg, { setTimer: (() => 0) as never });
    for (let i = 0; i < 20; i++) await s.pg.syncToFs();
    await wb.commit();
    expect(s.writes).toEqual([false]); expect(wb.dirty()).toBe(false);
    await wb.commit(); expect(s.writes).toEqual([false]);
  });
  it('concurrent commits are serialised and coalesced', async () => {
    const s = stub(); const wb = installWriteBehind(s.pg, { setTimer: (() => 0) as never });
    await s.pg.syncToFs();
    await Promise.all([wb.commit(), wb.commit(), wb.commit()]);
    expect(s.writes).toHaveLength(1);
  });
  it('saves by itself shortly after the last change if nobody asks', async () => {
    vi.useFakeTimers();
    const s = stub(); const wb = installWriteBehind(s.pg);
    await s.pg.syncToFs(); await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 10); expect(s.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(20); expect(s.writes).toEqual([false]); expect(wb.dirty()).toBe(false);
    vi.useRealTimers();
  });
  it('a failed save is reported to the caller and the database stays dirty so the next commit retries', async () => {
    const s = stub(); const wb = installWriteBehind(s.pg, { setTimer: (() => 0) as never });
    await s.pg.syncToFs(); s.failOnce();
    await expect(wb.commit()).rejects.toThrow('quota');
    expect(wb.dirty()).toBe(true);
    await wb.commit(); expect(s.writes).toEqual([false]); expect(wb.dirty()).toBe(false);
  });
  it('stop() saves what is left and cancels the timer, so closing the database cannot race a hidden write', async () => {
    vi.useFakeTimers();
    const s = stub(); const wb = installWriteBehind(s.pg);
    await s.pg.syncToFs(); await wb.stop();
    expect(s.writes).toEqual([false]);
    await vi.advanceTimersByTimeAsync(5000); expect(s.writes).toEqual([false]);   // the timer is gone
    vi.useRealTimers();
  });
});
