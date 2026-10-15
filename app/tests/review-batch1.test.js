import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { freshApp, freshDb } from './helpers.js';
import { signIn, MAX_FAILURES, LOCKED_MESSAGE } from '../server/auth.js';
import { foldOrRecord, flushFolds, takeAnonymousCount, openWindowCount, MAX_WINDOWS } from '../server/audit-fold.js';
import { verifyChain, redact } from '../server/audit.js';
import { setPasswordCost, currentCost } from '../server/password.js';
import { keyFrom, LocalDirDestination, runBackup, runRestore, BackupError } from '../server/backup.js';
import { openDb, migrate } from '../server/db.js';
import { loadConfig } from '../server/app.js';
import { unlockAccount, issueResetLink, RefusedError } from '../cli/break-glass.js';

const ctxOf = (db, ip = '203.0.113.5') => ({ db, ip, requestId: 'r', actor: null });
const rows = (db, action) => db.prepare('select * from audit_events where action = ? order by seq').all(action);
const count = (db, ws) => db.prepare('select count(*) n from audit_events where workspace_id = ?').get(ws).n;
const signin = (app, payload) => app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload });
const tokenOf = (link) => link.split('/').pop();

// ---------------------------------------------------------------- A1
test('A1: anonymous attempts cannot write into any tenant trail; a known account is recorded in its own workspace, never the one the request named', async () => {
  const { app, db, creds } = await freshApp({ signinPerMinute: 1000 });
  const demo = creds.workspaces.demo, other = creds.workspaces.other;
  const before = [count(db, demo), count(db, other), db.prepare('select count(*) n from audit_events').get().n];
  for (let i = 0; i < 40; i++) await signin(app, { email: `x${i}@evil.test`, password: 'wrong-password-1', workspace: 'demo' });
  assert.equal(db.prepare('select count(*) n from audit_events').get().n, before[2] + 0, 'forty anonymous attempts added nothing to any trail (not even a hidden bucket)');
  assert.equal(takeAnonymousCount(db), 40, 'they are counted');
  // a real account of the demo workspace, with the OTHER workspace named in the request
  for (let i = 0; i < 3; i++) await signin(app, { email: creds.member.email, password: 'wrong-password-1', workspace: 'other' });
  assert.ok(count(db, demo) > before[0], 'recorded where the person belongs');
  assert.equal(count(db, other), before[1], 'nothing was written to the workspace named in the request');
  assert.equal(db.prepare("select count(*) n from audit_events where workspace_id = 'none'").get().n, 0);
});

test('A1: the table of open windows is bounded; when it is full events are counted and dropped, and one summary row says how many', () => {
  const { db, creds } = freshDb();
  const ws = creds.workspaces.demo, now = '2030-01-01T00:00:00.000Z';
  const info = { ws, actorId: null, targetType: 'user', targetId: 'u', summaryAction: 'auth.signin_repeated', summary: 's', countKey: 'moreAttempts', afterBase: { attempted: 'signin_failed' } };
  let written = 0;
  for (let i = 0; i < MAX_WINDOWS + 300; i++) if (foldOrRecord(db, `k${i}`, info, now)) written++;
  assert.equal(written, MAX_WINDOWS, 'no more than the table size is ever written');
  assert.equal(openWindowCount(db), MAX_WINDOWS);
  const before = db.prepare('select count(*) n from audit_events').get().n;
  flushFolds(db, { now });   // nothing has ended yet, but dropped rows are summarised
  const dropped = rows(db, 'audit.rows_dropped');
  assert.equal(dropped.length, 1); assert.deepEqual(JSON.parse(dropped[0].after_json), { dropped: 300, windowSeconds: 300 });
  assert.equal(db.prepare('select count(*) n from audit_events').get().n, before + 1);
  flushFolds(db, { all: true });
  assert.equal(verifyChain(db, ws).ok, true);
});

