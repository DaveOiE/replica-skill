export const newId = (): string => crypto.randomUUID();

/** A stable id derived from a name, so two devices that create "the same" row independently agree on its id. */
export async function deterministicId(...parts: string[]): Promise<string> {
  const data = new TextEncoder().encode('tillbox:' + parts.join('\u0000'));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80; // shape it like a v5 uuid
  const x = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)
export function randomPrefix(len = 4): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
}
