import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { apportion, D } from '../../src/domain/engine';

describe('apportion', () => {
  it('splits exactly in proportion when it divides evenly', () => expect(apportion(100, [1, 1, 2])).toEqual([25, 25, 50]));
  it('gives the leftover to the largest remainders', () => expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]));
  it('breaks ties toward the lowest index, every time', () => {
    for (let i = 0; i < 3; i++) expect(apportion(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });
  it('handles negative totals symmetrically', () => expect(apportion(-100, [1, 1, 1])).toEqual([-34, -33, -33]));
  it('gives zero-weight slots nothing', () => expect(apportion(7, [0, 3, 0, 4])).toEqual([0, 3, 0, 4]));
  it('puts everything in the first slot when every weight is zero', () => expect(apportion(9, [0, 0])).toEqual([9, 0]));
  it('returns zeros for a zero total and [] for no weights', () => {
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
    expect(apportion(5, [])).toEqual([]);
  });
  it('accepts decimal weights and strings', () => expect(apportion(10, ['0.1', '0.3', new D('0.6')])).toEqual([1, 3, 6]));
  it('never returns negative zero', () => expect(apportion(-1, [0, 1]).some((x) => Object.is(x, -0))).toBe(false));
  it('rejects bad input', () => {
    expect(() => apportion(1.5, [1])).toThrow('whole number');
    expect(() => apportion(1, [-1, 2])).toThrow('not negative');
    expect(() => apportion(1, [Infinity])).toThrow();
  });
  it('property: parts always add up to the total and stay within 1 of the exact share', () => {
    fc.assert(fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), fc.array(fc.integer({ min: 0, max: 100000 }), { minLength: 1, maxLength: 12 }), (total, w) => {
      const parts = apportion(total, w);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      const sum = w.reduce((a, b) => a + b, 0);
      if (sum > 0) w.forEach((x, i) => expect(Math.abs(parts[i] - (total * x) / sum)).toBeLessThan(1 + 1e-9));
    }), { numRuns: 500 });
  });
});
