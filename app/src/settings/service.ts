import type { Db } from '../db/types';
import { deterministicId } from '../domain/ids';
import { GuardError } from '../auth/access';
import { runService, actorId, type Ctx } from '../services/runner';
import { SETTINGS, type SettingKey, type SettingValue } from './registry';
import type { CashRounding, PricingConfig } from '../domain/engine';

export class MissingSettingError extends Error {
  constructor(public key: string) { super(`setting "${key}" has not been set (the installer seeds the first values)`); this.name = 'MissingSettingError'; }
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<SettingValue<K>> {
  const [row] = await db.query<{ value: unknown }>('SELECT value FROM settings WHERE key = $1', [key]);
  if (!row) throw new MissingSettingError(key);
  return SETTINGS[key].schema.parse(row.value) as SettingValue<K>;
}

export async function hasAnyOrder(db: Db): Promise<boolean> {
  return (await db.query('SELECT 1 FROM orders LIMIT 1')).length > 0;
}

/** Writes a setting as a versioned last-write-wins row. Used by the installer (system) and by the service below. */
export async function writeSetting(db: Db, deviceId: string, key: SettingKey, value: unknown): Promise<void> {
  const parsed = SETTINGS[key].schema.parse(value);
  const id = await deterministicId('setting', key);
  await db.query(
    `INSERT INTO settings (id, key, value, updated_by_device) VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (id) DO UPDATE SET value = excluded.value, version = settings.version + 1,
       updated_at = clock_timestamp(), updated_by_device = excluded.updated_by_device`,
    [id, key, JSON.stringify(parsed), deviceId]);
}

/** Changing a setting needs the permission that setting names, is validated, audited, and tells listeners. */
export async function setSetting<K extends SettingKey>(ctx: Ctx, key: K, value: SettingValue<K>): Promise<SettingValue<K>> {
  const def = SETTINGS[key];
  const before = await getSetting(ctx.db, key).catch((e) => { if (e instanceof MissingSettingError) return null; throw e; });
  return runService(ctx, {
    name: `settings.set:${key}`, permission: def.permission,
    audit: () => ({ entityType: 'setting', summary: `changed ${key}`, data: { key, before, after: value } }),
    events: () => ({ 'settings.changed': { key, before, after: value, actorUserId: actorId(ctx) } }),
  }, async (tx) => {
    const locked = 'lockedAfterFirstOrder' in def ? def.lockedAfterFirstOrder : [];
    if (before && locked.length && (await hasAnyOrder(tx))) {
      for (const f of locked) {
        if ((before as Record<string, unknown>)[f] !== (value as Record<string, unknown>)[f]) {
          throw new GuardError(`"${f}" cannot change once an order exists (stored amounts would be read at the wrong scale)`);
        }
      }
    }
    await writeSetting(tx, ctx.deviceId, key, value);
    return SETTINGS[key].schema.parse(value) as SettingValue<K>;
  });
}

/** Local wall-clock time "HH:MM" in an IANA timezone (the engine has no clock or timezone of its own). */
export function localHHMM(date: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return `${p.find((x) => x.type === 'hour')!.value}:${p.find((x) => x.type === 'minute')!.value}`;
}

/** Everything the pricing engine needs, assembled from settings. The engine itself never reads a setting. */
export async function loadPricingConfig(db: Db, now = new Date()): Promise<{ pricing: PricingConfig; cash: CashRounding }> {
  const [rounding, locale] = await Promise.all([getSetting(db, 'rounding'), getSetting(db, 'locale')]);
  return {
    pricing: { rounding: rounding.mode, nowIso: now.toISOString(), localTime: localHHMM(now, locale.timezone) },
    cash: { enabled: rounding.cash.enabled, incrementCents: rounding.cash.incrementCents, mode: rounding.mode },
  };
}
