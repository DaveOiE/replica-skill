// ONE schema for every deployment mode. The same SQL is applied to the on-device
// PGlite database and to the server's PostgreSQL.
import { pgTable, uuid, text, integer, boolean, timestamp, bigserial, jsonb, unique } from 'drizzle-orm/pg-core';

export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Append-only. A row per device that has ever written data.
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  orderPrefix: text('order_prefix').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Versioned last-write-wins (catalogue).
export const products = pgTable('products', {
  id: uuid('id').primaryKey(),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  active: boolean('active').notNull().default(true),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedByDevice: uuid('updated_by_device').notNull(),
});

// Append-only ledger. Stock level = SUM(qty). Never updated, only reversed.
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id),
  qty: integer('qty').notNull(),
  kind: text('kind').notNull(), // opening | sale | return | adjustment | receipt
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  deviceId: uuid('device_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. Number = device prefix + per-device sequence, so offline devices never collide.
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey(),
  deviceId: uuid('device_id').notNull(),
  numberSeq: integer('number_seq').notNull(),
  number: text('number').notNull(),
  totalCents: integer('total_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('orders_device_seq').on(t.deviceId, t.numberSeq)]);

export const orderLines = pgTable('order_lines', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  name: text('name').notNull(),
  qty: integer('qty').notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
});

export const orderPayments = pgTable('order_payments', {
  id: uuid('id').primaryKey(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  kind: text('kind').notNull(),
  amountCents: integer('amount_cents').notNull(),
  tenderedCents: integer('tendered_cents').notNull(),
  changeCents: integer('change_cents').notNull(),
});

// Change feed. Filled by triggers on every synced table (device and server).
export const outbox = pgTable('outbox', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  tableName: text('table_name').notNull(),
  rowId: uuid('row_id').notNull(),
  op: text('op').notNull(),
  payload: jsonb('payload').notNull(),
  origin: text('origin').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
