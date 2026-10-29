import type { Db } from './types';

/** Insert one row. Keys are column names (snake_case). Objects must be JSON-stringified by the caller. */
export async function insertRow(db: Db, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
}
