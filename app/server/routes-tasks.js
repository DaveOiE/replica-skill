import { z } from 'zod';
import { mutate } from './audit.js';
import { newId, nowIso } from './db.js';
import { projectAccess } from './access.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.').refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'That is not a real date.');   // 2026-02-31 must not roll over into March
const STATUS = z.enum(['todo', 'in_progress', 'blocked', 'done']);
const fields = {
  title: z.string().trim().min(1).max(300), description: z.string().max(20000),
  sectionId: z.string().nullable(), assigneeId: z.string().nullable(), status: STATUS,
  startDate: date.nullable(), dueDate: date.nullable(), isMilestone: z.boolean(),
  estimateMinutes: z.number().int().min(0).max(100000).nullable(), position: z.number(),
  // links to Zen: staff can set these on a task made by hand. The client slug is not editable here: it comes from the project.
  jobNumber: z.string().min(1).max(60).refine((s) => !/[\u0000-\u001f\u007f]/.test(s) && s === s.trim(), 'No control characters or leading and trailing spaces: it is stored exactly as typed.').nullable(),
  promisedDate: date.nullable(), lane: z.string().trim().min(1).max(80).nullable(),
};
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const COL = { title: 'title', description: 'description', sectionId: 'section_id', assigneeId: 'assignee_id', status: 'status', startDate: 'start_date', dueDate: 'due_date', isMilestone: 'is_milestone', estimateMinutes: 'estimate_minutes', position: 'position', jobNumber: 'job_number', promisedDate: 'promised_date', lane: 'lane' };

