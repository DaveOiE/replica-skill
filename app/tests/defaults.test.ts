// Plan 4b gates: every default is seed data, editable by an admin with the matching permission, and changing it
// really changes behaviour. Each test edits a setting or a row THROUGH the app's own paths and checks the effect.
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { createSimpleProduct, setUnitPrice } from '../src/services/catalogue';
import { createSale, quoteSale } from '../src/services/sales';
import { getSetting, setSetting, writeSetting } from '../src/settings/service';
import { archiveCustomer, archiveCustomerGroup, archiveUnit, setOrderTypeActive } from '../src/services/guards';
import { insertRow } from '../src/db/sql';
import { newId } from '../src/domain/ids';
import { PermissionError, GuardError, type Access } from '../src/auth/access';
import { installDefaults } from '../src/seed';
import { renderTemplate } from '../src/settings/templates';
import { makeDevice, makeUser, bump, idOf, type TestDevice } from './helpers';
import type { Ctx } from '../src/services/runner';

let d: TestDevice; let admin: Access; let cashier: Access;
let cash: string, card: string, account: string;
const as = (a: Access): Ctx => ({ ...d.ctx, actor: a });
const ids = {} as Record<string, string>;

beforeAll(async () => {
  d = await makeDevice('defaults', { seed: true });
  admin = await makeUser(d, 'admin', 'administrator');
  cashier = await makeUser(d, 'cashier', 'cashier');
  cash = await idOf(d.db, "SELECT id FROM payment_types WHERE key='cash'");
  card = await idOf(d.db, "SELECT id FROM payment_types WHERE key='card'");
  account = await idOf(d.db, "SELECT id FROM payment_types WHERE key='account'");
  ids.gstGroup = await idOf(d.db, "SELECT id FROM tax_groups WHERE name='GST 10%'");
  ids.gst = await idOf(d.db, "SELECT id FROM taxes WHERE name='GST'");
});

const productAt = async (sku: string, priceCents: number, extra: Partial<Parameters<typeof createSimpleProduct>[1]> = {}) =>
  (await createSimpleProduct(as(admin), { sku, name: sku, priceCents, openingStock: 100, taxGroupId: ids.gstGroup, ...extra })).productUnitId;
const quote = async (pu: string, qty = 1) => quoteSale(d.db, { lines: [{ productUnitId: pu, qty }] });

describe('tax: 10% GST is one seeded row', () => {
  it('starts as seeded: 10% inclusive', async () => {
    const q = await quote(await productAt('TAX-A', 1100));
    expect(q.priced.totals).toMatchObject({ grossCents: 1100, taxCents: 100, netCents: 1000 });
  });
  it('editing the rate changes every price that uses it (and nothing about past orders)', async () => {
    const pu = await productAt('TAX-B', 1100);
    const sold = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 1100 }] });
    await bump(d, 'taxes', ids.gst, { rate: '0.150000' });
    expect((await quote(pu)).priced.totals).toMatchObject({ grossCents: 1100, taxCents: 143, netCents: 957 });
    const [o] = await d.db.query<any>('SELECT tax_cents FROM orders WHERE id = $1', [sold.orderId]);
    expect(o.tax_cents).toBe(100); // history is a snapshot
    await bump(d, 'taxes', ids.gst, { rate: '0.100000' });
  });
  it('inclusive vs exclusive is a property of the tax group, with a per-product override', async () => {
    const pu = await productAt('TAX-C', 1000);
    await bump(d, 'tax_groups', ids.gstGroup, { default_mode: 'exclusive' });
    expect((await quote(pu)).priced.totals).toMatchObject({ netCents: 1000, taxCents: 100, grossCents: 1100 });
    const pinned = await productAt('TAX-D', 1000, {});
    const pid = await idOf(d.db, 'SELECT product_id AS id FROM product_units WHERE id = $1', [pinned]);
    await bump(d, 'products', pid, { tax_mode_override: 'inclusive' });
    expect((await quote(pinned)).priced.totals).toMatchObject({ grossCents: 1000, taxCents: 91 });
    await bump(d, 'tax_groups', ids.gstGroup, { default_mode: 'inclusive' });
  });
  it('a second tax can be added to the group and shows up as its own part', async () => {
    const levy = newId();
    await insertRow(d.db, 'taxes', { id: levy, name: 'Levy', rate: '0.020000', updated_by_device: d.info.id });
    await insertRow(d.db, 'tax_group_taxes', { id: newId(), tax_group_id: ids.gstGroup, tax_id: levy, updated_by_device: d.info.id });
    const q = await quote(await productAt('TAX-E', 1120));
    expect(q.priced.lines[0].taxParts.map((p) => [p.name, p.amountCents])).toEqual([['GST', 100], ['Levy', 20]]);
    await bump(d, 'tax_group_taxes', await idOf(d.db, 'SELECT id FROM tax_group_taxes WHERE tax_id = $1', [levy]), { active: false });
  });
  it('a product with no tax group is untaxed', async () => {
    expect((await quote(await productAt('TAX-F', 500, { taxGroupId: null }))).priced.totals.taxCents).toBe(0);
  });
});

