import Decimal from 'decimal.js';

/** All engine arithmetic uses this Decimal (40 significant digits). Money is carried as integer minor units. */
export const D = Decimal.clone({ precision: 40 });
export type DecimalLike = Decimal.Value;
export type Dec = InstanceType<typeof D>;

export type RoundingMode = 'half_up' | 'half_even' | 'half_down';
export const ROUNDING_MODES: readonly RoundingMode[] = ['half_up', 'half_even', 'half_down'];

const MODE = {
  half_up: Decimal.ROUND_HALF_UP,     // .5 goes away from zero
  half_even: Decimal.ROUND_HALF_EVEN, // .5 goes to the even neighbour
  half_down: Decimal.ROUND_HALF_DOWN, // .5 goes toward zero
} as const;

/** Round to a whole minor unit. Symmetric for negatives. Never returns -0. */
export function roundToInt(v: DecimalLike, mode: RoundingMode): number {
  const n = new D(v).toDecimalPlaces(0, MODE[mode]).toNumber();
  if (!Number.isSafeInteger(n)) throw new RangeError('amount outside the safe integer range');
  return n === 0 ? 0 : n;
}

/** Round an integer amount to the nearest multiple of `increment` (for example 5 cents). */
export function roundToIncrement(cents: number, increment: number, mode: RoundingMode): number {
  if (!Number.isSafeInteger(increment) || increment <= 0) throw new RangeError('increment must be a positive integer');
  return roundToInt(new D(cents).div(increment), mode) * increment || 0;
}

export function assertCents(n: number, label = 'amount'): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a whole number of minor units`);
  return n;
}
