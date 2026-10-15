import { z } from 'zod';
import { readTasks, readProjects, encodeCursor, decodeCursor } from './store-read.js';

const MAX_LIMIT = 500;
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/, 'Use a UTC time like 2026-10-31T09:00:00Z.');
const plain = (n) => z.string().min(1).max(n).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'No control characters.');
const query = z.object({
  job_number: plain(60).optional(), client_slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/).optional(),
  ids: z.string().max(20000).transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)).refine((a) => a.length > 0 && a.length <= 200 && a.every((x) => x.length <= 64), 'Between 1 and 200 ids.').optional(),
  updated_since: iso.optional(), cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
}).strict();

export function readRoutes(define, db, config) {
  const task = (t) => ({
    id: t.id, url: `${config.publicUrl}/#/p/${t.project_id}/t/${t.id}`, title: t.title, status: t.status,
    assignee: t.assignee_id ? { name: t.assignee_name, email: t.assignee_email } : null,
    promised_date: t.promised_date, due_date: t.due_date, estimate_minutes: t.estimate_minutes, completed_at: t.completed_at,
    job_number: t.job_number, client_slug: t.effective_slug, lane: t.lane, inferred: !!t.inferred, source_call_id: t.source_call_id,
    source: t.source, context: t.context, project: { id: t.project_id, name: t.project_name, kind: t.project_kind }, updated_at: t.updated_at,
  });

  define({ method: 'GET', url: '/api/v1/read/tasks', action: 'tasks:read_api', write: false,
    sample: () => ({ url: '/api/v1/read/tasks?updated_since=2000-01-01T00:00:00Z' }),
    handler: async ({ req, actor, reply }) => {
      const p = query.safeParse(req.query || {});
      if (!p.success) return reply.code(400).send({ error: 'invalid_query', message: 'Some of the query values are not valid.', details: p.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
      const q = p.data;
      if (q.job_number === undefined && q.client_slug === undefined && !q.ids && !q.updated_since) return reply.code(400).send({ error: 'invalid_query', message: 'Give at least one of job_number, client_slug, ids or updated_since.' });
      let cursor = null;
      if (q.cursor) { cursor = decodeCursor(q.cursor); if (!cursor) return reply.code(400).send({ error: 'invalid_query', message: 'That cursor is not valid. Start again without it.' }); }
      const { rows, more } = readTasks(db, actor.workspaceId, { jobNumber: q.job_number, clientSlug: q.client_slug, ids: q.ids, updatedSince: q.updated_since }, cursor, q.limit || 100);
      const last = rows.at(-1);
      return { tasks: rows.map(task), count: rows.length, next_cursor: more && last ? encodeCursor(last.updated_at, last.id) : null };
    } });

  define({ method: 'GET', url: '/api/v1/read/projects', action: 'projects:read_api', write: false,
    sample: () => ({ url: '/api/v1/read/projects' }),
    handler: async ({ req, actor, reply }) => {
      const p = z.object({ kind: z.enum(['client', 'sales', 'internal']).optional() }).strict().safeParse(req.query || {});
      if (!p.success) return reply.code(400).send({ error: 'invalid_query', message: 'kind must be client, sales or internal.' });
      return { projects: readProjects(db, actor.workspaceId, p.data.kind).map((x) => ({ id: x.id, name: x.name, kind: x.kind, client_slug: x.client_slug, archived: !!x.archived_at, url: `${config.publicUrl}/#/p/${x.id}` })) };
    } });
}