test('A1: token reads are folded per token, route and status; the next window gets its own row and the summary carries the count and the token id', async () => {
  const { app, db, creds } = await freshApp({ tokenCallsPerMinute: 100000 });
  const R = creds.svc.read.token;
  for (let i = 0; i < 200; i++) assert.equal((await app.inject({ url: '/api/v1/read/projects', headers: { authorization: `Bearer ${R}` } })).statusCode, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(rows(db, 'api.call').length, 1, 'two hundred identical reads, one row');
  flushFolds(db, { all: true });
  const s = rows(db, 'api.calls_repeated');
  assert.equal(s.length, 1); const after = JSON.parse(s[0].after_json);
  assert.deepEqual([after.moreCalls, after.status, after.windowSeconds], [199, 200, 300]);
  assert.match(after.tokenId, /^[0-9a-f-]{36}$/, 'the token id, which names the token without being it');
  // a different route is its own row; a refusal is its own row
  await app.inject({ url: '/api/v1/read/tasks?job_number=J1', headers: { authorization: `Bearer ${R}` } });
  await app.inject({ url: '/api/v1/members', headers: { authorization: `Bearer ${R}` } });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(rows(db, 'api.call').length, 2); assert.equal(rows(db, 'api.denied').length, 1);
});

test('A1: appending to the audit chain uses an index and no longer sorts the whole workspace', () => {
  const { db } = freshDb();
  const plan = db.prepare('explain query plan select hash from audit_events where workspace_id = ? order by seq desc limit 1').all('x').map((r) => r.detail).join(' | ');
  assert.match(plan, /audit_workspace_seq/); assert.doesNotMatch(plan, /TEMP B-TREE/);
});

// ---------------------------------------------------------------- A2
test('A2: reset links, invite links and form addresses never reach the application log; the route pattern does', async () => {
  const lines = [];
  const { app, call, db, creds } = await freshApp({ logger: { level: 'trace', stream: { write: (l) => lines.push(l) } } });
  const secrets = ['RESETSECRET1234567890abcdefghijklmnopqrstuv', 'INVITESECRET1234567890abcdefghijklmnopqrstu', 'FORMSLUGSECRET-abcdefghij'];
  await app.inject({ url: `/api/v1/resets/${secrets[0]}` });
  await app.inject({ method: 'POST', url: `/api/v1/resets/${secrets[0]}/complete`, payload: { password: 'a long enough phrase 1' } });
  await app.inject({ url: `/api/v1/invites/${secrets[1]}` });
  await app.inject({ method: 'POST', url: `/api/v1/invites/${secrets[1]}/accept`, payload: { name: 'N', password: 'a long enough phrase 1' } });
  await app.inject({ url: `/api/v1/public/forms/${secrets[2]}` });
  await app.inject({ method: 'POST', url: `/api/v1/public/forms/${secrets[2]}/submit`, payload: { answers: {} } });
  await app.inject({ url: `/api/v1/some/unknown/path/${secrets[2]}` });
  // a real, valid link too
  const reset = (await call('admin', 'POST', `/api/v1/members/${creds.guest.userId}/reset`)).json();
  await app.inject({ url: `/api/v1/resets/${tokenOf(reset.link)}` });
  await app.inject({ url: `/api/v1/projects/${creds.projects.pub}` });
  const log = lines.join('');
  for (const s of [...secrets, tokenOf(reset.link), creds.projects.pub]) assert.ok(!log.includes(s), `the log holds ${s.slice(0, 12)}...`);
  assert.match(log, /\/api\/v1\/resets\/:token/); assert.match(log, /\/api\/v1\/invites\/:token/); assert.match(log, /\/api\/v1\/public\/forms\/:slug/);
  assert.match(log, /"route":"\/\*"/);   // an unknown address is logged as the catch-all route, not as what was asked for
  assert.doesNotMatch(log, /"url":"\/api/);
});

// ---------------------------------------------------------------- A3
test('A3: restore --replace keeps the crashed database whole: its write-ahead log moves with it and the committed rows are still there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wal-'));
  try {
    const live = join(dir, 'live.db');
    const crash = spawnSync(process.execPath, ['--no-warnings', '-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(live)});
      db.exec('pragma journal_mode = wal; pragma wal_autocheckpoint = 0; create table t(x); ');
      db.exec('pragma wal_checkpoint(truncate)');
      for (let i = 0; i < 50; i++) db.prepare('insert into t values (?)').run(i);
      process.kill(process.pid, 'SIGKILL');`], { encoding: 'utf8' });
    assert.equal(crash.signal, 'SIGKILL');
    assert.ok(existsSync(`${live}-wal`) && statSync(`${live}-wal`).size > 0, 'the newest rows exist only in the log');
    const good = openDb(join(dir, 'src', 'app.db')); migrate(good);
    const key = randomBytes(32), dest = new LocalDirDestination(join(dir, 'dest'));
    const { name } = await runBackup(good, { key, destination: dest });
    const r = await runRestore({ key, destination: dest, from: name, confirm: name, to: live, replace: true, now: () => 'T1' });
    assert.ok(existsSync(`${r.kept}-wal`), 'the log was kept with its file');
    assert.ok(!existsSync(`${live}-wal`) && !existsSync(`${live}-shm`), 'the restored file does not inherit it');
    const kept = new DatabaseSync(r.kept, { readOnly: false });
    assert.equal(kept.prepare('select count(*) n from t').get().n, 50, 'every committed row is in the kept copy');
    kept.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- A4, A5, A8
test('A4: concurrent wrong guesses cannot get around the lock-out', async () => {
  const { db, creds } = freshDb();
  const ctx = ctxOf(db);
  const rs = await Promise.all(Array.from({ length: 30 }, () => signIn(ctx, { email: creds.viewonly.email, password: 'wrong-password-9' })));
  const wrong = rs.filter((r) => r.status === 401).length;
  assert.ok(wrong <= MAX_FAILURES - 1, `${wrong} guesses were answered as ordinary failures`);
  assert.ok(rs.filter((r) => r.status === 429).length >= 30 - (MAX_FAILURES - 1));
  assert.equal(rows(db, 'auth.locked').length, 1, 'locked once');
  const right = await signIn(ctx, { email: creds.viewonly.email, password: creds.viewonly.password });
  assert.deepEqual([right.ok, right.status], [false, 429], 'the right password is refused while locked');
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('A4: a correct password that finishes after the account was locked by a burst is refused', async () => {
  const { db, creds } = freshDb();
  const ctx = ctxOf(db);
  const burst = Array.from({ length: MAX_FAILURES + 3 }, () => signIn(ctx, { email: creds.guest.email, password: 'wrong-password-9' }));
  const right = signIn(ctx, { email: creds.guest.email, password: creds.guest.password });
  const [r] = await Promise.all([right, ...burst]);
  assert.equal(r.ok, false, 'the lock decided while the correct password was being checked still wins');
});

test('A5: guessing the current password on a password change counts against the same lock-out as signing in', async () => {
  const { app, call, db, creds } = await freshApp({ signinPerMinute: 1000 });
  const guess = (cur) => call('member', 'POST', '/api/v1/auth/password', { current: cur, next: 'a perfectly fine new phrase' });
  const codes = [];
  for (let i = 0; i < MAX_FAILURES; i++) codes.push((await guess('wrong-current-1')).statusCode);
  assert.deepEqual(codes, [403, 403, 403, 403, 429], 'four refusals, the fifth locks');
  assert.equal(db.prepare('select locked_until l from users where email = ?').get(creds.member.email).l !== null, true);
  assert.equal((await guess(creds.member.password)).statusCode, 429, 'even the right password is refused while locked');
  assert.equal((await signin(app, { email: creds.member.email, password: creds.member.password })).statusCode, 429, 'and so is signing in: one shared counter');
  assert.equal(rows(db, 'auth.locked').length, 1);
  // success resets the count
  const { call: call2, db: db2, creds: c2 } = await freshApp();
  for (let i = 0; i < 3; i++) await call2('admin', 'POST', '/api/v1/auth/password', { current: 'nope-nope-nope-1', next: 'a perfectly fine new phrase' });
  assert.equal(db2.prepare('select failed_logins n from users where email = ?').get(c2.admin.email).n, 3);
  assert.equal((await call2('admin', 'POST', '/api/v1/auth/password', { current: c2.admin.password, next: 'a perfectly fine new phrase' })).statusCode, 200);
  assert.equal(db2.prepare('select failed_logins n from users where email = ?').get(c2.admin.email).n, 0);
});

test('A8: a locked real account takes about as long to answer as an unknown email, so timing does not tell them apart', async () => {
  const saved = currentCost();
  setPasswordCost({ N: 8192, r: 8, p: 1 });
  try {
    const { db, creds } = freshDb();
    const ctx = ctxOf(db);
    for (let i = 0; i < MAX_FAILURES; i++) await signIn(ctx, { email: creds.member2.email, password: 'wrong-password-1' });
    const time = async (email) => { const t = []; for (let i = 0; i < 5; i++) { const s = process.hrtime.bigint(); await signIn(ctx, { email, password: 'wrong-password-1' }); t.push(Number(process.hrtime.bigint() - s) / 1e6); } return t.sort((a, b) => a - b)[2]; };
    const locked = await time(creds.member2.email), unknown = await time('nobody@example.test');
    assert.ok(locked > unknown * 0.5, `locked ${locked.toFixed(1)} ms against unknown ${unknown.toFixed(1)} ms`);
  } finally { setPasswordCost(saved); }
});

// ---------------------------------------------------------------- A6
test('A6: issuing a reset ends the person\'s sessions at once', async () => {
  const { call, creds } = await freshApp();
  assert.equal((await call('member2', 'GET', '/api/v1/auth/session')).statusCode, 200);
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/reset`)).statusCode, 201);
  assert.equal((await call('member2', 'GET', '/api/v1/auth/session')).statusCode, 401, 'their old session no longer works');
});

