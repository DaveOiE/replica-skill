import type { Db } from './types';
import { flush } from './durability';
import { migrations, serverMigrations } from '../schema/migrations.generated';

async function run(db: Db, list: { name: string; sql: string }[]): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const m of list) {
    if (done.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql.replaceAll('--> statement-breakpoint', ''));
      await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [m.name]);
    });
    ran.push(m.name);
  }
  return ran;
}

/** The shared schema: identical on every device and on the server. */
export const migrate = async (db: Db) => { const ran = await run(db, migrations); if (ran.length) await flush(db); return ran; };
/** The server also has a few tables devices never see (tokens, pairing codes). */
export const migrateServer = async (db: Db) => [...(await run(db, migrations)), ...(await run(db, serverMigrations.map((m) => ({ ...m, name: 'server:' + m.name }))))];
