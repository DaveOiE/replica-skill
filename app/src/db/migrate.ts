import type { Db } from './types';
import { migrations } from '../schema/migrations.generated';

export async function migrate(db: Db): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const ran: string[] = [];
  for (const m of migrations) {
    if (done.has(m.name)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(m.sql.replaceAll('--> statement-breakpoint', ''));
      await tx.query('INSERT INTO _migrations (name) VALUES ($1)', [m.name]);
    });
    ran.push(m.name);
  }
  return ran;
}