test('A6: deactivating a person ends every session, blocks sign-in, hides them from pickers, and follows the rules', async () => {
  const { app, call, db, creds } = await freshApp({ signinPerMinute: 1000 });
  assert.equal((await call('leaver', 'GET', '/api/v1/auth/session')).statusCode, 200);
  assert.equal((await call('member', 'POST', `/api/v1/members/${creds.leaver.userId}/deactivate`)).statusCode, 403, 'a member cannot');
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.leaver.userId}/deactivate`)).statusCode, 200);
  assert.equal((await call('leaver', 'GET', '/api/v1/auth/session')).statusCode, 401, 'signed out at once');
  assert.equal(db.prepare('select count(*) n from sessions where user_id = ? and revoked_at is null').get(creds.leaver.userId).n, 0, 'every session row is marked ended, not just blocked by the status');
  assert.equal((await signin(app, { email: creds.leaver.email, password: creds.leaver.password })).statusCode, 401, 'cannot sign in again');
  const list = (await call('admin', 'GET', '/api/v1/members')).json().members.find((m) => m.userId === creds.leaver.userId);
  assert.equal(list.status, 'deactivated');
  assert.ok(!(await call('member', 'GET', `/api/v1/projects/${creds.projects.pub}/people`)).json().people.some((p) => p.userId === creds.leaver.userId), 'not offered as an assignee');
  assert.equal((await call('admin', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { assigneeId: creds.leaver.userId })).statusCode, 400, 'cannot be assigned work');
  const ev = rows(db, 'member.deactivate')[0];
  assert.deepEqual(JSON.parse(ev.after_json), { role: 'member' }); assert.doesNotMatch(JSON.stringify(ev), /ellis|marsh|@/i);
  // rules
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.admin.userId}/deactivate`)).statusCode, 400, 'not yourself');
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.owner.userId}/deactivate`)).statusCode, 403, 'an admin cannot deactivate an owner');
  assert.equal((await call('owner', 'POST', `/api/v1/members/${creds.outsider.userId}/deactivate`)).statusCode, 404, 'not someone in another workspace');
  db.prepare("insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values ('mx', ?, ?, 'member','t','t')").run(creds.workspaces.other, creds.member2.userId);
  assert.equal((await call('owner', 'POST', `/api/v1/members/${creds.member2.userId}/deactivate`)).statusCode, 409, 'not someone who is in two workspaces');
  // an owner can be deactivated by another owner (the actor is then still an active owner, so the workspace is never left without one)
  await call('owner', 'PATCH', `/api/v1/members/${creds.admin.userId}/role`, { role: 'owner' });
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.owner.userId}/deactivate`)).statusCode, 200, 'with a second owner it is allowed');
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

