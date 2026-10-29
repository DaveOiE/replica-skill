import { D, roundToInt, type RoundingMode } from './rounding';

/** percent: "10" means 10%. flat: whole minor units. */
export type Discount = { type: 'percent'; value: string } | { type: 'flat'; cents: number };

/** Discount on `baseCents`, always between 0 and the base (a discount can never create a negative line). */
export function discountAmount(baseCents: number, d: Discount | null | undefined, mode: RoundingMode): number {
  if (!d || baseCents <= 0) return 0;
  if (d.type === 'percent') {
    const pct = new D(d.value);
    if (pct.isNegative() || pct.greaterThan(100)) throw new RangeError('a percentage discount must be between 0 and 100');
    return Math.min(baseCents, roundToInt(new D(baseCents).times(pct).div(100), mode));
  }
  if (!Number.isSafeInteger(d.cents) || d.cents < 0) throw new RangeError('a flat discount must be a non-negative whole number of minor units');
  return Math.min(baseCents, d.cents);
}