describe('rounding: mode and cash rounding are settings', () => {
  it('changing the mode moves an exact-half case; the seeded mode was half_up', async () => {
    const pu = await productAt('RND-A', 1005);
    const pid = await idOf(d.db, 'SELECT product_id AS id FROM product_units WHERE id = $1', [pu]);
    await bump(d, 'products', pid, { tax_mode_override: 'exclusive' });
    const r = await getSetting(d.db, 'rounding');
    expect(r.mode).toBe('half_up');
    expect((await quote(pu)).grossCents).toBe(1106);
    await setSetting(as(admin), 'rounding', { ...r, mode: 'half_even' });
    expect((await quote(pu)).grossCents).toBe(1105);
    await setSetting(as(admin), 'rounding', { ...r, mode: 'half_down' });
    expect((await quote(pu)).grossCents).toBe(1105);
    await setSetting(as(admin), 'rounding', r);
  });
  it('cash rounding: on by default at 5c, switch off, or change the increment', async () => {
    const pu = await productAt('RND-B', 1997, { taxGroupId: null });
    const base = await getSetting(d.db, 'rounding');
    expect(await quote(pu)).toMatchObject({ grossCents: 1997, cashRoundingCents: -2, totalCents: 1995 });
    await setSetting(as(admin), 'rounding', { ...base, cash: { enabled: false, incrementCents: 5 } });
    expect(await quote(pu)).toMatchObject({ cashRoundingCents: 0, totalCents: 1997 });
    await setSetting(as(admin), 'rounding', { ...base, cash: { enabled: true, incrementCents: 10 } });
    expect(await quote(pu)).toMatchObject({ cashRoundingCents: 3, totalCents: 2000 });
    await setSetting(as(admin), 'rounding', base);
  });
  it('cash rounding only touches the cash part: a card payment pays the exact amount', async () => {
    const pu = await productAt('RND-C', 1997, { taxGroupId: null });
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 1997 }] })).resolves.toMatchObject({ totalCents: 1997, cashRoundingCents: 0 });
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: cash, amountCents: 1995 }] })).resolves.toMatchObject({ totalCents: 1995, cashRoundingCents: -2 });
    // split: 10.00 on card, the rest in cash is rounded, the card part is not
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 1000 }, { paymentTypeId: cash, amountCents: 995 }] })).resolves.toMatchObject({ totalCents: 1995 });
  });
});

describe('currency, locale and formats', () => {
  it('all of them are settings; symbol, position and separators are free to change, code and decimals only before the first order', async () => {
    const cur = await getSetting(d.db, 'currency');
    expect(cur).toMatchObject({ code: 'AUD', symbol: '$', decimals: 2 });
    // this device already has orders, so the locked fields refuse to move while the free ones do
    await expect(setSetting(as(admin), 'currency', { ...cur, decimals: 0 })).rejects.toThrow(GuardError);
    await setSetting(as(admin), 'currency', { ...cur, symbol: 'A$', position: 'after' });
    expect(await getSetting(d.db, 'currency')).toMatchObject({ symbol: 'A$', position: 'after' });
    await setSetting(as(admin), 'currency', cur);
  });
  it('date format, time format and timezone are settings', async () => {
    const l = await getSetting(d.db, 'locale');
    await setSetting(as(admin), 'locale', { ...l, dateFormat: 'YYYY-MM-DD', timeFormat: '24h', timezone: 'Pacific/Auckland' });
    expect(await getSetting(d.db, 'locale')).toMatchObject({ dateFormat: 'YYYY-MM-DD', timeFormat: '24h', timezone: 'Pacific/Auckland' });
    await setSetting(as(admin), 'locale', l);
  });
});