// ---------------------------------------------------------------- A7
test('A7: audit rows say which token acted, and still never hold a token or its hash', async () => {
  const { call, db, creds } = await freshApp();
  const acct = (await call('admin', 'POST', '/api/v1/service-accounts', { name: 'Review account' })).json();
  const made = (await call('admin', 'POST', `/api/v1/service-accounts/${acct.id}/tokens`, { label: 'one', scopes: ['tasks:read'] })).json();
  const made2 = (await call('admin', 'POST', `/api/v1/service-accounts/${acct.id}/tokens`, { label: 'two', scopes: ['tasks:read'] })).json();
  await call('admin', 'DELETE', `/api/v1/service-accounts/${acct.id}/tokens/${made2.id}`);
  const created = rows(db, 'service_token.create').map((r) => JSON.parse(r.after_json).tokenId), revoked = rows(db, 'service_token.revoke').map((r) => JSON.parse(r.after_json).tokenId);
  assert.deepEqual(created, [made.id, made2.id]); assert.deepEqual(revoked, [made2.id], 'the log shows which token was revoked');
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes(made.token.slice(4)) && !dump.includes(made2.token.slice(4)));
  assert.deepEqual(redact({ tokenId: 'abc', token: 'secret', token_hash: 'h', apiToken: 'x', password: 'p', tokenIds: 1 }), { tokenId: 'abc', token: '[redacted]', token_hash: '[redacted]', apiToken: '[redacted]', password: '[redacted]', tokenIds: '[redacted]' });
});

