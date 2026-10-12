import { openDb, migrate } from '../server/db.js';
import { seedDemo } from '../seed/seed.js';

/** Fresh in-memory database with the schema and the fake demo workspace. */
export function freshDb() {
  const db = openDb(':memory:');
  migrate(db);
  return { db, creds: seedDemo(db) };
}
