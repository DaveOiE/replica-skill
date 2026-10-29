import { text, boolean, integer, uuid, date, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, cents, qty, ts, oneOf, check, sql } from '../helpers';

export const customerGroups = lwwTable('customer_groups', {
  name: text('name').notNull(),
  description: text('description'),
  rewardProgramId: uuid('reward_program_id'),
  active: boolean('active').notNull().default(true),
});

export const customers = lwwTable('customers', {
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  email: text('email'),
  phone: text('phone'),
  groupId: uuid('group_id'),
  creditLimitCents: cents('credit_limit_cents').notNull().default(0),
  birthDate: date('birth_date'),
  note: text('note'),
  active: boolean('active').notNull().default(true),
}, (t) => [index('customers_phone').on(t.phone), index('customers_email').on(t.email), index('customers_name').on(t.lastName, t.firstName)]);

export const customerAddresses = lwwTable('customer_addresses', {
  customerId: uuid('customer_id').notNull(),
  kind: text('kind').notNull(),
  name: text('name'),
  line1: text('line1'),
  line2: text('line2'),
  city: text('city'),
  region: text('region'),
  postcode: text('postcode'),
  country: text('country'),
  phone: text('phone'),
  email: text('email'),
}, (t) => [index('customer_addresses_customer').on(t.customerId), check('customer_addresses_kind', oneOf(t.kind, ['billing', 'shipping']))]);

export const rewardPrograms = lwwTable('reward_programs', {
  name: text('name').notNull(),
  targetPoints: qty('target_points').notNull(),
  couponId: uuid('coupon_id'),
  active: boolean('active').notNull().default(true),
});

export const rewardRules = lwwTable('reward_rules', {
  programId: uuid('program_id').notNull(),
  fromCents: cents('from_cents').notNull(),
  toCents: cents('to_cents').notNull(),
  points: qty('points').notNull(),
  active: boolean('active').notNull().default(true),
});

/** Customer wallet. Balance = credits minus debits. Never overwritten. */
export const customerAccountEntries = ledgerTable('customer_account_entries', {
  customerId: uuid('customer_id').notNull(),
  operation: text('operation').notNull(),
  amountCents: cents('amount_cents').notNull(), // always positive; the operation says which way it moves
  orderId: uuid('order_id'),
  userId: uuid('user_id'),
  note: text('note'),
}, (t) => [index('customer_account_entries_customer').on(t.customerId), check('customer_account_entries_op', oneOf(t.operation, ['add', 'deduct', 'refund', 'payment'])), check('customer_account_entries_pos', sql`${t.amountCents} > 0`)]);

export const customerRewardEntries = ledgerTable('customer_reward_entries', {
  customerId: uuid('customer_id').notNull(),
  programId: uuid('program_id').notNull(),
  points: qty('points').notNull(), // signed
  orderId: uuid('order_id'),
  note: text('note'),
}, (t) => [index('customer_reward_entries_customer').on(t.customerId)]);

export const coupons = lwwTable('coupons', {
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  percent: text('percent'),            // decimal string, for kind = percent
  flatCents: cents('flat_cents'),      // for kind = flat
  minCartCents: cents('min_cart_cents'),
  maxCartCents: cents('max_cart_cents'),
  validFrom: ts('valid_from'),
  validUntil: ts('valid_until'),
  hoursStart: text('hours_start'),
  hoursEnd: text('hours_end'),
  usageLimit: integer('usage_limit'),
  perCustomerLimit: integer('per_customer_limit'),
  active: boolean('active').notNull().default(true),
}, (t) => [index('coupons_code').on(t.code), check('coupons_kind', oneOf(t.kind, ['percent', 'flat']))]);

export const couponScopes = lwwTable('coupon_scopes', {
  couponId: uuid('coupon_id').notNull(),
  scope: text('scope').notNull(),
  refId: uuid('ref_id').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [index('coupon_scopes_coupon').on(t.couponId), check('coupon_scopes_scope', oneOf(t.scope, ['product', 'category', 'customer', 'group']))]);

export const couponUses = ledgerTable('coupon_uses', {
  couponId: uuid('coupon_id').notNull(),
  customerId: uuid('customer_id'),
  orderId: uuid('order_id').notNull(),
  discountCents: cents('discount_cents').notNull(),
}, (t) => [index('coupon_uses_coupon').on(t.couponId)]);
