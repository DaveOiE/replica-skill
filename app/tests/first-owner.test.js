import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDb, migrate } from '../server/db.js';
import { createFirstOwner, RefusedError } from '../cli/first-owner.js';
import { buildApp } from '../server/app.js';
import { verifyChain } from '../server/audit.js';
import { freshDb } from './helpers.js';

const args = { workspace: 'Test Support Co', name: 'Pat Example', email: 'Pat.Example@Example.test' };
const empty = () => { const db = openDb(':memory:'); migrate(db); return db; };

test('creates the first owner on an empty database; the generated password works once and is stored only as a hash', async () => {
  const db = empty();
  const r = createFirstOwner(db, args);
  assert.equal(r.email, 'pat.example@example.test');
  assert.ok(r.password.length >= 20);
  const u = db.prepare('select * from users where id = ?').get(r.userId);
  assert.match(u.password_hash, /^scrypt\$/);
  assert.ok(!JSON.stringify(db.prepare('select * from users').all()).includes(r.password), 'no plain password in the database');
  assert.equal(db.prepare("select count(*) n from memberships where role = 'owner'").get().n, 1);
  const app = await buildApp({ db });
  const ok = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: args.email, password: r.password } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().role, 'owner');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: args.email, password: `${r.password}x` } })).statusCode, 401);
});

test('the password and personal details never reach the audit trail', () => {
  const db = empty();
  const r = createFirstOwner(db, args);
  const rows = db.prepare('select * from audit_events').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'workspace.first_owner');
  const text = JSON.stringify(rows).toLowerCase();
  for (const secret of [r.password, 'pat.example', 'pat example', 'test support']) assert.ok(!text.includes(secret.toLowerCase()), `audit row contains ${secret}`);
  assert.equal(verifyChain(db, r.workspaceId).ok, true);
});

test('refuses when an owner already exists (demo data, or a second run) and changes nothing', () => {
  const db = empty();
  createFirstOwner(db, args);
  const before = JSON.stringify([db.prepare('select count(*) n from users').get(), db.prepare('select count(*) n from audit_events').get()]);
  assert.throws(() => createFirstOwner(db, { ...args, email: 'second@example.test', workspace: 'Another' }), (e) => e instanceof RefusedError && /already has an owner/.test(e.message));
  assert.equal(JSON.stringify([db.prepare('select count(*) n from users').get(), db.prepare('select count(*) n from audit_events').get()]), before);
  const seeded = freshDb().db;
  assert.throws(() => createFirstOwner(seeded, args), /already has an owner/);
});

test('refuses bad input before touching anything', () => {
  for (const bad of [{ ...args, workspace: '' }, { ...args, name: '  ' }, { ...args, email: 'not-an-email' }, { ...args, slug: 'Bad Slug!' }, { ...args, workspace: 'x'.repeat(81) }]) {
    const db = empty();
    assert.throws(() => createFirstOwner(db, bad), RefusedError);
    assert.equal(db.prepare('select count(*) n from users').get().n, 0);
  }
});

test('the command line: shows the password once on a terminal, refuses a pipe, refuses a second run, leaves no password on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-cli-'));
  try {
    const env = { ...process.env, DB_PATH: join(dir, 'db', 'app.db') };
    const run = (extra = []) => spawnSync(process.execPath, ['--no-warnings', 'app/cli/first-owner.js', '--workspace', 'Cli Co', '--name', 'Cli Owner', '--email', 'cli.owner@example.test', ...extra], { env, encoding: 'utf8' });
    const piped = run();
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /run this in a terminal/);
    assert.equal(piped.stdout, '');
    const ok = run(['--allow-non-tty']);
    assert.equal(ok.status, 0, ok.stderr);
    const password = /Password:\s+(\S+)/.exec(ok.stdout)[1];
    assert.equal(ok.stdout.split(password).length - 1, 1, 'shown exactly once');
    assert.equal(ok.stderr, '');
    const again = run(['--allow-non-tty']);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already has an owner/);
    assert.ok(!again.stdout.includes(password) && !again.stderr.includes(password));
    for (const f of readdirSync(join(dir, 'db'))) assert.ok(!readFileSync(join(dir, 'db', f)).includes(password), `${f} contains the password`);
    assert.equal(run(['--bogus']).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
