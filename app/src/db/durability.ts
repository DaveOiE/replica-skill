// Durability on the device.
//
// The on-device database is stored in the browser (IndexedDB). The engine's own rule is to copy its files into
// IndexedDB after EVERY statement, even a read: measured at about 120 ms each on a desktop, so one sale (a handful of
// statements) took over half a second and a logical export took 9 seconds. So the app uses write-behind
// (db/writebehind.ts): a statement returns at once (a whole sale: about 20 ms) and the copy to browser storage is made
// when we ask for it, or shortly after the last change.
//
// What this costs: a commit that has not been copied yet lives only in memory, so a crash can lose it. The copy is one
// atomic IndexedDB transaction, so what is lost is whole commits, never a half-written database. To make that window
// harmless, call flush() before anything that must not be lost or must not be told to anyone else:
//   - confirming a sale to the customer or printing a receipt
//   - sending changes to a server (a device must never push what it could still lose: after a crash it would reuse
//     the same order number for a different order)
//   - locking, backing up, closing the database, and the page being hidden or closed
// flush() takes the engine's lock and does one STRICT write of everything not yet stored (about 120 ms).
//
// Tried first, and rejected: the engine's built-in "relaxed durability" option. Its background copy is invisible to
// the app, raced close(), and a sale that had been confirmed on screen was LOST when the browser was killed
// (e2e/crash.spec.ts). Measured, not assumed.
import type { Db } from './types';

/** Resolves once everything committed so far is safely in browser storage. */
export async function flush(db: Db): Promise<void> {
  if (db.durable) await db.durable();   // the server's Postgres makes every commit durable by itself, so there is nothing to do there
}

/** Flush when the page is hidden or going away (tab switched, app backgrounded, window closing). Returns an unsubscribe. */
export function flushOnPageHide(db: Db): () => void {
  const go = () => { void flush(db); };
  const vis = () => { if (document.visibilityState === 'hidden') go(); };
  document.addEventListener('visibilitychange', vis);
  window.addEventListener('pagehide', go);
  window.addEventListener('beforeunload', go);
  return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', go); window.removeEventListener('beforeunload', go); };
}