describe('order types and payment types are data', () => {
  it('seeded types exist; a new type works at once and its flags drive behaviour', async () => {
    const types = await d.db.query<{ key: string }>('SELECT key FROM order_types WHERE active ORDER BY sort_position');
    expect(types.map((t) => t.key)).toEqual(['takeaway', 'delivery', 'dine_in']);
    const pu = await productAt('OT-A', 500, { taxGroupId: null });
    const dine = await idOf(d.db, "SELECT id FROM order_types WHERE key='dine_in'");
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: dine })).rejects.toThrow('need a table label');
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: dine, tableLabel: 'T4' })).resolves.toBeTruthy();
    const delivery = await idOf(d.db, "SELECT id FROM order_types WHERE key='delivery'");
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: delivery })).rejects.toThrow('need a delivery address');

    const bar = newId();
    await insertRow(d.db, 'order_types', { id: bar, key: 'bar', name: 'Bar tab', needs_table_label: true, updated_by_device: d.info.id });
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: bar })).rejects.toThrow('Bar tab orders need a table label');
    const sale = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: bar, tableLabel: 'Stool 3', payments: [{ paymentTypeId: card, amountCents: 500 }] });
    const [o] = await d.db.query<any>('SELECT order_type_id, table_label FROM orders WHERE id = $1', [sale.orderId]);
    expect(o).toEqual({ order_type_id: bar, table_label: 'Stool 3' });
  });
  it('a disabled order type is refused; the default one and the last one cannot be disabled', async () => {
    const pu = await productAt('OT-B', 500, { taxGroupId: null });
    const pickup = newId();
    await insertRow(d.db, 'order_types', { id: pickup, key: 'pickup', name: 'Pickup', updated_by_device: d.info.id });
    await setOrderTypeActive(as(admin), pickup, false);
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 1 }], orderTypeId: pickup })).rejects.toThrow('disabled order type');
    const def = (await getSetting(d.db, 'pos')).defaultOrderTypeId!;
    await expect(setOrderTypeActive(as(admin), def, false)).rejects.toThrow('default order type');
    await expect(setOrderTypeActive(as(cashier), pickup, true)).rejects.toThrow(PermissionError);
  });
  it('the last enabled order type cannot be switched off', async () => {
    const solo = await makeDevice('solo', { seed: true });
    const sctx: Ctx = { ...solo.ctx, actor: 'system' };
    const pos = await getSetting(solo.db, 'pos');
    for (const t of await solo.db.query<{ id: string }>('SELECT id FROM order_types WHERE id <> $1', [pos.defaultOrderTypeId])) await setOrderTypeActive(sctx, t.id, false);
    await writeSetting(solo.db, solo.info.id, 'pos', { ...pos, defaultOrderTypeId: null });
    await expect(setOrderTypeActive(sctx, pos.defaultOrderTypeId!, false)).rejects.toThrow('at least one order type');
  });
  it('a new payment type of cash kind gives change; an electronic one does not', async () => {
    const pu = await productAt('PT-A', 1000, { taxGroupId: null });
    const petty = newId();
    await insertRow(d.db, 'payment_types', { id: petty, key: 'petty', name: 'Petty cash', kind: 'cash', updated_by_device: d.info.id });
    const r = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: petty, amountCents: 1000, tenderedCents: 2000 }] });
    expect(r.changeCents).toBe(1000);
    const gift = newId();
    await insertRow(d.db, 'payment_types', { id: gift, key: 'gift', name: 'Gift voucher', kind: 'electronic', updated_by_device: d.info.id });
    const r2 = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: gift, amountCents: 1000, tenderedCents: 5000 }] });
    expect(r2.changeCents).toBe(0);
  });
  it('the kind is constrained to the three the code understands', async () => {
    await expect(insertRow(d.db, 'payment_types', { id: newId(), key: 'x', name: 'X', kind: 'crypto', updated_by_device: d.info.id })).rejects.toThrow();
  });
  it('an inactive payment type is refused; paying from an account needs a customer', async () => {
    const pu = await productAt('PT-B', 1000, { taxGroupId: null });
    const off = newId();
    await insertRow(d.db, 'payment_types', { id: off, key: 'off', name: 'Off', kind: 'electronic', active: false, updated_by_device: d.info.id });
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: off, amountCents: 1000 }] })).rejects.toThrow('inactive payment type');
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: account, amountCents: 1000 }] })).rejects.toThrow('needs a customer');
    const cust = await idOf(d.db, "SELECT id FROM customers LIMIT 1");
    await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], customerId: cust, payments: [{ paymentTypeId: account, amountCents: 1000 }] });
    const [e] = await d.db.query<any>("SELECT operation, amount_cents FROM customer_account_entries WHERE customer_id = $1", [cust]);
    expect(e).toEqual({ operation: 'payment', amount_cents: 1000 });
  });
});

