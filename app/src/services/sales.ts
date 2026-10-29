// WALKING SKELETON. A sale end to end through the real pieces (settings -> engine -> schema -> audit -> events).
// It is enough to prove the architecture and to drive the sync, perf and backup tests. The full POS (Phase 3),
// orders and payments (Phase 4) build on it.
import { newId } from '../domain/ids';
import { insertRow } from '../db/sql';
import { runService, actorId, type Ctx } from './runner';
import { getSetting, loadPricingConfig } from '../settings/service';
import { D, priceCart, roundCashDue, type CartLine, type Coupon, type Discount, type PricedCart, type TaxGroup } from '../domain/engine';
import type { Db } from '../db/types';

export interface SaleLineInput { productUnitId: string; qty: string | number; unitPriceCents?: number; discount?: Discount | null }
export interface SalePaymentInput { paymentTypeId: string; amountCents: number; tenderedCents?: number }
export interface SaleInput {
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  customerId?: string | null;
  orderTypeId?: string | null;
  tableLabel?: string | null;
  note?: string | null;
  discount?: Discount | null;
  coupons?: Coupon[];
  registerSessionId?: string | null;
  shippingAddress?: Record<string, string> | null;
}
export interface SaleResult { orderId: string; number: string; totalCents: number; grossCents: number; cashRoundingCents: number; changeCents: number }

