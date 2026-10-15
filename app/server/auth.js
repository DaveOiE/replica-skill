import { createHash, randomBytes } from 'node:crypto';
import { newId, nowIso, transaction } from './db.js';
import { mutate } from './audit.js';
import { verifyPasswordAsync, hashPasswordAsync, needsRehash, dummyHash } from './password.js';
import { appendAudit } from './audit.js';
import { foldOrRecord, countAnonymousAttempt } from './audit-fold.js';

export const MAX_FAILURES = 5;
export const TEMP_PASSWORD_DAYS = 7;   // a temporary password that was never used stops working after this long
export const TEMP_EXPIRED_MESSAGE = 'That temporary password has expired. Ask an admin for a new one.';
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

export { FOLD_WINDOW_MS as FAILURE_WINDOW_MS, flushFolds as flushSignInFailures } from './audit-fold.js';

/** The workspace a failure is recorded in comes from the person's own memberships, never from what the request said. */
function auditWorkspace(db, userId, slug) {
  const ms = db.prepare('select m.workspace_id, w.slug from memberships m join workspaces w on w.id = m.workspace_id where m.user_id = ? order by w.slug').all(userId);
  return (ms.find((m) => m.slug === slug) || ms[0])?.workspace_id ?? null;
}

const NAMES = {
  signin: { failed: 'auth.signin_failed', blocked: 'auth.signin_blocked', failedSummary: 'Sign-in failed', blockedSummary: 'Sign-in blocked: account is locked' },
  password: { failed: 'auth.password_check_failed', blocked: 'auth.password_check_blocked', failedSummary: 'Wrong current password on a password change', blockedSummary: 'Password change blocked: account is locked' },
};
const foldInfo = (ws, userId, action) => ({ ws, actorId: null, targetType: 'user', targetId: userId, summaryAction: 'auth.signin_repeated', summary: 'More failed attempts in the same window', countKey: 'moreAttempts', afterBase: { attempted: action.replace('auth.', '') } });
function foldedRow(ctx, user, ws, action, summary, now, after) {
  if (!ws) return;
  if (!foldOrRecord(ctx.db, `${action}|${user.id}|${ctx.ip ?? ''}`, foldInfo(ws, user.id, action), now, ctx.ip ?? null)) return;
  mutate({ ...ctx, actor: null }, { workspaceId: ws, action, targetType: 'user', targetId: user.id, summary, ...(after ? { after } : {}) }, () => {});
}
export const isLocked = (db, userId, now) => { const r = db.prepare('select locked_until from users where id = ?').get(userId); return !!(r?.locked_until && r.locked_until > now); };

/** A blocked attempt (the account is locked): folded in the trail like repeated failures. */
export function recordBlocked(ctx, user, ws, now, via = 'signin') { foldedRow(ctx, user, ws, NAMES[via].blocked, NAMES[via].blockedSummary, now); }

/**
 * A wrong password for a real account, from sign-in or from a password change. Synchronous, so nothing interleaves: the lock state is read fresh,
 * the counter moves by one in a single UPDATE (never "read, then add one" across an await), and the lock is decided from the number that comes back.
 * Returns { locked }.
 */
export function recordWrongPassword(ctx, user, ws, now, via = 'signin') {
  if (isLocked(ctx.db, user.id, now)) { recordBlocked(ctx, user, ws, now, via); return { locked: true }; }
  const failures = ctx.db.prepare('update users set failed_logins = failed_logins + 1, updated_at = ? where id = ? returning failed_logins').get(now, user.id).failed_logins;
  if (failures >= MAX_FAILURES) {
    const lock = () => ctx.db.prepare('update users set failed_logins = 0, locked_until = ?, updated_at = ? where id = ?').run(addMs(now, LOCK_MINUTES * 60000), now, user.id);
    if (ws) mutate({ ...ctx, actor: null }, { workspaceId: ws, action: 'auth.locked', targetType: 'user', targetId: user.id, summary: 'Account locked after repeated failures', after: { failures } }, lock);
    else lock();
    return { locked: true };
  }
  foldedRow(ctx, user, ws, NAMES[via].failed, NAMES[via].failedSummary, now, { failures });
  return { locked: false };
}

