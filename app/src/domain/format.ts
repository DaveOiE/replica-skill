// Money formatting with integer arithmetic only. Display is the one place minor units become text.
export interface CurrencyFormat {
  symbol: string;
  position: 'before' | 'after';
  decimals: number;
  thousandSeparator: string;
  decimalSeparator: string;
}

export function formatMoney(cents: number, f: CurrencyFormat): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError('amount must be a whole number of minor units');
  const neg = cents < 0;
  const abs = Math.abs(cents).toString().padStart(f.decimals + 1, '0');
  const whole = f.decimals ? abs.slice(0, -f.decimals) : abs;
  const frac = f.decimals ? abs.slice(-f.decimals) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, f.thousandSeparator);
  const num = frac ? `${grouped}${f.decimalSeparator}${frac}` : grouped;
  const body = f.position === 'before' ? `${f.symbol}${num}` : `${num}${f.symbol}`;
  return neg ? `-${body}` : body;
}
