// Thin catalogue helpers needed by Phase 0b (tests, bench, shell). The full catalogue services arrive in Phase 2.
import { newId } from '../domain/ids';
import { insertRow } from '../db/sql';
import type { Db } from '../db/types';
import { runService, type Ctx } from './runner';
import { PRODUCT_ROOT_CTE } from '../sync/reconcile';

export interface NewProduct { sku: string; name: string; priceCents: number; costCents?: number; openingStock?: number; taxGroupId?: string | null; categoryId?: string | null; trackStock?: boolean; barcode?: string | null }

export async function createSimpleProduct(ctx: Ctx, p: NewProduct): Promise<{ productId: string; productUnitId: string }> {
  return runService(ctx, {
    name: 'products.create', permission: 'products.create',
    audit: (r) => ({ entityType: 'product', entityId: r.productId, summary: `created ${p.sku}` }),
  }, async (tx) => {
    const [unit] = await tx.query<{ id: string }>("SELECT u.id FROM units u JOIN unit_groups g ON g.id = u.group_id WHERE g.name = 'Count' AND u.is_base LIMIT 1");
    if (!unit) throw new Error('no base unit found; run the installer first');
    const productId = newId(), productUnitId = newId();
    await insertRow(tx, 'products', { id: productId, sku: p.sku, name: p.name, tax_group_id: p.taxGroupId ?? null, category_id: p.categoryId ?? null, track_stock: p.trackStock ?? true, updated_by_device: ctx.deviceId });
    await insertRow(tx, 'product_units', { id: productUnitId, product_id: productId, unit_id: unit.id, barcode: p.barcode ?? null, price_sale_cents: p.priceCents, cost_cents: p.costCents ?? null, updated_by_device: ctx.deviceId });
    if (p.openingStock) await insertRow(tx, 'stock_movements', { id: newId(), device_id: ctx.deviceId, product_unit_id: productUnitId, qty: String(p.openingStock), kind: 'opening' });
    return { productId, productUnitId };
  });
}

/** Catalogue edit: bump the version so the change wins over older versions everywhere. */
export async function editProduct(ctx: Ctx, productId: string, patch: { name?: string; active?: boolean }) {
  return runService(ctx, { name: 'products.update', permission: 'products.update', audit: () => ({ entityType: 'product', entityId: productId, summary: 'edited' }) }, async (tx) => {
    await tx.query(`UPDATE products SET name = coalesce($2, name), active = coalesce($3, active), version = version + 1, updated_at = clock_timestamp(), updated_by_device = $4 WHERE id = $1`,
      [productId, patch.name ?? null, patch.active ?? null, ctx.deviceId]);
  });
}
export async function setUnitPrice(ctx: Ctx, productUnitId: string, priceSaleCents: number) {
  return runService(ctx, { name: 'products.update', permission: 'products.update', audit: () => ({ entityType: 'product_unit', entityId: productUnitId, summary: `price ${priceSaleCents}` }) }, async (tx) => {
    await tx.query(`UPDATE product_units SET price_sale_cents = $2, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $3 WHERE id = $1`, [productUnitId, priceSaleCents, ctx.deviceId]);
  });
}

export interface StockRow { product_unit_id: string; product_id: string; sku: string; name: string; price_sale_cents: number; stock: string }

/** Grid query: stock comes from the trigger-maintained cache, so it never scans the ledger. Merged products fold into their winner. */
export async function stockGrid(db: Db, opts: { search?: string; limit?: number } = {}): Promise<StockRow[]> {
  const like = opts.search ? `%${opts.search.replace(/[%_]/g, '\\$&')}%` : null;
  return db.query<StockRow>(
    `${PRODUCT_ROOT_CTE}
     SELECT pu.id AS product_unit_id, p.id AS product_id, p.sku, p.name, pu.price_sale_cents,
            (coalesce(sl.qty, 0) + coalesce((
               SELECT sum(sl2.qty) FROM product_root pr JOIN product_units pu2 ON pu2.product_id = pr.id AND pu2.unit_id = pu.unit_id
                 JOIN stock_levels sl2 ON sl2.product_unit_id = pu2.id WHERE pr.root_id = p.id AND pr.id <> p.id), 0))::text AS stock
       FROM product_units pu JOIN products p ON p.id = pu.product_id
       LEFT JOIN stock_levels sl ON sl.product_unit_id = pu.id
      WHERE p.active AND p.status = 'available' AND NOT EXISTS (SELECT 1 FROM product_merges m WHERE m.id = p.id)
        AND ($1::text IS NULL OR p.name ILIKE $1 OR p.sku ILIKE $1 OR pu.barcode = $2)
      ORDER BY p.name LIMIT $3`, [like, opts.search ?? null, opts.limit ?? 200]);
}

/** Products whose stock went below zero because offline devices sold the same units. Flagged, never blocked. */
export async function stockExceptions(db: Db) {
  return db.query<{ product_unit_id: string; sku: string; name: string; stock: string }>(
    `SELECT sl.product_unit_id, p.sku, p.name, sl.qty::text AS stock FROM stock_levels sl
       JOIN product_units pu ON pu.id = sl.product_unit_id JOIN products p ON p.id = pu.product_id WHERE sl.qty < 0 ORDER BY p.name`);
}

export const stockOf = async (db: Db, productUnitId: string): Promise<string> =>
  (await db.query<{ q: string }>('SELECT coalesce((SELECT qty FROM stock_levels WHERE product_unit_id = $1), 0)::text AS q', [productUnitId]))[0].q;
