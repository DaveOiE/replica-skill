import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, freshDb } from './helpers.js';
import { signIn, flushSignInFailures, FAILURE_WINDOW_MS, actorFromToken, cleanupSessions, MAX_FAILURES } from '../server/auth.js';
import { hashPasswordAsync, verifyPasswordAsync, verifyPassword, needsRehash, setPasswordCost, currentCost, DEFAULT_COST, BusyError, isCommonPassword, checkPasswordRules, randomPassword, hashPassword } from '../server/password.js';
import { verifyChain } from '../server/audit.js';

const ctxOf = (db, ip = '203.0.113.5') => ({ db, ip, requestId: 'r', actor: null });
const at = (min) => new Date(Date.parse('2030-01-01T00:00:00.000Z') + min * 60000).toISOString();
const rows = (db, action) => db.prepare('select * from audit_events where action = ? order by seq').all(action);

// ---- repeated failed sign-ins are folded into one row per account and address per window, with a count
test('failed sign-ins: one audit row per account and address per window, then a count; lock-outs and successes are always recorded', async () => {
  const { db, creds } = freshDb();
  const pw = 'wrong-password-1', m = creds.member.email;
  for (let i = 0; i < MAX_FAILURES - 1; i++) await signIn(ctxOf(db), { email: m, password: pw, now: at(i * 0.1) });
  assert.equal(rows(db, 'auth.signin_failed').length, 1, 'four failures, one row');
  assert.equal(db.prepare('select failed_logins n from users where email = ?').get(m).n, MAX_FAILURES - 1, 'the counter still counts every failure');
  const locked = await signIn(ctxOf(db), { email: m, password: pw, now: at(0.5) });
  assert.equal(locked.status, 429);
  assert.equal(rows(db, 'auth.locked').length, 1, 'the lock-out is always recorded');
  for (let i = 0; i < 10; i++) await signIn(ctxOf(db), { email: m, password: pw, now: at(1 + i * 0.1) });
  assert.equal(rows(db, 'auth.signin_blocked').length, 1, 'ten blocked attempts, one row');
  // a different address is its own window
  await signIn(ctxOf(db, '198.51.100.9'), { email: creds.admin.email, password: pw, now: at(2) });
  await signIn(ctxOf(db, '198.51.100.10'), { email: creds.admin.email, password: pw, now: at(2.1) });
  assert.equal(rows(db, 'auth.signin_failed').length, 3, 'two more addresses, two more rows');
  // unknown emails: the same attempt repeated is folded too
  for (let i = 0; i < 6; i++) await signIn(ctxOf(db, '192.0.2.77'), { email: 'ghost@example.test', password: pw, now: at(3 + i * 0.1) });
  assert.equal(rows(db, 'auth.signin_failed').length, 4);
  // summaries: nothing is lost, the count says how many more there were
  flushSignInFailures(db, { all: true });
  const more = rows(db, 'auth.signin_repeated').map((r) => JSON.parse(r.after_json));
  const sum = (k) => more.filter((x) => x.attempted === k).reduce((n, x) => n + x.moreAttempts, 0);
  assert.equal(sum('signin_blocked'), 9, 'ten blocked = 1 row + 9 more');
  assert.equal(sum('signin_failed'), 3 + 5, 'member 3 more, ghost 5 more');
  assert.ok(more.every((x) => x.windowSeconds === FAILURE_WINDOW_MS / 1000));
  // a new window starts a new row, and the old window is summarised at that moment
  await signIn(ctxOf(db, '203.0.113.5'), { email: creds.viewonly.email, password: pw, now: at(10) });
  await signIn(ctxOf(db, '203.0.113.5'), { email: creds.viewonly.email, password: pw, now: at(10.5) });
  await signIn(ctxOf(db, '203.0.113.5'), { email: creds.viewonly.email, password: pw, now: at(20) });
  assert.equal(rows(db, 'auth.signin_failed').filter((r) => r.target_id === creds.viewonly.userId).length, 2);
  // a successful sign-in is always a row, and the trail holds no email text
  assert.equal((await signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password, now: at(30) })).ok, true);
  assert.equal(rows(db, 'auth.signin').length, 1);
  assert.doesNotMatch(JSON.stringify(db.prepare('select * from audit_events').all()).toLowerCase(), /@example\.test/);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('shutting the app down writes the pending summaries', async () => {
  const { app, db, creds } = await freshApp();
  for (let i = 0; i < 6; i++) await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.guest.email, password: 'wrong-password-9' } });
  assert.equal(rows(db, 'auth.signin_failed').length, 1);
  assert.equal(rows(db, 'auth.signin_repeated').length, 0);
  await app.close();
  const r = rows(db, 'auth.signin_repeated');
  assert.equal(r.length, 1);
  assert.equal(JSON.parse(r[0].after_json).moreAttempts, 3, 'six attempts: the first row plus three more; the fifth locks the account (its own row) and the sixth is a blocked attempt (its own row)');
  assert.equal(rows(db, 'auth.locked').length, 1);
});

