// Encrypted backup container, version 2:
//   "TBX2" | headerLength (u32, big endian) | header (JSON) | salt (16) | iv (12) | AES-256-GCM ciphertext
// The header is readable without the passphrase (so the restore screen can say what a file is) but it is bound to the
// ciphertext as GCM "additional data": changing a byte of it makes decryption fail. There is NO unencrypted option.
const MAGIC = new Uint8Array([0x54, 0x42, 0x58, 0x32]);
export const DEFAULT_ITERATIONS = 600_000;

export interface BackupHeader {
  v: 2;
  kind: 'physical' | 'logical';
  schemaVersion: string;
  createdAt: string;
  appVersion: string;
  deviceId?: string;
  storeId?: string | null;
  kdfIterations: number;
}

/** Backups are the only copy off the device, so the passphrase must be worth something. */
export function validateBackupPassphrase(p: string): string | null {
  if (p.length < 12) return 'use at least 12 characters (a few random words is fine)';
  if (/^(.)\1+$/.test(p)) return 'that passphrase is one repeated character';
  if (new Set(p).size < 5) return 'that passphrase has too few different characters';
  return null;
}

async function key(pass: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function encrypt(data: Uint8Array, pass: string, header: Omit<BackupHeader, 'v' | 'kdfIterations'>, iterations = DEFAULT_ITERATIONS): Promise<Uint8Array> {
  const problem = validateBackupPassphrase(pass);
  if (problem) throw new Error('backup passphrase: ' + problem);
  const h = new TextEncoder().encode(JSON.stringify({ v: 2, ...header, kdfIterations: iterations }));
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: h as BufferSource }, await key(pass, salt, iterations, ['encrypt']), data as BufferSource));
  const out = new Uint8Array(4 + 4 + h.length + 16 + 12 + ct.length);
  out.set(MAGIC, 0); new DataView(out.buffer).setUint32(4, h.length); out.set(h, 8); out.set(salt, 8 + h.length); out.set(iv, 24 + h.length); out.set(ct, 36 + h.length);
  return out;
}

/** What a file claims to be. Not trusted until decrypt() succeeds (the header is authenticated there). */
export function readHeader(blob: Uint8Array): BackupHeader {
  if (blob.length < 40 || MAGIC.some((b, i) => blob[i] !== b)) throw new Error('not a Tillbox backup file');
  const len = new DataView(blob.buffer, blob.byteOffset).getUint32(4);
  if (len > 4096 || 8 + len + 28 > blob.length) throw new Error('not a Tillbox backup file');
  try { return JSON.parse(new TextDecoder().decode(blob.slice(8, 8 + len))); } catch { throw new Error('not a Tillbox backup file'); }
}

export async function decrypt(blob: Uint8Array, pass: string): Promise<{ header: BackupHeader; data: Uint8Array }> {
  const header = readHeader(blob);
  const len = new DataView(blob.buffer, blob.byteOffset).getUint32(4);
  const h = blob.slice(8, 8 + len), salt = blob.slice(8 + len, 24 + len), iv = blob.slice(24 + len, 36 + len), ct = blob.slice(36 + len);
  try {
    const data = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: h as BufferSource }, await key(pass, salt, header.kdfIterations, ['decrypt']), ct));
    return { header, data };
  } catch { throw new Error('wrong passphrase or damaged backup'); }
}