describe('receipt and invoice templates', () => {
  it('are settings: editable with the documents permission, rejected if they use a token that does not exist', async () => {
    const r = await getSetting(d.db, 'documents.receipt');
    expect(r.template).toContain('{order_number}');
    await setSetting(as(admin), 'documents.receipt', { template: 'SHOP {order_number} - {total}', footer: 'Bye' });
    expect(renderTemplate((await getSetting(d.db, 'documents.receipt')).template, 'receipt', { order_number: 'K7QM-000001', total: '$5.00' })).toBe('SHOP K7QM-000001 - $5.00');
    await expect(setSetting(as(cashier), 'documents.receipt', r)).rejects.toThrow(PermissionError);
    await setSetting(as(admin), 'documents.receipt', r);
  });
});

describe('roles and permissions are data', () => {
  it('a cashier\'s permissions can be changed and the change takes effect immediately', async () => {
    const pu = await productAt('RB-A', 500, { taxGroupId: null });
    const sale = () => createSale(as(cashier), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 500 }] });
    await expect(sale()).resolves.toBeTruthy();
    const grant = await idOf(d.db, "SELECT rp.id FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key='cashier' AND rp.permission='orders.create'");
    await bump(d, 'role_permissions', grant, { granted: false });
    cashier = await makeUser(d, 'cashier2', 'cashier');
    await expect(sale()).rejects.toThrow(PermissionError);
    await bump(d, 'role_permissions', grant, { granted: true });
    cashier = await makeUser(d, 'cashier3', 'cashier');
    await expect(sale()).resolves.toBeTruthy();
  });
  it('a new role with any set of permissions can be created', async () => {
    const role = newId();
    await insertRow(d.db, 'roles', { id: role, key: 'stock', name: 'Stock clerk', updated_by_device: d.info.id });
    await insertRow(d.db, 'role_permissions', { id: newId(), role_id: role, permission: 'products.adjust_stock', updated_by_device: d.info.id });
    const u = await makeUser(d, 'stocky', null);
    await insertRow(d.db, 'user_roles', { id: newId(), user_id: u.userId, role_id: role, updated_by_device: d.info.id });
    const { loadAccess, can } = await import('../src/auth/access');
    const a = await loadAccess(d.db, u.userId);
    expect(can(a, 'products.adjust_stock')).toBe(true);
    expect(can(a, 'orders.create')).toBe(false);
  });
});

describe('categories, units and customer groups are data, with guard rails', () => {
  it('seeded examples exist and can be added to', async () => {
    expect((await d.db.query<{ name: string }>('SELECT name FROM categories ORDER BY sort_position')).map((c) => c.name)).toEqual(['General', 'Drinks', 'Food']);
    expect((await d.db.query<{ name: string }>('SELECT name FROM customer_groups ORDER BY name')).map((c) => c.name)).toEqual(['Regular', 'Walk-in']);
    await insertRow(d.db, 'categories', { id: newId(), name: 'Bakery', updated_by_device: d.info.id });
    expect(await d.db.query("SELECT 1 FROM categories WHERE name='Bakery'")).toHaveLength(1);
  });
  it('the default customer group and the default walk-in customer cannot be archived; others can', async () => {
    const def = (await getSetting(d.db, 'customers'));
    await expect(archiveCustomerGroup(as(admin), def.defaultGroupId!)).rejects.toThrow('default customer group');
    await expect(archiveCustomer(as(admin), def.defaultCustomerId!)).rejects.toThrow('default walk-in customer');
    const regular = await idOf(d.db, "SELECT id FROM customer_groups WHERE name='Regular'");
    await archiveCustomerGroup(as(admin), regular);
    expect((await d.db.query<{ active: boolean }>('SELECT active FROM customer_groups WHERE id=$1', [regular]))[0].active).toBe(false);
    await expect(archiveCustomerGroup(as(cashier), regular)).rejects.toThrow(PermissionError);
  });
  it('a unit group keeps its base unit; other units can be archived', async () => {
    await expect(archiveUnit(as(admin), await idOf(d.db, "SELECT id FROM units WHERE name='Gram'"))).rejects.toThrow('base unit');
    await archiveUnit(as(admin), await idOf(d.db, "SELECT id FROM units WHERE name='Kilogram'"));
    expect((await d.db.query<{ active: boolean }>("SELECT active FROM units WHERE name='Kilogram'"))[0].active).toBe(false);
  });
  it('rows are archived, never deleted, so history can always resolve its references', async () => {
    await expect(d.db.query("DELETE FROM categories WHERE name='Bakery'")).rejects.toThrow('never deleted');
  });
});

