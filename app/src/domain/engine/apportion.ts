import { D, type DecimalLike } from './rounding';

/**
 * Split `total` (whole minor units) across `weights` so the parts add up EXACTLY to the total.
 * Largest-remainder method; ties go to the lowest index, so the result is deterministic.
 * Zero weights get nothing. If every weight is zero the whole total goes to the first slot.
 */
export function apportion(total: number, weights: DecimalLike[]): number[] {
  if (!Number.isSafeInteger(total)) throw new RangeError('total must be a whole number of minor units');
  const w = weights.map((x) => new D(x));
  if (w.some((x) => x.isNegative() || !x.isFinite())) throw new RangeError('weights must be finite and not negative');
  const out = w.map(() => 0);
  if (!w.length || total === 0) return out;
  const sum = w.reduce((a, b) => a.plus(b), new D(0));
  if (sum.isZero()) { out[0] = total; return out; }
  const sign = total < 0 ? -1 : 1;
  const t = Math.abs(total);
  const exact = w.map((x) => x.times(t).div(sum));
  const floors = exact.map((x) => x.floor().toNumber());
  let leftover = t - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, rem: x.minus(floors[i]) })).sort((a, b) => b.rem.comparedTo(a.rem) || a.i - b.i);
  for (const { i } of order) { if (leftover <= 0) break; floors[i] += 1; leftover -= 1; }
  return floors.map((x, i) => { out[i] = x * sign || 0; return out[i]; });
}
