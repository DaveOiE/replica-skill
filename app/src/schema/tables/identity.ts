import { text, boolean, jsonb, uuid, index } from 'drizzle-orm/pg-core';
import { lwwTable, ledgerTable } from '../helpers';

export const users = lwwTable('users', {
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  active: boolean('active').notNull().default(true),
  customerId: uuid('customer_id'),
  locale: text('locale'),
  theme: text('theme'),
}, (t) => [index('users_username').on(t.username)]);

export const roles = lwwTable('roles', {
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  system: boolean('system').notNull().default(false),
  active: boolean('active').notNull().default(true),
});

export const userRoles = lwwTable('user_roles', {
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [index('user_roles_user').on(t.userId)]);

/** One row per (role, permission). `granted` flips; rows are never deleted. Permission keys are defined in code. */
export const rolePermissions = lwwTable('role_permissions', {
  roleId: uuid('role_id').notNull(),
  permission: text('permission').notNull(),
  granted: boolean('granted').notNull().default(true),
}, (t) => [index('role_permissions_role').on(t.roleId)]);

export const auditLog = ledgerTable('audit_log', {
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  summary: text('summary'),
  data: jsonb('data'),
}, (t) => [index('audit_log_created').on(t.createdAt), index('audit_log_entity').on(t.entityType, t.entityId)]);
