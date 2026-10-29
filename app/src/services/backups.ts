import type { PGlite } from '@electric-sql/pglite';
import { runService, requirePermission, type Ctx } from './runner';
import { createVerifiedPhysicalBackup, createLogicalExport, recordBackupRun } from '../backup/backup';
import { backupFileName, saveToDevice, type SaveRoute } from '../backup/destinations/file';
import { putVerified, type S3Config } from '../backup/s3';
import { getMeta } from '../domain/store';

type Kind = 'physical' | 'logical';
const make = async (ctx: Ctx, pg: PGlite, kind: Kind, passphrase: string, iterations?: number) =>
  kind === 'physical' ? (await createVerifiedPhysicalBackup(pg, passphrase, { iterations })).bytes : (await createLogicalExport(ctx.db, passphrase, { iterations })).bytes;

/**
 * One tap: build an encrypted backup, check it (a physical one is restored into a scratch database and compared),
 * hand it to the destination, and only then record it as a good backup. A failure is recorded as a failure.
 * The heavy work runs OUTSIDE any transaction: the on-device database has one connection, and a snapshot taken inside a
 * transaction would wait for itself. Only the record-keeping is transactional.
 */
async function run<T extends { bytes: number }>(ctx: Ctx, destination: 'file' | 's3', summary: (r: T) => string, work: () => Promise<{ result: T; detail: string }>): Promise<T> {
  requirePermission(ctx, 'backups.manage');
  let done: { result: T; detail: string };
  try { done = await work(); }
  catch (e) {
    await recordBackupRun(ctx.db, { destination, status: 'failed', verified: false, detail: (e as Error).message });
    throw e;
  }
  await runService(ctx, { name: `backups.${destination}`, permission: 'backups.manage', audit: () => ({ summary: summary(done.result), data: { bytes: done.result.bytes } }) }, async (tx) => {
    await recordBackupRun(tx, { destination, status: 'ok', bytes: done.result.bytes, verified: true, detail: done.detail });
  });
  return done.result;
}

export async function backupToFile(ctx: Ctx, pg: PGlite, o: { passphrase: string; kind?: Kind; prefer?: SaveRoute; iterations?: number }) {
  const kind = o.kind ?? 'physical';
  return run(ctx, 'file', (r: { bytes: number; route: SaveRoute; kind: Kind }) => `backup to device (${r.route})`, async () => {
    const bytes = await make(ctx, pg, kind, o.passphrase, o.iterations);
    const prefix = (await ctx.db.query<{ order_prefix: string }>('SELECT order_prefix FROM devices WHERE id = $1', [ctx.deviceId]))[0]?.order_prefix ?? 'dev';
    const route = await saveToDevice(bytes, backupFileName(prefix, new Date()), { prefer: o.prefer });
    return { result: { bytes: bytes.length, route, kind }, detail: `${kind}, ${route}` };
  });
}

export async function backupToS3(ctx: Ctx, pg: PGlite, o: { passphrase: string; s3: S3Config; kind?: Kind; iterations?: number; fetch?: typeof fetch }) {
  const kind = o.kind ?? 'physical';
  return run(ctx, 's3', () => `backup to ${o.s3.bucket}`, async () => {
    const bytes = await make(ctx, pg, kind, o.passphrase, o.iterations);
    const prefix = (await getMeta(ctx.db, 'device_id'))?.slice(0, 8) ?? 'dev';
    const put = await putVerified(o.s3, backupFileName(prefix, new Date()), bytes, { fetch: o.fetch });
    return { result: { bytes: bytes.length, key: put.key, kind }, detail: `${kind}, ${put.key}` };
  });
}
