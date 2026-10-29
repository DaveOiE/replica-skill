import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { REGISTRY } from '../src/schema/helpers';
import * as schema from '../src/schema/index';
import { SCHEMA_VERSION } from '../src/schema/migrations.generated';
import { SYNCED_TABLES } from '../src/sync/apply';
import { insertRow } from '../src/db/sql';
import { newId } from '../src/domain/ids';
import { makeDevice, makeServer, PG_ADMIN, type TestServer, type TestDevice } from './helpers';

let server: TestServer; let dev: TestDevice;
beforeAll(async () => { server = await makeServer(); dev = await makeDevice('schema', { seed: true }); });
afterAll(async () => { await server.close(); });

const SERVER_ONLY = ['device_tokens', 'pairing_codes'];

describe('the table registry', () => {
  it('every table in the database is classified, and every classified table exists', async () => {
    const rows = await dev.db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name <> '_migrations'");
    expect(rows.map((r) => r.table_name).sort()).toEqual([...REGISTRY.keys()].sort());
  });
  it('the schema exports only tables that were created through a classifying helper', () => {
    const exported = Object.values(schema).filter((v: any) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in v).length;
    expect(exported).toBe(REGISTRY.size);
  });
  it('there are 60 synced and 11 local tables (update this when the model grows, on purpose)', () => {
    expect(SYNCED_TABLES.length).toBe(60);
    expect([...REGISTRY.values()].filter((v) => v.cls === 'local').length).toBe(11);
  });
  it('versioned tables carry version columns; ledger and owner tables carry device and time', async () => {
    const cols = await dev.db.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'");
    const has = (t: string, c: string) => cols.some((x) => x.table_name === t && x.column_name === c);
    for (const [name, { cls }] of REGISTRY) {
      if (cls === 'lww') for (const c of ['id', 'version', 'updated_at', 'updated_by_device']) expect(has(name, c), `${name}.${c}`).toBe(true);
      if (cls === 'ledger' || cls === 'owner') for (const c of ['id', 'device_id', 'created_at']) expect(has(name, c), `${name}.${c}`).toBe(true);
    }
  });
});

describe('sync safety is enforced by the database', () => {
  it('every synced table has change capture; local tables have none', async () => {
    const trg = (await dev.db.query<{ t: string; n: string }>("SELECT c.relname AS t, g.tgname AS n FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid WHERE NOT g.tgisinternal")).map((r) => `${r.t}:${r.n}`);
    for (const [name, { cls }] of REGISTRY) {
      expect(trg.includes(`${name}:tb_capture_${name}`), `capture on ${name}`).toBe(cls !== 'local');
      expect(trg.includes(`${name}:tb_guard_${name}`), `guard on ${name}`).toBe(cls !== 'local');
    }
  });
  it('ledger rows can be neither updated nor deleted', async () => {
    const pu = (await dev.db.query<{ id: string }>('SELECT id FROM product_units LIMIT 1'))[0]?.id ?? newId();
    const id = newId();
    await insertRow(dev.db, 'stock_movements', { id, device_id: dev.info.id, product_unit_id: pu, qty: '1', kind: 'opening' });
    await expect(dev.db.query('UPDATE stock_movements SET qty = 99 WHERE id = $1', [id])).rejects.toThrow('append-only');
    await expect(dev.db.query('DELETE FROM stock_movements WHERE id = $1', [id])).rejects.toThrow('append-only');
    const audit = newId();
    await insertRow(dev.db, 'audit_log', { id: audit, device_id: dev.info.id, action: 'test' });
    await expect(dev.db.query('DELETE FROM audit_log WHERE id = $1', [audit])).rejects.toThrow('append-only');
  });
  it('versioned rows are archived, never deleted', async () => {
    await expect(dev.db.query('DELETE FROM settings')).rejects.toThrow('never deleted');
    const p = newId();
    await insertRow(dev.db, 'products', { id: p, sku: 'DEL', name: 'x', updated_by_device: dev.info.id });
    await expect(dev.db.query('DELETE FROM products WHERE id = $1', [p])).rejects.toThrow('never deleted');
  });
  it('no synced table has a unique constraint besides its key (offline devices cannot enforce them)', async () => {
    const idx = await dev.db.query<{ tablename: string; indexname: string }>("SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE 'CREATE UNIQUE%'");
    const bad = idx.filter((i) => REGISTRY.get(i.tablename)?.cls !== 'local' && !i.indexname.endsWith('_pkey') && i.indexname !== 'orders_device_seq');
    expect(bad).toEqual([]);
  });
  it('the stock-level cache always equals the sum of the ledger', async () => {
    const pu = (await dev.db.query<{ id: string }>('SELECT id FROM product_units LIMIT 1'))[0]?.id ?? newId();
    for (const q of ['5', '-2', '1.5']) await insertRow(dev.db, 'stock_movements', { id: newId(), device_id: dev.info.id, product_unit_id: pu, qty: q, kind: 'add' });
    const [r] = await dev.db.query<{ cached: string; summed: string }>('SELECT (SELECT qty FROM stock_levels WHERE product_unit_id=$1)::numeric AS cached, (SELECT sum(qty) FROM stock_movements WHERE product_unit_id=$1)::numeric AS summed', [pu]);
    expect(Number(r.cached)).toBe(Number(r.summed));
  });
  it('an order\'s current status is its latest event, even if events arrive out of order', async () => {
    const orderId = newId();
    const ev = (value: string, at: string) => insertRow(dev.db, 'order_status_events', { id: newId(), device_id: dev.info.id, order_id: orderId, field: 'payment', value, created_at: at });
    await ev('paid', '2026-06-01T10:05:00Z');
    await ev('unpaid', '2026-06-01T10:00:00Z');   // an older event arriving later must not win
    const [s] = await dev.db.query<{ payment_status: string }>('SELECT payment_status FROM order_state WHERE order_id=$1', [orderId]);
    expect(s.payment_status).toBe('paid');
  });
  it('a journal entry written here must balance at commit; one applied from sync is not re-checked', async () => {
    const entry = newId(), acc = newId();
    await insertRow(dev.db, 'journal_entries', { id: entry, device_id: dev.info.id, source_type: 'test', event: 'x' });
    await expect(dev.db.transaction(async (tx) => {
      await insertRow(tx, 'journal_lines', { id: newId(), device_id: dev.info.id, entry_id: entry, account_id: acc, debit_cents: 100 });
    })).rejects.toThrow('does not balance');
    await dev.db.transaction(async (tx) => {
      await insertRow(tx, 'journal_lines', { id: newId(), device_id: dev.info.id, entry_id: entry, account_id: acc, debit_cents: 100 });
      await insertRow(tx, 'journal_lines', { id: newId(), device_id: dev.info.id, entry_id: entry, account_id: acc, credit_cents: 100 });
    });
    await dev.db.transaction(async (tx) => {
      await tx.query("SELECT set_config('tillbox.suppress','on',true)");
      await insertRow(tx, 'journal_lines', { id: newId(), device_id: dev.info.id, entry_id: entry, account_id: acc, debit_cents: 7 });
    });
  });
  it('a journal line must be a debit or a credit, never both or neither', async () => {
    await expect(insertRow(dev.db, 'journal_lines', { id: newId(), device_id: dev.info.id, entry_id: newId(), account_id: newId(), debit_cents: 1, credit_cents: 1 })).rejects.toThrow();
  });
});

