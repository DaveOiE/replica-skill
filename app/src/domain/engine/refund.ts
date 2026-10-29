import { apportion } from './apportion';
import { D, roundToInt, type DecimalLike, type RoundingMode } from './rounding';
import type { TaxPart } from './tax';

export interface OriginalLine { qty: DecimalLike; grossCents: number; taxCents: number; taxParts: TaxPart[] }
export interface RefundedSoFar { qty: DecimalLike; grossCents: number; taxCents: number; parts: Record<string, number> }
export interface RefundStep { grossCents: number; taxCents: number; netCents: number; parts: Record<string, number> }

export const NOTHING_REFUNDED: RefundedSoFar = { qty: '0', grossCents: 0, taxCents: 0, parts: {} };

/**
 * Money to give back for `refundQty` more units of a line. Uses cumulative shares, so ANY way of splitting a line
 * into several refunds adds up to exactly what was charged, and tax refunded never exceeds tax collected.
 */
export function refundLine(orig: OriginalLine, prior: RefundedSoFar, refundQty: DecimalLike, mode: RoundingMode): RefundStep {
  const total = new D(orig.qty), prev = new D(prior.qty), step = new D(refundQty);
  if (step.lte(0)) throw new RangeError('refund quantity must be positive');
  if (prev.plus(step).gt(total)) throw new RangeError('cannot refund more than was sold');
  const cumulative = (amount: number, k: InstanceType<typeof D>) => roundToInt(new D(amount).times(k).div(total), mode);
  const k = prev.plus(step);
  const gross = cumulative(orig.grossCents, k) - prior.grossCents;
  const tax = cumulative(orig.taxCents, k) - prior.taxCents;
  const remaining = orig.taxParts.map((p) => p.amountCents - (prior.parts[p.taxId] ?? 0));
  const shares = apportion(tax, remaining);
  const parts: Record<string, number> = {};
  orig.taxParts.forEach((p, i) => { parts[p.taxId] = shares[i]; });
  return { grossCents: gross, taxCents: tax, netCents: gross - tax, parts };
}

export function addRefund(prior: RefundedSoFar, qty: DecimalLike, step: RefundStep): RefundedSoFar {
  const parts = { ...prior.parts };
  for (const [id, v] of Object.entries(step.parts)) parts[id] = (parts[id] ?? 0) + v;
  return { qty: new D(prior.qty).plus(qty).toString(), grossCents: prior.grossCents + step.grossCents, taxCents: prior.taxCents + step.taxCents, parts };
}
