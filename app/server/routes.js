import { z } from 'zod';
import { can, canAssignRole, ACTIONS } from './authz.js';
import { resolveBearer } from './store.js';
import { serviceRoutes } from './routes-service.js';
import { ingestRoutes } from './routes-ingest.js';
import { readRoutes } from './routes-read.js';
import { auditRoutes } from './routes-audit.js';
import { mutate } from './audit.js';
import { signIn, signOut, actorFromToken } from './auth.js';
import { projectAccess } from './access.js';
import { newId } from './db.js';
import { projectRoutes } from './routes-projects.js';
import { taskRoutes } from './routes-tasks.js';
import { peopleRoutes } from './routes-people.js';
import { reportRoutes } from './routes-reports.js';
import { accessRoutes } from './routes-access.js';
import { jobRoutes } from './routes-jobs.js';
import { formRoutes } from './routes-forms.js';
import { nowIso } from './db.js';

const SESSION_COOKIE = 'session';
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0f766e.');

/**
 * Every API route is declared here through define(), which records it in app.routeTable:
 *   action  the permission checked by can() before the handler runs (null only for public routes)
 *   write   true if it changes anything (it then must write an audit row, via mutate())
 *   sample  builds a valid request, so tests can call every route as every kind of user
 */
export function registerRoutes(app, { db, config, limiters }) {
  const define = (spec) => {
    app.routeTable.push(spec);
    app.route({
      method: spec.method, url: spec.url, ...(spec.bodyLimit ? { bodyLimit: spec.bodyLimit } : {}),
      handler: async (req, reply) => {
        let actor, svc = null;
        if (spec.action && req.headers.authorization) {
          // A bearer token is the only credential considered: no fallback to a cookie, and every kind of bad token looks the same.
          actor = resolveBearer(db, req.headers.authorization);
          if (!actor) { if (!limiters.token.hit(req.ip)) return reply.code(429).send({ error: 'Too many tries. Wait a minute and try again.' }); return reply.code(401).send({ error: 'That token is not valid.' }); }
          if (!limiters.tokenCalls.hit(actor.tokenId)) return reply.code(429).header('Retry-After', '60').send({ error: 'Too many calls for this token. Slow down and retry in a minute.' });
          svc = req.svc = { actor, spec };
        } else actor = actorFromToken(db, req.cookies?.[SESSION_COOKIE]);
        let access = null;
        if (spec.action) {
          if (!actor) return reply.code(401).send({ error: 'Sign in to continue.' });
          let resource;
          if (actor.kind === 'service' && !ACTIONS[spec.action]?.service) return reply.code(403).send({ error: 'This token cannot do that.' });
          if (spec.projectOf) {
            // Hidden and missing look the same (404) so nobody can probe for projects they cannot see.
            const pid = spec.projectOf(req, db, actor);
            access = pid ? projectAccess(db, actor, pid) : null;
            if (!access) return reply.code(404).send({ error: 'We could not find that.' });
            resource = { workspaceId: actor.workspaceId, projectRole: access.role };
          }
          if (!can(actor, spec.action, resource)) return reply.code(403).send({ error: 'You do not have permission to do that.' });
        }
        let body;
        if (spec.body) {
          const parsed = spec.body.safeParse(req.body ?? {});
          if (!parsed.success) return reply.code(400).send({ error: 'Some details need fixing.', details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
          body = parsed.data;
        }
        const ctx = { db, actor, ip: req.ip, requestId: req.id };
        return spec.handler({ req, reply, ctx, actor, body, access });
      },
    });
  };

  const setSessionCookie = (reply, token) => reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', path: '/', secure: config.cookieSecure, maxAge: config.sessionHours * 3600,
  });

  define({ method: 'GET', url: '/api/v1/health', public: true, action: null, write: false,
    sample: () => ({ url: '/api/v1/health' }),
    handler: async () => ({ ok: true, time: nowIso() }) });

  define({ method: 'POST', url: '/api/v1/auth/signin', public: true, action: null, write: true,
    body: z.object({ email: z.string().max(254), password: z.string().max(200), workspace: z.string().max(64).optional() }).strict(),
    sample: (fx) => ({ url: '/api/v1/auth/signin', payload: { email: fx.creds.member.email, password: fx.creds.member.password } }),
    handler: async ({ req, reply, ctx, body }) => {
      if (!limiters.signin.hit(req.ip)) return reply.code(429).send({ error: 'Too many tries. Wait a minute and try again.' });
      const r = signIn(ctx, { email: body.email, password: body.password, workspaceSlug: body.workspace, hours: config.sessionHours });
      if (!r.ok) return reply.code(r.status).send({ error: r.error, ...(r.workspaces ? { workspaces: r.workspaces } : {}) });
      setSessionCookie(reply, r.token);
      return { user: { id: r.actor.userId, name: r.actor.name, email: r.actor.email }, role: r.actor.role };
    } });

  define({ method: 'POST', url: '/api/v1/auth/signout', action: 'session:signout', write: true,
    sample: () => ({ url: '/api/v1/auth/signout' }),
    handler: async ({ req, reply, ctx }) => {
      signOut(ctx, req.cookies[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    } });

  serviceRoutes(define, db);
  ingestRoutes(define, db, config);
  readRoutes(define, db, config);
  auditRoutes(define, db);
  projectRoutes(define, db);
  taskRoutes(define, db);
  peopleRoutes(define, db);
  reportRoutes(define, db);
  accessRoutes(define, db, limiters);
  jobRoutes(define, db);
  formRoutes(define, db, limiters);

  const workspaceRow = (id) => db.prepare('select id, name, slug, accent from workspaces where id = ?').get(id);

  define({ method: 'GET', url: '/api/v1/auth/session', action: 'session:read', write: false,
    sample: () => ({ url: '/api/v1/auth/session' }),
    handler: async ({ actor }) => ({ user: { id: actor.userId, name: actor.name, email: actor.email }, role: actor.role, workspace: workspaceRow(actor.workspaceId) }) });

  define({ method: 'GET', url: '/api/v1/workspace', action: 'workspace:read', write: false,
    sample: () => ({ url: '/api/v1/workspace' }),
    handler: async ({ actor }) => workspaceRow(actor.workspaceId) });

  define({ method: 'PATCH', url: '/api/v1/workspace', action: 'workspace:update', write: true,
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), accent: hex.optional() }).strict()
      .refine((b) => Object.keys(b).length > 0, 'Send at least one thing to change.'),
    sample: () => ({ url: '/api/v1/workspace', payload: { name: 'Brightside IT Support (demo)' } }),
    handler: async ({ ctx, actor, body }) => {
      const before = workspaceRow(actor.workspaceId);
      const after = { ...before, ...body };
      mutate(ctx, { action: 'workspace.update', targetType: 'workspace', targetId: actor.workspaceId, summary: 'Workspace settings changed', before, after },
        () => db.prepare('update workspaces set name = ?, accent = ?, updated_at = ? where id = ?').run(after.name, after.accent, nowIso(), actor.workspaceId));
      return after;
    } });

  define({ method: 'GET', url: '/api/v1/members', action: 'members:read', write: false,
    sample: () => ({ url: '/api/v1/members' }),
    handler: async ({ actor }) => ({ members: db.prepare(`select u.id as userId, u.name, u.email, m.role, u.status from memberships m
      join users u on u.id = m.user_id where m.workspace_id = ? order by u.name`).all(actor.workspaceId) }) });

  define({ method: 'PATCH', url: '/api/v1/members/:userId/role', action: 'members:update_role', write: true,
    body: z.object({ role: z.enum(['owner', 'admin', 'member', 'view_only', 'guest']) }).strict(),
    sample: (fx) => ({ url: `/api/v1/members/${fx.creds.member2.userId}/role`, payload: { role: 'member' } }),
    handler: async ({ req, reply, ctx, actor, body }) => {
      const target = db.prepare('select role from memberships where workspace_id = ? and user_id = ?').get(actor.workspaceId, req.params.userId);
      if (!target) return reply.code(404).send({ error: 'That person is not in this workspace.' });
      if (!canAssignRole(actor, target.role, body.role)) return reply.code(403).send({ error: 'You do not have permission to give or change that role.' });
      if (target.role === 'owner' && body.role !== 'owner' &&
        db.prepare("select count(*) n from memberships where workspace_id = ? and role = 'owner'").get(actor.workspaceId).n <= 1)
        return reply.code(409).send({ error: 'A workspace needs at least one owner.' });
      mutate(ctx, { action: 'member.role_change', targetType: 'user', targetId: req.params.userId, summary: `Role changed from ${target.role} to ${body.role}`,
        before: { role: target.role }, after: { role: body.role } },
        () => db.prepare('update memberships set role = ?, updated_at = ? where workspace_id = ? and user_id = ?').run(body.role, nowIso(), actor.workspaceId, req.params.userId));
      return { userId: req.params.userId, role: body.role };
    } });
}

