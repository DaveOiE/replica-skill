// Device lock (plan A12). A PIN or passphrase gates the app and protects a small vault of secrets (for example the
// S3 backup key). IMPORTANT, and said plainly in Settings: this is a UI gate plus encryption of those secrets. The
// local database itself is NOT encrypted at rest by the browser; anyone who can copy the browser profile can read
// it. A short PIN also gives little protection against someone who has copied the stored data and can guess offline,
// so vault secrets should be least-privilege (write-only) keys.
import type { Db } from '../db/types';
import { flush } from '../db/durability';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongPinError extends Error { constructor(public attemptsLeftBeforeDelay: number) { super('wrong PIN'); this.name = 'WrongPinError'; } }
export class LockedOutError extends Error { constructor(public untilMs: number) { super('too many wrong attempts; try again later'); this.name = 'LockedOutError'; } }
export class WeakPinError extends Error { constructor(msg: string) { super(msg); this.name = 'WeakPinError'; } }

/** 6 to 12 digits, or a passphrase of at least 10 characters. Refuses the obvious: 000000, 123456, 654321. */
export function validateSecret(s: string): string | null {
  if (/^\d+$/.test(s)) {
    if (s.length < 6 || s.length > 12) return 'a PIN must be 6 to 12 digits';
    if (/^(\d)\1+$/.test(s)) return 'a PIN cannot be one repeated digit';
    const asc = '0123456789012345678901', desc = '9876543210987654321098';
    if (asc.includes(s) || desc.includes(s)) return 'a PIN cannot be a run of consecutive digits';
    return null;
  }
  if (s.length < 10) return 'use a PIN of 6 to 12 digits, or a passphrase of at least 10 characters';
  return null;
}

async function wrapKey(secret: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aes(key: CryptoKey, data: Uint8Array, mode: 'enc' | 'dec', iv: Uint8Array) {
  return new Uint8Array(await crypto.subtle[mode === 'enc' ? 'encrypt' : 'decrypt']({ name: 'AES-GCM', iv: iv as BufferSource }, key, data as BufferSource));
}

async function get(db: Db, k: string) { return (await db.query<{ value: string }>('SELECT value FROM device_secrets WHERE key=$1', [k]))[0]?.value ?? null; }
// every write here is made durable at once: a PIN that vanishes on reload, or a wrong-guess counter that resets, would defeat the lock
async function put(db: Db, k: string, v: string) { await db.query('INSERT INTO device_secrets(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=excluded.value', [k, v]); await flush(db); }

export interface Vault {
  /** Encrypt and store a secret under a name. */
  seal(name: string, plaintext: string): Promise<void>;
  /** Decrypt a stored secret, or null if there is none. */
  open(name: string): Promise<string | null>;
  forget(name: string): Promise<void>;
}

function makeVault(db: Db, vaultKey: CryptoKey): Vault {
  return {
    async seal(name, plaintext) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      await put(db, 'vault:' + name, b64(iv) + '.' + b64(await aes(vaultKey, enc.encode(plaintext), 'enc', iv)));
    },
    async open(name) {
      const v = await get(db, 'vault:' + name); if (!v) return null;
      const [iv, ct] = v.split('.');
      return dec.decode(await aes(vaultKey, unb64(ct), 'dec', unb64(iv)));
    },
    async forget(name) { await db.query('DELETE FROM device_secrets WHERE key=$1', ['vault:' + name]); await flush(db); },
  };
}

export const isLockSet = async (db: Db): Promise<boolean> => (await get(db, 'lock_wrapped')) !== null;

/** Wrapping iterations are chosen at setup and stored, so a slow tablet and a fast PC each get a sensible cost. */
export async function setupLock(db: Db, secret: string, opts: { iterations?: number } = {}): Promise<Vault> {
  const problem = validateSecret(secret); if (problem) throw new WeakPinError(problem);
  const iterations = opts.iterations ?? 300_000;
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await aes(await wrapKey(secret, salt, iterations), raw, 'enc', iv);
  await put(db, 'lock_params', JSON.stringify({ salt: b64(salt), iterations }));
  await put(db, 'lock_wrapped', b64(iv) + '.' + b64(wrapped));
  await put(db, 'lock_failures', '0'); await put(db, 'lock_until', '0');
  return makeVault(db, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
}

/** After 5 wrong tries: 30 s, then doubling for each further 5, capped at 15 minutes. Survives a reload. */
export const delayAfter = (failures: number): number => failures < 5 ? 0 : Math.min(30_000 * 2 ** (Math.floor(failures / 5) - 1), 15 * 60_000);

export async function unlock(db: Db, secret: string, now: () => number = Date.now): Promise<Vault> {
  const until = Number((await get(db, 'lock_until')) ?? 0);
  if (until > now()) throw new LockedOutError(until);
  const params = JSON.parse((await get(db, 'lock_params')) ?? 'null'), wrapped = await get(db, 'lock_wrapped');
  if (!params || !wrapped) throw new Error('no lock is set on this device');
  const [iv, ct] = wrapped.split('.');
  try {
    const raw = await aes(await wrapKey(secret, unb64(params.salt), params.iterations), unb64(ct), 'dec', unb64(iv));
    await put(db, 'lock_failures', '0'); await put(db, 'lock_until', '0');
    return makeVault(db, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  } catch {
    const failures = Number((await get(db, 'lock_failures')) ?? 0) + 1;
    await put(db, 'lock_failures', String(failures));
    const wait = delayAfter(failures);
    if (wait) { await put(db, 'lock_until', String(now() + wait)); throw new LockedOutError(now() + wait); }
    throw new WrongPinError(5 - (failures % 5));
  }
}

/** Change the PIN without losing the vault: the same key is simply wrapped again. */
export async function changeLock(db: Db, oldSecret: string, newSecret: string, now: () => number = Date.now): Promise<Vault> {
  const problem = validateSecret(newSecret); if (problem) throw new WeakPinError(problem);
  const vault = await unlock(db, oldSecret, now);   // proves the old PIN (and applies the throttle)
  const params = JSON.parse((await get(db, 'lock_params'))!);
  const [iv, ct] = (await get(db, 'lock_wrapped'))!.split('.');
  const raw = await aes(await wrapKey(oldSecret, unb64(params.salt), params.iterations), unb64(ct), 'dec', unb64(iv));
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv2 = crypto.getRandomValues(new Uint8Array(12));
  await put(db, 'lock_params', JSON.stringify({ salt: b64(salt), iterations: params.iterations }));
  await put(db, 'lock_wrapped', b64(iv2) + '.' + b64(await aes(await wrapKey(newSecret, salt, params.iterations), raw, 'enc', iv2)));
  return vault;
}

/** Locks after a period with no activity. The caller drops its Vault reference in `onLock`. */
export function createInactivityLock(opts: { minutes: number; onLock: () => void; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }) {
  const set = opts.setTimer ?? setTimeout, clear = opts.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = () => { if (timer) clear(timer); timer = set(() => { timer = null; opts.onLock(); }, opts.minutes * 60_000); };
  return { touch: arm, stop() { if (timer) clear(timer); timer = null; }, lockNow() { if (timer) clear(timer); timer = null; opts.onLock(); } };
}
