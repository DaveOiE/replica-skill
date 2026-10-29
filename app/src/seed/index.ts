// INITIAL VALUES ONLY. This is the single place defaults live. Only the installer (and tests) may import it;
// a lint rule enforces that (eslint.config.js). After install every value here is editable in Settings, and an
// upgrade never writes it again.
import type { Db } from '../db/types';
import { PERMISSION_GROUPS, allPermissions } from '../auth/permissions';
import { ADMIN_ROLE_KEY } from '../auth/access';
import { deterministicId } from '../domain/ids';
import { insertRow } from '../db/sql';
import { getMeta, setMeta } from '../domain/store';
import { writeSetting } from '../settings/service';

const RECEIPT_TEMPLATE = `{store_name}
{store_address}
{store_phone}

Order {order_number}   {order_date}
Cashier: {cashier}   {order_type} {table_label}
{customer_name}

{lines}

Subtotal   {subtotal}
Discounts  {discounts}
Tax        {tax}
Rounding   {cash_rounding}
TOTAL      {total}

{payments}
Change     {change}

{note}
{footer}`;

export const SEED_VERSION = 1;

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: string[] | 'all' }[] = [
  { key: ADMIN_ROLE_KEY, name: 'Administrator', description: 'Everything, always.', permissions: 'all' },
  {
    key: 'manager', name: 'Manager', description: 'Runs the shop day to day.',
    permissions: [
      ...PERMISSION_GROUPS.pos, ...PERMISSION_GROUPS.orders, ...PERMISSION_GROUPS.catalogue, ...PERMISSION_GROUPS.purchasing,
      ...PERMISSION_GROUPS.customers, ...PERMISSION_GROUPS.registers, ...PERMISSION_GROUPS.accounting, ...PERMISSION_GROUPS.reports,
      'dashboard.read', 'audit.read', 'users.read', 'media.manage',
    ],
  },
  {
    key: 'cashier', name: 'Cashier', description: 'Sells and takes payment.',
    permissions: ['pos.use', 'pos.hold', 'pos.remove_line', 'orders.read', 'orders.create', 'orders.pay', 'orders.refund', 'products.read', 'customers.read', 'customers.create', 'registers.use', 'dashboard.read'],
  },
];

/** Idempotent: does nothing if the shop has already been seeded. Returns false in that case. */
export async function installDefaults(db: Db, deviceId: string): Promise<boolean> {
  if (await getMeta(db, 'seed_version')) return false;
  await db.transaction(async (tx) => {
    const lww = (id: string) => ({ id, updated_by_device: deviceId });
    const put = async (table: string, key: string, row: Record<string, unknown>) =>
      { const id = await deterministicId('seed', table, key); await insertRow(tx, table, { ...lww(id), ...row }); return id; };

    // units
    const count = await put('unit_groups', 'count', { name: 'Count' });
    const each = await put('units', 'each', { group_id: count, name: 'Each', symbol: 'ea', ratio_to_base: '1', is_base: true });
    const weight = await put('unit_groups', 'weight', { name: 'Weight' });
    await put('units', 'g', { group_id: weight, name: 'Gram', symbol: 'g', ratio_to_base: '1', is_base: true });
    await put('units', 'kg', { group_id: weight, name: 'Kilogram', symbol: 'kg', ratio_to_base: '1000', is_base: false });
    const volume = await put('unit_groups', 'volume', { name: 'Volume' });
    await put('units', 'ml', { group_id: volume, name: 'Millilitre', symbol: 'ml', ratio_to_base: '1', is_base: true });
    await put('units', 'l', { group_id: volume, name: 'Litre', symbol: 'l', ratio_to_base: '1000', is_base: false });

    // tax
    const gst = await put('taxes', 'gst', { name: 'GST', rate: '0.100000' });
    const group = await put('tax_groups', 'gst10', { name: 'GST 10%', default_mode: 'inclusive' });
    await put('tax_group_taxes', 'gst10:gst', { tax_group_id: group, tax_id: gst });

    // categories
    for (const [i, n] of ['General', 'Drinks', 'Food'].entries()) await put('categories', n.toLowerCase(), { name: n, sort_position: i });

    // customers
    const walkIn = await put('customer_groups', 'walkin', { name: 'Walk-in' });
    await put('customer_groups', 'regular', { name: 'Regular' });
    const walkInCustomer = await put('customers', 'walkin', { first_name: 'Walk-in', last_name: 'customer', group_id: walkIn });

    // payment and order types
    for (const [i, [k, n, kind]] of ([['cash', 'Cash', 'cash'], ['card', 'Card', 'electronic'], ['bank', 'Bank transfer', 'electronic'], ['account', 'Customer account', 'account']] as const).entries())
      await put('payment_types', k, { key: k, name: n, kind, sort_position: i });
    const takeaway = await put('order_types', 'takeaway', { key: 'takeaway', name: 'Take-away', is_default: true, sort_position: 0 });
    await put('order_types', 'delivery', { key: 'delivery', name: 'Delivery', needs_address: true, allows_shipping: true, sort_position: 1 });
    await put('order_types', 'dine_in', { key: 'dine_in', name: 'Dine-in', needs_table_label: true, sort_position: 2 });

    // roles and their permissions (the administrator role is all-powerful by rule, not by rows)
    for (const r of DEFAULT_ROLES) {
      const roleId = await put('roles', r.key, { key: r.key, name: r.name, description: r.description, system: true });
      const perms = r.permissions === 'all' ? allPermissions() : r.permissions;
      for (const p of perms) await put('role_permissions', `${r.key}:${p}`, { role_id: roleId, permission: p, granted: true });
    }

    // settings
    const w = (k: Parameters<typeof writeSetting>[2], v: unknown) => writeSetting(tx, deviceId, k, v);
    await w('store', { name: 'My shop', address: '', phone: '', email: '', taxNumber: '' });
    await w('currency', { code: 'AUD', symbol: '$', position: 'before', decimals: 2, thousandSeparator: ',', decimalSeparator: '.' });
    await w('locale', { language: 'en-AU', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', timezone: 'Australia/Sydney' });
    await w('rounding', { mode: 'half_up', cash: { enabled: true, incrementCents: 5 } });
    await w('tax', { defaultTaxGroupId: group });
    await w('pos', { defaultOrderTypeId: takeaway, heldCartExpiryHours: 24, allowDecimalQuantities: false });
    await w('customers', { defaultCustomerId: walkInCustomer, defaultGroupId: walkIn });
    await w('documents.receipt', { template: RECEIPT_TEMPLATE, footer: 'Thank you' });
    await w('documents.invoice', { template: 'INVOICE {invoice_number}\n{store_name}\n\n{billing_address}\n\n{lines}\n\nTax {tax}\nTotal {total}\nDue {due_date}\n{footer}', footer: '' });
    await w('security', { lockAfterMinutes: 5, backupReminderDays: 3, autoBackupHours: 24 });

    await setMeta(tx, 'seed_version', String(SEED_VERSION));
    void each;
  });
  return true;
}
