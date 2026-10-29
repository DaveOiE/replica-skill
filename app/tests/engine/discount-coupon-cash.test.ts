import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { discountAmount, couponEligibility, roundCashDue, changeDue, ROUNDING_MODES, type Coupon, type CouponContext } from '../../src/domain/engine';

describe('discountAmount', () => {
  it('percent and flat', () => {
    expect(discountAmount(1000, { type: 'percent', value: '10' }, 'half_up')).toBe(100);
    expect(discountAmount(1000, { type: 'flat', cents: 250 }, 'half_up')).toBe(250);
  });
  it('percent rounds by mode on an exact half', () => {
    expect(ROUNDING_MODES.map((m) => discountAmount(25, { type: 'percent', value: '10' }, m))).toEqual([3, 2, 2]);
  });
  it('can never exceed the base', () => {
    expect(discountAmount(300, { type: 'flat', cents: 999 }, 'half_up')).toBe(300);
    expect(discountAmount(300, { type: 'percent', value: '100' }, 'half_up')).toBe(300);
  });
  it('is zero for no discount or an empty base', () => {
    expect(discountAmount(500, null, 'half_up')).toBe(0);
    expect(discountAmount(500, undefined, 'half_up')).toBe(0);
    expect(discountAmount(0, { type: 'flat', cents: 10 }, 'half_up')).toBe(0);
    expect(discountAmount(-5, { type: 'flat', cents: 10 }, 'half_up')).toBe(0);
  });
  it('rejects nonsense', () => {
    for (const v of ['-1', '100.01']) expect(() => discountAmount(100, { type: 'percent', value: v }, 'half_up')).toThrow('between 0 and 100');
    for (const c of [-1, 1.5]) expect(() => discountAmount(100, { type: 'flat', cents: c }, 'half_up')).toThrow('non-negative');
  });
  it('property: 0 <= discount <= base', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e7 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 2e7 }), fc.constantFrom(...ROUNDING_MODES), (base, pct, flat, m) => {
      for (const d of [{ type: 'percent', value: String(pct) } as const, { type: 'flat', cents: flat } as const]) {
        const x = discountAmount(base, d, m);
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(base);
      }
    }), { numRuns: 300 });
  });
});

const base: Coupon = { id: 'c', code: 'C', discount: { type: 'flat', cents: 100 } };
const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  nowIso: '2026-06-15T10:00:00Z', localTime: '10:00', cartSubtotalCents: 5000,
  lines: [{ id: 'l1', productId: 'p1', categoryId: 'k1', amountCents: 3000 }, { id: 'l2', productId: 'p2', categoryId: 'k2', amountCents: 2000 }], ...over,
});
describe('couponEligibility', () => {
  it('an unrestricted coupon covers every line with money on it', () => {
    expect(couponEligibility(base, ctx())).toEqual({ eligible: true, problems: [], eligibleLineIds: ['l1', 'l2'] });
    expect(couponEligibility(base, ctx({ lines: [{ id: 'z', productId: 'p', amountCents: 0 }] })).problems).toEqual(['no_qualifying_lines']);
  });
  it('date window', () => {
    expect(couponEligibility({ ...base, validFrom: '2026-07-01' }, ctx()).problems).toEqual(['not_started']);
    expect(couponEligibility({ ...base, validUntil: '2026-06-01' }, ctx()).problems).toEqual(['expired']);
    expect(couponEligibility({ ...base, validFrom: '2026-06-01', validUntil: '2026-07-01' }, ctx()).eligible).toBe(true);
  });
  it('hours window, including one that crosses midnight', () => {
    const happy = { ...base, hoursStart: '16:00', hoursEnd: '18:00' };
    expect(couponEligibility(happy, ctx({ localTime: '17:00' })).eligible).toBe(true);
    expect(couponEligibility(happy, ctx({ localTime: '10:00' })).problems).toEqual(['outside_hours']);
    const night = { ...base, hoursStart: '22:00', hoursEnd: '02:00' };
    expect(couponEligibility(night, ctx({ localTime: '23:30' })).eligible).toBe(true);
    expect(couponEligibility(night, ctx({ localTime: '01:00' })).eligible).toBe(true);
    expect(couponEligibility(night, ctx({ localTime: '12:00' })).eligible).toBe(false);
  });
  it('cart minimum and maximum', () => {
    expect(couponEligibility({ ...base, minCartCents: 6000 }, ctx()).problems).toEqual(['below_minimum']);
    expect(couponEligibility({ ...base, maxCartCents: 4000 }, ctx()).problems).toEqual(['above_maximum']);
    expect(couponEligibility({ ...base, minCartCents: 5000, maxCartCents: 5000 }, ctx()).eligible).toBe(true);
  });
  it('product and category restrictions', () => {
    expect(couponEligibility({ ...base, productIds: ['p2'] }, ctx()).eligibleLineIds).toEqual(['l2']);
    expect(couponEligibility({ ...base, categoryIds: ['k1'] }, ctx()).eligibleLineIds).toEqual(['l1']);
    expect(couponEligibility({ ...base, productIds: ['p2'], categoryIds: ['k1'] }, ctx()).eligibleLineIds).toEqual(['l1', 'l2']);
    expect(couponEligibility({ ...base, productIds: ['nope'] }, ctx()).problems).toEqual(['no_qualifying_lines']);
  });
  it('reports every problem at once', () => {
    expect(couponEligibility({ ...base, validUntil: '2026-01-01', minCartCents: 9999 }, ctx()).problems).toEqual(['expired', 'below_minimum']);
  });
});

describe('cash rounding', () => {
  const on = { enabled: true, incrementCents: 5, mode: 'half_up' as const };
  it('rounds the cash due to 5 cents and reports the adjustment separately', () => {
    expect(roundCashDue(1997, on)).toEqual({ payableCents: 1995, adjustmentCents: -2 });
    expect(roundCashDue(1998, on)).toEqual({ payableCents: 2000, adjustmentCents: 2 });
    expect(roundCashDue(2000, on)).toEqual({ payableCents: 2000, adjustmentCents: 0 });
  });
  it('does nothing when switched off or when nothing is due', () => {
    expect(roundCashDue(1997, { ...on, enabled: false })).toEqual({ payableCents: 1997, adjustmentCents: 0 });
    expect(roundCashDue(0, on)).toEqual({ payableCents: 0, adjustmentCents: 0 });
  });
  it('honours another increment and mode', () => {
    expect(roundCashDue(1005, { enabled: true, incrementCents: 10, mode: 'half_even' }).payableCents).toBe(1000);
    expect(roundCashDue(1005, { enabled: true, incrementCents: 10, mode: 'half_up' }).payableCents).toBe(1010);
  });
  it('change due', () => {
    expect(changeDue(2000, 1995)).toBe(5);
    expect(() => changeDue(100, 200)).toThrow('less than');
  });
  it('property: adjustment is never more than half an increment', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e7 }), fc.constantFrom(5, 10, 100), fc.constantFrom(...ROUNDING_MODES), (due, inc, m) => {
      const r = roundCashDue(due, { enabled: true, incrementCents: inc, mode: m });
      expect(Math.abs(r.adjustmentCents)).toBeLessThanOrEqual(inc / 2);
      expect(Math.abs(r.payableCents % inc)).toBe(0);
    }), { numRuns: 300 });
  });
});
