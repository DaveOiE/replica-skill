import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { mutate, appendAudit } from './audit.js';
import { newId, nowIso } from './db.js';
import { projectAccess } from './access.js';

const NOT_AVAILABLE = 'This form is not available.';
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
const question = z.object({ label: z.string().trim().min(1).max(200), kind: z.enum(['text', 'long_text', 'single_select']), required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(80)).max(20).optional(), mapsTo: z.enum(['title', 'description']).optional() }).strict();
const createBody = z.object({ name: z.string().trim().min(1).max(120), targetSectionId: z.string().nullable().optional(), questions: z.array(question).min(1).max(20), assigneeId: z.string().nullable().optional() }).strict();
const submitBody = z.object({ answers: z.record(z.string(), z.string().max(5000)), email: z.string().trim().email().max(254).optional().or(z.literal('')), website: z.string().max(200).optional() }).strict();

export function formRoutes(define, db, limiters) {
  const byProject = (req) => req.params.id;
  const byForm = (req, d, a) => d.prepare('select project_id from forms where id = ? and workspace_id = ?').get(req.params.id, a.workspaceId)?.project_id;
  const bad = (reply, msg, code = 400) => reply.code(code).send({ error: msg });
  const canSee = (ws, projectId, userId) => { const m = db.prepare('select role from memberships where workspace_id = ? and user_id = ?').get(ws, userId); return !!(m && projectAccess(db, { userId, workspaceId: ws, role: m.role }, projectId)); };
  const ruleOf = (formId) => db.prepare("select * from rules where json_extract(trigger_json, '$.formId') = ?").get(formId);
  const setAssignRule = (f, assigneeId, by) => {
    db.prepare("delete from rules where json_extract(trigger_json, '$.formId') = ?").run(f.id);
    if (assigneeId) db.prepare('insert into rules(id,workspace_id,project_id,name,trigger_json,conditions_json,actions_json,enabled,created_by,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId(), f.workspace_id, f.project_id, `Assign requests from "${f.name}"`, JSON.stringify({ type: 'form_submitted', formId: f.id }), '[]', JSON.stringify([{ type: 'assign', userId: assigneeId }]), 1, by, nowIso(), nowIso());
  };
  const listView = (f) => { const r = ruleOf(f.id); const uid = r ? JSON.parse(r.actions_json)[0]?.userId : null;
    return { id: f.id, name: f.name, slug: f.slug, isOpen: !!f.is_open, targetSectionId: f.target_section_id, assigneeId: uid || null, lastRuleError: r?.last_error || null,
      questions: db.prepare('select id, label, kind, options_json, required, maps_to from form_questions where form_id = ? order by position').all(f.id).map((q) => ({ id: q.id, label: q.label, kind: q.kind, options: JSON.parse(q.options_json), required: !!q.required, mapsTo: q.maps_to })),
      submissions: db.prepare('select count(*) n from form_submissions where form_id = ?').get(f.id).n }; };

  // ---- project admins build and manage forms
  define({ method: 'GET', url: '/api/v1/projects/:id/forms', action: 'project:manage', write: false, projectOf: byProject,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/forms` }),
    handler: async ({ access }) => ({ forms: db.prepare('select * from forms where project_id = ? order by created_at').all(access.project.id).map(listView) }) });

  define({ method: 'POST', url: '/api/v1/projects/:id/forms', action: 'project:manage', write: true, projectOf: byProject, body: createBody,
    sample: (fx) => ({ url: `/api/v1/projects/${fx.creds.projects.pub}/forms`, payload: { name: 'Walk form', questions: [{ label: 'What do you need?', kind: 'text', required: true, mapsTo: 'title' }, { label: 'How urgent?', kind: 'single_select', options: ['Low', 'Urgent'] }] } }),
    handler: async ({ ctx, actor, body, access, reply }) => {
      const p = access.project;
      if (body.targetSectionId && !db.prepare('select 1 from sections where id = ? and project_id = ?').get(body.targetSectionId, p.id)) return bad(reply, 'That section is not in this project.');
      if (body.assigneeId && !canSee(actor.workspaceId, p.id, body.assigneeId)) return bad(reply, 'That person cannot see this project, so they cannot be assigned requests.');
      if (body.questions.filter((q) => q.mapsTo === 'title').length > 1) return bad(reply, 'Only one question can be the task title.');
      for (const q of body.questions) if (q.kind === 'single_select' && (q.options?.length || 0) < 2) return bad(reply, `"${q.label}" needs at least two choices.`);
      const id = newId(), slug = randomBytes(16).toString('base64url'), now = nowIso();
      const section = body.targetSectionId ?? db.prepare('select id from sections where project_id = ? order by position limit 1').get(p.id)?.id ?? null;
      mutate(ctx, { action: 'form.create', targetType: 'form', targetId: id, summary: `Request form created: ${body.name}`, after: { questions: body.questions.length, assigned: !!body.assigneeId } }, () => {
        db.prepare('insert into forms(id,workspace_id,project_id,name,slug,target_section_id,created_by,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)').run(id, actor.workspaceId, p.id, body.name, slug, section, actor.userId, now, now);
        body.questions.forEach((q, i) => db.prepare('insert into form_questions(id,form_id,label,kind,options_json,required,position,maps_to) values (?,?,?,?,?,?,?,?)').run(newId(), id, q.label, q.kind, JSON.stringify(q.options || []), q.required ? 1 : 0, i, q.mapsTo || 'description'));
        setAssignRule({ id, workspace_id: actor.workspaceId, project_id: p.id, name: body.name }, body.assigneeId, actor.userId);
      });
      return reply.code(201).send({ id, slug });
    } });

  define({ method: 'PATCH', url: '/api/v1/forms/:id', action: 'project:manage', write: true, projectOf: byForm,
    body: z.object({ name: z.string().trim().min(1).max(120).optional(), isOpen: z.boolean().optional(), assigneeId: z.string().nullable().optional() }).strict().refine((b) => Object.keys(b).length > 0, 'Send at least one thing to change.'),
    sample: (fx) => ({ url: `/api/v1/forms/${fx.creds.forms.pub}`, payload: { isOpen: true } }),
    handler: async ({ ctx, req, actor, body, access, reply }) => {
      const f = db.prepare('select * from forms where id = ?').get(req.params.id);
      if (body.assigneeId && !canSee(actor.workspaceId, access.project.id, body.assigneeId)) return bad(reply, 'That person cannot see this project, so they cannot be assigned requests.');
      mutate(ctx, { action: 'form.update', targetType: 'form', targetId: f.id, summary: 'Request form changed', before: { name: f.name, isOpen: !!f.is_open }, after: { ...body } }, () => {
        db.prepare('update forms set name = ?, is_open = ?, updated_at = ? where id = ?').run(body.name ?? f.name, body.isOpen === undefined ? f.is_open : body.isOpen ? 1 : 0, nowIso(), f.id);
        if ('assigneeId' in body) setAssignRule({ ...f, name: body.name ?? f.name }, body.assigneeId, actor.userId);
      });
      return listView(db.prepare('select * from forms where id = ?').get(f.id));
    } });

  define({ method: 'DELETE', url: '/api/v1/forms/:id', action: 'project:manage', write: true, projectOf: byForm,
    sample: (fx) => ({ url: `/api/v1/forms/${fx.creds.forms.disposable}` }),
    handler: async ({ ctx, req }) => {
      const f = db.prepare('select name from forms where id = ?').get(req.params.id);
      mutate(ctx, { action: 'form.delete', targetType: 'form', targetId: req.params.id, summary: `Request form deleted: ${f.name}`, before: { name: f.name } }, () => {
        db.prepare("delete from rules where json_extract(trigger_json, '$.formId') = ?").run(req.params.id);
        db.prepare('delete from forms where id = ?').run(req.params.id);
      });
      return { ok: true };
    } });

  // ---- the public form: reveals only the form's name and questions
  const findOpen = (slug) => db.prepare('select f.* from forms f join projects p on p.id = f.project_id where f.slug = ? and f.is_open = 1 and p.archived_at is null').get(String(slug).slice(0, 64));

  define({ method: 'GET', url: '/api/v1/public/forms/:slug', public: true, action: null, write: false,
    sample: () => ({ url: '/api/v1/public/forms/none' }),
    handler: async ({ req, reply }) => {
      if (!limiters.token.hit(req.ip)) return bad(reply, 'Too many tries. Wait a minute and try again.', 429);
      const f = findOpen(req.params.slug);
      if (!f) return bad(reply, NOT_AVAILABLE, 404);
      return { name: f.name, questions: db.prepare('select id, label, kind, options_json, required from form_questions where form_id = ? order by position').all(f.id).map((q) => ({ id: q.id, label: q.label, kind: q.kind, options: JSON.parse(q.options_json), required: !!q.required })) };
    } });

  define({ method: 'POST', url: '/api/v1/public/forms/:slug/submit', public: true, action: null, write: true, body: submitBody, bodyLimit: 100_000,
    sample: () => ({ url: '/api/v1/public/forms/none/submit', payload: { answers: {} } }),
    handler: async ({ req, reply, ctx, body }) => {
      if (!limiters.formSubmit.hit(req.ip)) return bad(reply, 'Too many requests from your connection. Wait a minute and try again.', 429);
      const f = findOpen(req.params.slug);
      if (!f) return bad(reply, NOT_AVAILABLE, 404);
      if (!limiters.formHour.hit(f.id)) return bad(reply, 'This form is getting a lot of requests. Please try again later.', 429);
      if (body.website) return { ok: true }; // honeypot: a person never sees or fills this box; pretend it worked, create nothing
      const qs = db.prepare('select * from form_questions where form_id = ? order by position').all(f.id);
      const ids = new Set(qs.map((q) => q.id));
      if (Object.keys(body.answers).some((k) => !ids.has(k))) return bad(reply, 'Some answers do not match this form. Reload the page and try again.');
      const answers = [];
      for (const q of qs) {
        const v = clean(body.answers[q.id] ?? '');
        if (!v) { if (q.required) return bad(reply, `Please fill in: ${q.label}`); continue; }
        if (q.kind === 'single_select' && !JSON.parse(q.options_json).includes(v)) return bad(reply, `Please choose one of the options for: ${q.label}`);
        if (v.length > (q.kind === 'long_text' ? 5000 : 300)) return bad(reply, `That answer is too long: ${q.label}`);
        answers.push({ q, v });
      }
      const titleA = answers.find((a) => a.q.maps_to === 'title');
      const title = (titleA ? titleA.v : f.name).slice(0, 300);
      const email = body.email ? clean(body.email) : '';
      const description = [...answers.filter((a) => a !== titleA).map((a) => `${a.q.label}: ${a.v}`), email && `Submitted by: ${email}`, `Sent through the request form "${f.name}".`].filter(Boolean).join('\n\n');
      const taskId = newId(), now = nowIso();
      const log = (action, targetId, summary, after) => appendAudit(db, { workspaceId: f.workspace_id, actorKind: 'system', action, targetType: 'task', targetId, summary, after, ip: ctx.ip, requestId: ctx.requestId });
      mutate({ ...ctx, actor: null }, { workspaceId: f.workspace_id, action: 'form.submit', targetType: 'form', targetId: f.id, summary: 'Request submitted through a public form (task created)', after: { task: taskId, answered: answers.length, email: !!email } }, () => {
        const pos = db.prepare('select coalesce(max(position), 0) + 1 as n from tasks where project_id = ?').get(f.project_id).n;
        db.prepare(`insert into tasks(id,workspace_id,project_id,section_id,title,description,owner_id,status,position,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)`)
          .run(taskId, f.workspace_id, f.project_id, f.target_section_id, title, description, f.created_by, 'todo', pos, now, now);
        db.prepare('insert into form_submissions(id,form_id,task_id,answers_json,submitter_email,created_at) values (?,?,?,?,?,?)').run(newId(), f.id, taskId, JSON.stringify(Object.fromEntries(answers.map((a) => [a.q.id, a.v]))), email || null, now);
        for (const r of db.prepare("select * from rules where enabled = 1 and json_extract(trigger_json, '$.formId') = ?").all(f.id)) {
          for (const a of JSON.parse(r.actions_json)) {
            if (a.type !== 'assign') continue;
            if (canSee(f.workspace_id, f.project_id, a.userId)) {
              db.prepare('update tasks set assignee_id = ?, updated_at = ? where id = ?').run(a.userId, now, taskId);
              db.prepare('insert into rule_runs(id,rule_id,task_id,status,depth,detail,created_at) values (?,?,?,?,?,?,?)').run(newId(), r.id, taskId, 'ok', 0, 'assigned', now);
              db.prepare('update rules set last_error = null where id = ?').run(r.id);
              log('rule.assign', taskId, 'Rule assigned a new request', { assignee: a.userId, rule: r.id });
            } else {
              db.prepare('insert into rule_runs(id,rule_id,task_id,status,depth,detail,created_at) values (?,?,?,?,?,?,?)').run(newId(), r.id, taskId, 'error', 0, 'assignee cannot see the project', now);
              db.prepare('update rules set last_error = ? where id = ?').run('The chosen person can no longer see this project, so new requests are left unassigned.', r.id);
              log('rule.error', taskId, 'Rule could not assign: the chosen person cannot see the project', { rule: r.id });
            }
          }
        }
      });
      return { ok: true }; // nothing about the task, the project or the workspace is returned
    } });
}
