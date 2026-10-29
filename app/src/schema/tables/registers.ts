import { text, uuid, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, ownerTable, cents, ts, oneOf, check } from '../helpers';
import { boolean } from 'drizzle-orm/pg-core';

export const registers = lwwTable('registers', {
  name: text('name').notNull(),
  status: text('status').notNull().default('closed'),
  active: boolean('active').notNull().default(true),
}, (t) => [check('registers_status', oneOf(t.status, ['closed', 'opened', 'disabled']))]);

/** A session belongs to the device that opened it. Two devices opening one register offline is reported, not prevented. */
export const registerSessions = ownerTable('register_sessions', {
  registerId: uuid('register_id').notNull(),
  openedBy: uuid('opened_by'),
  openedAt: ts('opened_at').notNull().defaultNow(),
  openingFloatCents: cents('opening_float_cents').notNull().default(0),
  closedBy: uuid('closed_by'),
  closedAt: ts('closed_at'),
  countedCents: cents('counted_cents'),
  expectedCents: cents('expected_cents'),
  differenceCents: cents('difference_cents'),
  status: text('status').notNull().default('open'),
}, (t) => [index('register_sessions_register').on(t.registerId), check('register_sessions_status', oneOf(t.status, ['open', 'closed']))]);

export const registerEntries = ledgerTable('register_entries', {
  sessionId: uuid('session_id').notNull(),
  registerId: uuid('register_id').notNull(),
  kind: text('kind').notNull(),
  amountCents: cents('amount_cents').notNull(), // signed: money in is positive, money out is negative
  orderId: uuid('order_id'),
  paymentId: uuid('payment_id'),
  userId: uuid('user_id'),
  note: text('note'),
}, (t) => [
  index('register_entries_session').on(t.sessionId),
  check('register_entries_kind', oneOf(t.kind, ['opening', 'closing', 'cash_in', 'cash_out', 'sale', 'change', 'refund', 'account_pay'])),
]);
