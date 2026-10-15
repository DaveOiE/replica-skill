import { z } from 'zod';
import { mutate, appendAudit } from './audit.js';
import { projectAccess } from './access.js';
import { findTaskByKey, findProject, insertProject, staffOf, insertIngestedTask } from './store-tasks.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.').refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'That is not a real date.');
const plain = (max) => z.string().min(1).max(max).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'No control characters.');
export const ingestBody = z.object({
  idempotency_key: plain(200).refine((s) => s.length >= 8, 'At least 8 characters.'),
  context: z.enum(['prospect', 'client_job', 'internal_job']),   // the one field added to the owner's list: routing needs to know which case this is
  title: z.string().trim().min(1).max(300), description: z.string().max(20000).optional(),
  assignee: z.string().trim().min(1).max(254).optional(),
  promised_date: date.optional(), due_date: date.optional(), estimate_minutes: z.number().int().min(0).max(100000).optional(),
  inferred: z.boolean().optional(), source_call_id: plain(200).optional(),
  client_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Lower-case letters, digits and hyphens.').optional(),
  job_number: plain(60).refine((s) => s === s.trim(), 'No leading or trailing spaces: the job number is stored exactly as sent.').optional(),
  lane: z.string().trim().min(1).max(80).optional(), subtype: z.string().trim().min(1).max(80).optional(),
}).strict();

/** ADL-066 as one pure function. Returns { kind, clientSlug } or { reject: { code, message } }. Never an "unsorted" place (ADL-024). */
export function routeFor(b) {
  const no = (code, message) => ({ reject: { code, message } });
  if (b.context === 'prospect') return b.client_slug ? { kind: 'sales' } : no('client_slug_required', 'A prospect-stage action needs client_slug so the client can be identified.');
  if (b.context === 'client_job') {
    const missing = [!b.client_slug && 'client_slug', !b.job_number && 'job_number'].filter(Boolean);
    return missing.length ? no(`${missing[0]}_required`, `A client-job action needs ${missing.join(' and ')} so the job and client can be identified.`) : { kind: 'client', clientSlug: b.client_slug };
  }
  if (!b.job_number) return no('job_number_required', 'An internal-job action needs job_number so the job can be identified.');
  return { kind: String(b.subtype || '').trim().toLowerCase() === 'business development' ? 'sales' : 'internal' };
}

export function ingestRoutes(define, db, config) {
  const urlOf = (t) => `${config.publicUrl}/#/p/${t.project_id}/t/${t.id}`;
  const shape = (t, created, extra = {}) => ({ id: t.id, url: urlOf(t), created, project: { id: t.project_id, name: t.project_name, kind: t.project_kind }, job_number: t.job_number, client_slug: t.client_slug, assigned: !!t.assignee_id, ...extra });

  /** Email first, then the full name (any case), then a first name that only one person has. Anything else: unassigned, and the reason is recorded. */
  const findAssignee = (ws, text, project) => {
    const q = text.trim().toLowerCase(), staff = staffOf(db, ws);
    let hits = staff.filter((u) => u.email.toLowerCase() === q);
    if (!hits.length) hits = staff.filter((u) => u.name.toLowerCase() === q);
    if (!hits.length && !q.includes(' ')) hits = staff.filter((u) => u.name.toLowerCase().split(' ')[0] === q);
    if (hits.length > 1) return { problem: 'ambiguous' };
    if (!hits.length) return { problem: 'not_found' };
    return projectAccess(db, { userId: hits[0].id, workspaceId: ws, role: hits[0].role }, project.id) ? { id: hits[0].id } : { problem: 'cannot_see_project' };
  };

  define({ method: 'POST', url: '/api/v1/ingest/tasks', action: 'tasks:ingest', write: true, body: ingestBody, bodyLimit: 200_000,
    sample: () => ({ url: '/api/v1/ingest/tasks', payload: { idempotency_key: 'walk-sample-key-0001', context: 'internal_job', job_number: 'J0001T', title: 'Walk sample task' } }),
    handler: async ({ ctx, req, actor, body, reply }) => {
      const ws = actor.workspaceId;
      const replay = () => { const t = findTaskByKey(db, ws, body.idempotency_key); if (!t) return null; req.svc.audit = true; return reply.code(200).send(shape(t, false)); };
      if (replay()) return;                                     // a retry returns the original task, never a second one
      const target = routeFor(body);
      if (target.reject) return reply.code(422).send({ error: 'unroutable', code: target.reject.code, message: target.reject.message });
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const made = mutate(ctx, (r) => ({ action: 'task.ingest', targetType: 'task', targetId: r.id, summary: 'Task created by ingestion', after: { project: r.project.id, kind: r.project.kind, assigned: !!r.assigneeId, warnings: r.warnings.map((w) => w.problem), inferred: !!body.inferred } }), () => {
            let project = findProject(db, ws, target.kind, target.clientSlug);
            if (!project) {
              project = insertProject(db, ws, actor.userId, target.kind, target.clientSlug);
              appendAudit(db, { workspaceId: ws, actorId: actor.userId, actorKind: 'service', action: 'project.auto_create', targetType: 'project', targetId: project.id, summary: `Project created by ingestion (${target.kind})`, after: { kind: target.kind }, ip: ctx.ip, requestId: ctx.requestId });
            }
            const warnings = [];
            let assigneeId = null;
            if (body.assignee) { const a = findAssignee(ws, body.assignee, project); if (a.id) assigneeId = a.id; else warnings.push({ field: 'assignee', problem: a.problem }); }
            const id = insertIngestedTask(db, ws, project, actor.userId, { title: body.title, description: body.description, assigneeId, dueDate: body.due_date, estimateMinutes: body.estimate_minutes, sourceCallId: body.source_call_id,
              clientSlug: body.client_slug, jobNumber: body.job_number, promisedDate: body.promised_date, inferred: body.inferred, lane: body.lane, idempotencyKey: body.idempotency_key });
            return { id, project, assigneeId, warnings };
          });
          const t = findTaskByKey(db, ws, body.idempotency_key);
          return reply.code(201).send(shape(t, true, { warnings: made.warnings }));
        } catch (e) {
          // Two calls racing to create the same first project or the same key: the loser looks again and uses what the winner made.
          if (attempt === 0 && /UNIQUE/i.test(e.message)) { if (replay()) return; continue; }
          throw e;
        }
      }
    } });
}
