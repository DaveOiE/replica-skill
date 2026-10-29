import { text, boolean, integer, uuid, date, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable, localTable, cents, oneOf, check, sql } from '../helpers';

export const accounts = lwwTable('accounts', {
  code: text('code'),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  kind: text('kind').notNull(),
  systemKey: text('system_key'),
  active: boolean('active').notNull().default(true),
}, (t) => [check('accounts_kind', oneOf(t.kind, ['asset', 'liability', 'equity', 'income', 'expense']))]);

/** A posting. Its lines must balance when created locally (trigger); applying a synced entry is not re-checked. */
export const journalEntries = ledgerTable('journal_entries', {
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id'),
  event: text('event').notNull(),
  ruleId: uuid('rule_id'),
  postedAt: text('posted_at'),
  memo: text('memo'),
}, (t) => [index('journal_entries_source').on(t.sourceType, t.sourceId)]);

export const journalLines = ledgerTable('journal_lines', {
  entryId: uuid('entry_id').notNull(),
  accountId: uuid('account_id').notNull(),
  debitCents: cents('debit_cents').notNull().default(0),
  creditCents: cents('credit_cents').notNull().default(0),
}, (t) => [
  index('journal_lines_entry').on(t.entryId), index('journal_lines_account').on(t.accountId),
  check('journal_lines_one_side', sql`(${t.debitCents} > 0 and ${t.creditCents} = 0) or (${t.creditCents} > 0 and ${t.debitCents} = 0)`),
]);

export const expenses = lwwTable('expenses', {
  name: text('name').notNull(),
  accountId: uuid('account_id').notNull(),
  paymentAccountId: uuid('payment_account_id'),
  amountCents: cents('amount_cents').notNull(),
  kind: text('kind').notNull().default('direct'),
  note: text('note'),
  active: boolean('active').notNull().default(true),
}, (t) => [check('expenses_kind', oneOf(t.kind, ['direct', 'recurring', 'scheduled']))]);

export const expenseSchedules = lwwTable('expense_schedules', {
  expenseId: uuid('expense_id').notNull(),
  pattern: text('pattern').notNull(),
  patternValue: integer('pattern_value'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  lastRunOn: date('last_run_on'),
  active: boolean('active').notNull().default(true),
}, (t) => [check('expense_schedules_pattern', oneOf(t.pattern, ['month_start', 'month_middle', 'month_end', 'day_of_month', 'every_x_days', 'every_x_hours', 'every_x_minutes', 'once']))]);

export const postingRules = lwwTable('posting_rules', {
  event: text('event').notNull(),
  name: text('name').notNull(),
  locked: boolean('locked').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const postingRuleLines = lwwTable('posting_rule_lines', {
  ruleId: uuid('rule_id').notNull(),
  accountId: uuid('account_id'),
  dynamicRole: text('dynamic_role'),
  effect: text('effect').notNull(),
  amountSource: text('amount_source').notNull(),
  sortPosition: integer('sort_position').notNull().default(0),
  active: boolean('active').notNull().default(true),
}, (t) => [index('posting_rule_lines_rule').on(t.ruleId), check('posting_rule_lines_effect', oneOf(t.effect, ['debit', 'credit']))]);

export const dayBalances = localTable('day_balances', {
  day: date('day').primaryKey(),
  openingCents: cents('opening_cents').notNull().default(0),
  incomeCents: cents('income_cents').notNull().default(0),
  expenseCents: cents('expense_cents').notNull().default(0),
  closingCents: cents('closing_cents').notNull().default(0),
});
export const monthBalances = localTable('month_balances', {
  month: text('month').primaryKey(),
  openingCents: cents('opening_cents').notNull().default(0),
  incomeCents: cents('income_cents').notNull().default(0),
  expenseCents: cents('expense_cents').notNull().default(0),
  closingCents: cents('closing_cents').notNull().default(0),
});