// ---- hashing off the main thread, cost stored in the hash, upgrade on sign-in
test('hashing is asynchronous: the server keeps ticking while a hash is computed, at the production cost', async () => {
  const saved = currentCost();
  setPasswordCost(DEFAULT_COST);
  try {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const t0 = Date.now();
    const hashes = await Promise.all([hashPasswordAsync('correct horse battery'), hashPasswordAsync('correct horse battery')]);
    const ms = Date.now() - t0;
    clearInterval(timer);
    assert.match(hashes[0], /^scrypt\$65536\$8\$1\$/);
    assert.notEqual(hashes[0], hashes[1], 'each hash has its own salt');
    assert.ok(ticks >= Math.floor(ms / 25), `the main thread was blocked: ${ticks} ticks in ${ms} ms`);
    assert.equal(await verifyPasswordAsync('correct horse battery', hashes[0]), true);
    assert.equal(await verifyPasswordAsync('wrong', hashes[0]), false);
    assert.equal(needsRehash(hashes[0]), false);
    assert.ok(ms >= 100, 'the cost is real');
  } finally { setPasswordCost(saved); }
});

test('an old, cheaper hash still works and is replaced by a stronger one after a correct sign-in, never after a wrong one', async () => {
  const { db, creds } = freshDb();
  const before = db.prepare('select password_hash h from users where email = ?').get(creds.member.email).h;
  assert.match(before, /^scrypt\$1024\$/);
  const saved = currentCost();
  setPasswordCost({ N: 2048, r: 8, p: 1 });
  try {
    assert.equal(needsRehash(before), true);
    assert.equal((await signIn(ctxOf(db), { email: creds.member.email, password: 'wrong-password-1' })).ok, false);
    assert.equal(db.prepare('select password_hash h from users where email = ?').get(creds.member.email).h, before, 'a wrong password changes nothing');
    assert.equal((await signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password })).ok, true);
    const after = db.prepare('select password_hash h from users where email = ?').get(creds.member.email).h;
    assert.match(after, /^scrypt\$2048\$8\$1\$/);
    assert.equal(needsRehash(after), false);
    assert.equal((await signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password })).ok, true, 'the new hash works');
    assert.equal(db.prepare('select password_hash h from users where email = ?').get(creds.member.email).h, after, 'no churn once current');
    assert.doesNotMatch(JSON.stringify(db.prepare('select summary, before_json, after_json from audit_events').all()), /scrypt/);
  } finally { setPasswordCost(saved); }
});

