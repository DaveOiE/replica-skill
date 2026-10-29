// Guard rails from plan 4b: things that are data and editable, but must never be left in a state the app cannot run in.
import { GuardError } from '../auth/access';
import { getSetting } from '../settings/service';
import { runService, type Ctx } from './runner';

export async function archiveCustomerGroup(ctx: Ctx, groupId: string) {
  return runService(ctx, { name: 'customer_groups.archive', permission: 'customers.manage', audit: () => ({ entityType: 'customer_group', entityId: groupId, summary: 'archived' }) }, async (tx) => {
    if ((await getSetting(tx, 'customers')).defaultGroupId === groupId) throw new GuardError('the default customer group cannot be archived; choose another default first');
    await tx.query('UPDATE customer_groups SET active = false, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $2 WHERE id = $1', [groupId, ctx.deviceId]);
  });
}

export async function archiveCustomer(ctx: Ctx, customerId: string) {
  return runService(ctx, { name: 'customers.archive', permission: 'customers.manage', audit: () => ({ entityType: 'customer', entityId: customerId, summary: 'archived' }) }, async (tx) => {
    if ((await getSetting(tx, 'customers')).defaultCustomerId === customerId) throw new GuardError('the default walk-in customer cannot be archived; choose another default first');
    await tx.query('UPDATE customers SET active = false, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $2 WHERE id = $1', [customerId, ctx.deviceId]);
  });
}

/** Every unit group keeps exactly one base unit, and units in use keep their ratio. */
export async function archiveUnit(ctx: Ctx, unitId: string) {
  return runService(ctx, { name: 'units.archive', permission: 'catalogue.manage', audit: () => ({ entityType: 'unit', entityId: unitId, summary: 'archived' }) }, async (tx) => {
    const [u] = await tx.query<{ is_base: boolean }>('SELECT is_base FROM units WHERE id = $1', [unitId]);
    if (u?.is_base) throw new GuardError('a unit group must keep its base unit');
    await tx.query('UPDATE units SET active = false, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $2 WHERE id = $1', [unitId, ctx.deviceId]);
  });
}

/** At least one order type stays enabled, and the default one cannot be switched off. */
export async function setOrderTypeActive(ctx: Ctx, orderTypeId: string, active: boolean) {
  return runService(ctx, { name: 'order_types.set_active', permission: 'settings.pos', audit: () => ({ entityType: 'order_type', entityId: orderTypeId, summary: active ? 'enabled' : 'disabled' }) }, async (tx) => {
    if (!active) {
      if ((await getSetting(tx, 'pos')).defaultOrderTypeId === orderTypeId) throw new GuardError('the default order type cannot be disabled; choose another default first');
      const [{ n }] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM order_types WHERE active AND id <> $1', [orderTypeId]);
      if (n === 0) throw new GuardError('at least one order type must stay enabled');
    }
    await tx.query('UPDATE order_types SET active = $2, version = version + 1, updated_at = clock_timestamp(), updated_by_device = $3 WHERE id = $1', [orderTypeId, active, ctx.deviceId]);
  });
}
