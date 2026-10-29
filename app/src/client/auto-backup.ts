'use client';
import { useEffect } from 'react';
import { useSession } from './session';
import { backupStatus, shouldBackupNow } from '../backup/backup';
import { backupToS3 } from '../services/backups';
import { getSetting } from '../settings/service';
import type { S3Config } from '../backup/s3';

export const AUTO_PASS = 'backup-passphrase';
const RETRY_AFTER_MS = 15 * 60_000;

/**
 * "Scheduled" backups in a browser: while the app is open and unlocked, if a verified backup is due, send one to the
 * S3-compatible store (no tap needed). A save-to-file backup needs a person, because browsers only open the save
 * dialog after a tap. A failure is recorded and retried later, not hammered.
 */
export function useAutoBackup() {
  const { local, ctx, vault, phase } = useSession();
  useEffect(() => {
    if (phase !== 'ready' || !local || !ctx || !vault) return;
    let live = true; let lastAttempt = 0; let running = false;
    const tick = async () => {
      if (!live || running || Date.now() - lastAttempt < RETRY_AFTER_MS && lastAttempt) return;
      const [s3raw, pass] = [await vault.open('s3'), await vault.open(AUTO_PASS)];
      if (!s3raw || !pass) return;                                       // not set up: nothing to do
      const sec = await getSetting(local.db, 'security');
      const st = await backupStatus(local.db, sec.backupReminderDays);
      if (!shouldBackupNow(st, { intervalHours: sec.autoBackupHours })) return;
      running = true; lastAttempt = Date.now();
      try { await backupToS3(ctx, local.pg, { passphrase: pass, s3: JSON.parse(s3raw) as S3Config }); lastAttempt = 0; } catch { /* recorded as a failed run */ } finally { running = false; }
    };
    void tick();
    const t = setInterval(() => void tick(), 60_000);
    return () => { live = false; clearInterval(t); };
  }, [phase, local, ctx, vault]);
}