test('a damaged or hostile stored hash is refused quickly, and a flood of hashing is turned away instead of queued for ever', async () => {
  const t0 = Date.now();
  for (const bad of ['', 'x', 'scrypt$1073741824$8$1$AAAA$AAAA', 'scrypt$65535$8$1$QUJD$QUJDREVGR0hJSktMTU5PUFFS', 'scrypt$16384$64$1$QUJD$QUJDREVGR0hJSktMTU5PUFFS', 'scrypt$16384$8$1$QUJD$QQ==', 'bcrypt$10$8$1$a$b'])
    assert.equal(await verifyPasswordAsync('x', bad), false, bad);
  assert.equal(verifyPassword('x', 'scrypt$1073741824$8$1$AAAA$AAAA'), false);
  assert.ok(Date.now() - t0 < 1500, 'refused without computing');
  const saved = currentCost();
  setPasswordCost({ N: 4096, r: 8, p: 1 });
  try {
    const results = await Promise.allSettled(Array.from({ length: 160 }, () => hashPasswordAsync('queue me')));
    const refused = results.filter((r) => r.status === 'rejected');
    assert.ok(refused.length > 0 && refused.every((r) => r.reason instanceof BusyError && r.reason.statusCode === 503), 'some were refused with a busy error');
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 102, '2 running + 100 waiting');
    assert.match(await hashPasswordAsync('after the flood'), /^scrypt\$4096/, 'the queue drains and hashing works again');
  } finally { setPasswordCost(saved); }
});

test('over HTTP a saturated hasher answers 503 with Retry-After, not a hang or a 500', async () => {
  const { app, creds } = await freshApp();
  const saved = currentCost();
  setPasswordCost({ N: 4096, r: 8, p: 1 });
  try {
    const flood = Array.from({ length: 140 }, () => hashPasswordAsync('queue me').catch(() => null));
    const r = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } });
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers['retry-after'], '5');
    assert.match(r.json().error, /busy/);
    await Promise.all(flood);
  } finally { setPasswordCost(saved); }
});

// ---- sessions: idle timeout, cleanup
test('idle timeout: a session unused for two hours ends, use keeps it alive, and the 12 hour limit still applies', async () => {
  const { db, creds } = freshDb();
  const t0 = Date.parse((await signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password })).actor && new Date().toISOString());
  const { token } = await signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password, now: new Date(t0).toISOString() });
  const min = (m) => new Date(t0 + m * 60000).toISOString();
  assert.ok(actorFromToken(db, token, min(100)), 'used after 100 minutes: fine');
  assert.ok(actorFromToken(db, token, min(200)), 'idle only 100 minutes since it was last used');
  const seen1 = db.prepare('select last_seen_at l from sessions').all().map((r) => r.l).filter(Boolean).sort().at(-1);
  actorFromToken(db, token, new Date(Date.parse(min(200)) + 10000).toISOString());
  assert.equal(db.prepare('select last_seen_at l from sessions').all().map((r) => r.l).filter(Boolean).sort().at(-1), seen1, 'the last-seen time is written at most once a minute');
  assert.equal(actorFromToken(db, token, min(330)), null, 'idle for 130 minutes');
  const { token: t2 } = await signIn(ctxOf(db), { email: creds.owner.email, password: creds.owner.password, now: min(0) });
  for (let m = 60; m <= 700; m += 60) assert.ok(actorFromToken(db, t2, min(m)), `kept alive at ${m}`);
  assert.equal(actorFromToken(db, t2, min(13 * 60 + 1)), null, 'but never beyond 12 hours');
  const { token: t3 } = await signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password, now: min(0) });
  assert.equal(actorFromToken(db, t3, min(30), 0.1), null, 'the idle limit is a setting');
});

test('idle timeout over HTTP: after the idle limit the next request is signed out (401)', async () => {
  const { app, creds } = await freshApp({ config: { ...(await import('../server/app.js')).loadConfig({}), idleMinutes: 0.002 } });   // 120 ms
  const s = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } });
  const cookie = s.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } })).statusCode, 200);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } })).statusCode, 401);
});

