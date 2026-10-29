import type { Db } from '../db/types';
import { PermissionError, can, type Access } from '../auth/access';
import type { Bus, EventMap } from '../events/bus';
import { newId } from '../domain/ids';

export interface Ctx {
  db: Db;
  bus: Bus;
  deviceId: string;
  /** 'system' = the installer or a background job. Real users always carry their access. */
  actor: Access | 'system';
}
export const actorId = (ctx: Ctx): string | null => (ctx.actor === 'system' ? null : ctx.actor.userId);
export interface ServiceSpec<T> {
  name: string;
  /** Required for anything a user can trigger. System actions may omit it. */
  permission?: string;
  /** What to record in the audit log. Return null to skip (only for reads). */
  audit?: (result: T) => { entityType?: string; entityId?: string; summary?: string; data?: unknown } | null;
  /** Events to emit after the transaction commits. */
  events?: (result: T) => { [K in keyof EventMap & string]?: EventMap[K] };
}

/** Check a permission up front, before doing expensive work outside a transaction. */
export function requirePermission(ctx: Ctx, permission: string): void {
  if (ctx.actor !== 'system' && !can(ctx.actor, permission)) throw new PermissionError(permission);
}

/**
 * The one write path (plan 2.2 rule 2): check permission, run in ONE transaction, write the audit row in that same
 * transaction, then emit events after commit. REST, screens and plugins all go through here.
 */
export async function runService<T>(ctx: Ctx, spec: ServiceSpec<T>, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (spec.permission && ctx.actor !== 'system' && !can(ctx.actor, spec.permission)) throw new PermissionError(spec.permission);
  const result = await ctx.db.transaction(async (tx) => {
    const out = await fn(tx);
    const a = spec.audit?.(out);
    if (a) {
      await tx.query(
        'INSERT INTO audit_log (id, actor_user_id, action, entity_type, entity_id, summary, data, device_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
        [newId(), actorId(ctx), spec.name, a.entityType ?? null, a.entityId ?? null, a.summary ?? null, JSON.stringify(a.data ?? null), ctx.deviceId]);
    }
    return out;
  });
  const ev = spec.events?.(result);
  if (ev) for (const [name, payload] of Object.entries(ev)) await ctx.bus.emit(name as never, payload as never);
  return result;
}
