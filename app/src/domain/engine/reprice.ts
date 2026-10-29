import { priceCart, type Cart, type CartLine, type PricedCart, type PricingConfig } from './pricing';

/** A cart as it was when the cashier put it on hold. */
export interface HeldLine extends CartLine {
  /** true when the cashier typed a price by hand; those are kept as typed. */
  manualPrice?: boolean;
}
export interface HeldCart extends Omit<Cart, 'lines'> {
  lines: HeldLine[];
  /** The payable total shown when the cart was held. */
  totalCentsAtHold: number;
}
/** What the catalogue says today for a product. `null` for a product that no longer exists or is inactive. */
export interface CurrentProduct {
  unitPriceCents: number;
  taxGroup: CartLine['taxGroup'];
  taxMode: CartLine['taxMode'];
  name?: string;
}
export type CurrentCatalogue = Map<string, CurrentProduct | null>;

export interface PriceChange { lineId: string; name: string; oldUnitPriceCents: number; newUnitPriceCents: number; deltaUnitCents: number }
export interface RepriceNotice {
  /** Lines whose unit price is different now. Lines whose price did not change are never listed. */
  changedLines: PriceChange[];
  /** Lines whose product is gone or inactive. They stay in the cart, flagged, and are left out of the total. */
  unavailableLines: { lineId: string; name: string }[];
  totalBeforeCents: number;
  totalAfterCents: number;
  totalDeltaCents: number;
  /** True when the total moved even though no unit price did (a tax rate or rounding change). */
  totalChangedWithoutPriceChange: boolean;
  /** False when there is nothing to tell the cashier: no notice is shown. */
  hasNotice: boolean;
}
export interface RepricedCart { cart: Cart; unavailableLineIds: string[]; priced: PricedCart; notice: RepriceNotice }

/**
 * Resume a held cart against today's catalogue and settings (plan A11).
 * Unit prices come from the catalogue unless the cashier typed one by hand. Tax group and tax mode always come from
 * the catalogue. The notice names every line whose unit price changed, with old and new price.
 */
export function repriceHeldCart(held: HeldCart, current: CurrentCatalogue, cfg: PricingConfig): RepricedCart {
  const changed: PriceChange[] = [];
  const unavailable: { lineId: string; name: string }[] = [];
  const lines: CartLine[] = [];
  for (const l of held.lines) {
    const now = current.get(l.productId);
    if (!now) { unavailable.push({ lineId: l.id, name: l.name }); continue; }
    const price = l.manualPrice ? l.unitPriceCents : now.unitPriceCents;
    if (price !== l.unitPriceCents) {
      changed.push({ lineId: l.id, name: l.name, oldUnitPriceCents: l.unitPriceCents, newUnitPriceCents: price, deltaUnitCents: price - l.unitPriceCents });
    }
    const { manualPrice: _m, ...rest } = l;
    lines.push({ ...rest, unitPriceCents: price, taxGroup: now.taxGroup, taxMode: now.taxMode });
  }
  const cart: Cart = { lines, discount: held.discount, coupons: held.coupons, shipping: held.shipping };
  const priced = priceCart(cart, cfg);
  const delta = priced.totals.grossCents - held.totalCentsAtHold;
  const noticeBase = {
    changedLines: changed, unavailableLines: unavailable,
    totalBeforeCents: held.totalCentsAtHold, totalAfterCents: priced.totals.grossCents, totalDeltaCents: delta,
    totalChangedWithoutPriceChange: delta !== 0 && changed.length === 0 && unavailable.length === 0,
  };
  return {
    cart, priced, unavailableLineIds: unavailable.map((u) => u.lineId),
    notice: { ...noticeBase, hasNotice: changed.length > 0 || unavailable.length > 0 || delta !== 0 },
  };
}
