// Receipt and invoice templates (plan 4b, fixed item 9): admins edit layout and wording; the token list and the
// substitution engine are code, so a template can never execute anything.
export const RECEIPT_TOKENS = [
  'store_name', 'store_address', 'store_phone', 'order_number', 'order_date', 'cashier', 'customer_name', 'order_type',
  'table_label', 'lines', 'subtotal', 'discounts', 'tax', 'total', 'payments', 'change', 'cash_rounding', 'note', 'footer',
] as const;
export const INVOICE_TOKENS = [...RECEIPT_TOKENS, 'invoice_number', 'due_date', 'billing_address', 'shipping_address'] as const;
export type TemplateKind = 'receipt' | 'invoice';
export const tokensFor = (k: TemplateKind): readonly string[] => (k === 'receipt' ? RECEIPT_TOKENS : INVOICE_TOKENS);

const TOKEN = /\{([a-z_]+)\}/g;

/** Returns the unknown tokens used in `tpl` (empty array = valid). Anything else in braces is rejected too. */
export function unknownTokens(tpl: string, kind: TemplateKind): string[] {
  const allowed = new Set(tokensFor(kind));
  const found = new Set<string>();
  for (const m of tpl.matchAll(TOKEN)) if (!allowed.has(m[1])) found.add(m[1]);
  for (const m of tpl.matchAll(/\{([^}]*)\}/g)) if (!/^[a-z_]+$/.test(m[1])) found.add(m[1]);
  return [...found];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Plain substitution. Values are HTML-escaped; there are no expressions, loops or helpers. */
export function renderTemplate(tpl: string, kind: TemplateKind, values: Record<string, string>): string {
  const bad = unknownTokens(tpl, kind);
  if (bad.length) throw new Error(`unknown template tokens: ${bad.join(', ')}`);
  return tpl.replace(TOKEN, (_, t: string) => esc(values[t] ?? ''));
}
