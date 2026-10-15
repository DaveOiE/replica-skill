import { scrypt, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt, with the parameters stored in every hash so the cost can be raised later: old hashes keep working and are
// replaced by a stronger one the next time that person signs in. 64 MB and about a quarter of a second per hash on a small server.
export const DEFAULT_COST = Object.freeze({ N: 65536, r: 8, p: 1 });
const KEYLEN = 32;
let current = { ...DEFAULT_COST };
/** Only for tests, which use a cheap cost to stay fast. */
export function setPasswordCost(cost) { current = { ...cost }; dummy = null; }
export const currentCost = () => ({ ...current });
const maxmem = (N, r) => 256 * N * r + 1024 * 1024;

export class BusyError extends Error { constructor() { super('busy'); this.statusCode = 503; } }

// Hashing runs on worker threads, never on the main one, and at most MAX_ACTIVE at a time (64 MB each); a long queue is refused rather than queued for ever.
const MAX_ACTIVE = 2, MAX_QUEUE = 100;
let active = 0;
const waiters = [];
async function slot() {
  if (active < MAX_ACTIVE) { active++; return; }
  if (waiters.length >= MAX_QUEUE) throw new BusyError();
  await new Promise((resolve) => waiters.push(resolve));      // the slot is handed over, so `active` stays the same
}
function release() { const next = waiters.shift(); if (next) next(); else active--; }

const parse = (stored) => {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, key] = parts;
  const N = +n, R = +r, P = +p;
  // a stored hash is data too: refuse costs that would hang or exhaust the server
  if (![N, R, P].every(Number.isInteger) || N < 2 || (N & (N - 1)) !== 0 || N > 1 << 20 || R < 1 || R > 16 || P < 1 || P > 16) return null;
  const expected = Buffer.from(key, 'base64');
  if (expected.length < 16 || expected.length > 64) return null;
  return { N, r: R, p: P, salt: Buffer.from(salt, 'base64'), expected };
};
const format = (c, salt, key) => ['scrypt', c.N, c.r, c.p, salt.toString('base64'), key.toString('base64')].join('$');

export function hashPassword(password) {   // synchronous: for the seed and the first-owner command, which are not serving requests
  const c = current, salt = randomBytes(16);
  return format(c, salt, scryptSync(password, salt, KEYLEN, { N: c.N, r: c.r, p: c.p, maxmem: maxmem(c.N, c.r) }));
}
export async function hashPasswordAsync(password) {
  const c = { ...current }, salt = randomBytes(16);
  await slot();
  try { return format(c, salt, await scryptAsync(password, salt, KEYLEN, { N: c.N, r: c.r, p: c.p, maxmem: maxmem(c.N, c.r) })); } finally { release(); }
}

export function verifyPassword(password, stored) {
  const h = parse(stored);
  if (!h) return false;
  return timingSafeEqual(scryptSync(password, h.salt, h.expected.length, { N: h.N, r: h.r, p: h.p, maxmem: maxmem(h.N, h.r) }), h.expected);
}
export async function verifyPasswordAsync(password, stored) {
  const h = parse(stored);
  if (!h) return false;
  await slot();
  try { return timingSafeEqual(await scryptAsync(password, h.salt, h.expected.length, { N: h.N, r: h.r, p: h.p, maxmem: maxmem(h.N, h.r) }), h.expected); } finally { release(); }
}

/** True when a stored hash was made with a weaker cost than the current one (or cannot be read). */
export function needsRehash(stored) {
  const h = parse(stored);
  return !!h && (h.N < current.N || h.r < current.r || h.p < current.p);
}

// Hash compared against when the email is unknown, so "no such user" costs about the same as "wrong password".
let dummy = null;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(12).toString('hex')));

// A short list of the passwords people choose most. It is a floor, not a guarantee: it stops the worst, not every weak one.
const COMMON = new Set(`password1234 password12345 password123456 passwordpassword password2024 password2025 password2026 qwertyuiop12 qwertyuiop123 qwertyuiopas
qwertyuiop[] qwertyuiopasdf qwerty123456 qwerty1234567 1q2w3e4r5t6y 1qaz2wsx3edc 1qazxsw23edc zaq12wsxcde3 asdfghjkl123 asdfghjklqwe zxcvbnm12345
123456789012 1234567890123 12345678901234 123456123456 123123123123 111111111111 000000000000 123456789abc abcdefghijkl abcdefgh1234 abc123abc123
iloveyou1234 iloveyou12345 letmein12345 letmein123456 welcome12345 welcome123456 welcome2024 welcome2025 welcome2026 administrator admin12345678 admin123456789
changeme1234 changeme12345 changemenow1 changeit12345 trustno1trustno1 sunshine1234 sunshine12345 football1234 football12345 baseball1234 superman1234
princess1234 princess12345 monkey123456 dragon123456 master123456 shadow123456 michael12345 jennifer1234 charlie12345 maggie123456 summer123456 summer2024
summer2025 winter123456 spring123456 autumn123456 newpassword1 newpassword12 mypassword123 mypassword1234 mypassword12345 myPassword123 yourpassword1
secret123456 secretsecret1 passw0rd1234 passw0rd12345 p@ssw0rd1234 p@ssw0rd12345 p@ssword1234 password!234 password@123 password#123 pa55word1234 pa$$word1234
test12345678 testing12345 testtesttest default12345 guest1234567 computer1234 internet1234 service12345 support12345 helpdesk1234 company12345 workspace123
0987654321ab 9876543210ab 987654321098 aaaaaaaaaaaa abababababab 123412341234 12341234abcd`.split(/\s+/).filter(Boolean).map((s) => s.toLowerCase()));
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function isCommonPassword(password) {
  const p = String(password), q = squash(p);
  if (COMMON.has(p.toLowerCase()) || COMMON.has(q)) return true;
  if (new Set(p).size <= 2) return true;                                                        // aaaaaaaaaaaa, abababababab
  const run = (s, step) => s.length >= 8 && [...s].every((c, i) => i === 0 || c.charCodeAt(0) - s.charCodeAt(i - 1) === step);
  if (run(p, 1) || run(p, -1)) return true;                                                     // 123456789012, abcdefghijkl, 987654321098
  // a common word with only digits or punctuation added: password + 1234, welcome + 2026
  const letters = q.replace(/[0-9]/g, '');
  return letters.length >= 6 && [...COMMON].some((c) => c.replace(/[0-9]/g, '') === letters && q.length <= c.length + 6);
}

/** Default rule until the admin sets custom ones: at least 12 characters, and not one of the most common passwords. */
export function checkPasswordRules(password, rules = { minLength: 12 }) {
  const problems = [];
  if (password.length < rules.minLength) problems.push(`Use at least ${rules.minLength} characters.`);
  else if (isCommonPassword(password)) problems.push('That password is too common. Pick something harder to guess, such as three unrelated words.');
  return problems;
}

export function randomPassword() {
  return randomBytes(15).toString('base64url');
}
