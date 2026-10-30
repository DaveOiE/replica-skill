// Write-behind for the on-device database (the full reasoning is in db/durability.ts).
//
// The engine copies its files into IndexedDB after EVERY statement, reads included (about 120 ms each on a desktop).
// We replace that with our own rule: a statement marks the database "dirty" and returns at once; the copy happens
//   - when something calls commit() (a barrier: confirming a sale, locking, pushing, backing up, page hide), and
//   - otherwise a short while after the last change, so a quiet device never sits on unsaved work.
// Every copy is a STRICT write taken under the engine's own lock, one at a time, and we hold the promise for it, so
// closing the database can wait for it. (The engine's built-in "relaxed" mode was tried first: its background copy
// is invisible to us, raced close(), and lost a confirmed sale under kill -9.)
export interface WriteBehindTarget {
  syncToFs(): Promise<void>;
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  fs?: { syncToFs(relaxedDurability?: boolean): Promise<void> };
}
export interface WriteBehind { commit(): Promise<void>; dirty(): boolean; stop(): Promise<void> }

export const DEBOUNCE_MS = 750;

export function installWriteBehind(pg: WriteBehindTarget, opts: { debounceMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout } = {}): WriteBehind {
  const set = opts.setTimer ?? setTimeout, clear = opts.clearTimer ?? clearTimeout, wait = opts.debounceMs ?? DEBOUNCE_MS;
  let isDirty = false; let timer: ReturnType<typeof setTimeout> | undefined; let chain: Promise<void> = Promise.resolve();

  const commit = (): Promise<void> => {
    if (timer) { clear(timer); timer = undefined; }
    // one at a time, in order; a failed copy leaves the database dirty so the next commit tries again
    const run = chain.then(async () => {
      if (!isDirty) return;
      isDirty = false;
      try { await pg.runExclusive(async () => { await pg.fs?.syncToFs(false); }); }
      catch (e) { isDirty = true; throw e; }
    });
    chain = run.catch(() => {});
    return run;
  };

  // the engine calls this after each statement: remember that there is something to save, and make sure it will be
  pg.syncToFs = async () => {
    isDirty = true;
    if (!timer) timer = set(() => { timer = undefined; void commit().catch(() => {}); }, wait);
  };

  return { commit, dirty: () => isDirty, async stop() { await commit().catch(() => {}); if (timer) { clear(timer); timer = undefined; } } };
}