test('session cleanup removes only sessions that can never be used again, and says how many', async () => {
  const { db, creds } = freshDb();
  const now = at(0), day = (n) => at(-n * 1440);
  const mk = (id, created, expires, revoked = null, seen = null) => db.prepare('insert into sessions(id,user_id,workspace_id,auth_method,created_at,expires_at,revoked_at,last_seen_at) values (?,?,?,?,?,?,?,?)').run(id, creds.member.userId, creds.workspaces.demo, 'password', created, expires, revoked, seen);
  mk('expired-long-ago', day(20), day(19));
  mk('revoked-long-ago', day(20), at(600), day(10));
  mk('idle-for-weeks', day(30), at(600), null, day(9));
  mk('expired-yesterday', day(2), day(1));           // kept for a week, so support can still see it
  mk('active', at(-10), at(600), null, at(-1));
  assert.equal(cleanupSessions(db, now), 3);
  assert.deepEqual(db.prepare('select id from sessions order by id').all().map((r) => r.id), ['active', 'expired-yesterday']);
  const ev = rows(db, 'session.cleanup').filter((r) => r.workspace_id === creds.workspaces.demo);
  assert.equal(ev.length, 1); assert.deepEqual(JSON.parse(ev[0].after_json), { sessionsRemoved: 3 });
  assert.equal(cleanupSessions(db, now), 0);
  assert.equal(rows(db, 'session.cleanup').filter((r) => r.workspace_id === creds.workspaces.demo).length, 1, 'nothing removed, nothing written');
});

// ---- 404, headers
test('an unknown address gets one plain answer that does not echo the path; every response carries a Permissions-Policy', async () => {
  const { app } = await freshApp();
  for (const url of ['/api/v1/nope', '/nope', '/api/v1/<script>alert(1)</script>', '/shared/../server/auth.js']) {
    const r = await app.inject(url);
    assert.equal(r.statusCode, 404, url);
    assert.deepEqual(r.json(), { error: 'We could not find that.' });
    assert.doesNotMatch(r.body, /nope|script|auth\.js|Route/);
  }
  for (const url of ['/', '/api/v1/health', '/api/v1/nope', '/app.js']) assert.match((await app.inject(url)).headers['permissions-policy'], /camera=\(\).*microphone=\(\).*geolocation=\(\)/, url);
});

// ---- common passwords
test('the password rule: 12 characters and not one of the most common passwords, at every place a password is set', async () => {
  for (const bad of ['password1234', 'Password1234!', 'qwertyuiop12', 'Welcome2027', 'abcdefghijkl', '123456789012', 'aaaaaaaaaaaa', 'letmein123456', 'P@ssw0rd1234', 'changeme2031']) assert.equal(isCommonPassword(bad), true, bad);
  for (const good of ['correct horse battery', 'my dog likes walking', '9fK2-vlm3-Qw8z-pL', 'purple-giraffe-lamp-77']) assert.equal(isCommonPassword(good), false, good);
  assert.deepEqual(checkPasswordRules('short'), ['Use at least 12 characters.']);
  assert.match(checkPasswordRules('password1234')[0], /too common/);
  assert.deepEqual(checkPasswordRules('correct horse battery'), []);
  for (let i = 0; i < 2000; i++) assert.equal(isCommonPassword(randomPassword()), false);
  const { call, db, creds } = await freshApp();
  const change = await call('member', 'POST', '/api/v1/auth/password', { current: creds.member.password, next: 'Password1234!' });
  assert.equal(change.statusCode, 400); assert.match(change.json().error, /too common/);
  assert.equal((await call('member', 'POST', '/api/v1/auth/password', { current: creds.member.password, next: 'purple giraffe lamp 77' })).statusCode, 200);
  const inv = (await call('admin', 'POST', '/api/v1/invites', { email: 'newbie@example.test', role: 'member' })).json();
  const token = inv.link.split('/').pop();
  const accept = await call(null, 'POST', `/api/v1/invites/${token}/accept`, { name: 'New Person', password: 'welcome123456' });
  assert.equal(accept.statusCode, 400); assert.match(accept.json().error, /too common/);
  assert.equal((await call(null, 'POST', `/api/v1/invites/${token}/accept`, { name: 'New Person', password: 'a much better phrase' })).statusCode, 201);
  const reset = (await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/reset`)).json();
  const rt = reset.link.split('/').pop();
  assert.equal((await call(null, 'POST', `/api/v1/resets/${rt}/complete`, { password: 'qwertyuiop123' })).statusCode, 400);
  assert.equal((await call(null, 'POST', `/api/v1/resets/${rt}/complete`, { password: 'a much better phrase' })).statusCode, 200);
});
