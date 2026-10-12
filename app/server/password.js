import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// scrypt, with the parameters stored in the hash so they can change later.
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, key] = parts;
  const expected = Buffer.from(key, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Hash compared against when the email is unknown, so "no such user" costs the same time as "wrong password".
export const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

/** Default rule until the admin sets custom ones (M7): at least 12 characters. */
export function checkPasswordRules(password, rules = { minLength: 12 }) {
  const problems = [];
  if (password.length < rules.minLength) problems.push(`Use at least ${rules.minLength} characters.`);
  return problems;
}

export function randomPassword() {
  return randomBytes(15).toString('base64url');
}
