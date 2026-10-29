import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  priceCart, refundLine, addRefund, NOTHING_REFUNDED, repriceHeldCart, ROUNDING_MODES,
  type PricingConfig, type TaxGroup, type HeldCart, type CurrentCatalogue, type CartLine,
} from '../../src/domain/engine';

const gst: TaxGroup = { id: 'g', taxes: [{ id: 'gst', name: 'GST', rate: '0.10' }] };
const two: TaxGroup = { id: 'g2', taxes: [{ id: 'a', name: 'A', rate: '0.07' }, { id: 'b', name: 'B', rate: '0.03' }] };
const cfg: PricingConfig = { rounding: 'half_up', nowIso: '2026-06-15T10:00:00Z', localTime: '10:00' };

describe('refundLine', () => {
  const sold = (unit: number, qty: number, group: TaxGroup, mode: 'inclusive' | 'exclusive') => {
    const p = priceCart({ lines: [{ id: 'L', productId: 'p', name: 'X', unitPriceCents: unit, qty, taxGroup: group, taxMode: mode }] }, cfg).lines[0];
    return { qty, grossCents: p.grossCents, taxCents: p.taxCents, taxParts: p.taxParts };
  };
  it('refunding everything at once gives back exactly what was charged', () => {
    const o = sold(333, 3, gst, 'inclusive');
    const r = refundLine(o, NOTHING_REFUNDED, 3, 'half_up');
    expect(r).toMatchObject({ grossCents: o.grossCents, taxCents: o.taxCents, netCents: o.grossCents - o.taxCents });
  });
  it('refunding one at a time adds up to the same, even when the amount does not divide', () => {
    const o = sold(1000, 3, gst, 'inclusive'); // 3000 gross, 273 tax
    let prior = NOTHING_REFUNDED; let gross = 0, tax = 0;
    for (let i = 0; i < 3; i++) { const s = refundLine(o, prior, 1, 'half_up'); gross += s.grossCents; tax += s.taxCents; prior = addRefund(prior, 1, s); }
    expect([gross, tax]).toEqual([o.grossCents, o.taxCents]);
  });
  it('tax parts add up to the tax at every step', () => {
    const o = sold(1010, 4, two, 'exclusive');
    let prior = NOTHING_REFUNDED;
    for (let i = 0; i < 4; i++) {
      const s = refundLine(o, prior, 1, 'half_up');
      expect(Object.values(s.parts).reduce((a, b) => a + b, 0)).toBe(s.taxCents);
      prior = addRefund(prior, 1, s);
    }
    expect(prior.parts).toEqual(Object.fromEntries(o.taxParts.map((p) => [p.taxId, p.amountCents])));
  });
  it('refuses nonsense', () => {
    const o = sold(100, 2, gst, 'inclusive');
    expect(() => refundLine(o, NOTHING_REFUNDED, 0, 'half_up')).toThrow('positive');
    expect(() => refundLine(o, NOTHING_REFUNDED, 3, 'half_up')).toThrow('more than was sold');
    expect(() => refundLine(o, { ...NOTHING_REFUNDED, qty: '2' }, 1, 'half_up')).toThrow('more than was sold');
  });
  it('property: ANY way of splitting a line into refunds returns exactly what was charged', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 1, max: 12 }), fc.constantFrom(gst, two), fc.constantFrom<'inclusive' | 'exclusive'>('inclusive', 'exclusive'),
      fc.constantFrom(...ROUNDING_MODES), fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 12 }),
      (unit, qty, group, mode, rounding, cuts) => {
        const p = priceCart({ lines: [{ id: 'L', productId: 'p', name: 'X', unitPriceCents: unit, qty, taxGroup: group, taxMode: mode }] }, { ...cfg, rounding }).lines[0];
        const o = { qty, grossCents: p.grossCents, taxCents: p.taxCents, taxParts: p.taxParts };
        let prior = NOTHING_REFUNDED, left = qty, gross = 0, tax = 0;
        for (const c of cuts) {
          if (left === 0) break;
          const take = Math.min(c, left);
          const s = refundLine(o, prior, take, rounding);
          expect(s.grossCents).toBeGreaterThanOrEqual(0);
          expect(s.taxCents).toBeGreaterThanOrEqual(0);
          for (const v of Object.values(s.parts)) expect(v).toBeGreaterThanOrEqual(0);
          gross += s.grossCents; tax += s.taxCents; prior = addRefund(prior, take, s); left -= take;
        }
        if (left > 0) { const s = refundLine(o, prior, left, rounding); gross += s.grossCents; tax += s.taxCents; prior = addRefund(prior, left, s); }
        expect(gross).toBe(o.grossCents); expect(tax).toBe(o.taxCents);
        expect(prior.parts).toEqual(Object.fromEntries(o.taxParts.map((t) => [t.taxId, t.amountCents])));
      }), { numRuns: 400 });
  });
});