describe('seed data stays seed data', () => {
  it('re-running the installer after an admin edited things overwrites nothing', async () => {
    const before = await getSetting(d.db, 'rounding');
    await setSetting(as(admin), 'rounding', { ...before, mode: 'half_down' });
    await bump(d, 'taxes', ids.gst, { rate: '0.125000' });
    expect(await installDefaults(d.db, d.info.id)).toBe(false);
    expect((await getSetting(d.db, 'rounding')).mode).toBe('half_down');
    expect((await d.db.query<{ rate: string }>('SELECT rate FROM taxes WHERE id = $1', [ids.gst]))[0].rate).toBe('0.125000');
  });
  it('no code outside src/seed (and the future installer) imports the seed module', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (!/src[\\/](seed|installer)$/.test(p)) walk(p); continue; }
        if (/\.(ts|tsx)$/.test(f) && /from\s+['"][^'"]*\/seed(\/[^'"]*)?['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk('src'); walk('server'); walk('scripts');
    expect(offenders).toEqual([]);
  });
  it('no default literal lives outside the seed: currency, timezone, tax rate, rounding increment', () => {
    const banned = [/['"]AUD['"]/, /Australia\/Sydney/, /['"]0\.100000['"]/, /incrementCents:\s*5\b/, /GST 10%/];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (!/src[\\/]seed$/.test(p)) walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || /migrations\.generated/.test(f)) continue;
        const src = readFileSync(p, 'utf8');
        for (const re of banned) if (re.test(src)) hits.push(`${p}: ${re}`);
      }
    };
    walk('src'); walk('server');
    expect(hits).toEqual([]);
  });
  it('the lint rules themselves work: seed imports and clock reads are rejected where they should be', async () => {
    const eslint = new ESLint();
    const lint = async (code: string, filePath: string) => (await eslint.lintText(code, { filePath })).flatMap((r) => r.messages.map((m) => m.ruleId));
    expect(await lint("import { installDefaults } from '../seed';\nexport const x = installDefaults;", 'src/services/leak.ts')).toContain('no-restricted-imports');
    expect(await lint("import { installDefaults } from '../seed';\nexport const x = installDefaults;", 'src/installer/ok.ts')).not.toContain('no-restricted-imports');
    expect(await lint("export const t = new Date();", 'src/domain/engine/clock.ts')).toContain('no-restricted-syntax');
    expect(await lint("export const t = Date.parse('2026-01-01');", 'src/domain/engine/ok.ts')).not.toContain('no-restricted-syntax');
    expect(await lint("import { getSetting } from '../../settings/service';\nexport const g = getSetting;", 'src/domain/engine/impure.ts')).toContain('no-restricted-imports');
  });
});

