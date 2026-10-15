import { createHash, randomBytes } from 'node:crypto';
import { newId, nowIso, transaction } from './db.js';
import { mutate } from './audit.js';
import { verifyPasswordAsync, hashPasswordAsync, needsRehash, dummyHash } from './password.js';
import { appendAudit } from './audit.js';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const GENERIC_FAILURE = "That email and password don't match. Try again, or ask an admin to reset it.";
export const LOCKED_MESSAGE = 'Too many tries. Wait 15 minutes, or ask an admin to unlock you.';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

// Failures for emails that match no user, so unknown and known emails lock out identically
// and an attacker cannot tell which accounts exist. In memory: fine for one process.
const unknownFailures = new Map();

export function unknownLocked(email, now) {
  const f = unknownFailures.get(email);
  return !!(f && f.until && f.until > now);
}
export function noteUnknownFailure(email, now) {
  if (unknownFailures.size > 5000) for (const [k, f] of unknownFailures) if (!f.until || f.until <= now) unknownFailures.delete(k);   // bounded: only live locks are kept
  const f = unknownFailures.get(email) || { count: 0, until: null };
  if (f.until && f.until <= now) { f.count = 0; f.until = null; }
  f.count += 1;
  if (f.count >= MAX_FAILURES) f.until = addMs(now, LOCK_MINUTES * 60000);
  unknownFailures.set(email, f);
}
export const unknownFailureCount = () => unknownFailures.size;

// Repeated failed sign-ins are recorded once per account and address in each window, then summarised with a count, so a flood
// of wrong guesses cannot fill the append-only audit trail. A lock-out and every successful sign-in are always recorded in full.
export const FAILURE_WINDOW_MS = 5 * 60000;
const MAX_WINDOWS = 5000;
const perDb = new WeakMap();   // one table of open windows per database, so two databases in one process never mix
const stateOf = (db) => { let s = perDb.get(db); if (!s) perDb.set(db, (s = { windows: new Map(), lastSweep: 0 })); return s; };

const summarise = (db, w) => {
  if (!w.more) return;
  try { appendAudit(db, { workspaceId: w.ws, actorKind: 'system', action: 'auth.signin_repeated', targetType: 'user', targetId: w.userId, summary: 'More failed sign-ins in the same window', after: { moreAttempts: w.more, windowSeconds: FAILURE_WINDOW_MS / 1000, attempted: w.action.replace('auth.', '') }, ip: w.ip }); } catch { /* the workspace may be gone */ }
};
/** Write the summary rows for windows that have ended (or all of them, when shutting down). */
export function flushSignInFailures(db, { now = nowIso(), all = false } = {}) {
  const { windows } = stateOf(db);
  for (const [k, w] of windows) if (all || w.until <= now) { windows.delete(k); summarise(db, w); }
}
/** True when this failure should get its own audit row; false when it was folded into the window's count. */
function failureIsNew(ctx, key, info, now) {
  const st = stateOf(ctx.db), { windows } = st;
  if (Date.parse(now) - st.lastSweep > 30000 || windows.size > MAX_WINDOWS) { st.lastSweep = Date.parse(now); flushSignInFailures(ctx.db, { now }); }
  const w = windows.get(key);
  if (w && w.until > now) { w.more += 1; return false; }
  if (w) { windows.delete(key); summarise(ctx.db, w); }
  if (windows.size < MAX_WINDOWS) windows.set(key, { ...info, ip: ctx.ip ?? null, until: addMs(now, FAILURE_WINDOW_MS), more: 0 });
  return true;
}

/**
 * Password sign-in. Returns { ok: true, token, actor } or { ok: false, status, error, workspaces? }.
 * Every attempt, good or bad, writes an audit row. Wrong password and unknown email look the same.
 */