/**
 * Password sign-in. Returns { ok: true, token, actor } or { ok: false, status, error, workspaces? }.
 * Every attempt, good or bad, writes an audit row. Wrong password and unknown email look the same.
 */
export async function signIn(ctx, { email, password, workspaceSlug, hours = 12, now = nowIso() }) {
  const addr = String(email || '').trim().toLowerCase();
  const user = addr ? ctx.db.prepare('select * from users where email = ?').get(addr) : null;
  const fail = (status, error, action, extra = {}) => ({ ok: false, status, error, ...extra, action });
  const pw = String(password || '');

  const usable = user && user.kind === 'human' && user.status === 'active' && user.password_hash;
  if (!usable) {
    // No such account: nothing is written to any workspace's trail (the attempt names no workspace we can trust); it is only counted.
    const wasLocked = unknownLocked(addr, now);
    await verifyPasswordAsync(pw, dummyHash()); // about the same cost as a real check
    if (!wasLocked) noteUnknownFailure(addr, now);
    countAnonymousAttempt(ctx.db);
    return wasLocked || unknownLocked(addr, now) ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  }
  const ws = auditWorkspace(ctx.db, user.id, workspaceSlug);
  if (isLocked(ctx.db, user.id, now)) {
    await verifyPasswordAsync(pw, dummyHash());   // a locked account costs the same time as anything else, so timing does not tell it from an unknown email
    recordBlocked(ctx, user, ws, now);
    return fail(429, LOCKED_MESSAGE);
  }
  const good = await verifyPasswordAsync(pw, user.password_hash);
  // Hashing took time: the account may have been locked, or changed, by someone else meanwhile. Look again before deciding anything.
  if (isLocked(ctx.db, user.id, now)) { recordBlocked(ctx, user, ws, now); return fail(429, LOCKED_MESSAGE); }
  if (!good) return recordWrongPassword(ctx, user, ws, now).locked ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  // A correct password: if the stored hash is weaker than today's cost, make a stronger one now (work done before the transaction, since hashing is asynchronous).
  const upgraded = needsRehash(user.password_hash) ? await hashPasswordAsync(String(password)) : null;
  const memberships = ctx.db.prepare(`select m.workspace_id, m.role, w.slug, w.name from memberships m
    join workspaces w on w.id = m.workspace_id where m.user_id = ? order by w.slug`).all(user.id);
  const chosen = workspaceSlug ? memberships.find((m) => m.slug === workspaceSlug) : memberships.length === 1 ? memberships[0] : null;
  if (!chosen) {
    if (memberships.length > 1 && !workspaceSlug) return fail(409, 'Choose a workspace to sign in to.', 'auth.workspace_required', { workspaces: memberships.map((m) => m.slug) });
    foldedRow(ctx, user, ws, 'auth.signin_failed', 'Sign-in failed: not a member of that workspace', now);
    return fail(401, GENERIC_FAILURE);
  }
  if (user.must_change_password && user.password_expires_at && user.password_expires_at < now) return fail(401, TEMP_EXPIRED_MESSAGE);
  const token = randomBytes(32).toString('base64url');
  const actor = { userId: user.id, workspaceId: chosen.workspace_id, role: chosen.role, kind: 'user', name: user.name, email: user.email, mustChange: !!user.must_change_password };
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
  const r = db.prepare(`select s.user_id, s.workspace_id, m.role, u.name, u.email, u.must_change_password from sessions s
      join users u on u.id = s.user_id and u.status = 'active'
      join memberships m on m.user_id = s.user_id and m.workspace_id = s.workspace_id
      where s.id = ? and s.revoked_at is null and s.expires_at > ? and coalesce(s.last_seen_at, s.created_at) > ?`).get(sha256(token), now, idleCutoff);
  if (r) db.prepare('update sessions set last_seen_at = ? where id = ? and (last_seen_at is null or last_seen_at < ?)').run(now, sha256(token), addMs(now, -60000));   // at most once a minute
  return r ? { userId: r.user_id, workspaceId: r.workspace_id, role: r.role, kind: 'user', name: r.name, email: r.email, mustChange: !!r.must_change_password } : null;
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
