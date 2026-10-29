// The set of settings, their types and validation live in code (plan 4b, fixed item 10). VALUES are data.
// There are deliberately no default values here: defaults live in src/seed and are only ever imported by the installer.
import { z } from 'zod';
import { unknownTokens } from './templates';

const uuid = z.string().uuid();
const template = (kind: 'receipt' | 'invoice') =>
  z.string().max(20000).refine((s) => unknownTokens(s, kind).length === 0, { message: 'contains unknown template tokens' });

export const SETTINGS = {
  store: { permission: 'settings.general', schema: z.object({ name: z.string().min(1).max(120), address: z.string().max(300), phone: z.string().max(40), email: z.string().max(120), taxNumber: z.string().max(40) }) },
  currency: {
    permission: 'settings.currency',
    schema: z.object({
      code: z.string().regex(/^[A-Z]{3}$/), symbol: z.string().min(1).max(4), position: z.enum(['before', 'after']),
      decimals: z.number().int().min(0).max(4), thousandSeparator: z.string().max(1), decimalSeparator: z.string().length(1),
    }),
    /** Fixed once any order exists: stored amounts would otherwise be read at the wrong scale (plan 4b, fixed item 3). */
    lockedAfterFirstOrder: ['code', 'decimals'] as const,
  },
  locale: {
    permission: 'settings.locale',
    schema: z.object({
      language: z.string().min(2).max(10), dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']), timeFormat: z.enum(['12h', '24h']),
      timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'unknown timezone'),
    }),
  },
  rounding: {
    permission: 'settings.rounding',
    schema: z.object({
      mode: z.enum(['half_up', 'half_even', 'half_down']),
      cash: z.object({ enabled: z.boolean(), incrementCents: z.number().int().min(1).max(10000) }),
    }),
  },
  tax: { permission: 'settings.tax', schema: z.object({ defaultTaxGroupId: uuid.nullable() }) },
  pos: {
    permission: 'settings.pos',
    schema: z.object({ defaultOrderTypeId: uuid.nullable(), heldCartExpiryHours: z.number().min(0).max(24 * 30), allowDecimalQuantities: z.boolean() }),
  },
  customers: { permission: 'settings.customers', schema: z.object({ defaultCustomerId: uuid.nullable(), defaultGroupId: uuid.nullable() }) },
  'documents.receipt': { permission: 'settings.documents', schema: z.object({ template: template('receipt'), footer: z.string().max(500) }) },
  'documents.invoice': { permission: 'settings.documents', schema: z.object({ template: template('invoice'), footer: z.string().max(500) }) },
  security: {
    permission: 'settings.data_safety',
    schema: z.object({ lockAfterMinutes: z.number().int().min(1).max(240), backupReminderDays: z.number().int().min(1).max(90), autoBackupHours: z.number().int().min(1).max(24 * 30) }),
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
