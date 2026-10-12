// Encrypted backup container: "TBX1" | salt(16) | iv(12) | AES-256-GCM ciphertext.
// Key = PBKDF2-SHA256(passphrase, salt, 600k). WebCrypto only, so it runs in the browser and in Node.
const MAGIC = new Uint8Array([0x54, 0x42, 0x58, 0x31]);
const ITER = 600_000;

async function key(pass: string, salt: Uint8Array, usage: KeyUsage[]) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function encrypt(data: Uint8Array, pass: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ['encrypt']), data as BufferSource));
  const out = new Uint8Array(MAGIC.length + 16 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
  return out;
}

export async function decrypt(blob: Uint8Array, pass: string): Promise<Uint8Array> {
  if (blob.length < 33 || MAGIC.some((b, i) => blob[i] !== b)) throw new Error('not a Tillbox backup file');
  const salt = blob.slice(4, 20), iv = blob.slice(20, 32);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ['decrypt']), blob.slice(32)));
  } catch { throw new Error('wrong passphrase or damaged backup'); }
}
