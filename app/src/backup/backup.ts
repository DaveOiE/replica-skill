import { PGlite } from '@electric-sql/pglite';
import { encrypt, decrypt } from './crypto';
import { fromPglite } from '../db/pglite';
import { SYNCED_TABLES } from '../sync/apply';

export interface BackupCheck { counts: Record<string, number>; stockSum: number }

export async function fingerprint(pg: PGlite): Promise<BackupCheck> {
  const db = fromPglite(pg);
  const counts: Record<string, number> = {};
  for (const t of SYNCED_TABLES) counts[t] = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
  const [{ s }] = await db.query<{ s: number }>('SELECT coalesce(sum(qty),0)::int AS s FROM stock_movements');
  return { counts, stockSum: s };
}

/** Physical snapshot of the on-device database, compressed and encrypted. */
export async function createBackup(pg: PGlite, passphrase: string): Promise<Uint8Array> {
  const dump = await pg.dumpDataDir('gzip');
  return encrypt(new Uint8Array(await dump.arrayBuffer()), passphrase);
}

/** Restore into a fresh database. Pass `dataDir` (e.g. 'idb://tillbox') to restore over the real one. */
export async function restoreBackup(bytes: Uint8Array, passphrase: string, dataDir?: string): Promise<PGlite> {
  const plain = await decrypt(bytes, passphrase);
  const file = new File([plain as BlobPart], 'backup.tar.gz', { type: 'application/gzip' });
  return new PGlite({ ...(dataDir ? { dataDir } : {}), loadDataDir: file });
}

/**
 * A backup only counts once it has been restored into a scratch database and matches the original.
 * Returns the fingerprint on success, throws on mismatch.
 */
export async function createVerifiedBackup(pg: PGlite, passphrase: string): Promise<{ bytes: Uint8Array; check: BackupCheck }> {
  const before = await fingerprint(pg);
  const bytes = await createBackup(pg, passphrase);
  const scratch = await restoreBackup(bytes, passphrase);
  try {
    const after = await fingerprint(scratch);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('backup verification failed: restored data differs');
  } finally { await scratch.close(); }
  return { bytes, check: before };
}
