// Data access for ingestion. Thin on purpose: the routes decide, this module only talks to the database.
import { newId, nowIso } from './db.js';

export const findTaskByKey = (db, ws, key) => db.prepare(`select t.*, p.name as project_name, p.kind as project_kind from tasks t join projects p on p.id = t.project_id where t.workspace_id = ? and t.idempotency_key = ?`).get(ws, key);

export const findProject = (db, ws, kind, clientSlug) => (kind === 'client'
  ? db.prepare("select * from projects where workspace_id = ? and kind = 'client' and client_slug = ?").get(ws, clientSlug)
  : db.prepare('select * from projects where workspace_id = ? and kind = ?').get(ws, kind));

/** Creates a routing project with the standard sections. Visible to the whole workspace; owner is the service account. */
export function insertProject(db, ws, ownerId, kind, clientSlug) {
  const id = newId(), now = nowIso();
  const name = kind === 'sales' ? 'Sales' : kind === 'internal' ? 'Internal' : clientSlug;
  db.prepare(`insert into projects(id,workspace_id,name,description,owner_id,visibility,created_at,updated_at,kind,client_slug) values (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ws, name, 'Created automatically by ingestion.', ownerId, 'workspace', now, now, kind, kind === 'client' ? clientSlug : null);
  ['To do', 'In progress', 'Done'].forEach((n, i) => db.prepare('insert into sections(id,project_id,name,position) values (?,?,?,?)').run(newId(), id, n, i));
  return db.prepare('select * from projects where id = ?').get(id);
}

export const staffOf = (db, ws) => db.prepare("select u.id, u.name, u.email, m.role from memberships m join users u on u.id = m.user_id where m.workspace_id = ? and u.status = 'active' and u.kind = 'human'").all(ws);

export function insertIngestedTask(db, ws, project, ownerId, f) {
  const id = newId(), now = nowIso();
  const section = db.prepare('select id from sections where project_id = ? order by position limit 1').get(project.id)?.id ?? null;
  const pos = db.prepare('select coalesce(max(position), 0) + 1 as n from tasks where project_id = ?').get(project.id).n;
  db.prepare(`insert into tasks(id,workspace_id,project_id,section_id,title,description,assignee_id,owner_id,status,due_date,estimate_minutes,position,created_at,updated_at,
      source_call_id,client_slug,job_number,promised_date,inferred,lane,idempotency_key,context,source) values (?,?,?,?,?,?,?,?,'todo',?,?,?,?,?,?,?,?,?,?,?,?,?,'ingestion')`)
    .run(id, ws, project.id, section, f.title, f.description ?? '', f.assigneeId ?? null, ownerId, f.dueDate ?? null, f.estimateMinutes ?? null, pos, now, now,
      f.sourceCallId ?? null, f.clientSlug ?? null, f.jobNumber ?? null, f.promisedDate ?? null, f.inferred ? 1 : 0, f.lane ?? null, f.idempotencyKey, f.context);
  return id;
}
