import { text, boolean, integer, jsonb, uuid, bigserial, index } from 'drizzle-orm/pg-core';
import { lwwTable, ownerTable, localTable, ts, id } from '../helpers';

export const meta = localTable('meta', { key: text('key').primaryKey(), value: text('value').notNull() });

/** One row per device that has ever written data. The owning device writes its own row. */
export const devices = ownerTable('devices', {
  name: text('name').notNull(),
  orderPrefix: text('order_prefix').notNull(),
});

/** The change feed. Filled by triggers on every synced table; the server's copy is what other devices pull. */
export const outbox = localTable('outbox', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  tableName: text('table_name').notNull(),
  rowId: uuid('row_id').notNull(),
  op: text('op').notNull(),
  payload: jsonb('payload').notNull(),
  origin: text('origin').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('outbox_origin_seq').on(t.origin, t.seq)]);

/** Settings are data. The set of keys, their types and validation live in code (src/settings). Values replicate. */
export const settings = lwwTable('settings', {
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
});

export const plugins = lwwTable('plugins', {
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config'),
});

export const notifications = localTable('notifications', {
  id: id(),
  userId: uuid('user_id'),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Backup history on this device. Never synced. */
export const backupRuns = localTable('backup_runs', {
  id: id(),
  destination: text('destination').notNull(), // file | s3 | drive
  status: text('status').notNull(),           // ok | failed
  bytes: integer('bytes'),
  verified: boolean('verified').notNull().default(false),
  detail: text('detail'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const importRuns = localTable('import_runs', {
  id: id(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  summary: jsonb('summary'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** PIN verifier and the vault key wrapped by the PIN. Local to the device; protected by the PIN, not by the sync. */
export const deviceSecrets = localTable('device_secrets', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
