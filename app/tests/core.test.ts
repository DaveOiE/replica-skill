import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createBus } from '../src/events/bus';
import { runService } from '../src/services/runner';
import { loadAccess, can, assertCan, assertAdminRemains, assertRoleEditable, activeAdminIds, PermissionError, GuardError, ADMIN_ROLE_KEY } from '../src/auth/access';
import { allPermissions, isPermission, registerPermissions, PERMISSION_GROUPS } from '../src/auth/permissions';
import { formatMoney } from '../src/domain/format';
import { unknownTokens, renderTemplate, RECEIPT_TOKENS, INVOICE_TOKENS, tokensFor } from '../src/settings/templates';
import { deterministicId, randomPrefix, newId } from '../src/domain/ids';
import { insertRow } from '../src/db/sql';
import { getSetting, setSetting, MissingSettingError, localHHMM, loadPricingConfig } from '../src/settings/service';
import { SETTINGS } from '../src/settings/registry';
import { DEFAULT_ROLES, installDefaults } from '../src/seed';
import { getMeta } from '../src/domain/store';
import { makeDevice, type TestDevice } from './helpers';
import type { Ctx } from '../src/services/runner';
import type { Access } from '../src/auth/access';

describe('event bus and hook registry', () => {
  it('delivers events in order and lets a handler unsubscribe', async () => {
    const bus = createBus(); const seen: string[] = [];
    const off = bus.on('sale.created', (p) => { seen.push('a:' + p.number); });
    bus.on('sale.created', (p) => { seen.push('b:' + p.number); });
    await bus.emit('sale.created', { orderId: 'o', number: 'N1', totalCents: 1 });
    off();
    await bus.emit('sale.created', { orderId: 'o', number: 'N2', totalCents: 1 });
    expect(seen).toEqual(['a:N1', 'b:N1', 'b:N2']);
  });
  it('one failing handler never stops the others, and the error is reported', async () => {
    const errors: string[] = []; const bus = createBus((n, e) => errors.push(n + ':' + (e as Error).message));
    const ok = vi.fn();
    bus.on('sale.created', () => { throw new Error('boom'); });
    bus.on('sale.created', ok);
    await bus.emit('sale.created', { orderId: 'o', number: 'N', totalCents: 1 });
    expect(ok).toHaveBeenCalledOnce();
    expect(errors).toEqual(['sale.created:boom']);
  });
  it('emitting with no listeners is fine', async () => { await createBus().emit('settings.changed', { key: 'k', before: 1, after: 2, actorUserId: null }); });
  it('filters change a value in priority order, and a broken filter is skipped', async () => {
    const errors: unknown[] = []; const bus = createBus((_, e) => errors.push(e));
    bus.addFilter<number>('price', (v) => v + 1, 20);
    bus.addFilter<number>('price', (v) => v * 10, 10);
    bus.addFilter<number>('price', () => { throw new Error('bad plugin'); }, 15);
    expect(await bus.applyFilters('price', 2)).toBe(21);   // (2*10)+1, the broken one in between ignored
    expect(errors).toHaveLength(1);
    expect(await bus.applyFilters('nothing-registered', 'x')).toBe('x');
  });
  it('a filter can be removed', async () => {
    const bus = createBus(); const off = bus.addFilter<string>('t', (v) => v + '!');
    expect(await bus.applyFilters('t', 'a')).toBe('a!'); off();
    expect(await bus.applyFilters('t', 'a')).toBe('a');
  });
});

