// Data access for machine access (service accounts and tokens). All SQL for these features lives here, so moving to another
// database later means changing this module, not the routes. (Older routes still call the database directly.)
import { createHash, randomBytes } from 'node:crypto';
import { newId, nowIso } from './db.js';

export const SCOPES = ['tasks:write', 'tasks:read'];
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const BEARER = /^Bearer (dsk_[A-Za-z0-9_-]{43})$/;

export const newTokenValue = () => `dsk_${randomBytes(32).toString('base64url')}`;

export function listServiceAccounts(db, ws) {
  const accounts = db.prepare(`select u.id, u.name, u.status, a.created_at as createdAt from service_accounts a join users u on u.id = a.user_id where a.workspace_id = ? order by u.name`).all(ws);
  const tokens = db.prepare(`select id, user_id, label, scopes_json, created_at, last_used_at, expires_at, revoked_at from api_tokens where workspace_id = ? order by created_at`).all(ws);
  return accounts.map((a) => ({ ...a, tokens: tokens.filter((t) => t.user_id === a.id).map((t) => ({ id: t.id, label: t.label, scopes: JSON.parse(t.scopes_json), createdAt: t.created_at, lastUsedAt: t.last_used_at, expiresAt: t.expires_at, revokedAt: t.revoked_at })) }));
}

export const accountIn = (db, ws, id) => db.prepare('select u.id, u.name, u.status from service_accounts a join users u on u.id = a.user_id where a.workspace_id = ? and a.user_id = ?').get(ws, id);

export function createServiceAccount(db, ws, name, createdBy) {
  const id = newId(), now = nowIso();
  db.prepare("insert into users(id,email,name,kind,status,created_at,updated_at) values (?,?,?,'service','active',?,?)").run(id, `svc-${id}@service.invalid`, name, now, now); // a placeholder address that can never receive mail or sign in
  db.prepare('insert into service_accounts(user_id,workspace_id,created_by,created_at) values (?,?,?,?)').run(id, ws, createdBy, now);
  return id;
}

/** Returns the token once. Only its hash is stored. */
export function createToken(db, ws, userId, label, scopes, expiresAt) {
  const id = newId(), token = newTokenValue();
  db.prepare('insert into api_tokens(id,workspace_id,user_id,token_hash,label,scopes_json,created_at,expires_at) values (?,?,?,?,?,?,?,?)').run(id, ws, userId, sha256(token), label, JSON.stringify(scopes), nowIso(), expiresAt);
  return { id, token };
}

export const revokeToken = (db, ws, userId, tokenId) => db.prepare('update api_tokens set revoked_at = ? where id = ? and user_id = ? and workspace_id = ? and revoked_at is null').run(nowIso(), tokenId, userId, ws).changes > 0;

export function deactivateAccount(db, ws, userId) {
  db.prepare("update users set status = 'deactivated', updated_at = ? where id = ?").run(nowIso(), userId);
  db.prepare('update api_tokens set revoked_at = ? where user_id = ? and workspace_id = ? and revoked_at is null').run(nowIso(), userId, ws);
}

/** Authorization header to a service actor, or null. Revoked, expired, unknown and deactivated all look the same. */
export function resolveBearer(db, header, now = nowIso()) {
  const m = BEARER.exec(String(header || ''));
  if (!m) return null;
  const r = db.prepare(`select t.id as tokenId, t.workspace_id, t.scopes_json, u.id as userId, u.name from api_tokens t join users u on u.id = t.user_id
    where t.token_hash = ? and t.revoked_at is null and (t.expires_at is null or t.expires_at > ?) and u.kind = 'service' and u.status = 'active'`).get(sha256(m[1]), now);
  if (!r) return null;
  db.prepare('update api_tokens set last_used_at = ? where id = ?').run(now, r.tokenId);
  return { userId: r.userId, workspaceId: r.workspace_id, role: 'service', kind: 'service', name: r.name, scopes: JSON.parse(r.scopes_json), tokenId: r.tokenId };
}