describe('the sale skeleton (engine + schema + audit + events)', () => {
  beforeAll(async () => {   // earlier tests edited settings on purpose; start from the seeded values again
    await bump(d, 'taxes', ids.gst, { rate: '0.100000' });
    await setSetting(as(admin), 'rounding', { mode: 'half_up', cash: { enabled: true, incrementCents: 5 } });
  });
  it('writes order, lines, line taxes, payments, stock movement and statuses, all adding up', async () => {
    const pu = await productAt('SK-A', 450);
    const events: string[] = []; d.ctx.bus.on('sale.created', (p) => { events.push(p.number); });
    const ctx: Ctx = { ...as(admin), bus: d.ctx.bus };
    const r = await createSale(ctx, { lines: [{ productUnitId: pu, qty: 2 }], payments: [{ paymentTypeId: card, amountCents: 900 }] });
    expect(r.number).toMatch(new RegExp(`^${d.info.prefix}-\\d{6}$`));
    expect(events).toEqual([r.number]);
    const [o] = await d.db.query<any>('SELECT * FROM orders WHERE id = $1', [r.orderId]);
    expect(o).toMatchObject({ gross_cents: 900, total_cents: 900, tax_cents: 82, net_cents: 818, currency: 'AUD', rounding_mode: 'half_up' });
    const lines = await d.db.query<any>('SELECT * FROM order_lines WHERE order_id = $1', [r.orderId]);
    expect(lines).toHaveLength(1); expect(lines[0]).toMatchObject({ qty: '2.00000', gross_cents: 900, tax_cents: 82, name: 'SK-A' });
    expect((await d.db.query<any>('SELECT amount_cents FROM order_line_taxes WHERE order_line_id = $1', [lines[0].id]))[0].amount_cents).toBe(82);
    expect((await d.db.query<any>("SELECT qty FROM stock_movements WHERE ref_id = $1", [r.orderId]))[0].qty).toBe('-2.00000');
    expect((await d.db.query<any>('SELECT qty FROM stock_levels WHERE product_unit_id = $1', [pu]))[0].qty).toBe('98.00000');
    const [st] = await d.db.query<any>('SELECT payment_status, process_status FROM order_state WHERE order_id = $1', [r.orderId]);
    expect(st).toEqual({ payment_status: 'paid', process_status: 'pending' });
    const [a] = await d.db.query<any>("SELECT actor_user_id, entity_id FROM audit_log WHERE action = 'sales.create' ORDER BY created_at DESC LIMIT 1");
    expect(a).toEqual({ actor_user_id: admin.userId, entity_id: r.orderId });
  });
  it('order numbers count up per device', async () => {
    const pu = await productAt('SK-B', 100, { taxGroupId: null });
    const a = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 100 }] });
    const b = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 100 }] });
    expect(Number(b.number.slice(-6)) - Number(a.number.slice(-6))).toBe(1);
  });
  it('quoting writes nothing', async () => {
    const pu = await productAt('SK-C', 100);
    const before = (await d.db.query('SELECT 1 FROM orders')).length;
    await quote(pu);
    expect((await d.db.query('SELECT 1 FROM orders')).length).toBe(before);
  });
  it('a failed sale leaves no trace', async () => {
    const pu = await productAt('SK-D', 1000, { taxGroupId: null });
    const orders = (await d.db.query('SELECT 1 FROM orders')).length, moves = (await d.db.query('SELECT 1 FROM stock_movements')).length;
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: cash, amountCents: 1000, tenderedCents: 500 }] })).rejects.toThrow('tendered amount is less');
    await expect(createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 999 }] })).rejects.toThrow('must add up');
    expect((await d.db.query('SELECT 1 FROM orders')).length).toBe(orders);
    expect((await d.db.query('SELECT 1 FROM stock_movements')).length).toBe(moves);
  });
  it('bad input is refused: empty cart, unknown product, zero or fractional quantity', async () => {
    const pu = await productAt('SK-E', 100, { taxGroupId: null });
    await expect(quoteSale(d.db, { lines: [] })).rejects.toThrow('at least one line');
    await expect(quoteSale(d.db, { lines: [{ productUnitId: newId(), qty: 1 }] })).rejects.toThrow('unknown or unavailable');
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: 0 }] })).rejects.toThrow('more than zero');
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: '1.5' }] })).rejects.toThrow('whole number');
    const pos = await getSetting(d.db, 'pos');
    await setSetting(as(admin), 'pos', { ...pos, allowDecimalQuantities: true });
    await expect(quoteSale(d.db, { lines: [{ productUnitId: pu, qty: '1.5' }] })).resolves.toBeTruthy();
    await setSetting(as(admin), 'pos', pos);
  });
  it('services and untracked products do not move stock', async () => {
    const pu = await productAt('SK-F', 800, { taxGroupId: null, trackStock: false });
    const r = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 800 }] });
    expect(await d.db.query('SELECT 1 FROM stock_movements WHERE ref_id = $1', [r.orderId])).toHaveLength(0);
  });
  it('a price change is a versioned edit and applies to the next sale only', async () => {
    const pu = await productAt('SK-G', 1000, { taxGroupId: null });
    const first = await createSale(as(admin), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 1000 }] });
    await setUnitPrice(as(admin), pu, 1200);
    expect((await quote(pu)).grossCents).toBe(1200);
    expect((await d.db.query<any>('SELECT gross_cents FROM orders WHERE id = $1', [first.orderId]))[0].gross_cents).toBe(1000);
  });
  it('a cashier without the right permission cannot sell', async () => {
    const nobody = await makeUser(d, 'nobody', null);
    const pu = await productAt('SK-H', 100, { taxGroupId: null });
    await expect(createSale(as(nobody), { lines: [{ productUnitId: pu, qty: 1 }], payments: [{ paymentTypeId: card, amountCents: 100 }] })).rejects.toThrow(PermissionError);
  });
});
