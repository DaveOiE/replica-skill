import { apportion } from './apportion';
import { couponEligibility, type Coupon, type CouponContext } from './coupon';
import { discountAmount, type Discount } from './discount';
import { D, roundToInt, type DecimalLike, type RoundingMode } from './rounding';
import { lineTax, type TaxGroup, type TaxMode, type TaxPart } from './tax';

export interface CartLine {
  id: string;
  productId: string;
  categoryId?: string | null;
  name: string;
  /** Unit price as entered, in the line's tax mode (a tax-inclusive price for an inclusive line). */
  unitPriceCents: number;
  qty: DecimalLike;
  taxGroup: TaxGroup | null;
  taxMode: TaxMode;
  discount?: Discount | null;
}
export interface Cart {
  lines: CartLine[];
  discount?: Discount | null;
  coupons?: Coupon[];
  shipping?: { cents: number; taxGroup?: TaxGroup | null; taxMode?: TaxMode } | null;
}
export interface PricingConfig {
  rounding: RoundingMode;
  /** Supplied by the caller for coupon windows; the engine has no clock. */
  nowIso: string;
  localTime: string;
}
export interface PricedLine {
  id: string; productId: string; name: string; qty: string;
  baseCents: number;            // unit price x qty, rounded once
  lineDiscountCents: number;
  cartDiscountCents: number;    // this line's share of the cart discount
  couponDiscountCents: number;  // this line's share of all coupons
  taxableCents: number;         // amount left after every discount, in the line's tax mode
  netCents: number; taxCents: number; grossCents: number;
  taxMode: TaxMode;
  taxParts: TaxPart[];
}
export interface AppliedCoupon { couponId: string; code: string; discountCents: number; problems: string[] }
export interface PricedCart {
  lines: PricedLine[];
  shipping: { netCents: number; taxCents: number; grossCents: number; taxParts: TaxPart[] };
  coupons: AppliedCoupon[];
  totals: {
    baseCents: number; lineDiscountCents: number; cartDiscountCents: number; couponDiscountCents: number;
    netCents: number; taxCents: number; grossCents: number; // grossCents = amount payable before cash rounding
  };
  taxByTax: { taxId: string; name: string; rate: string; amountCents: number }[];
}

/**
 * The calculation order is fixed (plan 4b, item 7):
 *   1. line = round(unit price x qty)                      rounded once, per line
 *   2. line discount                                       capped at the line
 *   3. cart discount, shared across lines                  largest remainder, weights = line amounts
 *   4. coupons in the order given, each shared across the lines it covers
 *   5. tax ONCE per line on what is left                   inclusive or exclusive, parts add up exactly
 *   6. shipping with its own optional tax
 * Totals are sums of already-rounded line values, so a receipt always adds up.
 */
export function priceCart(cart: Cart, cfg: PricingConfig): PricedCart {
  const mode = cfg.rounding;
  const n = cart.lines.length;
  const base = cart.lines.map((l) => {
    const q = new D(l.qty);
    if (q.isNegative() || !q.isFinite()) throw new RangeError('quantity must be zero or more');
    if (!Number.isSafeInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new RangeError('unit price must be a non-negative whole number of minor units');
    return roundToInt(q.times(l.unitPriceCents), mode);
  });
  const lineDisc = cart.lines.map((l, i) => discountAmount(base[i], l.discount, mode));
  const afterLine = base.map((b, i) => b - lineDisc[i]);

  const cartDiscTotal = discountAmount(afterLine.reduce((a, b) => a + b, 0), cart.discount, mode);
  const cartShare = apportion(cartDiscTotal, afterLine);
  const remaining = afterLine.map((a, i) => a - cartShare[i]);

  const couponShare = new Array<number>(n).fill(0);
  const applied: AppliedCoupon[] = [];
  for (const c of cart.coupons ?? []) {
    const ctx: CouponContext = {
      nowIso: cfg.nowIso, localTime: cfg.localTime,
      cartSubtotalCents: afterLine.reduce((a, b) => a + b, 0),
      lines: cart.lines.map((l, i) => ({ id: l.id, productId: l.productId, categoryId: l.categoryId, amountCents: remaining[i] - couponShare[i] })),
    };
    const el = couponEligibility(c, ctx);
    if (!el.eligible) { applied.push({ couponId: c.id, code: c.code, discountCents: 0, problems: el.problems }); continue; }
    const idx = cart.lines.map((l, i) => i).filter((i) => el.eligibleLineIds.includes(cart.lines[i].id));
    const room = idx.map((i) => remaining[i] - couponShare[i]);
    const total = discountAmount(room.reduce((a, b) => a + b, 0), c.discount, mode);
    apportion(total, room).forEach((part, k) => { couponShare[idx[k]] += part; });
    applied.push({ couponId: c.id, code: c.code, discountCents: total, problems: [] });
  }

  const lines: PricedLine[] = cart.lines.map((l, i) => {
    const taxable = remaining[i] - couponShare[i];
    const t = lineTax(taxable, l.taxGroup, l.taxMode, mode);
    return {
      id: l.id, productId: l.productId, name: l.name, qty: new D(l.qty).toString(),
      baseCents: base[i], lineDiscountCents: lineDisc[i], cartDiscountCents: cartShare[i], couponDiscountCents: couponShare[i],
      taxableCents: taxable, netCents: t.netCents, taxCents: t.taxCents, grossCents: t.grossCents, taxMode: l.taxMode, taxParts: t.parts,
    };
  });

  const ship = cart.shipping
    ? lineTax(cart.shipping.cents, cart.shipping.taxGroup ?? null, cart.shipping.taxMode ?? 'inclusive', mode)
    : { netCents: 0, taxCents: 0, grossCents: 0, parts: [] as TaxPart[] };

  const sum = (f: (l: PricedLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const byTax = new Map<string, { taxId: string; name: string; rate: string; amountCents: number }>();
  for (const p of [...lines.flatMap((l) => l.taxParts), ...ship.parts]) {
    const cur = byTax.get(p.taxId);
    if (cur) cur.amountCents += p.amountCents; else byTax.set(p.taxId, { ...p });
  }
  return {
    lines,
    shipping: { netCents: ship.netCents, taxCents: ship.taxCents, grossCents: ship.grossCents, taxParts: ship.parts },
    coupons: applied,
    totals: {
      baseCents: sum((l) => l.baseCents), lineDiscountCents: sum((l) => l.lineDiscountCents),
      cartDiscountCents: sum((l) => l.cartDiscountCents), couponDiscountCents: sum((l) => l.couponDiscountCents),
      netCents: sum((l) => l.netCents) + ship.netCents, taxCents: sum((l) => l.taxCents) + ship.taxCents,
      grossCents: sum((l) => l.grossCents) + ship.grossCents,
    },
    taxByTax: [...byTax.values()],
  };
}
