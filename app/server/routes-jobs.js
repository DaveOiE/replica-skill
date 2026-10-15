import { z } from 'zod';
import { mutate, appendAudit } from './audit.js';
import { newId, nowIso } from './db.js';
import { projectAccess } from './access.js';
import { readRegister, HIDDEN_BY_DEFAULT } from './jobs-import.js';

// Tiny invented sample used only by route tests: no real data lives in this repository.
export const SAMPLE_CSV = ['Job No,Job Title / Folder,Start Date,Estimated Completion,Estimated Completion,Next Action Due,Client,Status,Team,Comment / Update / Action,Misc,Estimated Completion Date,Closed Date',
  'J0001T,Invented sample job,01-Jul-24,2,Week(s),,Example Client Pty,Lead,,A sample note,,,'].join('\n');
const FIELDS = [['name', 'name'], ['client', 'client'], ['status', 'status'], ['owner_name', 'ownerName'], ['start_date', 'startDate'], ['due_date', 'dueDate'], ['closed_date', 'closedDate'], ['tags', 'tags'], ['latest_note', 'latestNote'], ['description', 'description']];
const empty = (v) => v == null || v === '';
const same = (a, b) => (empty(a) && empty(b)) || a === b;
const bodySchema = z.object({ csv: z.string().max(3_000_000), visibility: z.enum(['private', 'workspace']).optional() }).strict();