// ---- held cart re-pricing (plan A11) ----
const hl = (id: string, unit: number, qty: number, over: Partial<CartLine> & { manualPrice?: boolean } = {}) =>
  ({ id, productId: 'p-' + id, name: 'Item ' + id, unitPriceCents: unit, qty, taxGroup: gst, taxMode: 'inclusive' as const, ...over });
const heldOf = (lines: ReturnType<typeof hl>[], c = cfg): HeldCart => {
  const p = priceCart({ lines }, c);
  return { lines, totalCentsAtHold: p.totals.grossCents };
};
const catalogueOf = (lines: ReturnType<typeof hl>[], patch: Record<string, Partial<{ unitPriceCents: number; taxGroup: TaxGroup | null; taxMode: 'inclusive' | 'exclusive' }> | null> = {}): CurrentCatalogue =>
  new Map(lines.map((l) => {
    const p = patch['p-' + l.id];
    return ['p-' + l.id, p === null ? null : { unitPriceCents: l.unitPriceCents, taxGroup: l.taxGroup, taxMode: l.taxMode, ...p }];
  }));

describe('repriceHeldCart', () => {
  const lines = [hl('A', 450, 2), hl('B', 520, 1), hl('C', 300, 3)];

  it('nothing changed: no notice, no listed lines, same total', () => {
    const r = repriceHeldCart(heldOf(lines), catalogueOf(lines), cfg);
    expect(r.notice).toMatchObject({ hasNotice: false, changedLines: [], unavailableLines: [], totalDeltaCents: 0, totalChangedWithoutPriceChange: false });
    expect(r.priced.totals.grossCents).toBe(heldOf(lines).totalCentsAtHold);
  });

  it('one price changed: that line is listed with old and new price, the others are not', () => {
    const r = repriceHeldCart(heldOf(lines), catalogueOf(lines, { 'p-B': { unitPriceCents: 560 } }), cfg);
    expect(r.notice.changedLines).toEqual([{ lineId: 'B', name: 'Item B', oldUnitPriceCents: 520, newUnitPriceCents: 560, deltaUnitCents: 40 }]);
    expect(r.notice.totalDeltaCents).toBe(40);
    expect(r.notice.totalBeforeCents).toBe(2320);
    expect(r.notice.totalAfterCents).toBe(2360);
    expect(r.notice.hasNotice).toBe(true);
    expect(r.cart.lines.find((l) => l.id === 'B')!.unitPriceCents).toBe(560);
    expect(r.cart.lines.find((l) => l.id === 'A')!.unitPriceCents).toBe(450);
  });

  it('several changes, up and down: each listed with the correct sign', () => {
    const r = repriceHeldCart(heldOf(lines), catalogueOf(lines, { 'p-A': { unitPriceCents: 400 }, 'p-C': { unitPriceCents: 350 } }), cfg);
    expect(r.notice.changedLines.map((c) => [c.lineId, c.oldUnitPriceCents, c.newUnitPriceCents, c.deltaUnitCents]))
      .toEqual([['A', 450, 400, -50], ['C', 300, 350, 50]]);
  });

  it('a tax-rate change on an EXCLUSIVE line moves the total without any price change, and says so', () => {
    const ex = [hl('A', 1000, 1, { taxMode: 'exclusive' })];
    const gst15: TaxGroup = { id: 'g', taxes: [{ id: 'gst', name: 'GST', rate: '0.15' }] };
    const r = repriceHeldCart(heldOf(ex), catalogueOf(ex, { 'p-A': { taxGroup: gst15 } }), cfg);
    expect(r.notice.changedLines).toEqual([]);
    expect(r.notice).toMatchObject({ totalBeforeCents: 1100, totalAfterCents: 1150, totalDeltaCents: 50, totalChangedWithoutPriceChange: true, hasNotice: true });
  });

  it('a tax-rate change on an INCLUSIVE line leaves the total alone and shows no notice', () => {
    const inc = [hl('A', 1100, 1)];
    const gst15: TaxGroup = { id: 'g', taxes: [{ id: 'gst', name: 'GST', rate: '0.15' }] };
    const r = repriceHeldCart(heldOf(inc), catalogueOf(inc, { 'p-A': { taxGroup: gst15 } }), cfg);
    expect(r.notice.hasNotice).toBe(false);
    expect(r.priced.lines[0].taxCents).toBe(143); // the tax part moved, the shelf price did not
  });

  it('a rounding-mode change that moves the total is reported as a total change', () => {
    const ex = [hl('A', 1005, 1, { taxMode: 'exclusive' })];
    const held = heldOf(ex, { ...cfg, rounding: 'half_up' }); // 1005 + 101 = 1106
    const r = repriceHeldCart(held, catalogueOf(ex), { ...cfg, rounding: 'half_even' }); // tax 100
    expect(r.notice).toMatchObject({ totalBeforeCents: 1106, totalAfterCents: 1105, totalDeltaCents: -1, totalChangedWithoutPriceChange: true });
    expect(r.notice.changedLines).toEqual([]);
  });

  it('a product that is gone or inactive stays in the cart, flagged, and is left out of the total', () => {
    const r = repriceHeldCart(heldOf(lines), catalogueOf(lines, { 'p-B': null }), cfg);
    expect(r.notice.unavailableLines).toEqual([{ lineId: 'B', name: 'Item B' }]);
    expect(r.unavailableLineIds).toEqual(['B']);
    expect(r.notice.changedLines).toEqual([]);
    expect(r.notice.totalAfterCents).toBe(2320 - 520);
    expect(r.notice.hasNotice).toBe(true);
    expect(r.cart.lines.map((l) => l.id)).toEqual(['A', 'C']); // not silently dropped: reported, with the id to show
  });

  it('a price the cashier typed by hand is kept and is not reported as changed', () => {
    const l2 = [hl('A', 450, 2, { manualPrice: true }), hl('B', 520, 1)];
    const r = repriceHeldCart(heldOf(l2), catalogueOf(l2, { 'p-A': { unitPriceCents: 999 } }), cfg);
    expect(r.cart.lines.find((l) => l.id === 'A')!.unitPriceCents).toBe(450);
    expect(r.notice.hasNotice).toBe(false);
  });

  it('a wholesale-tier line is re-priced from the catalogue like any other', () => {
    const w = [hl('W', 800, 10)];
    const r = repriceHeldCart(heldOf(w), catalogueOf(w, { 'p-W': { unitPriceCents: 760 } }), cfg);
    expect(r.notice.changedLines).toEqual([{ lineId: 'W', name: 'Item W', oldUnitPriceCents: 800, newUnitPriceCents: 760, deltaUnitCents: -40 }]);
    expect(r.notice.totalDeltaCents).toBe(-400);
  });

  it('carries cart discount, coupons and shipping through unchanged', () => {
    const held: HeldCart = { ...heldOf(lines), discount: { type: 'percent', value: '10' }, shipping: { cents: 500 } };
    held.totalCentsAtHold = priceCart({ lines, discount: held.discount, shipping: held.shipping }, cfg).totals.grossCents;
    const r = repriceHeldCart(held, catalogueOf(lines), cfg);
    expect(r.notice.hasNotice).toBe(false);
    expect(r.cart.discount).toEqual({ type: 'percent', value: '10' });
    expect(r.cart.shipping).toEqual({ cents: 500 });
  });

  it('property: only lines whose price really differs are ever listed', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 1, max: 9000 }), fc.integer({ min: 1, max: 9000 }), fc.integer({ min: 1, max: 5 })), { minLength: 1, maxLength: 8 }), (rows) => {
      const ls = rows.map(([oldP, , q], i) => hl('L' + i, oldP, q));
      const patch = Object.fromEntries(rows.map(([, newP], i) => ['p-L' + i, { unitPriceCents: newP }]));
      const r = repriceHeldCart(heldOf(ls), catalogueOf(ls, patch), cfg);
      const expected = rows.map(([o, n], i) => [i, o, n] as const).filter(([, o, n]) => o !== n).map(([i]) => 'L' + i);
      expect(r.notice.changedLines.map((c) => c.lineId)).toEqual(expected);
      for (const c of r.notice.changedLines) expect(c.newUnitPriceCents - c.oldUnitPriceCents).toBe(c.deltaUnitCents);
      expect(r.notice.hasNotice).toBe(expected.length > 0 || r.notice.totalDeltaCents !== 0);
    }), { numRuns: 300 });
  });
});
