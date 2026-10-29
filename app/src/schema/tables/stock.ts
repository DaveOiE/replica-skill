import { text, uuid, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, localTable, cents, qty, oneOf, check } from '../helpers';

/** Stock is a ledger. The level is the sum of movements, never a number that gets overwritten. */
export const stockMovements = ledgerTable('stock_movements', {
  productUnitId: uuid('product_unit_id').notNull(),
  qty: qty('qty').notNull(), // signed, in the product unit's own unit
  kind: text('kind').notNull(),
  unitCostCents: cents('unit_cost_cents'),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  reason: text('reason'),
}, (t) => [
  index('stock_movements_unit').on(t.productUnitId), index('stock_movements_ref').on(t.refType, t.refId),
  check('stock_movements_kind', oneOf(t.kind, ['opening', 'sale', 'return_good', 'return_damaged', 'void_return', 'receipt', 'add', 'remove', 'defective', 'lost', 'set', 'convert_in', 'convert_out'])),
]);

/** Cache of SUM(qty) per product unit, kept by a trigger on every insert (local, synced or applied). Rebuildable. */
export const stockLevels = localTable('stock_levels', {
  productUnitId: uuid('product_unit_id').primaryKey(),
  qty: qty('qty').notNull().default('0'),
});

export const stockAdjustments = lwwTable('stock_adjustments', {
  title: text('title'),
  status: text('status').notNull().default('draft'),
  description: text('description'),
  authorUserId: uuid('author_user_id'),
}, (t) => [check('stock_adjustments_status', oneOf(t.status, ['draft', 'executed']))]);

export const stockAdjustmentLines = lwwTable('stock_adjustment_lines', {
  adjustmentId: uuid('adjustment_id').notNull(),
  productUnitId: uuid('product_unit_id').notNull(),
  action: text('action').notNull(),
  qty: qty('qty').notNull(),
  note: text('note'),
}, (t) => [index('stock_adjustment_lines_adj').on(t.adjustmentId), check('stock_adjustment_lines_action', oneOf(t.action, ['add', 'remove', 'defective', 'lost', 'set']))]);