export function jobRoutes(define, db) {
  const workspaceUsers = (ws) => db.prepare("select u.id, u.name from memberships m join users u on u.id = m.user_id where m.workspace_id = ? and u.status = 'active' and u.kind = 'human'").all(ws);

  /** Read the file and compare with what is already in this workspace. No writes. */
  const plan = (ws, csv) => {
    const reg = readRegister(csv, workspaceUsers(ws));
    if (!reg.ok) return reg;
    const have = new Map(db.prepare('select * from projects where workspace_id = ? and job_number is not null').all(ws).map((p) => [p.job_number, p]));
    const create = [], update = []; let unchanged = 0;
    for (const rec of reg.rows) {
      const ex = have.get(rec.job);
      if (!ex) { create.push(rec); continue; }
      const changed = FIELDS.filter(([col, key]) => !same(ex[col], rec[key])).map(([col]) => col);
      if (rec.ownerId && ex.owner_id !== rec.ownerId) changed.push('owner_id');
      if (changed.length) update.push({ rec, id: ex.id, changed }); else unchanged++;
    }
    return { ...reg, create, update, unchanged };
  };
  const summary = (p) => ({
    rowsInFile: p.total, blankRows: p.blankRows, jobsFound: p.rows.length, toCreate: p.create.length, toUpdate: p.update.length, unchanged: p.unchanged,
    skipped: p.skipped.length, duplicateJobNumbers: p.duplicates.length, teamMatchedToAPerson: p.teamMatched, teamKeptAsText: p.teamText,
  });
  const report = (p) => ({ ok: true, counts: summary(p),
    skipped: p.skipped.slice(0, 100), // row numbers and reasons only, never contents
    duplicates: p.duplicates.slice(0, 50).map((d) => ({ rows: [d.first, d.later], used: 'the later row' })),
    warnings: Object.entries(p.warnings).map(([kind, rows]) => ({ kind, count: rows.length, rows: rows.slice(0, 20) })) });

  define({ method: 'POST', url: '/api/v1/jobs/import/preview', action: 'jobs:import_preview', write: false, body: bodySchema, bodyLimit: 3_300_000,
    sample: () => ({ url: '/api/v1/jobs/import/preview', payload: { csv: SAMPLE_CSV } }),
    handler: async ({ actor, body, reply }) => {
      const p = plan(actor.workspaceId, body.csv);
      return p.ok ? report(p) : reply.code(400).send({ error: p.error });
    } });

  define({ method: 'POST', url: '/api/v1/jobs/import', action: 'jobs:import', write: true, body: bodySchema, bodyLimit: 3_300_000,
    sample: () => ({ url: '/api/v1/jobs/import', payload: { csv: SAMPLE_CSV, visibility: 'private' } }),
    handler: async ({ ctx, actor, body, reply }) => {
      const p = plan(actor.workspaceId, body.csv);
      if (!p.ok) return reply.code(400).send({ error: p.error });
      const vis = body.visibility || 'private'; // imported client data starts visible to owners and admins only unless the admin chooses otherwise
      const counts = summary(p);
      mutate(ctx, { action: 'jobs.import', targetType: 'workspace', targetId: actor.workspaceId, summary: 'Job Register imported (counts only)', after: counts }, () => {
        const now = nowIso();
        const ev = (action, id, summaryText, after) => appendAudit(db, { workspaceId: actor.workspaceId, actorId: actor.userId, actorKind: 'user', action, targetType: 'project', targetId: id, summary: summaryText, after, ip: ctx.ip, requestId: ctx.requestId });
        for (const r of p.create) {
          const id = newId();
          db.prepare(`insert into projects(id,workspace_id,name,description,owner_id,visibility,created_at,updated_at,job_number,client,status,owner_name,start_date,due_date,closed_date,tags,latest_note)
            values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, actor.workspaceId, r.name, r.description, r.ownerId || actor.userId, vis, now, now, r.job, r.client || null, r.status || null, r.ownerName || null, r.startDate || null, r.dueDate || null, r.closedDate || null, r.tags, r.latestNote || null);
          db.prepare('insert into project_members(id,project_id,user_id,role) values (?,?,?,?)').run(newId(), id, actor.userId, 'admin');
          ['To do', 'In progress', 'Done'].forEach((n, i) => db.prepare('insert into sections(id,project_id,name,position) values (?,?,?,?)').run(newId(), id, n, i));
          ev('job.import_create', id, 'Job created by import', { visibility: vis });
        }
        for (const { rec: r, id, changed } of p.update) {
          db.prepare(`update projects set name=?, description=?, owner_name=?, owner_id=coalesce(?, owner_id), client=?, status=?, start_date=?, due_date=?, closed_date=?, tags=?, latest_note=?, updated_at=? where id=?`)
            .run(r.name, r.description, r.ownerName || null, r.ownerId, r.client || null, r.status || null, r.startDate || null, r.dueDate || null, r.closedDate || null, r.tags, r.latestNote || null, now, id);
          ev('job.import_update', id, 'Job updated by import', { fields: changed }); // which fields, never their values
        }
        return counts;
      });
      return { ok: true, counts, warnings: Object.entries(p.warnings).map(([kind, rows]) => ({ kind, count: rows.length })) };
    } });

  const query = z.object({ q: z.string().max(100).optional(), status: z.string().max(60).optional(), client: z.string().max(200).optional(), team: z.string().max(200).optional(),
    showClosed: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(500).optional(), offset: z.coerce.number().int().min(0).optional() }).strict();

  define({ method: 'GET', url: '/api/v1/jobs', action: 'jobs:list', write: false,
    sample: () => ({ url: '/api/v1/jobs' }),
    handler: async ({ req, actor, reply }) => {
      const parsed = query.safeParse(req.query || {});
      if (!parsed.success) return reply.code(400).send({ error: 'Some of the filters are not valid.' });
      const f = parsed.data;
      const all = db.prepare('select * from projects where workspace_id = ? and job_number is not null order by job_number').all(actor.workspaceId)
        .filter((p) => actor.role === 'owner' || actor.role === 'admin' || projectAccess(db, actor, p.id));
      const uniq = (k) => [...new Set(all.map((p) => p[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const q = (f.q || '').toLowerCase();
      const rows = all.filter((p) => (f.showClosed === 'true' || !HIDDEN_BY_DEFAULT.includes((p.status || '').toLowerCase()))
        && (!q || p.job_number.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        && (!f.status || p.status === f.status) && (!f.client || p.client === f.client) && (!f.team || (p.owner_name || '').toLowerCase().includes(f.team.toLowerCase())));
      const off = f.offset || 0, lim = f.limit || 200;
      return { total: rows.length, filters: { statuses: uniq('status'), clients: uniq('client'), teams: uniq('owner_name') },
        jobs: rows.slice(off, off + lim).map((p) => ({ id: p.id, jobNumber: p.job_number, name: p.name, client: p.client, status: p.status, ownerName: p.owner_name,
          startDate: p.start_date, dueDate: p.due_date, closedDate: p.closed_date, tags: JSON.parse(p.tags || '[]'), latestNote: p.latest_note ? p.latest_note.slice(0, 280) : null })) };
    } });
}
