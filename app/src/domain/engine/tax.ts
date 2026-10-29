import { apportion } from './apportion';
import { D, roundToInt, type RoundingMode } from './rounding';

export type TaxMode = 'inclusive' | 'exclusive';
/** `rate` is a fraction as a decimal string: "0.10" is 10%. */
export interface TaxRate { id: string; name: string; rate: string }
export interface TaxGroup { id: string; name?: string; taxes: TaxRate[] }
export interface TaxPart { taxId: string; name: string; rate: string; amountCents: number }
export interface LineTax { netCents: number; taxCents: number; grossCents: number; parts: TaxPart[] }

const RATE_SCALE = 1_000_000; // rates carry at most 6 decimal places

export function groupRate(group: TaxGroup | null | undefined): InstanceType<typeof D> {
  return (group?.taxes ?? []).reduce((a, t) => a.plus(t.rate), new D(0));
}

/**
 * Tax on one amount.
 *  - inclusive: `baseCents` already contains tax. tax = base - base / (1 + R)
 *  - exclusive: `baseCents` is before tax.         tax = base * R
 * The line's total tax is rounded ONCE, then split across the taxes in the group by rate, so the parts always
 * add up to the total. Taxes in a group are parallel (all on the same base), not compounded.
 */
export function lineTax(baseCents: number, group: TaxGroup | null | undefined, mode: TaxMode, rounding: RoundingMode): LineTax {
  const R = groupRate(group);
  if (R.isNegative()) throw new RangeError('tax rates cannot be negative');
  if (R.isZero() || !group) return { netCents: baseCents, taxCents: 0, grossCents: baseCents, parts: [] };
  const tax = mode === 'inclusive'
    ? roundToInt(new D(baseCents).minus(new D(baseCents).div(R.plus(1))), rounding)
    : roundToInt(new D(baseCents).times(R), rounding);
  const weights = group.taxes.map((t) => new D(t.rate).times(RATE_SCALE).toDecimalPlaces(0));
  const amounts = apportion(tax, weights);
  const parts = group.taxes.map((t, i) => ({ taxId: t.id, name: t.name, rate: t.rate, amountCents: amounts[i] }));
  return mode === 'inclusive'
    ? { netCents: baseCents - tax, taxCents: tax, grossCents: baseCents, parts }
    : { netCents: baseCents, taxCents: tax, grossCents: baseCents + tax, parts };
}
