import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { freshApp } from './helpers.js';
import { loadConfig } from '../server/app.js';
import { makeLimiter } from '../server/rateLimit.js';
import { noteUnknownFailure, unknownFailureCount, unknownLocked } from '../server/auth.js';
import { openDb } from '../server/db.js';

let n = 0; // a different unknown email each time, so the per-email lock does not mix in with what is being tested
const bad = (app, ip, extra = {}) => app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: `nobody${++n}@example.test`, password: 'wrong-password-123' }, headers: ip ? { 'x-forwarded-for': ip, ...extra } : extra });

test('behind a local proxy the caller is told apart by the forwarded address; without TRUST_PROXY the header is ignored', async () => {
  const proxied = await freshApp({ config: loadConfig({ TRUST_PROXY: 'true' }), signinPerMinute: 2 });
  const codes = [];
  for (const ip of ['198.51.100.1', '198.51.100.1', '198.51.100.1', '198.51.100.2']) codes.push((await bad(proxied.app, ip)).statusCode);
  assert.deepEqual(codes, [401, 401, 429, 401], 'one noisy caller is limited, a different caller is not');
  // a client that sends its own forwarded address cannot pick the one that is counted: the proxy appends the real one on the right
  const proxied2 = await freshApp({ config: loadConfig({ TRUST_PROXY: 'true' }), signinPerMinute: 2 });
  const spoof = [];
  for (const h of ['1.1.1.1, 198.51.100.7', '2.2.2.2, 198.51.100.7', '3.3.3.3, 198.51.100.7']) spoof.push((await bad(proxied2.app, h)).statusCode);
  assert.deepEqual(spoof, [401, 401, 429]);
  // not trusting a proxy: the header is just text, so rotating it buys nothing
  const direct = await freshApp({ signinPerMinute: 2 });
  const rotating = [];
  for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) rotating.push((await bad(direct.app, ip)).statusCode);
  assert.deepEqual(rotating, [401, 401, 429]);
});

test('the session cookie is Secure on an https site, HSTS is sent only then, and a contradictory setting refuses to start', async () => {
  assert.equal(loadConfig({}).cookieSecure, false);
  assert.equal(loadConfig({ PUBLIC_URL: 'https://tasks.example.test' }).cookieSecure, true);
  assert.equal(loadConfig({ PUBLIC_URL: 'http://127.0.0.1:3000', COOKIE_SECURE: 'true' }).cookieSecure, true);
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://tasks.example.test', COOKIE_SECURE: 'false' }), /must be Secure/);
  const secure = await freshApp({ config: loadConfig({ PUBLIC_URL: 'https://tasks.example.test' }) });
  const r = await secure.app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: secure.creds.member.email, password: secure.creds.member.password } });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['set-cookie'], /; Secure/);
  assert.match(r.headers['set-cookie'], /HttpOnly/);
  assert.match(r.headers['strict-transport-security'], /max-age=\d+/);
  const plain = await freshApp();
  assert.equal((await plain.app.inject('/')).headers['strict-transport-security'], undefined);
});

test('rate limiter and unknown-email lock tables forget finished windows, so memory cannot grow without bound', () => {
  let t = 0;
  const lim = makeLimiter({ max: 5, windowMs: 1000, now: () => t });
  for (let i = 0; i < 6000; i++) lim.hit(`ip-${i}`);
  assert.equal(lim.size(), 6000);
  t = 5000; lim.hit('late');
  assert.ok(lim.size() < 10, `still holding ${lim.size()} finished windows`);
  assert.equal(lim.hit('x'), true);
  const before = unknownFailureCount();
  const old = '2020-01-01T00:00:00.000Z', fresh = '2030-01-01T00:00:00.000Z';
  for (let i = 0; i < 6000; i++) noteUnknownFailure(`nobody-${i}@example.test`, old);
  noteUnknownFailure('later@example.test', fresh);
  assert.ok(unknownFailureCount() < 5100, `table holds ${unknownFailureCount()} entries after 6000 old failures`);
  for (let i = 0; i < 5; i++) noteUnknownFailure('locked@example.test', fresh);   // a live lock must survive the sweep
  for (let i = 0; i < 6000; i++) noteUnknownFailure(`more-${i}@example.test`, fresh);
  assert.ok(unknownFailureCount() < 6100);
  assert.equal(unknownLocked('locked@example.test', fresh), true, 'a live lock survived the sweep');
});

test('read API: an impossible updated_since is refused, a real one works', async () => {
  const { app, creds } = await freshApp();
  const get = (q) => app.inject({ method: 'GET', url: `/api/v1/read/tasks?${q}`, headers: { authorization: `Bearer ${creds.svc.read.token}` } });
  for (const q of ['updated_since=2026-13-45T00:00:00Z', 'updated_since=2026-02-31T00:00:00Z', 'updated_since=2026-10-15T25:00:00Z'])
    assert.equal((await get(q)).statusCode, 400, q);
  assert.equal((await get('updated_since=2026-02-28T23:59:59Z')).statusCode, 200);
});

test('the database folder and file are private to the app user', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'perm-check-'));
  try {
    const path = join(dir, 'sub', 'app.db');
    const db = openDb(path);
    db.exec('create table t(x); insert into t values (1);');
    assert.equal(statSync(join(dir, 'sub')).mode & 0o077, 0, 'folder is not open to others');
    assert.equal(statSync(path).mode & 0o077, 0, 'database file is not open to others');
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
