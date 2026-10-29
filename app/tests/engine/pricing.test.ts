import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { priceCart, ROUNDING_MODES, type Cart, type CartLine, type PricingConfig, type TaxGroup, type Coupon } from '../../src/domain/engine';

const gst: TaxGroup = { id: 'g', taxes: [{ id: 'gst', name: 'GST', rate: '0.10' }] };
const cfg: PricingConfig = { rounding: 'half_up', nowIso: '2026-06-15T10:00:00Z', localTime: '10:00' };
const line = (id: string, unit: number, qty: string | number, over: Partial<CartLine> = {}): CartLine =>
  ({ id, productId: 'p-' + id, categoryId: 'k-' + id, name: id, unitPriceCents: unit, qty, taxGroup: gst, taxMode: 'inclusive', ...over });

describe('priceCart: worked examples', () => {
  it('one inclusive line', () => {
    const p = priceCart({ lines: [line('A', 550, 2)] }, cfg);
    expect(p.lines[0]).toMatchObject({ baseCents: 1100, taxCents: 100, netCents: 1000, grossCents: 1100 });
    expect(p.totals).toMatchObject({ grossCents: 1100, taxCents: 100, netCents: 1000 });
  });
  it('one exclusive line adds tax on top', () => {
    const p = priceCart({ lines: [line('A', 1000, 1, { taxMode: 'exclusive' })] }, cfg);
    expect(p.totals).toMatchObject({ netCents: 1000, taxCents: 100, grossCents: 1100 });
  });
  it('decimal quantity (0.333 kg) is rounded once per line', () => {
    const p = priceCart({ lines: [line('W', 1299, '0.333', { taxGroup: null })] }, cfg);
    expect(p.lines[0].baseCents).toBe(433); // 432.567
  });
  it('a 10% cart discount is shared so the parts add up (A $9.00 + B $5.20)', () => {
    const p = priceCart({ lines: [line('A', 450, 2), line('B', 520, 1)], discount: { type: 'percent', value: '10' } }, cfg);
    expect(p.lines.map((l) => l.cartDiscountCents)).toEqual([90, 52]);
    expect(p.lines.map((l) => [l.taxCents, l.grossCents])).toEqual([[74, 810], [43, 468]]);
    expect(p.totals).toMatchObject({ cartDiscountCents: 142, grossCents: 1278, taxCents: 117 });
  });
  it('line discount comes first, then the cart discount works on what is left', () => {
    const p = priceCart({ lines: [line('A', 1000, 1, { discount: { type: 'percent', value: '50' } }), line('B', 1000, 1)], discount: { type: 'flat', cents: 300 } }, cfg);
    expect(p.lines.map((l) => l.lineDiscountCents)).toEqual([500, 0]);
    expect(p.lines.map((l) => l.cartDiscountCents)).toEqual([100, 200]); // shared 1:2 over 500 and 1000
    expect(p.totals.grossCents).toBe(1200);
  });
  it('a coupon restricted to one product only touches that product', () => {
    const c: Coupon = { id: 'c1', code: 'TWO', discount: { type: 'flat', cents: 200 }, productIds: ['p-B'] };
    const p = priceCart({ lines: [line('A', 450, 2), line('B', 520, 1)], coupons: [c] }, cfg);
    expect(p.lines.map((l) => l.couponDiscountCents)).toEqual([0, 200]);
    expect(p.lines[1]).toMatchObject({ taxableCents: 320, taxCents: 29 });
    expect(p.coupons[0]).toMatchObject({ discountCents: 200, problems: [] });
  });
  it('an ineligible coupon is reported and changes nothing', () => {
    const c: Coupon = { id: 'c2', code: 'BIG', discount: { type: 'flat', cents: 500 }, minCartCents: 100000 };
    const p = priceCart({ lines: [line('A', 450, 1)], coupons: [c] }, cfg);
    expect(p.totals.couponDiscountCents).toBe(0);
    expect(p.coupons[0]).toMatchObject({ discountCents: 0, problems: ['below_minimum'] });
  });
  it('coupons stack in order, each on what the previous left, and cannot take more than is left', () => {
    const c1: Coupon = { id: 'c1', code: 'HALF', discount: { type: 'percent', value: '50' } };
    const c2: Coupon = { id: 'c2', code: 'BIG', discount: { type: 'flat', cents: 99999 } };
    const p = priceCart({ lines: [line('A', 1000, 1, { taxGroup: null })], coupons: [c1, c2] }, cfg);
    expect(p.coupons.map((c) => c.discountCents)).toEqual([500, 500]);
    expect(p.totals.grossCents).toBe(0);
  });
  it('shipping carries its own tax', () => {
    const p = priceCart({ lines: [line('A', 1100, 1)], shipping: { cents: 550, taxGroup: gst, taxMode: 'inclusive' } }, cfg);
    expect(p.shipping).toMatchObject({ grossCents: 550, taxCents: 50, netCents: 500 });
    expect(p.totals).toMatchObject({ grossCents: 1650, taxCents: 150 });
    expect(p.taxByTax).toEqual([{ taxId: 'gst', name: 'GST', rate: '0.10', amountCents: 150 }]);
  });
  it('shipping without a tax group defaults to untaxed', () => {
    const p = priceCart({ lines: [], shipping: { cents: 700 } }, cfg);
    expect(p.totals.grossCents).toBe(700);
  });
  it('mixed inclusive and exclusive lines', () => {
    const p = priceCart({ lines: [line('A', 1100, 1), line('B', 1000, 1, { taxMode: 'exclusive' })] }, cfg);
    expect(p.totals).toMatchObject({ grossCents: 2200, taxCents: 200, netCents: 2000 });
  });
  it('an empty cart prices to zero', () => {
    expect(priceCart({ lines: [] }, cfg).totals.grossCents).toBe(0);
  });
  it('the rounding mode is an input: an exact half moves with it', () => {
    const cart: Cart = { lines: [line('A', 1005, 1, { taxMode: 'exclusive' })] };
    expect(ROUNDING_MODES.map((m) => priceCart(cart, { ...cfg, rounding: m }).totals.taxCents)).toEqual([101, 100, 100]);
  });
  it('rejects negative quantity, price or fractional price', () => {
    expect(() => priceCart({ lines: [line('A', 100, -1)] }, cfg)).toThrow('quantity');
    expect(() => priceCart({ lines: [line('A', -100, 1)] }, cfg)).toThrow('unit price');
    expect(() => priceCart({ lines: [line('A', 100.5, 1)] }, cfg)).toThrow('unit price');
  });
});