// ---------------------------------------------------------------- A12, A13
test('A12: updated_since given to the second includes rows updated within that second', async () => {
  const { app, db, creds } = await freshApp();
  db.prepare("update tasks set updated_at = '2030-05-05T12:00:00.793Z' where id = ?").run(creds.tasks.a);
  const get = (q) => app.inject({ url: `/api/v1/read/tasks?${q}`, headers: { authorization: `Bearer ${creds.svc.read.token}` } });
  // the seed task is in a staff project, which the read token never sees: make an ingested one instead
  const post = await app.inject({ method: 'POST', url: '/api/v1/ingest/tasks', headers: { authorization: `Bearer ${creds.svc.write.token}` }, payload: { idempotency_key: 'a12-key-123456', context: 'client_job', client_slug: 'a12-client', job_number: 'J12', title: 'Ingested for A12' } });
  const id = post.json().id;
  db.prepare("update tasks set updated_at = '2030-05-05T12:00:00.793Z' where id = ?").run(id);
  assert.deepEqual((await get('updated_since=2030-05-05T12:00:00Z')).json().tasks.map((t) => t.id), [id], 'same second, earlier millisecond');
  assert.deepEqual((await get('updated_since=2030-05-05T12:00:00.793Z')).json().tasks.map((t) => t.id), [id]);
  assert.deepEqual((await get('updated_since=2030-05-05T12:00:00.794Z')).json().tasks, []);
  assert.deepEqual((await get('updated_since=2030-05-05T12:00:01Z')).json().tasks, []);
});

test('A13: only accepted submissions count toward the form\'s hourly cap, so rejected posts cannot shut the form', async () => {
  const { app, creds } = await freshApp({ formPerMinute: 1000, formPerHour: 3 });
  const slug = creds.forms.slug;
  const qs = (await app.inject(`/api/v1/public/forms/${slug}`)).json().questions;
  const title = qs.find((q) => q.label === 'What do you need help with?').id;
  for (let i = 0; i < 30; i++) assert.equal((await app.inject({ method: 'POST', url: `/api/v1/public/forms/${slug}/submit`, payload: { answers: {} } })).statusCode, 400);
  const ok = async (n) => (await app.inject({ method: 'POST', url: `/api/v1/public/forms/${slug}/submit`, payload: { answers: { [title]: `Real request ${n}` } } })).statusCode;
  assert.deepEqual([await ok(1), await ok(2), await ok(3), await ok(4)], [200, 200, 200, 429], 'three accepted, then the cap');
});

