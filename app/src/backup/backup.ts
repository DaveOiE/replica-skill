import type { PGlite } from '@electric-sql/pglite';
import { createPglite, fromPglite } from '../db/pglite';
import type { Db } from '../db/types';
import { encrypt, decrypt, readHeader, type BackupHeader } from './crypto';
import { SYNCED_TABLES, applyChanges, type Change } from '../sync/apply';
import { SCHEMA_VERSION } from '../schema/migrations.generated';
import { getMeta } from '../domain/store';
import { newId } from '../domain/ids';

export const APP_VERSION = '0.0.0-phase0b';

export interface Fingerprint { counts: Record<string, number>; stockSum: string }

/** Cheap, order-independent summary used to prove a restored copy matches the original. */
export async function fingerprint(db: Db): Promise<Fingerprint> {
  const counts: Record<string, number> = {};
  for (const t of SYNCED_TABLES) counts[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
  const [{ s }] = await db.query<{ s: string }>('SELECT coalesce(sum(qty), 0)::text AS s FROM stock_movements');
  return { counts, stockSum: s };
}
const same = (a: Fingerprint, b: Fingerprint) => JSON.stringify(a) === JSON.stringify(b);

async function headerFor(db: Db, kind: BackupHeader['kind']) {
  return { kind, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), appVersion: APP_VERSION, deviceId: (await getMeta(db, 'device_id')) ?? undefined, storeId: await getMeta(db, 'store_id') };
}

// ---- physical: a snapshot of the whole on-device database (fast, exact, tied to the engine version) ----

export async function createPhysicalBackup(pg: PGlite, passphrase: string, over: { iterations?: number } = {}): Promise<Uint8Array> {
  const db = fromPglite(pg);
  const dump = await pg.dumpDataDir('gzip');
  return encrypt(new Uint8Array(await dump.arrayBuffer()), passphrase, await headerFor(db, 'physical'), over.iterations);
}

export class IncompatibleBackupError extends Error {
  constructor(public file: string, public here: string) { super(`this backup was made by a different version of the database layout (${file}); this device is on ${here}. Use a logical export or update the app first.`); this.name = 'IncompatibleBackupError'; }
}

/**
 * Check a snapshot file and decrypt it, changing nothing. Use this BEFORE wiping anything, so a mistyped passphrase or
 * the wrong file can never leave a device without its database.
 */
export async function openPhysicalBackup(bytes: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const head = readHeader(bytes);
  if (head.kind !== 'physical') throw new Error('this file is a logical export, not a database snapshot');
  if (head.schemaVersion !== SCHEMA_VERSION) throw new IncompatibleBackupError(head.schemaVersion, SCHEMA_VERSION);
  return (await decrypt(bytes, passphrase)).data;
}

export function loadPhysicalData(data: Uint8Array, dataDir?: string): PGlite {
  return createPglite(dataDir, { loadDataDir: new File([data as BlobPart], 'backup.tar.gz', { type: 'application/gzip' }) });
}

/** Restore into a fresh database (pass `dataDir`, e.g. 'idb://tillbox', to restore over the real one). */
export async function restorePhysicalBackup(bytes: Uint8Array, passphrase: string, dataDir?: string): Promise<PGlite> {
  return loadPhysicalData(await openPhysicalBackup(bytes, passphrase), dataDir);
}

/**
 * A backup only counts once it has been restored into a scratch database and matches the original.
 * Throws if it does not. The scratch copy is discarded.
 */
export async function createVerifiedPhysicalBackup(pg: PGlite, passphrase: string, over: { iterations?: number } = {}): Promise<{ bytes: Uint8Array; check: Fingerprint }> {
  const before = await fingerprint(fromPglite(pg));
  const bytes = await createPhysicalBackup(pg, passphrase, over);
  const scratch = await restorePhysicalBackup(bytes, passphrase);
  try {
    if (!same(before, await fingerprint(fromPglite(scratch)))) throw new Error('backup verification failed: the restored copy differs from the original');
  } finally { await scratch.close(); }
  return { bytes, check: before };
}

// ---- logical: every synced row as plain records (portable, engine-independent, restorable into a new device) ----

