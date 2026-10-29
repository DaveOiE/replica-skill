'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from './session';
import { getSyncStatus, type SyncStatus } from '../sync/client';
import { backupStatus, type BackupStatus } from '../backup/backup';
import { getSetting } from '../settings/service';

/** Re-run an async read every few seconds and when the network changes. Returns null until the first result. */
export function usePoll<T>(read: () => Promise<T>, deps: unknown[], ms = 3000): { value: T | null; refresh: () => void } {
  const [value, setValue] = useState<T | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const run = () => read().then((v) => { if (live) setValue(v); }).catch(() => {});
    run();
    const t = setInterval(run, ms);
    window.addEventListener('online', run); window.addEventListener('offline', run);
    return () => { live = false; clearInterval(t); window.removeEventListener('online', run); window.removeEventListener('offline', run); };
  }, [...deps, tick, ms]);
  return { value, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

export function useSyncStatus(): SyncStatus | null {
  const { local } = useSession();
  return usePoll(() => (local ? getSyncStatus(local.db, navigator.onLine) : Promise.resolve(null as never)), [local]).value;
}

export function useBackupStatus(): BackupStatus | null {
  const { local } = useSession();
  return usePoll(async () => {
    if (!local) return null as never;
    const days = await getSetting(local.db, 'security').then((s) => s.backupReminderDays).catch(() => 3);
    return backupStatus(local.db, days);
  }, [local]).value;
}
