import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mutate } from './audit.js';
import { newId, nowIso } from './db.js';
import { canAssignRole } from './authz.js';
import { hashPasswordAsync, verifyPasswordAsync, checkPasswordRules, randomPassword } from './password.js';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function peopleRoutes(define, db) {
  const byProject = (req) => req.params.id;

  define({ method: 'POST', url: '/api/v1/members', action: 'members:create', write: true,
    body: z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['admin', 'member', 'view_only', 'guest']) }).strict(),
    sample: () => ({ url: '/api/v1/members', payload: { name: 'Walk Person', email: 'walk.person@example.test', role: 'member' } }),
    handler: async ({ ctx, actor, body, reply }) => {
      if (!canAssignRole(actor, null, body.role)) return reply.code(403).send({ error: 'You do not have permission to give that role.' });
      if (db.prepare('select 1 from users where email = ?').get(body.email)) return reply.code(409).send({ error: 'That email already has an account.' });
      const id = newId(), now = nowIso(), temp = randomPassword();
      const tempHash = await hashPasswordAsync(temp);
      mutate(ctx, { action: 'member.create', targetType: 'user', targetId: id, summary: `Added ${body.role === 'guest' ? 'guest' : 'person'}`, after: { role: body.role } }, () => {
        db.prepare('insert into users(id,email,name,password_hash,created_at,updated_at) values (?,?,?,?,?,?)').run(id, body.email, body.name, tempHash, now, now);
        db.prepare('insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?,?)').run(newId(), actor.workspaceId, id, body.role, now, now);
      });
      // Shown once, here only. It is never stored in plain text and never written to the audit trail.
      return reply.code(201).send({ userId: id, email: body.email, role: body.role, temporaryPassword: temp });
    } });

  define({ method: 'POST', url: '/api/v1/auth/password', action: 'session:password', write: true,
    body: z.object({ current: z.string().max(200), next: z.string().max(200) }).strict(),
    sample: (fx) => ({ url: '/api/v1/auth/password', payload: { current: fx.who.password, next: 'a-new-long-password-1' } }),
    handler: async ({ ctx, req, actor, body, reply }) => {
      const u = db.prepare('select password_hash from users where id = ?').get(actor.userId);
      if (!u?.password_hash || !(await verifyPasswordAsync(body.current, u.password_hash))) return reply.code(403).send({ error: 'Your current password is not right.' });
      const problems = checkPasswordRules(body.next);
      if (problems.length) return reply.code(400).send({ error: problems.join(' '), details: [{ field: 'next', message: problems.join(' ') }] });
      const nextHash = await hashPasswordAsync(body.next);
      mutate(ctx, { action: 'auth.password_change', targetType: 'user', targetId: actor.userId, summary: 'Password changed; other sessions ended' }, () => {
        db.prepare('update users set password_hash = ?, updated_at = ? where id = ?').run(nextHash, nowIso(), actor.userId);
        db.prepare('update sessions set revoked_at = ? where user_id = ? and revoked_at is null and id != ?').run(nowIso(), actor.userId, sha256(req.cookies.session));
      });
      return { ok: true };
    } });

  define({ method: 'GET', url: '/api/v1/projects/:id/members', action: 'project:manage', write: false, projectOf: byProject,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/members` }),
    handler: async ({ access }) => ({ members: db.prepare(`select pm.user_id as userId, u.name, u.email, pm.role from project_members pm
      join users u on u.id = pm.user_id where pm.project_id = ? order by u.name`).all(access.project.id) }) });

  define({ method: 'PUT', url: '/api/v1/projects/:id/members', action: 'project:manage', write: true, projectOf: byProject,
    body: z.object({ userId: z.string(), role: z.enum(['viewer', 'commenter', 'editor', 'admin']) }).strict(),
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/members`, payload: { userId: fx.creds.member2.userId, role: 'commenter' } }),
    handler: async ({ ctx, actor, body, access, reply }) => {
      const m = db.prepare('select role from memberships where workspace_id = ? and user_id = ?').get(actor.workspaceId, body.userId);
      if (!m) return reply.code(404).send({ error: 'That person is not in this workspace.' });
      if (m.role === 'guest' && body.role === 'admin') return reply.code(400).send({ error: 'Guests cannot be project admins. Pick editor or lower.' });
      const before = db.prepare('select role from project_members where project_id = ? and user_id = ?').get(access.project.id, body.userId) || null;
      mutate(ctx, { action: 'project.member_set', targetType: 'project', targetId: access.project.id, summary: `Project role for a person set to ${body.role}`, before, after: { userId: body.userId, role: body.role } }, () => {
        if (before) db.prepare('update project_members set role = ? where project_id = ? and user_id = ?').run(body.role, access.project.id, body.userId);
        else db.prepare('insert into project_members(id,project_id,user_id,role) values (?,?,?,?)').run(newId(), access.project.id, body.userId, body.role);
      });
      return { userId: body.userId, role: body.role };
    } });

  define({ method: 'DELETE', url: '/api/v1/projects/:id/members/:userId', action: 'project:manage', write: true, projectOf: byProject,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/members/${fx.creds.guest.userId}` }),
    handler: async ({ ctx, req, access, reply }) => {
      const before = db.prepare('select role from project_members where project_id = ? and user_id = ?').get(access.project.id, req.params.userId);
      if (!before) return reply.code(404).send({ error: 'That person is not on this project.' });
      mutate(ctx, { action: 'project.member_remove', targetType: 'project', targetId: access.project.id, summary: 'Person removed from project', before: { userId: req.params.userId, ...before } },
        () => db.prepare('delete from project_members where project_id = ? and user_id = ?').run(access.project.id, req.params.userId));
      return { ok: true };
    } });
}
