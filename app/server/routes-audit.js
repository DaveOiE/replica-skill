import { z } from 'zod';
import { mutate } from './audit.js';
import { listAudit, countAudit, filterOptions, toCsv, validWho } from './store-audit.js';

const MAX_EXPORT = 50000;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.').refine((d) => { const t = Date.parse(`${d}T00:00:00.000Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d; }, 'That is not a real date.');
const filters = { who: z.string().max(80).refine(validWho, 'Pick a person from the list.').optional(), action: z.string().max(80).optional(), from: date.optional(), to: date.optional() };

/** The audit log screen's API and CSV export: owners and admins only, a token can never read it. */
export function auditRoutes(define, db) {
  define({ method: 'GET', url: '/api/v1/audit', action: 'audit:read', write: false,
    sample: () => ({ url: '/api/v1/audit?limit=5' }),
    handler: async ({ req, actor, reply }) => {
      const p = z.object({ ...filters, before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict().safeParse(req.query || {});
      if (!p.success) return reply.code(400).send({ error: 'Some of the filters are not valid.', details: p.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
      const { before, limit, ...f } = p.data;
      const { rows, more } = listAudit(db, actor.workspaceId, f, before, limit || 50);
      return { events: rows, next_before: more ? rows.at(-1).seq : null, ...(before ? {} : { options: filterOptions(db, actor.workspaceId) }) };
    } });

  // POST, not GET, because exporting is itself recorded in the log.
  define({ method: 'POST', url: '/api/v1/audit/export', action: 'audit:export', write: true, body: z.object(filters).strict(),
    sample: () => ({ url: '/api/v1/audit/export', payload: {} }),
    handler: async ({ ctx, actor, body, reply }) => {
      const n = countAudit(db, actor.workspaceId, body);
      if (n > MAX_EXPORT) return reply.code(422).send({ error: `That is ${n} events, more than the ${MAX_EXPORT} one export allows. Narrow the dates.` });
      const { rows } = listAudit(db, actor.workspaceId, body, undefined, MAX_EXPORT);
      const csv = toCsv(rows);
      mutate(ctx, { action: 'audit.export', targetType: 'workspace', targetId: actor.workspaceId, summary: `Audit log exported as CSV (${rows.length} events)`, after: { rows: rows.length, filtered: Object.keys(body) } }, () => {});
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="audit-log.csv"').send(csv);
    } });
}
