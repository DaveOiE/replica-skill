import { text, boolean, uuid, date, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, cents, qty, oneOf, check } from '../helpers';

export const providers = lwwTable('providers', {
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  note: text('note'),
  active: boolean('active').notNull().default(true),
});

export const procurements = lwwTable('procurements', {
  providerId: uuid('provider_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  paymentStatus: text('payment_status').notNull().default('unpaid'),
  invoiceRef: text('invoice_ref'),
  invoiceDate: date('invoice_date'),
  deliveryDate: date('delivery_date'),
  autoApprove: boolean('auto_approve').notNull().default(false),
  costTotalCents: cents('cost_total_cents').notNull().default(0),
  taxTotalCents: cents('tax_total_cents').notNull().default(0),
  note: text('note'),
}, (t) => [
  index('procurements_provider').on(t.providerId),
  check('procurements_status', oneOf(t.status, ['draft', 'pending', 'delivered', 'stocked'])),
  check('procurements_payment', oneOf(t.paymentStatus, ['unpaid', 'paid'])),
]);

export const procurementLines = lwwTable('procurement_lines', {
  procurementId: uuid('procurement_id').notNull(),
  productUnitId: uuid('product_unit_id').notNull(),
  qty: qty('qty').notNull(),
  purchasePriceCents: cents('purchase_price_cents').notNull(),
  taxGroupId: uuid('tax_group_id'),
  taxMode: text('tax_mode'),
  taxCents: cents('tax_cents').notNull().default(0),
  expiryDate: date('expiry_date'),
  barcode: text('barcode'),
  active: boolean('active').notNull().default(true),
}, (t) => [index('procurement_lines_proc').on(t.procurementId)]);

export const procurementPayments = ledgerTable('procurement_payments', {
  procurementId: uuid('procurement_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
  method: text('method'),
  note: text('note'),
}, (t) => [index('procurement_payments_proc').on(t.procurementId)]);

export const purchasePriceHistory = ledgerTable('purchase_price_history', {
  productUnitId: uuid('product_unit_id').notNull(),
  procurementId: uuid('procurement_id'),
  costCents: cents('cost_cents').notNull(),
  qty: qty('qty').notNull(),
}, (t) => [index('purchase_price_history_unit').on(t.productUnitId, t.createdAt)]);
