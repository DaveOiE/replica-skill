// Password-reset links, shared by the admin route and the command-line break-glass tool. Only a hash is stored; the link is shown once, single use, it expires.
import { createHash, randomBytes } from 'node:crypto';
import { newId, nowIso } from './db.js';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Replaces any unused reset for the person with a new one. Returns the secret token (to show once) and its expiry. Call inside the caller's transaction. */
export function createReset(db, { workspaceId, userId, createdBy, hours = 24 }) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + hours * 3600000).toISOString();
  db.prepare('delete from password_resets where user_id = ? and used_at is null').run(userId);
  db.prepare('insert into password_resets(id,workspace_id,user_id,token_hash,created_by,expires_at,created_at) values (?,?,?,?,?,?,?)').run(newId(), workspaceId, userId, sha256(token), createdBy, expires, nowIso());
  return { token, expires };
}
