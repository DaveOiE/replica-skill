import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');

export const nowIso = () => new Date().toISOString();
export const newId = () => randomUUID();

/** Open the database. Pass ':memory:' for tests. Foreign keys are always on. */
export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** Apply numbered .sql files in order, once each, each inside a transaction. */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec('create table if not exists schema_migrations (version text primary key, applied_at text not null)');
  const done = new Set(db.prepare('select version from schema_migrations').all().map((r) => r.version));
  const applied = [];
  for (const file of readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    if (done.has(file)) continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(dir, file), 'utf8'));
      db.prepare('insert into schema_migrations(version, applied_at) values (?, ?)').run(file, nowIso());
      db.exec('COMMIT');
      applied.push(file);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${e.message}`);
    }
  }
  return applied;
}

/** Run fn inside one transaction. fn must be synchronous (node:sqlite is). */
export function transaction(db, fn) {
  if (fn.constructor.name === 'AsyncFunction') throw new Error('transaction() needs a synchronous function');
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