export function taskRoutes(define, db) {
  const byProject = (req) => req.params.id;
  const byTask = (req, d, a) => d.prepare('select project_id from tasks where id = ? and workspace_id = ?').get(req.params.id, a.workspaceId)?.project_id;
  const taskRow = (id) => db.prepare('select * from tasks where id = ?').get(id);
  const view = (t) => ({ id: t.id, projectId: t.project_id, parentId: t.parent_id, sectionId: t.section_id, title: t.title, description: t.description,
    status: t.status, assigneeId: t.assignee_id, assigneeName: t.assignee_name ?? null, startDate: t.start_date, dueDate: t.due_date,
    isMilestone: !!t.is_milestone, estimateMinutes: t.estimate_minutes, position: t.position, completedAt: t.completed_at,
    jobNumber: t.job_number, promisedDate: t.promised_date, lane: t.lane, clientSlug: t.client_slug, inferred: !!t.inferred, source: t.source, sourceCallId: t.source_call_id,
    ...(t.open_blockers !== undefined ? { openBlockers: t.open_blockers } : {}) });
  const SELECT = `select t.*, u.name as assignee_name,
    (select count(*) from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = t.id and b.status != 'done') as open_blockers
    from tasks t left join users u on u.id = t.assignee_id`;

  /** An assignee must be someone who can actually see the project. */
  const assigneeError = (workspaceId, projectId, userId) => {
    if (!userId) return null;
    const m = db.prepare('select role from memberships where workspace_id = ? and user_id = ?').get(workspaceId, userId);
    return m && projectAccess(db, { userId, workspaceId, role: m.role }, projectId) ? null : 'That person cannot see this project, so they cannot be assigned to it.';
  };
  const sectionError = (projectId, sectionId) => (!sectionId || db.prepare('select 1 from sections where id = ? and project_id = ?').get(sectionId, projectId) ? null : 'That section is not in this project.');
  const wouldCycle = (taskId, dependsOnId) => {
    const seen = new Set(); const stack = [dependsOnId];
    while (stack.length) {
      const id = stack.pop();
      if (id === taskId) return true;
      if (seen.has(id)) continue; seen.add(id);
      for (const r of db.prepare('select depends_on_id from task_dependencies where task_id = ?').all(id)) stack.push(r.depends_on_id);
    }
    return false;
  };
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });

  define({ method: 'GET', url: '/api/v1/projects/:id/tasks', action: 'project:read', write: false, projectOf: byProject,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/tasks` }),
    handler: async ({ access }) => ({
      sections: db.prepare('select id, name, position from sections where project_id = ? order by position').all(access.project.id),
      tasks: db.prepare(`${SELECT} where t.project_id = ? order by t.position`).all(access.project.id).map(view) }) });

  define({ method: 'POST', url: '/api/v1/projects/:id/tasks', action: 'task:write', write: true, projectOf: byProject,
    body: z.object({ ...pick(fields, ['title', 'description', 'sectionId', 'assigneeId', 'status', 'startDate', 'dueDate', 'isMilestone', 'estimateMinutes']), parentId: z.string().optional() }).partial({ description: true, sectionId: true, assigneeId: true, status: true, startDate: true, dueDate: true, isMilestone: true, estimateMinutes: true, parentId: true }).strict(),
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/tasks`, payload: { title: 'Walk test task', dueDate: '2030-01-15' } }),
    handler: async ({ ctx, actor, body, access, reply }) => {
      const p = access.project;
      if (p.archived_at) return bad(reply, 'This project is archived. Unarchive it to add tasks.', 409);
      const err = sectionError(p.id, body.sectionId) || assigneeError(actor.workspaceId, p.id, body.assigneeId);
      if (err) return bad(reply, err);
      if (body.startDate && body.dueDate && body.startDate > body.dueDate) return bad(reply, 'The start date must be on or before the due date.');
      if (body.parentId) {
        const parent = taskRow(body.parentId);
        if (!parent || parent.project_id !== p.id) return bad(reply, 'That parent task is not in this project.');
        if (parent.parent_id) return bad(reply, 'Subtasks cannot have subtasks of their own.');
      }
      const id = newId(), now = nowIso();
      const pos = db.prepare('select coalesce(max(position), 0) + 1 as n from tasks where project_id = ?').get(p.id).n;
      mutate(ctx, { action: 'task.create', targetType: 'task', targetId: id, summary: 'Task created', after: { ...body, project: p.id } }, () =>
        db.prepare(`insert into tasks(id,workspace_id,project_id,section_id,parent_id,title,description,assignee_id,owner_id,status,start_date,due_date,is_milestone,estimate_minutes,position,completed_at,created_at,updated_at,client_slug)
          values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, actor.workspaceId, p.id, body.sectionId ?? null, body.parentId ?? null, body.title, body.description ?? '', body.assigneeId ?? null,
          actor.userId, body.status ?? 'todo', body.startDate ?? null, body.dueDate ?? null, body.isMilestone ? 1 : 0, body.estimateMinutes ?? null, pos, body.status === 'done' ? now : null, now, now, p.kind === 'client' ? p.client_slug : null)); // a task made in a client's project carries that client's slug
      return reply.code(201).send({ id });
    } });

  define({ method: 'GET', url: '/api/v1/tasks/:id', action: 'project:read', write: false, projectOf: byTask,
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.b}` }),
    handler: async ({ req, access }) => {
      const t = db.prepare(`${SELECT} where t.id = ?`).get(req.params.id);
      const dep = (sql) => db.prepare(sql).all(t.id).map((r) => ({ id: r.id, title: r.title, status: r.status }));
      return { task: view(t), project: { id: access.project.id, name: access.project.name }, myRole: access.role,
        subtasks: db.prepare(`${SELECT} where t.parent_id = ? order by t.position`).all(t.id).map(view),
        comments: db.prepare('select c.id, c.body, c.created_at as createdAt, u.name as author, c.author_id as authorId from comments c join users u on u.id = c.author_id where c.task_id = ? order by c.created_at, c.rowid').all(t.id),
        blockedBy: dep('select b.id, b.title, b.status from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = ?'),
        blocking: dep('select b.id, b.title, b.status from task_dependencies d join tasks b on b.id = d.task_id where d.depends_on_id = ?') };
    } });

  define({ method: 'PATCH', url: '/api/v1/tasks/:id', action: 'task:write', write: true, projectOf: byTask,
    body: z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]))).strict().refine((b) => Object.keys(b).length > 0, 'Send at least one thing to change.'),
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.a}`, payload: { description: 'Short, plain, no jargon.' } }),
    handler: async ({ ctx, req, actor, body, access, reply }) => {
      const t = taskRow(req.params.id);
      if (access.project.archived_at) return bad(reply, 'This project is archived. Unarchive it to change tasks.', 409);
      const err = ('sectionId' in body && sectionError(t.project_id, body.sectionId)) || ('assigneeId' in body && assigneeError(actor.workspaceId, t.project_id, body.assigneeId));
      if (err) return bad(reply, err);
      const start = 'startDate' in body ? body.startDate : t.start_date, due = 'dueDate' in body ? body.dueDate : t.due_date;
      if (start && due && start > due) return bad(reply, 'The start date must be on or before the due date.');
      let override = false;
      if (body.status === 'done' && t.status !== 'done') {
        const open = db.prepare("select b.title from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = ? and b.status != 'done'").all(t.id);
        if (open.length) {
          if (access.role !== 'admin') return bad(reply, `Waiting on: ${open.map((o) => o.title).join(', ')}. Finish those first, or ask a project admin.`, 409);
          override = true; // project admins may close it anyway; the audit trail says so
        }
      }
      const before = Object.fromEntries(Object.keys(body).map((k) => [k, k === 'isMilestone' ? !!t[COL[k]] : t[COL[k]]]));
      const sets = Object.keys(body).map((k) => `${COL[k]} = ?`);
      const vals = Object.keys(body).map((k) => (k === 'isMilestone' ? (body[k] ? 1 : 0) : body[k]));
      if ('status' in body) { sets.push('completed_at = ?'); vals.push(body.status === 'done' ? (t.completed_at || nowIso()) : null); }
      mutate(ctx, { action: 'task.update', targetType: 'task', targetId: t.id, summary: override ? 'Task changed (closed over open dependencies by a project admin)' : 'Task changed',
        before, after: { ...body, ...(override ? { override: true } : {}) } },
        () => db.prepare(`update tasks set ${sets.join(', ')}, updated_at = ? where id = ?`).run(...vals, nowIso(), t.id));
      return view(db.prepare(`${SELECT} where t.id = ?`).get(t.id));
    } });

  define({ method: 'DELETE', url: '/api/v1/tasks/:id', action: 'task:write', write: true, projectOf: byTask,
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.disposable}` }),
    handler: async ({ ctx, req }) => {
      const t = taskRow(req.params.id);
      const subs = db.prepare('select count(*) n from tasks where parent_id = ?').get(t.id).n;
      const blanked = db.prepare(`with recursive d(id) as (select ? union all select t.id from tasks t join d on t.parent_id = d.id) select count(*) n from form_submissions where task_id in (select id from d) and (answers_json != '{}' or submitter_email is not null)`).get(t.id).n;
      mutate(ctx, { action: 'task.delete', targetType: 'task', targetId: t.id, summary: subs ? `Task deleted (and ${subs} subtasks)` : 'Task deleted', before: { status: t.status, project: t.project_id }, after: { submissionsBlanked: blanked } },
        () => db.prepare('delete from tasks where id = ?').run(t.id));
      return { ok: true };
    } });

  define({ method: 'POST', url: '/api/v1/tasks/:id/comments', action: 'task:comment', write: true, projectOf: byTask,
    body: z.object({ body: z.string().trim().min(1).max(10000) }).strict(),
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.a}/comments`, payload: { body: 'Looks good to me.' } }),
    handler: async ({ ctx, req, actor, body, reply }) => {
      const id = newId();
      mutate(ctx, { action: 'comment.create', targetType: 'task', targetId: req.params.id, summary: 'Comment added', after: { comment: id, length: body.body.length } },
        () => db.prepare('insert into comments(id,workspace_id,task_id,author_id,body,created_at) values (?,?,?,?,?,?)').run(id, actor.workspaceId, req.params.id, actor.userId, body.body, nowIso()));
      return reply.code(201).send({ id });
    } });

  define({ method: 'POST', url: '/api/v1/tasks/:id/dependencies', action: 'task:write', write: true, projectOf: byTask,
    body: z.object({ dependsOnId: z.string() }).strict(),
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.sub}/dependencies`, payload: { dependsOnId: fx.creds.tasks.a } }),
    handler: async ({ ctx, req, body, reply }) => {
      const t = taskRow(req.params.id), other = taskRow(body.dependsOnId);
      if (!other || other.project_id !== t.project_id) return bad(reply, 'That task is not in this project.');
      if (other.id === t.id) return bad(reply, 'A task cannot wait on itself.');
      if (wouldCycle(t.id, other.id)) return bad(reply, 'That would make a loop: each task would be waiting on the other.', 409);
      mutate(ctx, { action: 'dependency.add', targetType: 'task', targetId: t.id, summary: 'Dependency added', after: { dependsOn: other.id } },
        () => db.prepare('insert or ignore into task_dependencies(task_id, depends_on_id) values (?, ?)').run(t.id, other.id));
      return reply.code(201).send({ ok: true });
    } });

  define({ method: 'DELETE', url: '/api/v1/tasks/:id/dependencies/:depId', action: 'task:write', write: true, projectOf: byTask,
    sample: (fx) => ({ url: `/api/v1/tasks/${fx.creds.tasks.b}/dependencies/${fx.creds.tasks.a}` }),
    handler: async ({ ctx, req, reply }) => {
      if (!db.prepare('select 1 from task_dependencies where task_id = ? and depends_on_id = ?').get(req.params.id, req.params.depId)) return bad(reply, 'That dependency does not exist.', 404);
      mutate(ctx, { action: 'dependency.remove', targetType: 'task', targetId: req.params.id, summary: 'Dependency removed', before: { dependsOn: req.params.depId } },
        () => db.prepare('delete from task_dependencies where task_id = ? and depends_on_id = ?').run(req.params.id, req.params.depId));
      return { ok: true };
    } });

  define({ method: 'GET', url: '/api/v1/me/tasks', action: 'me:tasks', write: false,
    sample: () => ({ url: '/api/v1/me/tasks' }),
    handler: async ({ actor }) => {
      const rows = db.prepare(`${SELECT} where t.workspace_id = ? and t.assignee_id = ? and t.status != 'done' order by t.due_date is null, t.due_date, t.position`).all(actor.workspaceId, actor.userId);
      const names = new Map(db.prepare('select id, name from projects where workspace_id = ?').all(actor.workspaceId).map((p) => [p.id, p.name]));
      return { tasks: rows.filter((t) => projectAccess(db, actor, t.project_id)).map((t) => ({ ...view(t), projectName: names.get(t.project_id) })) }; // still hidden if the project was hidden since
    } });
}