const CHUNK = 500;
async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function createLogicalExport(db: Db, passphrase: string, over: { iterations?: number } = {}): Promise<{ bytes: Uint8Array; rows: number; check: Fingerprint }> {
  const lines: string[] = [];
  let rows = 0;
  for (const table of SYNCED_TABLES) {
    let after: string | null = null;
    for (;;) {
      const page: { id: string; row: unknown }[] = await db.query(`SELECT id::text AS id, to_jsonb(t) AS row FROM ${table} t WHERE ($1::text IS NULL OR id::text > $1) ORDER BY id::text LIMIT ${CHUNK}`, [after]);
      for (const r of page) { lines.push(JSON.stringify({ t: table, p: r.row })); rows++; }
      if (page.length < CHUNK) break;
      after = page[page.length - 1].id;
    }
  }
  const check = await fingerprint(db);
  lines.push(JSON.stringify({ end: true, rows }));
  const plain = await gzip(new TextEncoder().encode(lines.join('\n')));
  return { bytes: await encrypt(plain, passphrase, await headerFor(db, 'logical'), over.iterations), rows, check };
}

/**
 * Load a logical export into a database that has been migrated (and given its own device identity).
 * Capture stays on, so everything restored is pushed to the server on the next sync.
 */
export async function importLogicalExport(db: Db, bytes: Uint8Array, passphrase: string): Promise<{ rows: number }> {
  const head = readHeader(bytes);
  if (head.kind !== 'logical') throw new Error('this file is a database snapshot, not a logical export');
  if (head.schemaVersion !== SCHEMA_VERSION) throw new IncompatibleBackupError(head.schemaVersion, SCHEMA_VERSION);
  const { data } = await decrypt(bytes, passphrase);
  const text = new TextDecoder().decode(await gunzip(data)).split('\n');
  const last = JSON.parse(text[text.length - 1]);
  if (!last.end) throw new Error('the export is incomplete (no end marker)');
  const body = text.slice(0, -1).map((l) => JSON.parse(l) as { t: string; p: Record<string, unknown> });
  if (body.length !== last.rows) throw new Error('the export is damaged (row count does not match)');
  let seq = 0;
  for (let i = 0; i < body.length; i += CHUNK) {
    const batch: Change[] = body.slice(i, i + CHUNK).map((r) => ({ seq: ++seq, table: r.t, op: 'INSERT', payload: r.p }));
    await applyChanges(db, batch, { as: 'import' });
  }
  return { rows: body.length };
}

// ---- backup history and reminders (local to the device) ----

export type BackupLevel = 'ok' | 'due' | 'warn' | 'urgent' | 'never';
export interface BackupStatus { lastVerifiedAt: string | null; ageDays: number | null; level: BackupLevel }

export async function recordBackupRun(db: Db, r: { destination: 'file' | 's3' | 'drive'; status: 'ok' | 'failed'; bytes?: number; verified: boolean; detail?: string }) {
  await db.query('INSERT INTO backup_runs (id, destination, status, bytes, verified, detail) VALUES ($1,$2,$3,$4,$5,$6)', [newId(), r.destination, r.status, r.bytes ?? null, r.verified, r.detail ?? null]);
}

/** ok < reminder days; due at the reminder; warn after 3 days past it; urgent after 7. Never = no verified backup at all. */
export async function backupStatus(db: Db, reminderDays: number, now: Date = new Date()): Promise<BackupStatus> {
  const [row] = await db.query<{ at: string | null }>("SELECT max(created_at)::text AS at FROM backup_runs WHERE status = 'ok' AND verified");
  if (!row?.at) return { lastVerifiedAt: null, ageDays: null, level: 'never' };
  const ageDays = (now.getTime() - new Date(row.at).getTime()) / 86_400_000;
  const level: BackupLevel = ageDays < reminderDays ? 'ok' : ageDays < reminderDays + 3 ? 'due' : ageDays < reminderDays + 7 ? 'warn' : 'urgent';
  return { lastVerifiedAt: row.at, ageDays, level };
}

/** "Scheduled" backups in a browser mean: when the app is open and one is due, and when a register closes. */
export function shouldBackupNow(s: BackupStatus, opts: { intervalHours: number; now?: Date; registerJustClosed?: boolean }): boolean {
  if (opts.registerJustClosed) return true;
  if (!s.lastVerifiedAt) return true;
  return ((opts.now ?? new Date()).getTime() - new Date(s.lastVerifiedAt).getTime()) / 3_600_000 >= opts.intervalHours;
}
