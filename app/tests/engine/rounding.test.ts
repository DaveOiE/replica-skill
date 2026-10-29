import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { roundToInt, roundToIncrement, assertCents, ROUNDING_MODES } from '../../src/domain/engine';

describe('roundToInt: the three modes on exact halves', () => {
  const halves = [0.5, 1.5, 2.5, -0.5, -1.5, -2.5];
  it('half_up goes away from zero', () => expect(halves.map((h) => roundToInt(h, 'half_up'))).toEqual([1, 2, 3, -1, -2, -3]));
  it('half_even goes to the even neighbour', () => expect(halves.map((h) => roundToInt(h, 'half_even'))).toEqual([0, 2, 2, 0, -2, -2]));
  it('half_down goes toward zero', () => expect(halves.map((h) => roundToInt(h, 'half_down'))).toEqual([0, 1, 2, 0, -1, -2]));
  it('away from a half every mode agrees', () => {
    for (const m of ROUNDING_MODES) expect([0.49, 0.51, 1.2, 1.8, -0.49, -0.51].map((x) => roundToInt(x, m))).toEqual([0, 1, 1, 2, 0, -1]);
  });
  it('never returns negative zero', () => {
    for (const m of ROUNDING_MODES) expect(Object.is(roundToInt(-0.3, m), -0)).toBe(false);
  });
  it('accepts strings and rejects values outside the safe integer range', () => {
    expect(roundToInt('12.5', 'half_up')).toBe(13);
    expect(() => roundToInt('1e300', 'half_up')).toThrow(RangeError);
  });
  it('property: result is within half a unit and monotone', () => {
    fc.assert(fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), fc.constantFrom(...ROUNDING_MODES), (x, m) => {
      const r = roundToInt(x, m);
      expect(Math.abs(r - x)).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(roundToInt(x + 1, m)).toBe(r + 1);
    }), { numRuns: 300 });
  });
});

describe('roundToIncrement', () => {
  it('rounds to 5 cents', () => {
    expect([1, 2, 3, 4, 5, 7, 8, 10, 1997, 1998].map((c) => roundToIncrement(c, 5, 'half_up'))).toEqual([0, 0, 5, 5, 5, 5, 10, 10, 1995, 2000]);
  });
  it('exact halves depend on the mode (10 cent steps)', () => {
    expect(['half_up', 'half_even', 'half_down'].map((m) => roundToIncrement(5, 10, m as any))).toEqual([10, 0, 0]);
    expect(['half_up', 'half_even', 'half_down'].map((m) => roundToIncrement(15, 10, m as any))).toEqual([20, 20, 10]);
  });
  it('works for negatives and for zero', () => {
    expect(roundToIncrement(-3, 5, 'half_up')).toBe(-5);
    expect(roundToIncrement(0, 5, 'half_up')).toBe(0);
  });
  it('rejects a bad increment', () => {
    for (const bad of [0, -5, 2.5]) expect(() => roundToIncrement(10, bad, 'half_up')).toThrow(RangeError);
  });
  it('property: result is a multiple of the increment and within half of it', () => {
    fc.assert(fc.property(fc.integer({ min: -100000, max: 100000 }), fc.constantFrom(5, 10, 100), fc.constantFrom(...ROUNDING_MODES), (c, inc, m) => {
      const r = roundToIncrement(c, inc, m);
      expect(Math.abs(r % inc)).toBe(0);
      expect(Math.abs(r - c)).toBeLessThanOrEqual(inc / 2);
    }), { numRuns: 300 });
  });
});

describe('assertCents', () => {
  it('passes whole numbers and rejects fractions', () => {
    expect(assertCents(5)).toBe(5);
    expect(() => assertCents(5.5)).toThrow('whole number');
    expect(() => assertCents(NaN, 'total')).toThrow('total');
  });
});
