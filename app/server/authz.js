// The one place that answers "can this actor do this?". Every route calls can() before touching data.
// Unknown actions are denied. To add a permission, add a row to ACTIONS: a route that names an action
// missing from this table fails the route-walking test.

import { PROJECT_RANK } from './access.js';

export const ROLES = ['owner', 'admin', 'member', 'view_only', 'guest'];
const ALL = ROLES;
const MANAGERS = ['owner', 'admin'];
const READ_ONLY_ROLES = ['view_only', 'guest'];

/** action -> who may, and whether it changes anything. */
export const ACTIONS = {
  'session:read': { roles: ALL, write: false },
  // Signing out audits itself but changes no workspace data, so every role may do it (view-only included).
  'session:signout': { roles: ALL, write: false },
  'workspace:read': { roles: ALL, write: false },
  'workspace:update': { roles: MANAGERS, write: true },
  'members:read': { roles: MANAGERS, write: false },
  'members:update_role': { roles: MANAGERS, write: true },
  'members:create': { roles: MANAGERS, write: true },
  'project:list': { roles: ALL, write: false },
  'project:create': { roles: ['owner', 'admin', 'member'], write: true },
  // Project actions: `project` is the lowest project role allowed. The route layer works out the actor's
  // project role (see access.js, already capped for view-only and guests) and passes it as resource.projectRole.
  'project:read': { project: 'viewer', write: false },
  'task:comment': { project: 'commenter', write: true },
  'task:write': { project: 'editor', write: true },
  'project:manage': { project: 'admin', write: true },
  'me:tasks': { roles: ALL, write: false },
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
  if (rule.project) return !!resource?.projectRole && PROJECT_RANK[resource.projectRole] >= PROJECT_RANK[rule.project];
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