describe('permissions and access', () => {
  let d: TestDevice;
  const addUser = async (name: string, roleKey: string | null, active = true) => {
    const id = newId();
    await insertRow(d.db, 'users', { id, username: name, display_name: name, password_hash: 'x', active, updated_by_device: d.info.id });
    if (roleKey) {
      const [r] = await d.db.query<{ id: string }>('SELECT id FROM roles WHERE key = $1', [roleKey]);
      await insertRow(d.db, 'user_roles', { id: newId(), user_id: id, role_id: r.id, updated_by_device: d.info.id });
    }
    return id;
  };
  beforeAll(async () => { d = await makeDevice('access', { seed: true }); });

  it('permission keys are defined in code, and plugins can add their own', () => {
    expect(allPermissions().length).toBeGreaterThanOrEqual(80);
    expect(isPermission('orders.create')).toBe(true);
    expect(isPermission('made.up')).toBe(false);
    registerPermissions(['plugin.x']);
    expect(isPermission('plugin.x')).toBe(true);
  });
  it('the three seeded roles exist; the administrator row set is complete', async () => {
    expect(DEFAULT_ROLES.map((r) => r.key)).toEqual([ADMIN_ROLE_KEY, 'manager', 'cashier']);
    const [{ n }] = await d.db.query<{ n: number }>("SELECT count(*)::int n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key = 'administrator'");
    expect(n).toBe(Object.values(PERMISSION_GROUPS).flat().length); // plugin permissions registered after the seed are not in it
  });
  it('a cashier can sell but cannot change settings or manage users', async () => {
    const c = await loadAccess(d.db, await addUser('cash1', 'cashier'));
    expect(can(c, 'orders.create')).toBe(true);
    expect(can(c, 'settings.tax')).toBe(false);
    expect(can(c, 'users.manage')).toBe(false);
    expect(() => assertCan(c, 'users.manage')).toThrow(PermissionError);
    expect(c.isAdmin).toBe(false);
  });
  it('the administrator can do anything, including permissions registered later', async () => {
    const a = await loadAccess(d.db, await addUser('boss', ADMIN_ROLE_KEY));
    expect(a.isAdmin).toBe(true);
    expect(can(a, 'anything.at.all')).toBe(true);
  });
  it('a user with no roles, an unknown user, or null access can do nothing', async () => {
    expect(can(await loadAccess(d.db, await addUser('nobody', null)), 'orders.read')).toBe(false);
    expect(can(await loadAccess(d.db, newId()), 'orders.read')).toBe(false);
    expect(can(null, 'orders.read')).toBe(false);
  });
  it('an inactive role or a revoked grant removes the permission', async () => {
    const u = await addUser('temp', 'cashier');
    const [row] = await d.db.query<{ id: string }>("SELECT rp.id FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.key='cashier' AND rp.permission='orders.refund'");
    expect(can(await loadAccess(d.db, u), 'orders.refund')).toBe(true);
    await d.db.query('UPDATE role_permissions SET granted = false, version = version + 1, updated_at = clock_timestamp() WHERE id = $1', [row.id]);
    expect(can(await loadAccess(d.db, u), 'orders.refund')).toBe(false);
    await d.db.query("UPDATE roles SET active = false, version = version + 1, updated_at = clock_timestamp() WHERE key = 'cashier'");
    expect(can(await loadAccess(d.db, u), 'orders.create')).toBe(false);
    await d.db.query("UPDATE roles SET active = true, version = version + 1, updated_at = clock_timestamp() WHERE key = 'cashier'");
  });
  it('the last administrator cannot be removed, but one of two can', async () => {
    const only = await addUser('only-admin', ADMIN_ROLE_KEY);
    const everyone = await activeAdminIds(d.db);
    expect(everyone).toContain(only);
    // with the earlier admin from the previous test there are two
    await assertAdminRemains(d.db, { userId: only });
    await d.db.query("UPDATE users SET active = false, version = version + 1, updated_at = clock_timestamp() WHERE id <> $1 AND id IN (SELECT user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'administrator')", [only]);
    await expect(assertAdminRemains(d.db, { userId: only })).rejects.toThrow(GuardError);
    await assertAdminRemains(d.db, { userId: newId() }); // removing someone who is not an admin is always fine
  });
  it('the administrator role cannot be edited, other roles can', () => {
    expect(() => assertRoleEditable({ key: ADMIN_ROLE_KEY })).toThrow('every permission');
    expect(() => assertRoleEditable({ key: 'cashier' })).not.toThrow();
  });
});

describe('the service runner', () => {
  let d: TestDevice;
  beforeAll(async () => { d = await makeDevice('runner', { seed: true }); });
  const cashier: Access = { userId: newId(), isAdmin: false, permissions: new Set(['orders.read']) };
  const ctxFor = (actor: Ctx['actor']): Ctx => ({ ...d.ctx, actor });

  it('refuses a user who lacks the permission and does nothing', async () => {
    const fn = vi.fn();
    await expect(runService(ctxFor(cashier), { name: 't', permission: 'orders.create' }, fn)).rejects.toThrow(PermissionError);
    expect(fn).not.toHaveBeenCalled();
  });
  it('the system actor bypasses permission checks; the audit row has no user', async () => {
    await runService(ctxFor('system'), { name: 'sys.job', permission: 'orders.create', audit: () => ({ summary: 'ran' }) }, async () => 1);
    const [r] = await d.db.query<any>("SELECT actor_user_id, summary FROM audit_log WHERE action = 'sys.job'");
    expect(r).toMatchObject({ actor_user_id: null, summary: 'ran' });
  });
  it('writes the audit row in the SAME transaction: if the work fails, neither exists', async () => {
    const id = newId();
    await expect(runService(ctxFor('system'), { name: 'will.fail', audit: () => ({ summary: 'x' }) }, async (tx) => {
      await insertRow(tx, 'providers', { id, name: 'Rolled back', updated_by_device: d.info.id });
      throw new Error('nope');
    })).rejects.toThrow('nope');
    expect(await d.db.query('SELECT 1 FROM providers WHERE id = $1', [id])).toHaveLength(0);
    expect(await d.db.query("SELECT 1 FROM audit_log WHERE action = 'will.fail'")).toHaveLength(0);
  });
  it('events fire only after a successful commit', async () => {
    const seen: string[] = [];
    d.ctx.bus.on('sale.created', (p) => { seen.push(p.number); });
    await expect(runService(ctxFor('system'), { name: 'x', events: () => ({ 'sale.created': { orderId: 'o', number: 'FAILED', totalCents: 0 } }) }, async () => { throw new Error('no'); })).rejects.toThrow();
    await runService(ctxFor('system'), { name: 'y', events: () => ({ 'sale.created': { orderId: 'o', number: 'OK', totalCents: 0 } }) }, async () => 1);
    expect(seen).toEqual(['OK']);
  });
  it('a read can skip the audit row', async () => {
    const before = (await d.db.query('SELECT 1 FROM audit_log')).length;
    await runService(ctxFor(cashier), { name: 'read.thing', permission: 'orders.read', audit: () => null }, async () => 1);
    expect((await d.db.query('SELECT 1 FROM audit_log')).length).toBe(before);
  });
});

