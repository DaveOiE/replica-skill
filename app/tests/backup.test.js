import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, migrate } from '../server/db.js';
import { seedDemo } from '../seed/seed.js';
import { buildApp } from '../server/app.js';
import { verifyChain } from '../server/audit.js';
import { keyFrom, destinationFrom, LocalDirDestination, runBackup, runRestore, checkDatabase, tableCounts, encryptFile, decryptFile, BackupError } from '../server/backup.js';

const MARK = 'zqxbackupmark';
const KEY = randomBytes(32);
const tmp = () => mkdtempSync(join(tmpdir(), 'bk-'));

/** A real file database in WAL mode with the fake demo data, as a live instance would be. */
function liveDb(dir) {
  const db = openDb(join(dir, 'live', 'app.db'));
  migrate(db);
  const creds = seedDemo(db);
  db.prepare("update tasks set description = ? where id = ?").run(`${MARK} secret client note`, creds.tasks.a);
  return { db, creds };
}
const chainsOf = (db) => db.prepare('select id from workspaces order by id').all().map((w) => [w.id, verifyChain(db, w.id)]);

test('backup, then restore to a new file: same row counts in every table and the audit chain still verifies', async () => {
  const dir = tmp();
  try {
    const { db, creds } = liveDb(dir);
    const app = await buildApp({ db });
    const cookie = (await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } })).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: `/api/v1/projects/${creds.projects.pub}/tasks`, headers: { cookie }, payload: { title: `Real activity ${i}` } });
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const r = await runBackup(db, { key: KEY, destination: dest, kind: 'daily' });
    assert.match(r.name, /^backup-daily-\d{8}T\d{6}Z\.db\.gz\.enc$/);
    assert.deepEqual(await dest.list('backup-'), [r.name]);
    const out = join(dir, 'restored', 'app.db');
    const x = await runRestore({ key: KEY, destination: dest, from: r.name, to: out });
    const restored = new DatabaseSync(out, { readOnly: true });
    assert.deepEqual(tableCounts(restored), tableCounts(db), 'every table has the same number of rows');
    assert.deepEqual(x.counts, r.counts);
    assert.ok(tableCounts(restored).audit_events > 5 && tableCounts(restored).tasks > 3, 'it is not an empty comparison');
    assert.deepEqual(chainsOf(restored), chainsOf(db));
    assert.ok(chainsOf(restored).every(([, c]) => c.ok && c.checked > 0));
    assert.equal(restored.prepare('select description from tasks where description like ?').get(`${MARK}%`).description, `${MARK} secret client note`);
    assert.equal(restored.prepare('pragma integrity_check').get().integrity_check, 'ok');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('no downtime: the app keeps answering and writing while a backup runs, and the copy is consistent', async () => {
  const dir = tmp();
  try {
    const { db, creds } = liveDb(dir);
    const app = await buildApp({ db });
    const signin = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } });
    const cookie = signin.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const backups = [];
    const writes = [];
    for (let i = 0; i < 6; i++) {
      backups.push(runBackup(db, { key: KEY, destination: dest, kind: 'manual', now: () => `20300101T00000${i}Z` }));
      for (let j = 0; j < 5; j++) writes.push(app.inject({ method: 'POST', url: `/api/v1/projects/${creds.projects.pub}/tasks`, headers: { cookie }, payload: { title: `during backup ${i}-${j}` } }));
      await new Promise((r) => setImmediate(r));
    }
    const codes = (await Promise.all(writes)).map((r) => r.statusCode);
    assert.ok(codes.every((c) => c === 201), `writes during backup: ${codes.join(',')}`);
    const results = await Promise.all(backups);
    assert.equal(results.length, 6);
    for (const r of results) {
      const out = join(dir, `r-${r.name}.db`);
      await runRestore({ key: KEY, destination: dest, from: r.name, to: out });
      const c = checkDatabase(out);
      assert.equal(c.ok, true, c.problems.join('; '));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the encrypted file reveals nothing, and a wrong key, a changed byte or a short file all fail without touching the target', async () => {
  const dir = tmp();
  try {
    const { db } = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const { name } = await runBackup(db, { key: KEY, destination: dest });
    const file = join(dir, 'dest', name);
    const bytes = readFileSync(file);
    assert.ok(!bytes.includes(Buffer.from(MARK)) && !bytes.includes(Buffer.from('SQLite format')) && !bytes.includes(Buffer.from('example.test')), 'no plaintext in the file');
    const target = join(dir, 'target.db');
    writeFileSync(target, 'existing database stand-in');
    const untouched = () => assert.equal(readFileSync(target, 'utf8'), 'existing database stand-in');
    await assert.rejects(runRestore({ key: randomBytes(32), destination: dest, from: name, to: target, replace: true }), /key is wrong or the file was changed/);
    untouched();
    const flipped = Buffer.from(bytes); flipped[Math.floor(flipped.length / 2)] ^= 1;
    writeFileSync(join(dir, 'flipped.enc'), flipped);
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: join(dir, 'flipped.enc'), to: target, replace: true }), /key is wrong or the file was changed/);
    writeFileSync(join(dir, 'short.enc'), bytes.subarray(0, 10));
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: join(dir, 'short.enc'), to: target, replace: true }), /too short/);
    writeFileSync(join(dir, 'other.enc'), Buffer.from('not a backup at all, just some text that is long enough to pass the size test'));
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: join(dir, 'other.enc'), to: target, replace: true }), /not a backup made by this tool/);
    untouched();
    assert.deepEqual(readdirSync(dir).filter((f) => f.includes('restoring') || f.includes('before-restore')), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a copy that fails its check is never uploaded (broken audit chain), and a damaged backup never replaces a good database', async () => {
  const dir = tmp();
  try {
    const { db } = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    // damage the live database the way a tamperer would: remove the guard, change a row
    db.exec('drop trigger audit_no_update');
    db.prepare("update audit_events set summary = 'edited later' where seq = 1").run();
    await assert.rejects(runBackup(db, { key: KEY, destination: dest }), /failed its check, so nothing was uploaded.*audit chain broken/);
    assert.deepEqual(await dest.list(''), [], 'nothing reached the destination');
    // a well-formed encrypted file holding a broken database must not replace a good one
    const bad = join(dir, 'bad.db'); copyFileSync(join(dir, 'live', 'app.db'), bad);
    const raw = new DatabaseSync(bad); raw.exec('pragma wal_checkpoint(truncate)'); raw.close();
    await encryptFile(bad, join(dir, 'bad.enc'), KEY);
    const good = join(dir, 'good.db'); writeFileSync(good, 'GOOD');
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: join(dir, 'bad.enc'), to: good, replace: true }), /failed its check, so nothing was replaced/);
    assert.equal(readFileSync(good, 'utf8'), 'GOOD');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a backup name is never reused: the folder destination refuses to overwrite', async () => {
  const dir = tmp();
  try {
    const { db } = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const first = await runBackup(db, { key: KEY, destination: dest, now: () => '20300101T000000Z' });
    const before = readFileSync(join(dir, 'dest', first.name));
    await assert.rejects(runBackup(db, { key: KEY, destination: dest, now: () => '20300101T000000Z' }), /Backups are never overwritten/);
    assert.ok(readFileSync(join(dir, 'dest', first.name)).equals(before));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('restore never overwrites silently: an existing target needs --replace and is kept aside; stale log files are removed', async () => {
  const dir = tmp();
  try {
    const { db } = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const { name } = await runBackup(db, { key: KEY, destination: dest });
    const target = join(dir, 'app.db');
    writeFileSync(target, 'old'); writeFileSync(`${target}-wal`, 'stale wal'); writeFileSync(`${target}-shm`, 'stale shm');
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: name, to: target }), /already exists/);
    assert.equal(readFileSync(target, 'utf8'), 'old');
    const r = await runRestore({ key: KEY, destination: dest, from: name, to: target, replace: true, now: () => 'T1' });
    assert.equal(r.kept, `${target}.before-restore-T1`);
    assert.equal(readFileSync(r.kept, 'utf8'), 'old');
    assert.ok(!existsSync(`${target}-wal`) && !existsSync(`${target}-shm`));
    assert.equal(checkDatabase(target).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('settings: key and destination are validated, and the destination is an interface any store can implement', async () => {
  assert.equal(keyFrom(KEY.toString('hex')).length, 32);
  assert.equal(keyFrom(KEY.toString('base64')).length, 32);
  for (const bad of [undefined, '', 'short', 'zz'.repeat(32), randomBytes(16).toString('hex')]) assert.throws(() => keyFrom(bad), BackupError);
  assert.ok(destinationFrom('file:/some/folder') instanceof LocalDirDestination);
  assert.throws(() => destinationFrom(''), /BACKUP_DEST is not set/);
  assert.throws(() => destinationFrom('gcs://a-bucket/path'), /has no driver yet.*no account is created/);
  const dir = tmp();
  try {
    const { db } = liveDb(dir);
    const store = new Map();   // a stand-in for any other storage service
    const memory = { put: async (n, p) => store.set(n, readFileSync(p)), get: async (n, p) => { if (!store.has(n)) throw new BackupError('missing'); writeFileSync(p, store.get(n)); }, list: async () => [...store.keys()] };
    const { name } = await runBackup(db, { key: KEY, destination: memory, kind: 'premigration' });
    assert.match(name, /premigration/);
    await runRestore({ key: KEY, destination: memory, from: name, to: join(dir, 'm.db') });
    assert.equal(checkDatabase(join(dir, 'm.db')).ok, true);
    await assert.rejects(runBackup(db, { key: KEY, destination: memory, kind: 'weekly' }), /kind must be one of/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the commands: backup, list and restore through the command line; the key is never printed; keygen needs a terminal', async () => {
  const dir = tmp();
  try {
    const { db } = liveDb(dir); db.close();
    const key = randomBytes(32).toString('hex');
    const env = { ...process.env, DB_PATH: join(dir, 'live', 'app.db'), BACKUP_KEY: key, BACKUP_DEST: `file:${join(dir, 'dest')}` };
    const run = (...a) => spawnSync(process.execPath, ['--no-warnings', 'app/cli/backup.js', ...a], { env, encoding: 'utf8' });
    const b = run('backup', '--kind', 'hourly');
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /Backup written: backup-hourly-\d{8}T\d{6}Z\.db\.gz\.enc/);
    assert.match(b.stdout, /passed its integrity and audit-chain check/);
    const name = /Backup written: (\S+)/.exec(b.stdout)[1];
    assert.equal(run('list').stdout.trim(), name);
    const r = run('restore', '--from', name, '--to', join(dir, 'restored.db'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /passed its integrity and audit-chain check before it was put in place/);
    assert.equal(checkDatabase(join(dir, 'restored.db')).ok, true);
    for (const out of [b.stdout, b.stderr, r.stdout, r.stderr]) assert.ok(!out.includes(key), 'the key was printed');
    assert.equal(run('restore', '--from', name, '--to', join(dir, 'restored.db')).status, 1, 'no silent overwrite');
    const noKey = spawnSync(process.execPath, ['--no-warnings', 'app/cli/backup.js', 'backup'], { env: { ...env, BACKUP_KEY: '' }, encoding: 'utf8' });
    assert.equal(noKey.status, 1); assert.match(noKey.stderr, /BACKUP_KEY is not set/);
    const kg = run('keygen');
    assert.equal(kg.status, 1); assert.match(kg.stderr, /run this in a terminal/);
    assert.equal(run('nonsense').status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
