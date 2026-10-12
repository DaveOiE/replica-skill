import { z } from 'zod';
import { mutate } from './audit.js';
import { newId, nowIso } from './db.js';
import { projectAccess } from './access.js';

const name = z.string().trim().min(1).max(120);
const visibility = z.enum(['private', 'team', 'workspace']);
const DEFAULT_SECTIONS = ['To do', 'In progress', 'Done'];
const viewOf = (p, role) => ({ id: p.id, name: p.name, description: p.description, visibility: p.visibility, archived: !!p.archived_at, myRole: role });

export function projectRoutes(define, db) {
  const byId = (req) => req.params.id;
  const bySection = (req, d, a) => d.prepare('select project_id from sections s join projects p on p.id = s.project_id where s.id = ? and p.workspace_id = ?').get(req.params.id, a.workspaceId)?.project_id;

  define({ method: 'GET', url: '/api/v1/projects', action: 'project:list', write: false,
    sample: () => ({ url: '/api/v1/projects' }),
    handler: async ({ actor }) => ({ projects: db.prepare('select * from projects where workspace_id = ? order by name').all(actor.workspaceId)
      .map((p) => [p, projectAccess(db, actor, p.id)]).filter(([, a]) => a).map(([p, a]) => viewOf(p, a.role)) }) });

  define({ method: 'POST', url: '/api/v1/projects', action: 'project:create', write: true,
    body: z.object({ name, description: z.string().max(2000).optional(), visibility: visibility.optional() }).strict(),
    sample: () => ({ url: '/api/v1/projects', payload: { name: 'Walk test project' } }),
    handler: async ({ ctx, actor, body, reply }) => {
      const id = newId(), now = nowIso();
      mutate(ctx, { action: 'project.create', targetType: 'project', targetId: id, summary: `Project created: ${body.name}`, after: { name: body.name, visibility: body.visibility || 'workspace' } }, () => {
        db.prepare('insert into projects(id,workspace_id,name,description,owner_id,visibility,created_at,updated_at) values (?,?,?,?,?,?,?,?)')
          .run(id, actor.workspaceId, body.name, body.description || '', actor.userId, body.visibility || 'workspace', now, now);
        db.prepare('insert into project_members(id,project_id,user_id,role) values (?,?,?,?)').run(newId(), id, actor.userId, 'admin');
        DEFAULT_SECTIONS.forEach((n, i) => db.prepare('insert into sections(id,project_id,name,position) values (?,?,?,?)').run(newId(), id, n, i));
      });
      return reply.code(201).send({ id });
    } });

  define({ method: 'GET', url: '/api/v1/projects/:id', action: 'project:read', write: false, projectOf: byId,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}` }),
    handler: async ({ access }) => ({ ...viewOf(access.project, access.role),
      sections: db.prepare('select id, name, position from sections where project_id = ? order by position').all(access.project.id) }) });

  define({ method: 'PATCH', url: '/api/v1/projects/:id', action: 'project:manage', write: true, projectOf: byId,
    body: z.object({ name: name.optional(), description: z.string().max(2000).optional(), visibility: visibility.optional(), archived: z.boolean().optional() }).strict()
      .refine((b) => Object.keys(b).length > 0, 'Send at least one thing to change.'),
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}`, payload: { description: 'Refresh the public website.' } }),
    handler: async ({ ctx, body, access }) => {
      const p = access.project;
      const next = { name: body.name ?? p.name, description: body.description ?? p.description, visibility: body.visibility ?? p.visibility,
        archived_at: body.archived === undefined ? p.archived_at : body.archived ? nowIso() : null };
      mutate(ctx, { action: 'project.update', targetType: 'project', targetId: p.id, summary: 'Project changed',
        before: { name: p.name, description: p.description, visibility: p.visibility, archived: !!p.archived_at }, after: { ...body } },
        () => db.prepare('update projects set name=?, description=?, visibility=?, archived_at=?, updated_at=? where id=?').run(next.name, next.description, next.visibility, next.archived_at, nowIso(), p.id));
      return viewOf({ ...p, ...next }, access.role);
    } });

  define({ method: 'POST', url: '/api/v1/projects/:id/sections', action: 'project:manage', write: true, projectOf: byId,
    body: z.object({ name }).strict(),
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/sections`, payload: { name: 'Later' } }),
    handler: async ({ ctx, body, access, reply }) => {
      const id = newId();
      const pos = db.prepare('select coalesce(max(position), -1) + 1 as n from sections where project_id = ?').get(access.project.id).n;
      mutate(ctx, { action: 'section.create', targetType: 'section', targetId: id, summary: `Section added: ${body.name}`, after: { name: body.name, project: access.project.id } },
        () => db.prepare('insert into sections(id,project_id,name,position) values (?,?,?,?)').run(id, access.project.id, body.name, pos));
      return reply.code(201).send({ id });
    } });

  define({ method: 'PATCH', url: '/api/v1/sections/:id', action: 'project:manage', write: true, projectOf: bySection,
    body: z.object({ name }).strict(),
    sample: (fx) => ({ url: `/api/v1/sections/${fx.creds.sections.todo}`, payload: { name: 'To do' } }),
    handler: async ({ ctx, req, body }) => {
      const before = db.prepare('select name from sections where id = ?').get(req.params.id);
      mutate(ctx, { action: 'section.rename', targetType: 'section', targetId: req.params.id, summary: 'Section renamed', before, after: { name: body.name } },
        () => db.prepare('update sections set name = ? where id = ?').run(body.name, req.params.id));
      return { id: req.params.id, name: body.name };
    } });

  define({ method: 'DELETE', url: '/api/v1/sections/:id', action: 'project:manage', write: true, projectOf: bySection,
    sample: (fx) => ({ url: `/api/v1/sections/${fx.creds.sections.disposable}` }),
    handler: async ({ ctx, req }) => {
      const before = db.prepare('select name, project_id from sections where id = ?').get(req.params.id);
      mutate(ctx, { action: 'section.delete', targetType: 'section', targetId: req.params.id, summary: `Section deleted: ${before.name}`, before },
        () => db.prepare('delete from sections where id = ?').run(req.params.id));
      return { ok: true };
    } });
}
