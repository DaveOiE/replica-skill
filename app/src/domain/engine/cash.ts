import { roundToIncrement, type RoundingMode } from './rounding';

export interface CashRounding { enabled: boolean; incrementCents: number; mode: RoundingMode }

/**
 * Cash rounding applies ONCE, to the cash amount actually being paid, never to card or account payments and never
 * to line tax. The adjustment is returned separately so it can be shown and posted as its own line.
 */
export function roundCashDue(dueCents: number, cfg: CashRounding): { payableCents: number; adjustmentCents: number } {
  if (!cfg.enabled || dueCents === 0) return { payableCents: dueCents, adjustmentCents: 0 };
  const payable = roundToIncrement(dueCents, cfg.incrementCents, cfg.mode);
  return { payableCents: payable, adjustmentCents: payable - dueCents };
}

export function changeDue(tenderedCents: number, payableCents: number): number {
  if (tenderedCents < payableCents) throw new RangeError('tendered amount is less than the amount due');
  return tenderedCents - payableCents;
}
