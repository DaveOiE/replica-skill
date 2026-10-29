import type { Discount } from './discount';

export interface Coupon {
  id: string;
  code: string;
  discount: Discount;
  minCartCents?: number;
  maxCartCents?: number;
  validFrom?: string;       // ISO date or date-time
  validUntil?: string;
  hoursStart?: string;      // "HH:MM" store-local time
  hoursEnd?: string;
  productIds?: string[];    // if set, only these products qualify
  categoryIds?: string[];   // if set, only these categories qualify
}
export interface CouponLine { id: string; productId: string; categoryId?: string | null; amountCents: number }
export interface CouponContext {
  /** Supplied by the caller: the engine has no clock and no timezone. */
  nowIso: string;
  localTime: string; // "HH:MM" in the store's timezone
  cartSubtotalCents: number; // after line discounts
  lines: CouponLine[];
}
export type CouponProblem = 'not_started' | 'expired' | 'outside_hours' | 'below_minimum' | 'above_maximum' | 'no_qualifying_lines';
export interface Eligibility { eligible: boolean; problems: CouponProblem[]; eligibleLineIds: string[] }

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Pure eligibility. Usage limits need the database and are checked by the service. */
export function couponEligibility(c: Coupon, ctx: CouponContext): Eligibility {
  const problems: CouponProblem[] = [];
  const now = Date.parse(ctx.nowIso);
  if (c.validFrom && now < Date.parse(c.validFrom)) problems.push('not_started');
  if (c.validUntil && now > Date.parse(c.validUntil)) problems.push('expired');
  if (c.hoursStart && c.hoursEnd) {
    const t = toMin(ctx.localTime), a = toMin(c.hoursStart), b = toMin(c.hoursEnd);
    const inside = a <= b ? t >= a && t <= b : t >= a || t <= b; // a window may cross midnight
    if (!inside) problems.push('outside_hours');
  }
  if (c.minCartCents != null && ctx.cartSubtotalCents < c.minCartCents) problems.push('below_minimum');
  if (c.maxCartCents != null && ctx.cartSubtotalCents > c.maxCartCents) problems.push('above_maximum');
  const restricted = !!(c.productIds?.length || c.categoryIds?.length);
  const eligibleLineIds = ctx.lines
    .filter((l) => !restricted || c.productIds?.includes(l.productId) || (l.categoryId != null && c.categoryIds?.includes(l.categoryId)))
    .filter((l) => l.amountCents > 0)
    .map((l) => l.id);
  if (!eligibleLineIds.length) problems.push('no_qualifying_lines');
  return { eligible: problems.length === 0, problems, eligibleLineIds };
}