export async function signIn(ctx, { email, password, workspaceSlug, hours = 12, now = nowIso() }) {
  const addr = String(email || '').trim().toLowerCase();
  const user = addr ? ctx.db.prepare('select * from users where email = ?').get(addr) : null;
  const workspace = workspaceSlug ? ctx.db.prepare('select id from workspaces where slug = ?').get(workspaceSlug) : null;
  const ws = workspace ? workspace.id : 'none';
  const fail = (status, error, action, extra = {}) => ({ ok: false, status, error, ...extra, action });
  const keyOf = (action) => `${action}|${user?.id ?? addr}|${ctx.ip ?? ''}`;   // the email text is only a key in memory, never written anywhere
  const audit = (action, summary, workspaceId = ws, actorId = null) => {
    if (!failureIsNew(ctx, keyOf(action), { ws: workspaceId, userId: actorId, action }, now)) return;
    mutate({ ...ctx, actor: null }, { workspaceId, action, targetType: 'user', targetId: actorId, summary }, () => {});
  };

  const usable = user && user.kind === 'human' && user.status === 'active' && user.password_hash;
  if (!usable) {
    const wasLocked = unknownLocked(addr, now);
    await verifyPasswordAsync(String(password || ''), dummyHash()); // about the same cost as a real check
    if (!wasLocked) noteUnknownFailure(addr, now);
    audit('auth.signin_failed', 'Sign-in failed');
    return wasLocked || unknownLocked(addr, now) ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  }
  if (user.locked_until && user.locked_until > now) {
    audit('auth.signin_blocked', 'Sign-in blocked: account is locked', ws, user.id);
    return fail(429, LOCKED_MESSAGE);
  }
  if (!(await verifyPasswordAsync(String(password || ''), user.password_hash))) {
    const failures = user.failed_logins + 1;
    const lock = failures >= MAX_FAILURES;
    const update = () => ctx.db.prepare('update users set failed_logins = ?, locked_until = ?, updated_at = ? where id = ?')
      .run(lock ? 0 : failures, lock ? addMs(now, LOCK_MINUTES * 60000) : null, now, user.id);
    if (lock) mutate({ ...ctx, actor: null }, { workspaceId: ws, action: 'auth.locked', targetType: 'user', targetId: user.id, summary: 'Account locked after repeated failures', after: { failures } }, update);
    else if (failureIsNew(ctx, keyOf('auth.signin_failed'), { ws, userId: user.id, action: 'auth.signin_failed' }, now))
      mutate({ ...ctx, actor: null }, { workspaceId: ws, action: 'auth.signin_failed', targetType: 'user', targetId: user.id, summary: 'Sign-in failed', after: { failures } }, update);
    else transaction(ctx.db, update);   // the counter still moves, so the lock-out still works; only the audit row is folded
    return lock ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  }
  // A correct password: if the stored hash is weaker than today's cost, make a stronger one now (work done before the transaction, since hashing is asynchronous).
  const upgraded = needsRehash(user.password_hash) ? await hashPasswordAsync(String(password)) : null;
  const memberships = ctx.db.prepare(`select m.workspace_id, m.role, w.slug, w.name from memberships m
    join workspaces w on w.id = m.workspace_id where m.user_id = ? order by w.slug`).all(user.id);
  const chosen = workspaceSlug ? memberships.find((m) => m.slug === workspaceSlug) : memberships.length === 1 ? memberships[0] : null;
  if (!chosen) {
    if (memberships.length > 1 && !workspaceSlug) return fail(409, 'Choose a workspace to sign in to.', 'auth.workspace_required', { workspaces: memberships.map((m) => m.slug) });
    audit('auth.signin_failed', 'Sign-in failed: not a member of that workspace', ws, user.id);
    return fail(401, GENERIC_FAILURE);
  }
  const token = randomBytes(32).toString('base64url');
  const actor = { userId: user.id, workspaceId: chosen.workspace_id, role: chosen.role, kind: 'user', name: user.name, email: user.email };
  mutate({ ...ctx, actor }, { action: 'auth.signin', targetType: 'user', targetId: user.id, summary: 'Signed in with password' }, () => {
    ctx.db.prepare('update users set failed_logins = 0, locked_until = null where id = ?').run(user.id);
    if (upgraded) ctx.db.prepare('update users set password_hash = ? where id = ? and password_hash = ?').run(upgraded, user.id, user.password_hash);
    ctx.db.prepare(`insert into sessions(id,user_id,workspace_id,auth_method,created_at,expires_at) values (?,?,?,?,?,?)`)
      .run(sha256(token), user.id, chosen.workspace_id, 'password', now, addMs(now, hours * 3600000));
  });
  return { ok: true, token, actor };
}

/** Resolve a session token to an actor, or null. Role and status are read fresh on every request. */
export const DEFAULT_IDLE_MINUTES = 120;
export function actorFromToken(db, token, now = nowIso(), idleMinutes = DEFAULT_IDLE_MINUTES) {
  if (!token) return null;
  const idleCutoff = addMs(now, -idleMinutes * 60000);
  const r = db.prepare(`select s.user_id, s.workspace_id, m.role, u.name, u.email from sessions s
      join users u on u.id = s.user_id and u.status = 'active'
      join memberships m on m.user_id = s.user_id and m.workspace_id = s.workspace_id
      where s.id = ? and s.revoked_at is null and s.expires_at > ? and coalesce(s.last_seen_at, s.created_at) > ?`).get(sha256(token), now, idleCutoff);
  if (r) db.prepare('update sessions set last_seen_at = ? where id = ? and (last_seen_at is null or last_seen_at < ?)').run(now, sha256(token), addMs(now, -60000));   // at most once a minute
  return r ? { userId: r.user_id, workspaceId: r.workspace_id, role: r.role, kind: 'user', name: r.name, email: r.email } : null;
}

export function signOut(ctx, token) {
  const actor = actorFromToken(ctx.db, token);
  if (!actor) return false;
  mutate({ ...ctx, actor }, { action: 'auth.signout', targetType: 'user', targetId: actor.userId, summary: 'Signed out' },
    () => ctx.db.prepare('update sessions set revoked_at = ? where id = ?').run(nowIso(), sha256(token)));
  return true;
}

/** Delete sessions that can never be used again (expired, revoked or idle for longer than a week). Returns how many went. */
export function cleanupSessions(db, now = nowIso(), keepDays = 7) {
  const cutoff = addMs(now, -keepDays * 86400000);
  const n = db.prepare(`delete from sessions where expires_at < ? or revoked_at < ? or coalesce(last_seen_at, created_at) < ?`).run(cutoff, cutoff, cutoff).changes;
  if (n > 0) for (const w of db.prepare('select id from workspaces').all()) appendAudit(db, { workspaceId: w.id, actorKind: 'system', action: 'session.cleanup', targetType: 'workspace', targetId: w.id, summary: 'Old sessions cleared', after: { sessionsRemoved: n } });
  return n;
}

/** End every session for a user (used by deactivation and "sign out everywhere"). */
export function revokeUserSessions(db, userId) {
  db.prepare('update sessions set revoked_at = ? where user_id = ? and revoked_at is null').run(nowIso(), userId);
}

export { newId };
