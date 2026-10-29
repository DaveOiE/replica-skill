import { text, boolean, integer, jsonb, uuid, date, index, unique } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, localTable, cents, qty, rate, oneOf, check, id, ts } from '../helpers';

/** Order types are data. Behaviour comes from a fixed set of flags (plan 4b item 6). */
export const orderTypes = lwwTable('order_types', {
  key: text('key').notNull(),
  name: text('name').notNull(),
  needsAddress: boolean('needs_address').notNull().default(false),
  needsTableLabel: boolean('needs_table_label').notNull().default(false),
  allowsShipping: boolean('allows_shipping').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  sortPosition: integer('sort_position').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

/** Payment types are data. `kind` is code: it decides change, cash rounding and ledger effects (plan 4b item 5). */
export const paymentTypes = lwwTable('payment_types', {
  key: text('key').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  accountId: uuid('account_id'),
  sortPosition: integer('sort_position').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, (t) => [check('payment_types_kind', oneOf(t.kind, ['cash', 'electronic', 'account']))]);

/** Immutable once written. Later facts (payments, refunds, status changes) are separate rows. */
export const orders = ledgerTable('orders', {
  numberSeq: integer('number_seq').notNull(),
  number: text('number').notNull(),
  customerId: uuid('customer_id'),
  orderTypeId: uuid('order_type_id'),
  cashierUserId: uuid('cashier_user_id'),
  registerSessionId: uuid('register_session_id'),
  tableLabel: text('table_label'),
  note: text('note'),
  noteOnReceipt: boolean('note_on_receipt').notNull().default(false),
  shippingAddress: jsonb('shipping_address'),
  currency: text('currency').notNull(),
  roundingMode: text('rounding_mode').notNull(),
  baseCents: cents('base_cents').notNull(),
  lineDiscountCents: cents('line_discount_cents').notNull().default(0),
  cartDiscountCents: cents('cart_discount_cents').notNull().default(0),
  couponDiscountCents: cents('coupon_discount_cents').notNull().default(0),
  netCents: cents('net_cents').notNull(),
  taxCents: cents('tax_cents').notNull(),
  shippingCents: cents('shipping_cents').notNull().default(0),
  grossCents: cents('gross_cents').notNull(),          // payable before cash rounding
  cashRoundingCents: cents('cash_rounding_cents').notNull().default(0),
  totalCents: cents('total_cents').notNull(),          // what the customer owes
  heldFromId: uuid('held_from_id'),
}, (t) => [
  // The order number is made unique per device by construction; this keeps a device from reusing a sequence number.
  unique('orders_device_seq').on(t.deviceId, t.numberSeq),
  index('orders_created').on(t.createdAt), index('orders_customer').on(t.customerId), index('orders_number').on(t.number),
]);

export const orderLines = ledgerTable('order_lines', {
  orderId: uuid('order_id').notNull(),
  productId: uuid('product_id').notNull(),
  productUnitId: uuid('product_unit_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  unitName: text('unit_name'),
  qty: qty('qty').notNull(),
  unitPriceCents: cents('unit_price_cents').notNull(),
  unitCostCents: cents('unit_cost_cents'),
  taxMode: text('tax_mode').notNull(),
  taxGroupId: uuid('tax_group_id'),
  baseCents: cents('base_cents').notNull(),
  lineDiscountCents: cents('line_discount_cents').notNull().default(0),
  cartDiscountCents: cents('cart_discount_cents').notNull().default(0),
  couponDiscountCents: cents('coupon_discount_cents').notNull().default(0),
  netCents: cents('net_cents').notNull(),
  taxCents: cents('tax_cents').notNull(),
  grossCents: cents('gross_cents').notNull(),
  note: text('note'),
}, (t) => [index('order_lines_order').on(t.orderId), index('order_lines_product').on(t.productId)]);

export const orderLineTaxes = ledgerTable('order_line_taxes', {
  orderLineId: uuid('order_line_id').notNull(),
  taxId: uuid('tax_id').notNull(),
  name: text('name').notNull(),
  rate: rate('rate').notNull(),
  amountCents: cents('amount_cents').notNull(),
}, (t) => [index('order_line_taxes_line').on(t.orderLineId)]);

export const orderStatusEvents = ledgerTable('order_status_events', {
  orderId: uuid('order_id').notNull(),
  field: text('field').notNull(),
  value: text('value').notNull(),
  reason: text('reason'),
  userId: uuid('user_id'),
}, (t) => [
  index('order_status_events_order').on(t.orderId, t.createdAt),
  check('order_status_events_field', oneOf(t.field, ['payment', 'process', 'delivery'])),
]);

/** Current status of each order = its latest event of each field. Maintained by a trigger. Local cache, rebuildable. */
export const orderState = localTable('order_state', {
  orderId: uuid('order_id').primaryKey(),
  paymentStatus: text('payment_status'),
  processStatus: text('process_status'),
  deliveryStatus: text('delivery_status'),
  updatedAt: ts('updated_at'),
});

export const orderPayments = ledgerTable('order_payments', {
  orderId: uuid('order_id').notNull(),
  paymentTypeId: uuid('payment_type_id').notNull(),
  kind: text('kind').notNull(),
  amountCents: cents('amount_cents').notNull(),
  tenderedCents: cents('tendered_cents').notNull(),
  changeCents: cents('change_cents').notNull().default(0),
  reference: text('reference'),
  registerSessionId: uuid('register_session_id'),
  instalmentId: uuid('instalment_id'),
  userId: uuid('user_id'),
}, (t) => [index('order_payments_order').on(t.orderId), check('order_payments_kind', oneOf(t.kind, ['cash', 'electronic', 'account']))]);

export const orderInstalments = ledgerTable('order_instalments', {
  orderId: uuid('order_id').notNull(),
  dueDate: date('due_date').notNull(),
  amountCents: cents('amount_cents').notNull(),
}, (t) => [index('order_instalments_order').on(t.orderId)]);

export const orderCoupons = ledgerTable('order_coupons', {
  orderId: uuid('order_id').notNull(),
  couponId: uuid('coupon_id').notNull(),
  code: text('code').notNull(),
  discountCents: cents('discount_cents').notNull(),
});

export const refunds = ledgerTable('refunds', {
  orderId: uuid('order_id').notNull(),
  reason: text('reason'),
  userId: uuid('user_id'),
  registerSessionId: uuid('register_session_id'),
  grossCents: cents('gross_cents').notNull(),
  taxCents: cents('tax_cents').notNull(),
  shippingCents: cents('shipping_cents').notNull().default(0),
}, (t) => [index('refunds_order').on(t.orderId)]);

export const refundLines = ledgerTable('refund_lines', {
  refundId: uuid('refund_id').notNull(),
  orderLineId: uuid('order_line_id').notNull(),
  qty: qty('qty').notNull(),
  grossCents: cents('gross_cents').notNull(),
  taxCents: cents('tax_cents').notNull(),
  taxParts: jsonb('tax_parts').notNull(),
  condition: text('condition').notNull(),
  restock: boolean('restock').notNull(),
}, (t) => [index('refund_lines_refund').on(t.refundId), index('refund_lines_line').on(t.orderLineId), check('refund_lines_condition', oneOf(t.condition, ['good', 'damaged']))]);

export const refundPayments = ledgerTable('refund_payments', {
  refundId: uuid('refund_id').notNull(),
  paymentTypeId: uuid('payment_type_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
});

/** Held carts stay on the device that held them. They are cart snapshots, not orders. */
export const heldOrders = localTable('held_orders', {
  id: id(),
  name: text('name'),
  payload: jsonb('payload').notNull(),
  totalCentsAtHold: cents('total_cents_at_hold').notNull(),
  heldAt: ts('held_at').notNull().defaultNow(),
  expiresAt: ts('expires_at'),
});
