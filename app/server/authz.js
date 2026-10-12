// The one place that answers "can this actor do this?". Every route calls can() before touching data.
// Unknown actions are denied. To add a permission, add a row to ACTIONS: a route that names an action
// missing from this table fails the route-walking test.

export const ROLES = ['owner', 'admin', 'member', 'view_only', 'guest'];
const ALL = ROLES;
const MANAGERS = ['owner', 'admin'];
const READ_ONLY_ROLES = ['view_only', 'guest'];

/** action -> who may, and whether it changes anything. */
export const ACTIONS = {
  'session:read': { roles: ALL, write: false },
  'workspace:read': { roles: ALL, write: false },
  'workspace:update': { roles: MANAGERS, write: true },
  'members:read': { roles: MANAGERS, write: false },
  'members:update_role': { roles: MANAGERS, write: true },
};

/**
 * actor = { userId, workspaceId, role, kind } or null; resource may carry { workspaceId }.
 * Rules, in order: no actor, no access; a resource from another workspace is never reachable;
 * view-only and guest roles can never perform a write, whatever the table says; then the table.
 */
export function can(actor, action, resource) {
  if (!actor) return false;
  const rule = ACTIONS[action];
  if (!rule) return false;
  if (resource && resource.workspaceId && resource.workspaceId !== actor.workspaceId) return false;
  if (rule.write && READ_ONLY_ROLES.includes(actor.role)) return false;
  return rule.roles.includes(actor.role);
}

/** Role-change rules on top of can(): only an owner touches owners; an admin can't make an owner. */
export function canAssignRole(actor, currentRole, newRole) {
  if (!ROLES.includes(newRole)) return false;
  if (actor.role === 'owner') return true;
  if (actor.role === 'admin') return currentRole !== 'owner' && newRole !== 'owner';
  return false;
}
