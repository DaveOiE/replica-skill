import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { mutate } from './audit.js';
import { newId, nowIso } from './db.js';
import { canAssignRole } from './authz.js';
import { hashPassword, checkPasswordRules } from './password.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const NOT_VALID = 'This link is not valid any more.';
const email = z.string().trim().toLowerCase().email().max(254);

/** Reset, unlock and invites. The links are the secret: shown once to the admin, only a hash is stored, single use, they expire. */
export function accessRoutes(define, db, limiters) {
  const memberOf = (ws, uid) => db.prepare(`select m.role, u.id, u.kind, u.status, u.email from memberships m join users u on u.id = m.user_id where m.workspace_id = ? and m.user_id = ?`).get(ws, uid);
  const throttle = (req, reply) => (limiters.token.hit(req.ip) ? null : reply.code(429).send({ error: 'Too many tries. Wait a minute and try again.' }));
  const validInvite = (token) => db.prepare(`select i.*, w.name as workspace_name from invites i join workspaces w on w.id = i.workspace_id where i.token_hash = ? and i.accepted_at is null and i.expires_at > ?`).get(sha256(token), nowIso());
  const validReset = (token) => db.prepare(`select r.*, u.email, w.name as workspace_name from password_resets r join users u on u.id = r.user_id join workspaces w on w.id = r.workspace_id where r.token_hash = ? and r.used_at is null and r.expires_at > ?`).get(sha256(token), nowIso());

  // ---- admin: unlock and reset
  define({ method: 'POST', url: '/api/v1/members/:userId/unlock', action: 'members:unlock', write: true,
    sample: (fx) => ({ url: `/api/v1/members/${fx.creds.member2.userId}/unlock` }),
    handler: async ({ ctx, req, actor, reply }) => {
      const t = memberOf(actor.workspaceId, req.params.userId);
      if (!t || t.kind !== 'human') return reply.code(404).send({ error: 'That person is not in this workspace.' });
      if (actor.role === 'admin' && t.role === 'owner') return reply.code(403).send({ error: 'Only an owner can do that for an owner.' });
      mutate(ctx, { action: 'member.unlock', targetType: 'user', targetId: t.id, summary: 'Sign-in lock cleared by an admin' },
        () => db.prepare('update users set failed_logins = 0, locked_until = null, updated_at = ? where id = ?').run(nowIso(), t.id));
      return { ok: true };
    } });

  define({ method: 'POST', url: '/api/v1/members/:userId/reset', action: 'members:reset_password', write: true,
    sample: (fx) => ({ url: `/api/v1/members/${fx.creds.member2.userId}/reset` }),
    handler: async ({ ctx, req, actor, reply }) => {
      const t = memberOf(actor.workspaceId, req.params.userId);
      if (!t || t.kind !== 'human' || t.status !== 'active') return reply.code(404).send({ error: 'That person is not in this workspace.' });
      if (t.id === actor.userId) return reply.code(400).send({ error: 'Use Account to change your own password.' });
      if (actor.role === 'admin' && t.role === 'owner') return reply.code(403).send({ error: 'Only an owner can reset an owner.' });
      // A password belongs to the person, not to one workspace. If they are in another workspace too, an admin here must not be able to set it.
      if (db.prepare('select count(*) n from memberships where user_id = ?').get(t.id).n > 1)
        return reply.code(409).send({ error: 'This person is in more than one workspace, so a reset here could affect the others. They can change their own password under Account.' });
      const token = newToken(), expires = inHours(24);
      mutate(ctx, { action: 'member.reset_issued', targetType: 'user', targetId: t.id, summary: 'Password reset link issued (valid 24 hours)', after: { expiresAt: expires } }, () => {
        db.prepare('delete from password_resets where user_id = ? and used_at is null').run(t.id);
        db.prepare('insert into password_resets(id,workspace_id,user_id,token_hash,created_by,expires_at,created_at) values (?,?,?,?,?,?,?)').run(newId(), actor.workspaceId, t.id, sha256(token), actor.userId, expires, nowIso());
      });
      return reply.code(201).send({ link: `/#/reset/${token}`, expiresAt: expires, email: t.email }); // shown once, never stored in the clear
    } });

  // ---- public: finish a reset
  define({ method: 'GET', url: '/api/v1/resets/:token', public: true, action: null, write: false,
    sample: () => ({ url: '/api/v1/resets/none' }),
    handler: async ({ req, reply }) => {
      if (throttle(req, reply)) return;
      const r = validReset(req.params.token);
      return r ? { email: r.email, workspaceName: r.workspace_name } : reply.code(404).send({ error: NOT_VALID });
    } });

  define({ method: 'POST', url: '/api/v1/resets/:token/complete', public: true, action: null, write: true,
    body: z.object({ password: z.string().max(200) }).strict(),
    sample: () => ({ url: '/api/v1/resets/none/complete', payload: { password: 'a-new-long-password-1' } }),
    handler: async ({ req, reply, ctx, body }) => {
      if (throttle(req, reply)) return;
      const r = validReset(req.params.token);
      if (!r) return reply.code(404).send({ error: NOT_VALID });
      const problems = checkPasswordRules(body.password);
      if (problems.length) return reply.code(400).send({ error: problems.join(' '), details: [{ field: 'password', message: problems.join(' ') }] });
      mutate({ ...ctx, actor: null }, { workspaceId: r.workspace_id, action: 'auth.password_reset', targetType: 'user', targetId: r.user_id, summary: 'Password set from a reset link; all sessions ended; lock cleared' }, () => {
        db.prepare('update users set password_hash = ?, failed_logins = 0, locked_until = null, updated_at = ? where id = ?').run(hashPassword(body.password), nowIso(), r.user_id);
        db.prepare('update sessions set revoked_at = ? where user_id = ? and revoked_at is null').run(nowIso(), r.user_id);
        db.prepare('update password_resets set used_at = ? where id = ?').run(nowIso(), r.id);
      });
      return { ok: true };
    } });

  // ---- admin: invites
  define({ method: 'GET', url: '/api/v1/invites', action: 'invites:read', write: false,
    sample: () => ({ url: '/api/v1/invites' }),
    handler: async ({ actor }) => ({ invites: db.prepare(`select i.id, i.email, i.role, i.expires_at as expiresAt, u.name as invitedBy from invites i join users u on u.id = i.invited_by
      where i.workspace_id = ? and i.accepted_at is null and i.expires_at > ? order by i.created_at desc`).all(actor.workspaceId, nowIso()) }) });

  define({ method: 'POST', url: '/api/v1/invites', action: 'invites:manage', write: true,
    body: z.object({ email, role: z.enum(['admin', 'member', 'view_only', 'guest']) }).strict(),
    sample: () => ({ url: '/api/v1/invites', payload: { email: 'walk.invite@example.test', role: 'guest' } }),
    handler: async ({ ctx, actor, body, reply }) => {
      if (!canAssignRole(actor, null, body.role)) return reply.code(403).send({ error: 'You do not have permission to give that role.' });
      if (db.prepare('select 1 from users where email = ?').get(body.email)) return reply.code(409).send({ error: 'That email already has an account.' });
      const id = newId(), token = newToken(), expires = inHours(24 * 7);
      mutate(ctx, { action: 'invite.create', targetType: 'invite', targetId: id, summary: `Invite created as ${body.role}`, after: { role: body.role, expiresAt: expires } }, () => {
        db.prepare('delete from invites where workspace_id = ? and email = ? and accepted_at is null').run(actor.workspaceId, body.email); // a new invite replaces the old one
        db.prepare('insert into invites(id,workspace_id,email,role,token_hash,invited_by,expires_at,created_at) values (?,?,?,?,?,?,?,?)').run(id, actor.workspaceId, body.email, body.role, sha256(token), actor.userId, expires, nowIso());
      });
      return reply.code(201).send({ id, email: body.email, role: body.role, expiresAt: expires, link: `/#/invite/${token}` }); // no email is sent: the admin passes the link on
    } });

  define({ method: 'DELETE', url: '/api/v1/invites/:id', action: 'invites:manage', write: true,
    sample: (fx) => ({ url: `/api/v1/invites/${fx.creds.invites.pending}` }),
    handler: async ({ ctx, req, actor, reply }) => {
      const inv = db.prepare('select email, role from invites where id = ? and workspace_id = ? and accepted_at is null').get(req.params.id, actor.workspaceId);
      if (!inv) return reply.code(404).send({ error: 'We could not find that invite.' });
      mutate(ctx, { action: 'invite.revoke', targetType: 'invite', targetId: req.params.id, summary: 'Invite revoked', before: { role: inv.role } }, () => db.prepare('delete from invites where id = ?').run(req.params.id));
      return { ok: true };
    } });

  // ---- public: accept an invite
  define({ method: 'GET', url: '/api/v1/invites/:token', public: true, action: null, write: false,
    sample: () => ({ url: '/api/v1/invites/none' }),
    handler: async ({ req, reply }) => {
      if (throttle(req, reply)) return;
      const i = validInvite(req.params.token);
      return i ? { email: i.email, role: i.role, workspaceName: i.workspace_name } : reply.code(404).send({ error: NOT_VALID });
    } });

  define({ method: 'POST', url: '/api/v1/invites/:token/accept', public: true, action: null, write: true,
    body: z.object({ name: z.string().trim().min(1).max(100), password: z.string().max(200) }).strict(),
    sample: () => ({ url: '/api/v1/invites/none/accept', payload: { name: 'Walk Person', password: 'a-new-long-password-1' } }),
    handler: async ({ req, reply, ctx, body }) => {
      if (throttle(req, reply)) return;
      const i = validInvite(req.params.token);
      if (!i) return reply.code(404).send({ error: NOT_VALID });
      const problems = checkPasswordRules(body.password);
      if (problems.length) return reply.code(400).send({ error: problems.join(' '), details: [{ field: 'password', message: problems.join(' ') }] });
      if (db.prepare('select 1 from users where email = ?').get(i.email)) return reply.code(409).send({ error: 'That email already has an account. Sign in instead.' });
      const uid = newId(), now = nowIso();
      mutate({ ...ctx, actor: null }, { workspaceId: i.workspace_id, action: 'invite.accept', targetType: 'user', targetId: uid, summary: `Invite accepted as ${i.role}`, after: { role: i.role } }, () => {
        db.prepare('insert into users(id,email,name,password_hash,created_at,updated_at) values (?,?,?,?,?,?)').run(uid, i.email, body.name, hashPassword(body.password), now, now);
        db.prepare('insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?,?)').run(newId(), i.workspace_id, uid, i.role, now, now);
        db.prepare('update invites set accepted_at = ? where id = ?').run(now, i.id);
      });
      return reply.code(201).send({ email: i.email });
    } });
}
