import { createHash, randomBytes } from 'node:crypto';
import { newId, nowIso } from './db.js';
import { mutate } from './audit.js';
import { verifyPassword, DUMMY_HASH } from './password.js';

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
export const GENERIC_FAILURE = "That email and password don't match. Try again, or ask an admin to reset it.";
export const LOCKED_MESSAGE = 'Too many tries. Wait 15 minutes, or ask an admin to unlock you.';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const addMs = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

// Failures for emails that match no user, so unknown and known emails lock out identically
// and an attacker cannot tell which accounts exist. In memory: fine for one process.
const unknownFailures = new Map();

function unknownLocked(email, now) {
  const f = unknownFailures.get(email);
  return !!(f && f.until && f.until > now);
}
function noteUnknownFailure(email, now) {
  const f = unknownFailures.get(email) || { count: 0, until: null };
  if (f.until && f.until <= now) { f.count = 0; f.until = null; }
  f.count += 1;
  if (f.count >= MAX_FAILURES) f.until = addMs(now, LOCK_MINUTES * 60000);
  unknownFailures.set(email, f);
}

/**
 * Password sign-in. Returns { ok: true, token, actor } or { ok: false, status, error, workspaces? }.
 * Every attempt, good or bad, writes an audit row. Wrong password and unknown email look the same.
 */
export function signIn(ctx, { email, password, workspaceSlug, hours = 12, now = nowIso() }) {
  const addr = String(email || '').trim().toLowerCase();
  const user = addr ? ctx.db.prepare('select * from users where email = ?').get(addr) : null;
  const workspace = workspaceSlug ? ctx.db.prepare('select id from workspaces where slug = ?').get(workspaceSlug) : null;
  const ws = workspace ? workspace.id : 'none';
  const fail = (status, error, action, extra = {}) => ({ ok: false, status, error, ...extra, action });
  const audit = (action, summary, workspaceId = ws, actorId = null) =>
    mutate({ ...ctx, actor: null }, { workspaceId, action, targetType: 'user', targetId: actorId, summary, after: { email: addr } }, () => {});

  const usable = user && user.kind === 'human' && user.status === 'active' && user.password_hash;
  if (!usable) {
    const wasLocked = unknownLocked(addr, now);
    verifyPassword(String(password || ''), DUMMY_HASH); // same cost as a real check
    if (!wasLocked) noteUnknownFailure(addr, now);
    audit('auth.signin_failed', 'Sign-in failed');
    return wasLocked || unknownLocked(addr, now) ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  }
  if (user.locked_until && user.locked_until > now) {
    audit('auth.signin_blocked', 'Sign-in blocked: account is locked', ws, user.id);
    return fail(429, LOCKED_MESSAGE);
  }
  if (!verifyPassword(String(password || ''), user.password_hash)) {
    const failures = user.failed_logins + 1;
    const lock = failures >= MAX_FAILURES;
    mutate({ ...ctx, actor: null }, { workspaceId: ws, action: lock ? 'auth.locked' : 'auth.signin_failed', targetType: 'user', targetId: user.id,
      summary: lock ? 'Account locked after repeated failures' : 'Sign-in failed', after: { email: addr, failures } }, () =>
      ctx.db.prepare('update users set failed_logins = ?, locked_until = ?, updated_at = ? where id = ?')
        .run(lock ? 0 : failures, lock ? addMs(now, LOCK_MINUTES * 60000) : null, now, user.id));
    return lock ? fail(429, LOCKED_MESSAGE) : fail(401, GENERIC_FAILURE);
  }
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
    ctx.db.prepare(`insert into sessions(id,user_id,workspace_id,auth_method,created_at,expires_at) values (?,?,?,?,?,?)`)
      .run(sha256(token), user.id, chosen.workspace_id, 'password', now, addMs(now, hours * 3600000));
  });
  return { ok: true, token, actor };
}

/** Resolve a session token to an actor, or null. Role and status are read fresh on every request. */
export function actorFromToken(db, token, now = nowIso()) {
  if (!token) return null;
  const r = db.prepare(`select s.user_id, s.workspace_id, m.role, u.name, u.email from sessions s
      join users u on u.id = s.user_id and u.status = 'active'
      join memberships m on m.user_id = s.user_id and m.workspace_id = s.workspace_id
      where s.id = ? and s.revoked_at is null and s.expires_at > ?`).get(sha256(token), now);
  return r ? { userId: r.user_id, workspaceId: r.workspace_id, role: r.role, kind: 'user', name: r.name, email: r.email } : null;
}

export function signOut(ctx, token) {
  const actor = actorFromToken(ctx.db, token);
  if (!actor) return false;
  mutate({ ...ctx, actor }, { action: 'auth.signout', targetType: 'user', targetId: actor.userId, summary: 'Signed out' },
    () => ctx.db.prepare('update sessions set revoked_at = ? where id = ?').run(nowIso(), sha256(token)));
  return true;
}

/** End every session for a user (used by deactivation and "sign out everywhere"). */
export function revokeUserSessions(db, userId) {
  db.prepare('update sessions set revoked_at = ? where user_id = ? and revoked_at is null').run(nowIso(), userId);
}

export { newId };