const arbGroup = fc.constantFrom<TaxGroup | null>(null, gst, { id: 'g2', taxes: [{ id: 'a', name: 'A', rate: '0.07' }, { id: 'b', name: 'B', rate: '0.03' }] });
const arbDiscount = fc.option(fc.oneof(
  fc.integer({ min: 0, max: 100 }).map((v) => ({ type: 'percent' as const, value: String(v) })),
  fc.integer({ min: 0, max: 20000 }).map((c) => ({ type: 'flat' as const, cents: c }))), { nil: null });
const arbLine = fc.record({
  unit: fc.integer({ min: 0, max: 50000 }), qty: fc.oneof(fc.integer({ min: 0, max: 20 }).map(String), fc.double({ min: 0, max: 20, noNaN: true }).map((x) => x.toFixed(3))),
  group: arbGroup, mode: fc.constantFrom<'inclusive' | 'exclusive'>('inclusive', 'exclusive'), disc: arbDiscount,
});
const arbCart = fc.record({
  lines: fc.array(arbLine, { minLength: 0, maxLength: 8 }), cartDisc: arbDiscount,
  coupon: fc.option(fc.integer({ min: 0, max: 30000 }), { nil: null }), ship: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
  rounding: fc.constantFrom(...ROUNDING_MODES),
});

describe('priceCart: properties over random carts', () => {
  it('everything adds up, nothing goes negative, discounts never exceed the goods', () => {
    fc.assert(fc.property(arbCart, (r) => {
      const cart: Cart = {
        lines: r.lines.map((l, i) => line('L' + i, l.unit, l.qty, { taxGroup: l.group, taxMode: l.mode, discount: l.disc })),
        discount: r.cartDisc,
        coupons: r.coupon == null ? [] : [{ id: 'c', code: 'C', discount: { type: 'flat', cents: r.coupon } }],
        shipping: r.ship == null ? null : { cents: r.ship, taxGroup: gst, taxMode: 'inclusive' },
      };
      const p = priceCart(cart, { ...cfg, rounding: r.rounding });
      const sum = (f: (l: (typeof p.lines)[number]) => number) => p.lines.reduce((a, l) => a + f(l), 0);
      for (const l of p.lines) {
        expect(l.grossCents).toBe(l.netCents + l.taxCents);
        expect(l.taxParts.reduce((a, t) => a + t.amountCents, 0)).toBe(l.taxCents);
        expect(l.baseCents - l.lineDiscountCents - l.cartDiscountCents - l.couponDiscountCents).toBe(l.taxableCents);
        for (const v of [l.baseCents, l.taxableCents, l.netCents, l.taxCents, l.grossCents]) expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(p.totals.grossCents).toBe(sum((l) => l.grossCents) + p.shipping.grossCents);
      expect(p.totals.taxCents).toBe(sum((l) => l.taxCents) + p.shipping.taxCents);
      expect(p.totals.netCents).toBe(sum((l) => l.netCents) + p.shipping.netCents);
      expect(p.taxByTax.reduce((a, t) => a + t.amountCents, 0)).toBe(p.totals.taxCents);
      expect(p.totals.lineDiscountCents + p.totals.cartDiscountCents + p.totals.couponDiscountCents).toBeLessThanOrEqual(p.totals.baseCents);
      expect(p.totals.cartDiscountCents).toBe(sum((l) => l.cartDiscountCents));
    }), { numRuns: 400 });
  });
  it('changing only the rounding mode moves a total by at most one unit per line', () => {
    fc.assert(fc.property(arbCart, (r) => {
      const cart: Cart = { lines: r.lines.map((l, i) => line('L' + i, l.unit, l.qty, { taxGroup: l.group, taxMode: l.mode })) };
      const t = ROUNDING_MODES.map((m) => priceCart(cart, { ...cfg, rounding: m }).totals.grossCents);
      expect(Math.max(...t) - Math.min(...t)).toBeLessThanOrEqual(2 * cart.lines.length);
    }), { numRuns: 200 });
  });
});
