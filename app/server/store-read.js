// Data access for Zen's read API. A read token sees ONLY projects made by ingestion (kind is not null): Sales, Internal and client projects.
// Imported per-job projects and ordinary staff projects have no kind, so nothing in them is ever returned.
export const encodeCursor = (updatedAt, id) => Buffer.from(JSON.stringify([updatedAt, id])).toString('base64url');
export function decodeCursor(c) {
  try { const [u, i] = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); return typeof u === 'string' && typeof i === 'string' ? [u, i] : null; } catch { return null; }
}

/** Keyset pagination on (updated_at, id): stable, and a task edited while you page simply reappears later. */
export function readTasks(db, ws, f, cursor, limit) {
  const where = ['t.workspace_id = ?', 'p.kind is not null'], args = [ws];
  if (f.jobNumber !== undefined) { where.push('t.job_number = ?'); args.push(f.jobNumber); }                       // exact, as stored
  if (f.clientSlug !== undefined) { where.push('coalesce(t.client_slug, p.client_slug) = ?'); args.push(f.clientSlug); } // own slug, or the client project's
  if (f.ids) { where.push(`t.id in (${f.ids.map(() => '?').join(',')})`); args.push(...f.ids); }
  if (f.updatedSince) { where.push('t.updated_at >= ?'); args.push(f.updatedSince); }
  if (cursor) { where.push('(t.updated_at > ? or (t.updated_at = ? and t.id > ?))'); args.push(cursor[0], cursor[0], cursor[1]); }
  const rows = db.prepare(`select t.*, p.name as project_name, p.kind as project_kind, coalesce(t.client_slug, p.client_slug) as effective_slug, u.name as assignee_name, u.email as assignee_email
    from tasks t join projects p on p.id = t.project_id left join users u on u.id = t.assignee_id where ${where.join(' and ')} order by t.updated_at, t.id limit ?`).all(...args, limit + 1);
  const more = rows.length > limit;
  return { rows: rows.slice(0, limit), more };
}

export const readProjects = (db, ws, kind) => db.prepare(`select id, name, kind, client_slug, archived_at from projects where workspace_id = ? and kind is not null ${kind ? 'and kind = ?' : ''} order by kind, name`).all(...(kind ? [ws, kind] : [ws]));