// ---------------------------------------------------------------- A14
test('A14: the seed never deletes an existing database unless told to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-'));
  try {
    const env = { ...process.env, DB_PATH: join(dir, 'app.db'), DEMO_CREDENTIALS_FILE: join(dir, 'creds.txt') };
    const run = (...a) => spawnSync(process.execPath, ['--no-warnings', 'app/seed/seed.js', ...a], { env, encoding: 'utf8' });
    assert.equal(run().status, 0, 'a new file is created');
    const before = readFileSync(join(dir, 'app.db'));
    const again = run();
    assert.equal(again.status, 1); assert.match(again.stderr, /already exists, so the seed did nothing/); assert.match(again.stderr, /--force/);
    assert.ok(readFileSync(join(dir, 'app.db')).equals(before), 'the existing database was not touched');
    const forced = run('--force');
    assert.equal(forced.status, 0, forced.stderr);
    assert.ok(!readFileSync(join(dir, 'app.db')).equals(before), 'with --force it was recreated');
    assert.ok(!existsSync(join(process.cwd(), '.local', 'zz-never')), 'sanity');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- A15
test('A15: break-glass unlock clears a lock from the command line and is recorded with ids only', async () => {
  const { app, db, creds } = await freshApp({ signinPerMinute: 1000 });
  for (let i = 0; i < MAX_FAILURES; i++) await signin(app, { email: creds.owner.email, password: 'wrong-password-1' });
  assert.equal((await signin(app, { email: creds.owner.email, password: creds.owner.password })).statusCode, 429, 'the only owner is locked out');
  assert.deepEqual(unlockAccount(db, { email: creds.owner.email.toUpperCase() }), { wasLocked: true });
  assert.equal((await signin(app, { email: creds.owner.email, password: creds.owner.password })).statusCode, 200, 'and can sign in again');
  const ev = rows(db, 'member.unlock').at(-1);
  assert.equal(ev.actor_kind, 'system'); assert.equal(ev.target_id, creds.owner.userId); assert.doesNotMatch(JSON.stringify(ev), /avery|quinn|@example/i);
  for (const bad of ['nobody@example.test', '', creds.leaver.email]) {
    if (bad === creds.leaver.email) db.prepare("update users set status = 'deactivated' where id = ?").run(creds.leaver.userId);
    assert.throws(() => unlockAccount(db, { email: bad }), RefusedError);
  }
});

test('A15: break-glass reset makes a one-time link that works once, ends their sessions, and is recorded', async () => {
  const { app, call, db, creds } = await freshApp();
  assert.equal((await call('owner', 'GET', '/api/v1/auth/session')).statusCode, 200);
  const r = issueResetLink(db, { email: creds.owner.email });
  assert.match(r.path, /^\/#\/reset\/[A-Za-z0-9_-]{43}$/);
  assert.equal((await call('owner', 'GET', '/api/v1/auth/session')).statusCode, 401, 'their sessions were ended');
  const token = tokenOf(r.path);
  assert.equal((await app.inject(`/api/v1/resets/${token}`)).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/resets/${token}/complete`, payload: { password: 'my brand new passphrase' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/resets/${token}/complete`, payload: { password: 'another new passphrase' } })).statusCode, 404, 'works once');
  assert.equal((await signin(app, { email: creds.owner.email, password: 'my brand new passphrase' })).statusCode, 200);
  const ev = rows(db, 'member.reset_issued').at(-1);
  assert.equal(ev.actor_kind, 'system'); assert.doesNotMatch(JSON.stringify(ev) + db.prepare('select token_hash from password_resets').all().map((x) => x.token_hash).join(), new RegExp(token));
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('A15: the break-glass command line refuses to print a link into a pipe, and refuses a bad command or an unknown person', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bg-'));
  try {
    const db = openDb(join(dir, 'app.db')); migrate(db);
    db.exec("insert into workspaces(id,name,slug,created_at,updated_at) values ('w','W','w','t','t'); insert into users(id,email,name,kind,status,password_hash,created_at,updated_at) values ('u','owner@example.test','O','human','active','scrypt$1024$8$1$QUJD$QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=','t','t'); insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values ('m','w','u','owner','t','t')");
    db.close();
    const env = { ...process.env, DB_PATH: join(dir, 'app.db'), PUBLIC_URL: 'https://tasks.example.test' };
    const run = (...a) => spawnSync(process.execPath, ['--no-warnings', 'app/cli/break-glass.js', ...a], { env, encoding: 'utf8' });
    const piped = run('reset', '--email', 'owner@example.test');
    assert.equal(piped.status, 1); assert.match(piped.stderr, /run this in a terminal/); assert.equal(piped.stdout, '');
    const ok = run('reset', '--email', 'owner@example.test', '--allow-non-tty');
    assert.equal(ok.status, 0, ok.stderr); assert.match(ok.stdout, /https:\/\/tasks\.example\.test\/#\/reset\/[A-Za-z0-9_-]{43}/); assert.equal((ok.stdout.match(/#\/reset\//g) || []).length, 1, 'shown once');
    assert.equal(run('unlock', '--email', 'owner@example.test').status, 0);
    assert.equal(run('unlock', '--email', 'ghost@example.test').status, 1);
    assert.equal(run('explode').status, 1); assert.equal(run('unlock').status, 1); assert.equal(run('unlock', '--email').status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- the two small S4 items that were asked for
test('an https address is required in production, and an all-zero or patterned backup key is refused', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /PUBLIC_URL must be set to the public https address/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'http://tasks.example.test' }), /https/);
  assert.equal(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test' }).cookieSecure, true);
  assert.equal(loadConfig({}).cookieSecure, false, 'development on localhost is unchanged');
  for (const bad of ['0'.repeat(64), 'ab'.repeat(32), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', '0123456789abcdef'.repeat(4).slice(0, 62) + '00', 'ff'.repeat(16) + '00'.repeat(16)]) assert.throws(() => keyFrom(bad), /BackupError|looks made up|32 bytes/, bad);
  assert.equal(keyFrom(randomBytes(32).toString('hex')).length, 32);
});

// ---------------------------------------------------------------- A16
test('A16: a password chosen for someone must be replaced at the first sign-in, and nothing else works until it is', async () => {
  const { app, call, db, creds } = await freshApp({ signinPerMinute: 1000 });
  const made = (await call('admin', 'POST', '/api/v1/members', { name: 'New Person', email: 'new.person@example.test', role: 'member' })).json();
  const login = await signin(app, { email: 'new.person@example.test', password: made.temporaryPassword });
  assert.equal(login.statusCode, 200); assert.equal(login.json().mustChangePassword, true);
  const headers = { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  const ask = (method, url, payload) => app.inject({ method, url, payload, headers });
  for (const [m, u] of [['GET', '/api/v1/projects'], ['GET', '/api/v1/me/tasks'], ['GET', `/api/v1/projects/${creds.projects.pub}/tasks`], ['POST', `/api/v1/projects/${creds.projects.pub}/tasks`], ['GET', '/api/v1/workspace']]) {
    const r = await ask(m, u, m === 'POST' ? { title: 'x' } : undefined);
    assert.equal(r.statusCode, 403, `${m} ${u}`); assert.equal(r.json().mustChangePassword, true);
  }
  const s = await ask('GET', '/api/v1/auth/session'); assert.equal(s.statusCode, 200); assert.equal(s.json().mustChangePassword, true);
  assert.equal((await ask('POST', '/api/v1/auth/password', { current: made.temporaryPassword, next: 'password1234' })).statusCode, 400, 'the new password still has to pass the rules');
  assert.equal((await ask('POST', '/api/v1/auth/password', { current: made.temporaryPassword, next: 'a phrase of my own choosing' })).statusCode, 200);
  assert.equal((await ask('GET', '/api/v1/projects')).statusCode, 200, 'everything works once they have chosen');
  assert.equal((await ask('GET', '/api/v1/auth/session')).json().mustChangePassword, false);
  assert.equal((await signin(app, { email: 'new.person@example.test', password: 'a phrase of my own choosing' })).json().mustChangePassword, false);
  // a person who was never given a temporary password is not affected; nor is one who set their own through an invite or a reset link
  assert.equal(db.prepare('select must_change_password n from users where email = ?').get(creds.member.email).n, 0);
});

test('A16: a temporary password that was never used stops working after seven days, and the owner made by the command line must also choose their own', async () => {
  const { app, call, db } = await freshApp({ signinPerMinute: 1000 });
  const made = (await call('admin', 'POST', '/api/v1/members', { name: 'Late Person', email: 'late.person@example.test', role: 'member' })).json();
  const row = db.prepare('select password_expires_at e from users where id = ?').get(made.userId);
  const days = (Date.parse(row.e) - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1, `expires in ${days} days`);
  db.prepare('update users set password_expires_at = ? where id = ?').run(new Date(Date.now() - 1000).toISOString(), made.userId);
  const r = await signin(app, { email: 'late.person@example.test', password: made.temporaryPassword });
  assert.equal(r.statusCode, 401); assert.match(r.json().error, /expired/); assert.equal(r.cookies.length, 0, 'no session');
  assert.equal((await call('admin', 'POST', `/api/v1/members/${made.userId}/reset`)).statusCode, 201, 'an admin can issue a reset link instead');
  // first-owner command
  const db2 = openDb(':memory:'); migrate(db2);
  return import('../cli/first-owner.js').then(({ createFirstOwner }) => {
    const o = createFirstOwner(db2, { workspace: 'W', name: 'Owner', email: 'owner.cli@example.test' });
    assert.equal(db2.prepare('select must_change_password n from users where id = ?').get(o.userId).n, 1);
  });
});
