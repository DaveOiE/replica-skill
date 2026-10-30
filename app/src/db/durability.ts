// Durability on the device.
//
// The on-device database is stored in the browser (IndexedDB). In "strict" mode the engine copies its files into
// IndexedDB after EVERY statement, even a read: measured at about 120 ms each on a desktop, so one sale (a handful
// of statements) took over half a second. In "relaxed" mode that copy runs in the background right after the
// statement, coalesced, and a statement returns at once (a whole sale: about 17 ms).
//
// What relaxed costs: the background copy asks the browser for "relaxed" IndexedDB durability, which Chromium may
// buffer, so the newest commits can be lost if the browser is killed. (Measured, not assumed: a confirmed sale was
// lost after kill -9 when the barrier only waited for the relaxed copy.) The copy is one atomic transaction, so what
// is lost is whole commits, never a half-written database.
//
// So the rule is: before anything that must not be lost or must not be told to anyone else, call flush(). On the
// device it takes the engine's lock and does one STRICT write of everything not yet stored (about 120 ms).
//   - confirming a sale to the customer or printing a receipt
//   - sending changes to a server (a device must never push what it could still lose: after a crash it would reuse
//     the same order number for a different order)
//   - locking, backing up, and the page being hidden or closed
import type { Db } from './types';

/** Resolves once everything committed so far is safely in browser storage. */
export async function flush(db: Db): Promise<void> {
  if (db.durable) await db.durable(); else await db.query('SELECT 1 AS durable');
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
