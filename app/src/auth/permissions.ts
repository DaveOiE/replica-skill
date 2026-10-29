// Permissions are defined in code (plan 4b, fixed item 1): each one is enforced at a specific point in a service.
// Admins assign them to roles; they cannot invent them. Plugins add theirs with registerPermissions().
export const PERMISSION_GROUPS = {
  pos: ['pos.use', 'pos.price_override', 'pos.line_discount', 'pos.cart_discount', 'pos.remove_line', 'pos.hold', 'pos.edit_cost', 'pos.order_settings'],
  orders: ['orders.read', 'orders.create', 'orders.update', 'orders.delete', 'orders.void', 'orders.refund', 'orders.pay', 'orders.instalments'],
  catalogue: ['products.read', 'products.create', 'products.update', 'products.delete', 'products.import', 'products.export', 'products.labels', 'products.adjust_stock', 'products.history', 'catalogue.manage'],
  purchasing: ['providers.manage', 'procurements.read', 'procurements.create', 'procurements.update', 'procurements.delete', 'procurements.pay'],
  customers: ['customers.read', 'customers.create', 'customers.update', 'customers.delete', 'customers.import', 'customers.account', 'customers.manage', 'coupons.manage', 'rewards.manage'],
  registers: ['registers.manage', 'registers.use', 'registers.history'],
  accounting: ['accounting.read', 'expenses.manage', 'accounts.manage', 'accounting.rules'],
  reports: ['reports.sales', 'reports.profit', 'reports.stock', 'reports.low_stock', 'reports.payment_types', 'reports.cash_flow', 'reports.annual', 'reports.customers', 'reports.customer_statement', 'reports.stock_history'],
  settings: ['settings.general', 'settings.currency', 'settings.locale', 'settings.tax', 'settings.rounding', 'settings.pos', 'settings.payments', 'settings.documents', 'settings.orders', 'settings.customers', 'settings.accounting', 'settings.reports', 'settings.notifications', 'settings.data_safety'],
  admin: ['users.read', 'users.manage', 'roles.manage', 'plugins.manage', 'media.manage', 'audit.read', 'sync.manage', 'backups.manage', 'dashboard.read', 'system.reset'],
} as const;

const extra = new Set<string>();
export const registerPermissions = (keys: string[]) => keys.forEach((k) => extra.add(k));
export const allPermissions = (): string[] => [...Object.values(PERMISSION_GROUPS).flat(), ...extra];
export const isPermission = (k: string): boolean => allPermissions().includes(k);

export type Permission = (typeof PERMISSION_GROUPS)[keyof typeof PERMISSION_GROUPS][number];
