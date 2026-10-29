import { text, boolean, integer, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, cents, qty, rate, oneOf, check, sql } from '../helpers';

export const categories = lwwTable('categories', {
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  imageMediaId: uuid('image_media_id'),
  showOnPos: boolean('show_on_pos').notNull().default(true),
  sortPosition: integer('sort_position').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const unitGroups = lwwTable('unit_groups', { name: text('name').notNull(), active: boolean('active').notNull().default(true) });

export const units = lwwTable('units', {
  groupId: uuid('group_id').notNull(),
  name: text('name').notNull(),
  symbol: text('symbol'),
  /** How many base units one of these is (base unit = 1). */
  ratioToBase: qty('ratio_to_base').notNull().default('1'),
  isBase: boolean('is_base').notNull().default(false),
  active: boolean('active').notNull().default(true),
}, (t) => [index('units_group').on(t.groupId)]);

export const taxes = lwwTable('taxes', {
  name: text('name').notNull(),
  rate: rate('rate').notNull(), // a fraction: 0.100000 is 10%
  active: boolean('active').notNull().default(true),
}, (t) => [check('taxes_rate_nonneg', sql`${t.rate} >= 0`)]);

export const taxGroups = lwwTable('tax_groups', {
  name: text('name').notNull(),
  defaultMode: text('default_mode').notNull().default('inclusive'),
  active: boolean('active').notNull().default(true),
}, (t) => [check('tax_groups_mode', oneOf(t.defaultMode, ['inclusive', 'exclusive']))]);

export const taxGroupTaxes = lwwTable('tax_group_taxes', {
  taxGroupId: uuid('tax_group_id').notNull(),
  taxId: uuid('tax_id').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [index('tax_group_taxes_group').on(t.taxGroupId)]);

/** Metadata only in Phase 0b; the image bytes are handled with the catalogue in Phase 2. */
export const media = lwwTable('media', {
  name: text('name').notNull(),
  mime: text('mime'),
  size: integer('size'),
  storageRef: text('storage_ref'),
});

export const products = lwwTable('products', {
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('simple'),
  categoryId: uuid('category_id'),
  parentId: uuid('parent_id'),
  taxGroupId: uuid('tax_group_id'),
  taxModeOverride: text('tax_mode_override'),
  trackStock: boolean('track_stock').notNull().default(true),
  status: text('status').notNull().default('available'),
  description: text('description'),
  imageMediaId: uuid('image_media_id'),
  searchable: boolean('searchable').notNull().default(true),
  pinned: boolean('pinned').notNull().default(false),
  sortPosition: integer('sort_position').notNull().default(0),
  expires: boolean('expires').notNull().default(false),
  onExpiry: text('on_expiry').notNull().default('allow_sales'),
  defaultPurchaseUnitId: uuid('default_purchase_unit_id'),
  reorderQty: qty('reorder_qty'),
  active: boolean('active').notNull().default(true),
}, (t) => [
  index('products_sku').on(t.sku), index('products_category').on(t.categoryId), index('products_name').on(t.name),
  check('products_kind', oneOf(t.kind, ['simple', 'service', 'bundle', 'variable', 'variant'])),
  check('products_status', oneOf(t.status, ['available', 'unavailable'])),
  check('products_tax_mode', oneOf(t.taxModeOverride, ['inclusive', 'exclusive'])),
]);

export const productUnits = lwwTable('product_units', {
  productId: uuid('product_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  barcode: text('barcode'),
  barcodeType: text('barcode_type'),
  priceSaleCents: cents('price_sale_cents').notNull().default(0),
  priceWholesaleCents: cents('price_wholesale_cents'),
  priceCustomCents: cents('price_custom_cents'),
  costCents: cents('cost_cents'),
  lowStockQty: qty('low_stock_qty').notNull().default('0'),
  stockAlert: boolean('stock_alert').notNull().default(false),
  scalePlu: text('scale_plu'),
  weighable: boolean('weighable').notNull().default(false),
  visible: boolean('visible').notNull().default(true),
}, (t) => [index('product_units_product').on(t.productId), index('product_units_barcode').on(t.barcode)]);

export const bundleItems = lwwTable('bundle_items', {
  bundleProductId: uuid('bundle_product_id').notNull(),
  productUnitId: uuid('product_unit_id').notNull(),
  qty: qty('qty').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [index('bundle_items_bundle').on(t.bundleProductId)]);

export const scaleRanges = lwwTable('scale_ranges', {
  name: text('name').notNull(),
  rangeStart: integer('range_start').notNull(),
  rangeEnd: integer('range_end').notNull(),
  nextPlu: integer('next_plu').notNull(),
});

/** Written when two devices created the same SKU: the older product wins and the other is folded into it. Id = loser's id. */
export const productMerges = ledgerTable('product_merges', {
  winnerId: uuid('winner_id').notNull(),
  reason: text('reason').notNull().default('same_sku'),
  data: jsonb('data'),
});