describe('money is never a float', () => {
  it('no real, double or float column exists, and every *_cents column is a bigint', async () => {
    const cols = await dev.db.query<{ table_name: string; column_name: string; data_type: string }>("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public'");
    expect(cols.filter((c) => ['real', 'double precision'].includes(c.data_type))).toEqual([]);
    const cents = cols.filter((c) => c.column_name.endsWith('_cents'));
    expect(cents.length).toBeGreaterThan(40);
    expect(cents.filter((c) => c.data_type !== 'bigint')).toEqual([]);
  });
  it('amounts come back as JS numbers, quantities and rates as exact strings', async () => {
    const [r] = await dev.db.query<any>("SELECT 9007199254740991::bigint AS b, 0.333::numeric(18,5) AS q");
    expect(r.b).toBe(9007199254740991);
    expect(typeof r.q).toBe('string');
  });
});

describe('one schema, two engines', () => {
  it('the same migrations give PGlite and PostgreSQL identical tables, columns, indexes and triggers', async () => {
    const q = (extra: string) => `SELECT ${extra}`;
    const queries = [
      q("table_name, column_name, data_type, is_nullable, coalesce(column_default,'') AS d FROM information_schema.columns WHERE table_schema='public' AND table_name NOT IN ('device_tokens','pairing_codes') ORDER BY 1,2"),
      q("tablename, indexname FROM pg_indexes WHERE schemaname='public' AND tablename NOT IN ('device_tokens','pairing_codes') ORDER BY 1,2"),
      q("c.relname AS t, g.tgname AS n FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid WHERE NOT g.tgisinternal ORDER BY 1,2"),
    ];
    for (const sql of queries) {
      const a = await dev.db.query(sql), b = await server.db.query(sql);
      expect(a.length).toBeGreaterThan(100);
      expect(a).toEqual(b);
    }
  });
  it('the server also has its own tables, which devices never get', async () => {
    const a = await dev.db.query("SELECT 1 FROM information_schema.tables WHERE table_name IN ('device_tokens','pairing_codes')");
    const b = await server.db.query("SELECT table_name FROM information_schema.tables WHERE table_name IN ('device_tokens','pairing_codes')");
    expect(a.length).toBe(0); expect(b.length).toBe(SERVER_ONLY.length);
  });
  it('one Drizzle table object queries both engines', async () => {
    const onDevice = await drizzlePglite(dev.pg).select().from(schema.roles).where(eq(schema.roles.key, 'administrator'));
    expect(onDevice[0].name).toBe('Administrator');
    const cfg = (await server.db.query<{ d: string }>('select current_database() d'))[0].d;
    const pool = new Pool({ connectionString: PG_ADMIN.replace(/\/[^/]*$/, '/' + cfg) });
    expect(Array.isArray(await drizzlePg(pool).select().from(schema.roles))).toBe(true);
    await pool.end();
  });
  it('the generated migration module is up to date with the SQL files (run `npm run db:generate`)', () => {
    const files = readdirSync('drizzle').filter((f) => f.endsWith('.sql')).sort();
    const hash = createHash('sha256').update(files.map((f) => f + readFileSync(`drizzle/${f}`, 'utf8')).join('\n')).digest('hex').slice(0, 16);
    expect(SCHEMA_VERSION).toBe(hash);
  });
});