/** Everything needed to price and pay a sale, computed without writing anything. */
async function buildQuote(tx: Db, input: SaleInput) {
  if (!input.lines.length) throw new Error('a sale needs at least one line');
  const { pricing, cash } = await loadPricingConfig(tx);
  const currency = await getSetting(tx, 'currency');
  const pos = await getSetting(tx, 'pos');

  const orderTypeId = input.orderTypeId ?? pos.defaultOrderTypeId;
  const [orderType] = orderTypeId ? await tx.query<any>('SELECT id, name, needs_address, needs_table_label, active FROM order_types WHERE id = $1', [orderTypeId]) : [];
  if (orderTypeId && (!orderType || !orderType.active)) throw new Error('unknown or disabled order type');
  // behaviour comes from flags on the order type, which are data (plan 4b, fixed item 6)
  if (orderType?.needs_table_label && !input.tableLabel) throw new Error(`${orderType.name} orders need a table label`);
  if (orderType?.needs_address && !input.shippingAddress) throw new Error(`${orderType.name} orders need a delivery address`);

  const ids = input.lines.map((l) => l.productUnitId);
  const rows = await tx.query<any>(
    `SELECT pu.id AS pu_id, pu.price_sale_cents, pu.cost_cents, pu.product_id, p.name, p.sku, p.category_id, p.track_stock, p.tax_group_id, p.tax_mode_override, p.active, p.status,
            u.name AS unit_name, tg.default_mode
       FROM product_units pu JOIN products p ON p.id = pu.product_id JOIN units u ON u.id = pu.unit_id
       LEFT JOIN tax_groups tg ON tg.id = p.tax_group_id WHERE pu.id = ANY($1::uuid[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.pu_id, r]));
  const groupIds = [...new Set(rows.map((r) => r.tax_group_id).filter(Boolean))];
  const taxRows = groupIds.length ? await tx.query<any>(
    `SELECT tgt.tax_group_id, t.id, t.name, t.rate FROM tax_group_taxes tgt JOIN taxes t ON t.id = tgt.tax_id
      WHERE tgt.tax_group_id = ANY($1::uuid[]) AND tgt.active AND t.active ORDER BY t.name`, [groupIds]) : [];
  const groups = new Map<string, TaxGroup>(groupIds.map((g) => [g, { id: g, taxes: taxRows.filter((t) => t.tax_group_id === g).map((t) => ({ id: t.id, name: t.name, rate: String(t.rate) })) }]));

  const cartLines: CartLine[] = input.lines.map((l, i) => {
    const r = byId.get(l.productUnitId);
    if (!r || !r.active || r.status !== 'available') throw new Error('unknown or unavailable product');
    const q = new D(l.qty);
    if (q.lte(0)) throw new Error('quantity must be more than zero');
    if (!pos.allowDecimalQuantities && !q.isInteger()) throw new Error('quantity must be a whole number');
    return {
      id: `line-${i}`, productId: r.product_id, categoryId: r.category_id, name: r.name,
      unitPriceCents: l.unitPriceCents ?? r.price_sale_cents, qty: l.qty,
      taxGroup: r.tax_group_id ? groups.get(r.tax_group_id) ?? null : null,
      taxMode: (r.tax_mode_override ?? r.default_mode ?? 'inclusive') as 'inclusive' | 'exclusive', discount: l.discount ?? null,
    };
  });
  const priced = priceCart({ lines: cartLines, discount: input.discount ?? null, coupons: input.coupons ?? [] }, pricing);
  const gross = priced.totals.grossCents;

  const types = input.payments.length
    ? await tx.query<{ id: string; kind: string }>('SELECT id, kind FROM payment_types WHERE id = ANY($1::uuid[]) AND active', [input.payments.map((p) => p.paymentTypeId)]) : [];
  const kindOf = new Map(types.map((t) => [t.id, t.kind]));
  for (const p of input.payments) if (!kindOf.has(p.paymentTypeId)) throw new Error('unknown or inactive payment type');
  const nonCash = input.payments.filter((p) => kindOf.get(p.paymentTypeId) !== 'cash').reduce((a, p) => a + p.amountCents, 0);
  const cashPaid = input.payments.filter((p) => kindOf.get(p.paymentTypeId) === 'cash').reduce((a, p) => a + p.amountCents, 0);
  // cash rounding applies once, to the cash actually being paid; with no payments yet, quote it as if paid in cash
  const rounded = (cashPaid > 0 || !input.payments.length) ? roundCashDue(gross - nonCash, cash) : { payableCents: gross - nonCash, adjustmentCents: 0 };
  return { pricing, currency, orderType, byId, cartLines, priced, gross, kindOf, rounded, total: gross + rounded.adjustmentCents };
}

export interface Quote { totalCents: number; grossCents: number; cashRoundingCents: number; priced: PricedCart }
/** Price a sale without writing anything: what a screen shows while the cashier builds the cart. */
export async function quoteSale(db: Db, input: Omit<SaleInput, 'payments'> & { payments?: SalePaymentInput[] }): Promise<Quote> {
  const q = await buildQuote(db, { ...input, payments: input.payments ?? [] });
  return { totalCents: q.total, grossCents: q.gross, cashRoundingCents: q.rounded.adjustmentCents, priced: q.priced };
}

export async function createSale(ctx: Ctx, input: SaleInput): Promise<SaleResult> {
  return runService<SaleResult>(ctx, {
    name: 'sales.create', permission: 'orders.create',
    audit: (r) => ({ entityType: 'order', entityId: r.orderId, summary: `sale ${r.number}`, data: { totalCents: r.totalCents } }),
    events: (r) => ({ 'sale.created': { orderId: r.orderId, number: r.number, totalCents: r.totalCents } }),
  }, async (tx) => {
    const { pricing, currency, orderType, byId, cartLines, priced, gross, kindOf, rounded, total } = await buildQuote(tx, input);
    if (input.payments.reduce((a, p) => a + p.amountCents, 0) !== total) throw new Error(`payments (${input.payments.reduce((a, p) => a + p.amountCents, 0)}) must add up to the total (${total})`);
    if (input.payments.some((p) => kindOf.get(p.paymentTypeId) === 'account') && !input.customerId) throw new Error('paying from a customer account needs a customer');
    // order number: per-device sequence, so offline devices never collide
    const [dev] = await tx.query<{ order_prefix: string }>('SELECT order_prefix FROM devices WHERE id = $1', [ctx.deviceId]);
    const [{ next }] = await tx.query<{ next: number }>('SELECT coalesce(max(number_seq), 0) + 1 AS next FROM orders WHERE device_id = $1', [ctx.deviceId]);
    const number = `${dev.order_prefix}-${String(next).padStart(6, '0')}`;
    const orderId = newId();
    const base = { device_id: ctx.deviceId };
    await insertRow(tx, 'orders', {
      id: orderId, ...base, number_seq: next, number, customer_id: input.customerId ?? null, order_type_id: orderType?.id ?? null, shipping_address: input.shippingAddress ? JSON.stringify(input.shippingAddress) : null,
      cashier_user_id: actorId(ctx), register_session_id: input.registerSessionId ?? null, table_label: input.tableLabel ?? null, note: input.note ?? null,
      currency: currency.code, rounding_mode: pricing.rounding, base_cents: priced.totals.baseCents,
      line_discount_cents: priced.totals.lineDiscountCents, cart_discount_cents: priced.totals.cartDiscountCents, coupon_discount_cents: priced.totals.couponDiscountCents,
      net_cents: priced.totals.netCents, tax_cents: priced.totals.taxCents, gross_cents: gross, cash_rounding_cents: rounded.adjustmentCents, total_cents: total,
    });

    for (const [i, pl] of priced.lines.entries()) {
      const src = byId.get(input.lines[i].productUnitId);
      const lineId = newId();
      await insertRow(tx, 'order_lines', {
        id: lineId, ...base, order_id: orderId, product_id: src.product_id, product_unit_id: src.pu_id, name: src.name, sku: src.sku, unit_name: src.unit_name,
        qty: new D(pl.qty).toFixed(5), unit_price_cents: cartLines[i].unitPriceCents, unit_cost_cents: src.cost_cents, tax_mode: pl.taxMode, tax_group_id: src.tax_group_id,
        base_cents: pl.baseCents, line_discount_cents: pl.lineDiscountCents, cart_discount_cents: pl.cartDiscountCents, coupon_discount_cents: pl.couponDiscountCents,
        net_cents: pl.netCents, tax_cents: pl.taxCents, gross_cents: pl.grossCents,
      });
      for (const t of pl.taxParts) await insertRow(tx, 'order_line_taxes', { id: newId(), ...base, order_line_id: lineId, tax_id: t.taxId, name: t.name, rate: t.rate, amount_cents: t.amountCents });
      if (src.track_stock) {
        await insertRow(tx, 'stock_movements', { id: newId(), ...base, product_unit_id: src.pu_id, qty: new D(pl.qty).negated().toFixed(5), kind: 'sale', unit_cost_cents: src.cost_cents, ref_type: 'order', ref_id: orderId });
      }
    }
    let change = 0;
    for (const p of input.payments) {
      const kind = kindOf.get(p.paymentTypeId)!;
      const tendered = kind === 'cash' ? p.tenderedCents ?? p.amountCents : p.amountCents;
      if (tendered < p.amountCents) throw new Error('tendered amount is less than the amount due');
      const chg = kind === 'cash' ? tendered - p.amountCents : 0;
      change += chg;
      const payId = newId();
      await insertRow(tx, 'order_payments', { id: payId, ...base, order_id: orderId, payment_type_id: p.paymentTypeId, kind, amount_cents: p.amountCents, tendered_cents: tendered, change_cents: chg, register_session_id: input.registerSessionId ?? null, user_id: actorId(ctx) });
      if (kind === 'account') await insertRow(tx, 'customer_account_entries', { id: newId(), ...base, customer_id: input.customerId, operation: 'payment', amount_cents: p.amountCents, order_id: orderId, user_id: actorId(ctx) });
      if (kind === 'cash' && input.registerSessionId) {
        const reg = await tx.query<{ register_id: string }>('SELECT register_id FROM register_sessions WHERE id = $1', [input.registerSessionId]);
        if (reg[0]) {
          await insertRow(tx, 'register_entries', { id: newId(), ...base, session_id: input.registerSessionId, register_id: reg[0].register_id, kind: 'sale', amount_cents: p.amountCents + chg, order_id: orderId, payment_id: payId });
          if (chg) await insertRow(tx, 'register_entries', { id: newId(), ...base, session_id: input.registerSessionId, register_id: reg[0].register_id, kind: 'change', amount_cents: -chg, order_id: orderId, payment_id: payId });
        }
      }
    }
    await insertRow(tx, 'order_status_events', { id: newId(), ...base, order_id: orderId, field: 'payment', value: 'paid', user_id: actorId(ctx) });
    await insertRow(tx, 'order_status_events', { id: newId(), ...base, order_id: orderId, field: 'process', value: 'pending', user_id: actorId(ctx) });
    return { orderId, number, totalCents: total, grossCents: gross, cashRoundingCents: rounded.adjustmentCents, changeCents: change };
  });
}

