import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, openDbOrExplain, migrate, transaction, MIGRATIONS_DIR, nowIso, newId } from '../server/db.js';
import { hashPassword, verifyPassword, checkPasswordRules } from '../server/password.js';
import { appendAudit, verifyChain, mutate, redact, GENESIS } from '../server/audit.js';
import { freshDb } from './helpers.js';

test('migrations apply once, in order, and are recorded', () => {
  const db = openDb(':memory:');
  assert.deepEqual(migrate(db), readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort());
  assert.deepEqual(migrate(db), [], 'second run applies nothing');
  assert.equal(db.prepare("select count(*) n from sqlite_master where type = 'table'").get().n >= 46, true);
  assert.equal(db.prepare('pragma foreign_keys').get().foreign_keys, 1);
});

test('the first migration is exactly the documented schema', () => {
  const doc = readFileSync(join(MIGRATIONS_DIR, '..', '..', 'replica', 'schema.sql'), 'utf8');
  assert.equal(readFileSync(join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8'), doc);
  assert.ok(readdirSync(MIGRATIONS_DIR).every((f) => /^\d{4}_.+\.sql$/.test(f)));
});

test('a failing migration rolls back completely', () => {
  const db = openDb(':memory:');
  const dir = join(MIGRATIONS_DIR, '..', '..', '.local', 'bad-migration');
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, '0001_bad.sql'), 'create table a(x); this is not sql;');
    assert.throws(() => migrate(db, dir), /migration 0001_bad.sql failed/);
    assert.equal(db.prepare("select count(*) n from sqlite_master where name = 'a'").get().n, 0);
    assert.equal(db.prepare('select count(*) n from schema_migrations').get().n, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passwords: scrypt hash verifies, wrong one does not, hashes are salted', () => {
  const h1 = hashPassword('correct horse battery'), h2 = hashPassword('correct horse battery');
  assert.notEqual(h1, h2);
  assert.ok(h1.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct horse battery', h1), true);
  assert.equal(verifyPassword('wrong', h1), false);
  assert.equal(verifyPassword('x', 'not-a-hash'), false);
  assert.equal(checkPasswordRules('short').length, 1);
  assert.equal(checkPasswordRules('long enough password').length, 0);
});

test('seed: fake people only, two workspaces, no password stored in plain text', () => {
  const { db, creds } = freshDb();
  const users = db.prepare('select email, password_hash from users').all();
  assert.equal(users.length, 7);
  for (const u of users) {
    assert.match(u.email, /@example\.test$/, 'only reserved example.test addresses');
    assert.ok(u.password_hash.startsWith('scrypt$'));
  }
  assert.equal(db.prepare('select count(*) n from workspaces').get().n, 2);
  assert.ok(Object.values(creds).filter((c) => c.password).every((c) => verifyPassword(c.password, users.find((u) => u.email === c.email).password_hash)));
});

test('audit: chain appends, verifies, and detects tampering', () => {
  const { db, creds } = freshDb();
  const ws = creds.workspaces.demo;
  appendAudit(db, { workspaceId: ws, actorKind: 'user', actorId: creds.admin.userId, action: 'x.one', summary: 'one' });
  appendAudit(db, { workspaceId: ws, actorKind: 'user', actorId: creds.admin.userId, action: 'x.two', summary: 'two', before: { a: 1 }, after: { a: 2 } });
  assert.deepEqual(verifyChain(db, ws), { ok: true, checked: 3, brokenAtSeq: null }); // seed row + 2
  const first = db.prepare('select prev_hash from audit_events where workspace_id = ? order by seq limit 1').get(ws);
  assert.equal(first.prev_hash, GENESIS);
  // The database refuses edits and deletes outright...
  assert.throws(() => db.exec("update audit_events set summary = 'forged'"), /append-only/);
  assert.throws(() => db.exec('delete from audit_events'), /append-only/);
  // ...and if someone with file access drops the trigger and edits anyway, verify finds the row.
  db.exec('drop trigger audit_no_update');
  db.exec("update audit_events set summary = 'forged' where action = 'x.one'");
  const v = verifyChain(db, ws);
  assert.equal(v.ok, false);
  assert.ok(v.brokenAtSeq > 0);
});

test('audit: chains are per workspace and redaction hides secrets', () => {
  const { db, creds } = freshDb();
  assert.equal(verifyChain(db, creds.workspaces.other).ok, true);
  assert.deepEqual(redact({ name: 'a', password_hash: 'x', nested: { apiToken: 'y', ok: 1 } }),
    { name: 'a', password_hash: '[redacted]', nested: { apiToken: '[redacted]', ok: 1 } });
});

test('mutate: change and audit row commit together, or neither does', () => {
  const { db, creds } = freshDb();
  const ctx = { db, actor: { userId: creds.admin.userId, workspaceId: creds.workspaces.demo, kind: 'user' }, ip: '127.0.0.1', requestId: 'r1' };
  const count = () => db.prepare('select count(*) n from audit_events').get().n;
  const before = count();
  mutate(ctx, { action: 'workspace.update', targetType: 'workspace', targetId: ctx.actor.workspaceId, summary: 's' },
    () => db.prepare('update workspaces set name = ? where id = ?').run('Renamed', ctx.actor.workspaceId));
  assert.equal(count(), before + 1);
  assert.throws(() => mutate(ctx, { action: 'boom', summary: 's' }, () => {
    db.prepare('update workspaces set name = ? where id = ?').run('Should roll back', ctx.actor.workspaceId);
    throw new Error('fail');
  }), /fail/);
  assert.equal(count(), before + 1, 'no audit row for a failed change');
  assert.equal(db.prepare('select name from workspaces where id = ?').get(ctx.actor.workspaceId).name, 'Renamed');
  assert.throws(() => transaction(db, async () => {}), /synchronous/);
});

test('a database folder that cannot be used gives a plain explanation, not a bare database error', () => {
  const blocker = join(MIGRATIONS_DIR, '..', '..', '.local', 'not-a-folder');
  mkdirSync(join(blocker, '..'), { recursive: true });
  writeFileSync(blocker, 'a file where a folder should be');
  try {
    assert.throws(() => openDbOrExplain(join(blocker, 'app.db')), (e) => /Could not open the database at/.test(e.message) && /folder is one you can write to/.test(e.message) && /System32/.test(e.message) && /DB_PATH/.test(e.message));
  } finally { rmSync(blocker, { force: true }); }
});