describe('settings: typed, validated, permissioned, audited', () => {
  let d: TestDevice;
  const admin: Access = { userId: newId(), isAdmin: true, permissions: new Set() };
  const cashier: Access = { userId: newId(), isAdmin: false, permissions: new Set(['orders.create']) };
  const taxClerk: Access = { userId: newId(), isAdmin: false, permissions: new Set(['settings.tax']) };
  beforeAll(async () => { d = await makeDevice('settings', { seed: true }); });
  const as = (actor: Ctx['actor']): Ctx => ({ ...d.ctx, actor });

  it('every setting names the permission that guards it, and that permission exists', () => {
    for (const [key, def] of Object.entries(SETTINGS)) expect(isPermission(def.permission), key).toBe(true);
  });
  it('reading a setting that was never set says so (there are no hidden defaults in code)', async () => {
    const bare = await makeDevice('bare');
    await expect(getSetting(bare.db, 'rounding')).rejects.toThrow(MissingSettingError);
  });
  it('the installer seeds once; running it again changes nothing', async () => {
    expect(await getMeta(d.db, 'seed_version')).toBe('1');
    expect(await installDefaults(d.db, d.info.id)).toBe(false);
  });
  it('a change needs the matching permission: a cashier cannot, a tax clerk can only touch tax', async () => {
    const r = await getSetting(d.db, 'rounding');
    await expect(setSetting(as(cashier), 'rounding', { ...r, mode: 'half_even' })).rejects.toThrow(PermissionError);
    await expect(setSetting(as(taxClerk), 'rounding', { ...r, mode: 'half_even' })).rejects.toThrow(PermissionError);
    const t = await getSetting(d.db, 'tax');
    await expect(setSetting(as(taxClerk), 'tax', t)).resolves.toBeTruthy();
    await expect(setSetting(as(admin), 'rounding', { ...r, mode: 'half_even' })).resolves.toMatchObject({ mode: 'half_even' });
    expect((await getSetting(d.db, 'rounding')).mode).toBe('half_even');
  });
  it('every change is audited with before and after, and bumps the version', async () => {
    const [row] = await d.db.query<any>("SELECT data FROM audit_log WHERE action = 'settings.set:rounding' ORDER BY created_at DESC LIMIT 1");
    expect(row.data.before.mode).toBe('half_up'); expect(row.data.after.mode).toBe('half_even');
    const [s] = await d.db.query<{ version: number }>("SELECT version FROM settings WHERE key = 'rounding'");
    expect(s.version).toBeGreaterThanOrEqual(2);
  });
  it('listeners hear about a change', async () => {
    const heard: string[] = []; d.ctx.bus.on('settings.changed', (p) => { heard.push(`${p.key}`); });
    await setSetting(as(admin), 'security', { lockAfterMinutes: 10, backupReminderDays: 5, autoBackupHours: 12 });
    expect(heard).toEqual(['security']);
  });
  it('invalid values are refused', async () => {
    await expect(setSetting(as(admin), 'rounding', { mode: 'banker' as never, cash: { enabled: true, incrementCents: 5 } })).rejects.toThrow();
    await expect(setSetting(as(admin), 'locale', { language: 'en', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', timezone: 'Mars/Phobos' })).rejects.toThrow();
    await expect(setSetting(as(admin), 'currency', { code: 'aud', symbol: '$', position: 'before', decimals: 2, thousandSeparator: ',', decimalSeparator: '.' })).rejects.toThrow();
    await expect(setSetting(as(admin), 'documents.receipt', { template: 'Hi {not_a_token}', footer: '' })).rejects.toThrow('unknown template tokens');
  });
  it('currency symbol and separators stay editable after sales; code and decimals lock after the first order', async () => {
    const cur = await getSetting(d.db, 'currency');
    await setSetting(as(admin), 'currency', { ...cur, code: 'NZD', decimals: 2 });          // before any order: allowed
    const now = await getSetting(d.db, 'currency');
    await insertRow(d.db, 'orders', { id: newId(), device_id: d.info.id, number_seq: 1, number: 'X-1', currency: 'NZD', rounding_mode: 'half_up', base_cents: 1, net_cents: 1, tax_cents: 0, gross_cents: 1, total_cents: 1 });
    await expect(setSetting(as(admin), 'currency', { ...now, decimals: 3 })).rejects.toThrow('cannot change once an order exists');
    await expect(setSetting(as(admin), 'currency', { ...now, code: 'USD' })).rejects.toThrow(GuardError);
    await expect(setSetting(as(admin), 'currency', { ...now, symbol: 'NZ$', position: 'after', thousandSeparator: ' ' })).resolves.toMatchObject({ symbol: 'NZ$', position: 'after' });
  });
  it('local clock time in a timezone, and the pricing config the engine receives', async () => {
    expect(localHHMM(new Date('2026-06-15T00:30:00Z'), 'Australia/Sydney')).toBe('10:30');
    expect(localHHMM(new Date('2026-06-15T00:30:00Z'), 'UTC')).toBe('00:30');
    const cfg = await loadPricingConfig(d.db, new Date('2026-06-15T00:30:00Z'));
    expect(cfg.pricing).toMatchObject({ rounding: 'half_even', localTime: '10:30' });
    expect(cfg.cash).toEqual({ enabled: true, incrementCents: 5, mode: 'half_even' });
  });
});

describe('templates, formatting and ids', () => {
  it('only known tokens are allowed; braces that are not tokens are refused too', () => {
    expect(unknownTokens('Hi {store_name} {total}', 'receipt')).toEqual([]);
    expect(unknownTokens('{nope} {total} {nope}', 'receipt')).toEqual(['nope']);
    expect(unknownTokens('{ total }', 'receipt')).toEqual([' total ']);
    expect(unknownTokens('{invoice_number}', 'receipt')).toEqual(['invoice_number']);
    expect(unknownTokens('{invoice_number}', 'invoice')).toEqual([]);
    expect(tokensFor('invoice').length).toBeGreaterThan(tokensFor('receipt').length);
    expect(RECEIPT_TOKENS.every((t) => INVOICE_TOKENS.includes(t))).toBe(true);
  });
  it('rendering substitutes and HTML-escapes; there is no way to run anything', () => {
    expect(renderTemplate('{store_name}: {total}', 'receipt', { store_name: '<b>Cafe & "Co"</b>', total: '$5.00' })).toBe('&lt;b&gt;Cafe &amp; &quot;Co&quot;&lt;/b&gt;: $5.00');
    expect(renderTemplate('[{note}]', 'receipt', {})).toBe('[]');
    expect(renderTemplate("{store_name}", 'receipt', { store_name: "it's" })).toBe('it&#39;s');
    expect(() => renderTemplate('{constructor}', 'receipt', {})).toThrow('unknown template tokens');
    expect(() => renderTemplate('{${process.exit()}}', 'receipt', {})).toThrow('unknown template tokens');
  });
  const aud = { symbol: '$', position: 'before' as const, decimals: 2, thousandSeparator: ',', decimalSeparator: '.' };
  it('formats money with integers only', () => {
    expect(formatMoney(0, aud)).toBe('$0.00');
    expect(formatMoney(5, aud)).toBe('$0.05');
    expect(formatMoney(123456789, aud)).toBe('$1,234,567.89');
    expect(formatMoney(-250, aud)).toBe('-$2.50');
    expect(formatMoney(9007199254740991, aud)).toBe('$90,071,992,547,409.91');
    expect(formatMoney(1050, { ...aud, symbol: '€', position: 'after', thousandSeparator: '.', decimalSeparator: ',' })).toBe('10,50€');
    expect(formatMoney(1234, { ...aud, decimals: 0 })).toBe('$1,234');
    expect(formatMoney(12345, { ...aud, decimals: 3 })).toBe('$12.345');
    expect(() => formatMoney(1.5, aud)).toThrow('whole number');
  });
  it('deterministic ids agree across calls and differ across inputs; prefixes avoid look-alikes', async () => {
    expect(await deterministicId('a', 'b')).toBe(await deterministicId('a', 'b'));
    expect(await deterministicId('a', 'b')).not.toBe(await deterministicId('a', 'c'));
    expect(await deterministicId('a', 'b')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (let i = 0; i < 50; i++) expect(randomPrefix()).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}$/);
  });
});
