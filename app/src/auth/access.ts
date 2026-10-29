import type { Db } from '../db/types';
import { isPermission } from './permissions';

export const ADMIN_ROLE_KEY = 'administrator';

export class PermissionError extends Error {
  constructor(public permission: string) { super(`permission denied: ${permission}`); this.name = 'PermissionError'; }
}
export class GuardError extends Error { constructor(msg: string) { super(msg); this.name = 'GuardError'; } }

export interface Access { userId: string; isAdmin: boolean; permissions: ReadonlySet<string> }

/** A user's access = the union of the permissions granted to their active roles. The administrator role has all of them. */
export async function loadAccess(db: Db, userId: string): Promise<Access> {
  const roles = await db.query<{ id: string; key: string }>(
    `SELECT r.id, r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND ur.active AND r.active`, [userId]);
  const isAdmin = roles.some((r) => r.key === ADMIN_ROLE_KEY);
  const granted = roles.length
    ? await db.query<{ permission: string }>(`SELECT DISTINCT permission FROM role_permissions WHERE role_id = ANY($1::uuid[]) AND granted`, [roles.map((r) => r.id)])
    : [];
  return { userId, isAdmin, permissions: new Set(granted.map((g) => g.permission).filter(isPermission)) };
}

export const can = (a: Access | null, permission: string): boolean => !!a && (a.isAdmin || a.permissions.has(permission));
export function assertCan(a: Access | null, permission: string): void { if (!can(a, permission)) throw new PermissionError(permission); }

/** Active users who hold an active administrator role. */
export async function activeAdminIds(db: Db): Promise<string[]> {
  return (await db.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id AND ur.active
       JOIN roles r ON r.id = ur.role_id AND r.active AND r.key = $1 WHERE u.active`, [ADMIN_ROLE_KEY])).map((r) => r.id);
}

/**
 * The last administrator can never be deactivated, demoted or have the role removed (plan 4b, fixed item 2).
 * Call before any change that could remove an admin; it throws if the change would leave none.
 */
export async function assertAdminRemains(db: Db, removing: { userId: string }): Promise<void> {
  const admins = await activeAdminIds(db);
  if (admins.includes(removing.userId) && admins.length <= 1) throw new GuardError('the last administrator cannot be removed or demoted');
}

/** The administrator role always keeps every permission, so its grants are not editable. */
export function assertRoleEditable(role: { key: string }): void {
  if (role.key === ADMIN_ROLE_KEY) throw new GuardError('the administrator role always has every permission and cannot be edited');
}
