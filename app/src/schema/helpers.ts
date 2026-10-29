// Every table is created through one of four helpers, so its sync behaviour is decided when it is declared and
// cannot be forgotten. The registry below is filled as a side effect.
import { pgTable, uuid, integer, timestamp, bigint, numeric, check, type PgColumnBuilderBase, type AnyPgTable } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { getTableName } from 'drizzle-orm';

export type SyncClass =
  | 'ledger'  // append-only, converges by union. Updates and deletes are blocked by the database.
  | 'lww'     // versioned last-write-wins. Rows are archived, never deleted.
  | 'owner'   // only the owning device writes it; sent as its current state.
  | 'local';  // never leaves the device (caches, secrets, drafts, backup history).

export const REGISTRY = new Map<string, { cls: SyncClass; table: AnyPgTable }>();
const register = <T extends AnyPgTable>(cls: SyncClass, t: T): T => { REGISTRY.set(getTableName(t), { cls, table: t }); return t; };

type Cols = Record<string, PgColumnBuilderBase>;
type Extra = (t: any) => any[];

/** Money in whole minor units (cents). The pg driver is configured to return these as JS numbers. */
export const cents = (name: string) => bigint(name, { mode: 'number' });
/** Quantities and balances that may be fractional. Carried as strings and handled with Decimal. */
export const qty = (name: string) => numeric(name, { precision: 18, scale: 5 });
export const rate = (name: string) => numeric(name, { precision: 9, scale: 6 });
export const ts = (name: string) => timestamp(name, { withTimezone: true });
export const id = () => uuid('id').primaryKey();

export const oneOf = (col: unknown, values: string[]): SQL => sql`${col as never} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
export { check, sql };

const lwwCols = () => ({
  version: integer('version').notNull().default(1),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedByDevice: uuid('updated_by_device').notNull(),
});
const ledgerCols = () => ({
  deviceId: uuid('device_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const lwwTable = <C extends Cols>(name: string, cols: C, extra?: Extra) =>
  register('lww', pgTable(name, { id: id(), ...cols, ...lwwCols() }, extra as never));
export const ledgerTable = <C extends Cols>(name: string, cols: C, extra?: Extra) =>
  register('ledger', pgTable(name, { id: id(), ...cols, ...ledgerCols() }, extra as never));
export const ownerTable = <C extends Cols>(name: string, cols: C, extra?: Extra) =>
  register('owner', pgTable(name, { id: id(), ...cols, ...ledgerCols() }, extra as never));
export const localTable = <C extends Cols>(name: string, cols: C, extra?: Extra) =>
  register('local', pgTable(name, cols, extra as never));
