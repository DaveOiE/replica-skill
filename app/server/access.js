// Who can do what inside one project. Workspace role sets the ceiling, project membership (direct or via a team) sets the level.
export const PROJECT_RANK = { viewer: 1, commenter: 2, editor: 3, admin: 4 };
const best = (a, b) => ((PROJECT_RANK[a] || 0) >= (PROJECT_RANK[b] || 0) ? a : b);

/** Returns { project, role } for this actor, or null when the project does not exist, is in another workspace, or is hidden from them. */
export function projectAccess(db, actor, projectId) {
  const project = db.prepare('select * from projects where id = ? and workspace_id = ?').get(projectId, actor.workspaceId);
  if (!project) return null;
  let explicit = null;
  const rows = db.prepare(`select pm.role, coalesce(t.view_only, 0) as vo from project_members pm
      left join teams t on t.id = pm.team_id
      where pm.project_id = ? and (pm.user_id = ? or pm.team_id in (select team_id from team_members where user_id = ?))`)
    .all(projectId, actor.userId, actor.userId);
  for (const r of rows) explicit = best(explicit, r.vo ? 'viewer' : r.role); // a view-only team never gives more than viewer
  let role = null;
  if (actor.role === 'owner' || actor.role === 'admin') role = 'admin';
  else if (actor.role === 'guest') role = explicit ? (explicit === 'admin' ? 'editor' : explicit) : null; // guests: only where added, never project admin
  else {
    let implicit = null;
    if (project.visibility === 'workspace') implicit = 'editor';
    else if (project.visibility === 'team' && project.team_id &&
      db.prepare('select 1 from team_members where team_id = ? and user_id = ?').get(project.team_id, actor.userId)) implicit = 'editor';
    role = best(implicit, explicit);
    if (actor.role === 'view_only' && role) role = 'viewer'; // view-only seats can read, never change
  }
  return role ? { project, role } : null;
}
