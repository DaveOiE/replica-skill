// Repeated, low-value events (failed sign-ins, token reads) are recorded once per key in each window and then summarised with a count,
// so that nobody can fill the append-only audit trail by repeating a request. The table of open windows is bounded: when it is full,
// new keys are NOT written; they are counted, and a single "rows dropped" summary is written per workspace instead.
import { appendAudit } from './audit.js';
import { nowIso } from './db.js';

export const FOLD_WINDOW_MS = 5 * 60000;
export const MAX_WINDOWS = 5000;
const perDb = new WeakMap();   // one table per database, so two databases in one process never mix
const stateOf = (db) => { let s = perDb.get(db); if (!s) perDb.set(db, (s = { windows: new Map(), lastSweep: 0, dropped: new Map(), anonymous: 0 })); return s; };
const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

const summarise = (db, w) => {
  if (!w.more) return;
  try {
    appendAudit(db, { workspaceId: w.ws, actorId: w.actorId ?? null, actorKind: w.actorKind || 'system', action: w.summaryAction, targetType: w.targetType, targetId: w.targetId,
      summary: w.summary, after: { ...w.afterBase, [w.countKey]: w.more, windowSeconds: FOLD_WINDOW_MS / 1000 }, ip: w.ip });
  } catch { /* the workspace may be gone */ }
};

/** Write the summary rows for windows that have ended (or all of them, on shutdown), and one row per workspace for rows that were dropped. */
function sweepEnded(db, now, all = false) {
  const st = stateOf(db);
  for (const [k, w] of st.windows) if (all || w.until <= now) { st.windows.delete(k); summarise(db, w); }
}
export function flushFolds(db, { now = nowIso(), all = false } = {}) {
  const st = stateOf(db);
  sweepEnded(db, now, all);
  for (const [ws, n] of st.dropped) {
    st.dropped.delete(ws);
    try { appendAudit(db, { workspaceId: ws, actorKind: 'system', action: 'audit.rows_dropped', targetType: 'workspace', targetId: ws, summary: 'Repeated events were counted, not recorded, because too many were open at once', after: { dropped: n, windowSeconds: FOLD_WINDOW_MS / 1000 } }); } catch { /* ignore */ }
  }
}

/**
 * True when the caller should write its own audit row for this event. False when it was folded into an open window's count, or dropped
 * because the table of open windows is full (the drop is counted and summarised later).
 * info: { ws, actorId, actorKind, targetType, targetId, summaryAction, summary, countKey, afterBase }
 */
export function foldOrRecord(db, key, info, now = nowIso(), ip = null) {
  const st = stateOf(db), { windows } = st;
  // Tidy up ended windows now and then (and, when the table is full, at most once a second so a flood cannot make every request scan it).
  const since = Date.parse(now) - st.lastSweep;
  if (since > 30000 || (windows.size >= MAX_WINDOWS && since > 1000)) { st.lastSweep = Date.parse(now); sweepEnded(db, now); }
  const w = windows.get(key);
  if (w && w.until > now) { w.more += 1; return false; }
  if (w) { windows.delete(key); summarise(db, w); }
  if (windows.size >= MAX_WINDOWS) { st.dropped.set(info.ws, (st.dropped.get(info.ws) || 0) + 1); return false; }
  windows.set(key, { ...info, ip, until: addMs(now, FOLD_WINDOW_MS), more: 0 });
  return true;
}

/** Failed sign-ins for accounts that do not exist are never written to the trail (there is no workspace to put them in); they are only counted. */
export const countAnonymousAttempt = (db) => { stateOf(db).anonymous += 1; };
export const takeAnonymousCount = (db) => { const st = stateOf(db), n = st.anonymous; st.anonymous = 0; return n; };
export const openWindowCount = (db) => stateOf(db).windows.size;
