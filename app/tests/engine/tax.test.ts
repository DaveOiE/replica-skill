import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineTax, groupRate, ROUNDING_MODES, type TaxGroup } from '../../src/domain/engine';

const gst: TaxGroup = { id: 'g1', taxes: [{ id: 'gst', name: 'GST', rate: '0.10' }] };
const two: TaxGroup = { id: 'g2', taxes: [{ id: 'a', name: 'A', rate: '0.07' }, { id: 'b', name: 'B', rate: '0.03' }] };

describe('lineTax', () => {
  it('inclusive: the price already contains the tax', () => {
    expect(lineTax(1100, gst, 'inclusive', 'half_up')).toMatchObject({ netCents: 1000, taxCents: 100, grossCents: 1100 });
  });
  it('exclusive: tax is added on top', () => {
    expect(lineTax(1000, gst, 'exclusive', 'half_up')).toMatchObject({ netCents: 1000, taxCents: 100, grossCents: 1100 });
  });
  it('rounds the line once (inclusive 19.99 at 10%)', () => {
    expect(lineTax(1999, gst, 'inclusive', 'half_up')).toMatchObject({ taxCents: 182, netCents: 1817 });
  });
  it('rounding mode matters only on exact halves (exclusive 10.05 at 10%)', () => {
    expect(ROUNDING_MODES.map((m) => lineTax(1005, gst, 'exclusive', m).taxCents)).toEqual([101, 100, 100]);
  });
  it('a group of taxes is parallel and the parts add up to the total', () => {
    const t = lineTax(1010, two, 'exclusive', 'half_up');
    expect(t.taxCents).toBe(101);
    expect(t.parts.map((p) => p.amountCents)).toEqual([71, 30]);
    expect(t.parts.map((p) => p.taxId)).toEqual(['a', 'b']);
  });
  it('no group, an empty group or a zero rate means no tax', () => {
    expect(lineTax(500, null, 'inclusive', 'half_up')).toEqual({ netCents: 500, taxCents: 0, grossCents: 500, parts: [] });
    expect(lineTax(500, undefined, 'exclusive', 'half_up').taxCents).toBe(0);
    expect(lineTax(500, { id: 'z', taxes: [{ id: 'z', name: 'Z', rate: '0' }] }, 'exclusive', 'half_up').taxCents).toBe(0);
    expect(lineTax(500, { id: 'e', taxes: [] }, 'exclusive', 'half_up').taxCents).toBe(0);
  });
  it('is symmetric for negative amounts (returns)', () => {
    expect(lineTax(-1100, gst, 'inclusive', 'half_up').taxCents).toBe(-100);
    expect(lineTax(-1005, gst, 'exclusive', 'half_up').taxCents).toBe(-101);
  });
  it('rejects negative rates', () => {
    expect(() => lineTax(100, { id: 'n', taxes: [{ id: 'n', name: 'N', rate: '-0.1' }] }, 'exclusive', 'half_up')).toThrow('negative');
  });
  it('groupRate adds the rates', () => expect(groupRate(two).toString()).toBe('0.1'));
  it('property: parts add up, gross = net + tax, inclusive and exclusive agree within a cent', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.constantFrom(...ROUNDING_MODES), fc.constantFrom(gst, two), (base, m, g) => {
      const inc = lineTax(base, g, 'inclusive', m), exc = lineTax(base, g, 'exclusive', m);
      for (const t of [inc, exc]) {
        expect(t.parts.reduce((a, p) => a + p.amountCents, 0)).toBe(t.taxCents);
        expect(t.grossCents).toBe(t.netCents + t.taxCents);
        expect(t.taxCents).toBeGreaterThanOrEqual(0);
      }
      // net of the inclusive amount, taxed exclusively, comes back to (almost) the same gross
      const back = lineTax(inc.netCents, g, 'exclusive', m);
      expect(Math.abs(back.grossCents - base)).toBeLessThanOrEqual(1);
    }), { numRuns: 400 });
  });
});
