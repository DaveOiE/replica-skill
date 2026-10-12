import { projectAccess } from './access.js';
import { nowIso } from './db.js';

const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const day = (d) => d.toISOString().slice(0, 10);

export function reportRoutes(define, db) {
  // Fixed demo widgets over every task in projects the caller can see. Archived projects are left out.
  // Dates are UTC (see the assumption on due dates in frame.md).
  define({ method: 'GET', url: '/api/v1/reports/summary', action: 'report:read', write: false,
    sample: () => ({ url: '/api/v1/reports/summary' }),
    handler: async ({ actor }) => {
      const now = new Date(), today = day(now), soon = day(new Date(now.getTime() + 7 * 86400000)), weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const projects = db.prepare('select id, name from projects where workspace_id = ? and archived_at is null order by name').all(actor.workspaceId)
        .filter((p) => projectAccess(db, actor, p.id));
      const totals = { open: 0, overdue: 0, dueSoon: 0, doneRecently: 0 };
      const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
      const people = new Map();
      const byProject = [];
      for (const p of projects) {
        const tasks = db.prepare('select t.status, t.due_date, t.completed_at, u.name as assignee from tasks t left join users u on u.id = t.assignee_id where t.project_id = ?').all(p.id);
        let done = 0;
        for (const t of tasks) {
          byStatus[t.status] += 1;
          if (t.status === 'done') { done += 1; if (t.completed_at && t.completed_at >= weekAgo) totals.doneRecently += 1; continue; }
          totals.open += 1;
          if (t.due_date && t.due_date < today) totals.overdue += 1;
          else if (t.due_date && t.due_date <= soon) totals.dueSoon += 1;
          const who = t.assignee || null;
          people.set(who, (people.get(who) || 0) + 1);
        }
        byProject.push({ id: p.id, name: p.name, done, total: tasks.length });
      }
      const byAssignee = [...people.entries()].map(([name, open]) => ({ name, open })).sort((a, b) => b.open - a.open || String(a.name).localeCompare(String(b.name)));
      return { generatedAt: nowIso(), totals, byStatus, byAssignee, byProject };
    } });
}
