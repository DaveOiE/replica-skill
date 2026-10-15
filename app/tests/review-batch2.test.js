import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, symlinkSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDb, migrate } from '../server/db.js';
import { seedDemo } from '../seed/seed.js';
import { setPasswordCost } from '../server/password.js';
import { LocalDirDestination, runBackup, runRestore, sealSnapshot, snapshot, encryptFile, decryptFile, checkDatabase, fingerprintOf, keyFromEnv, stampOf, NAME_RE, BackupError } from '../server/backup.js';
import { loadConfig } from '../server/app.js';
import { main as backupCli } from '../cli/backup.js';

setPasswordCost({ N: 1024, r: 8, p: 1 });
const KEY = randomBytes(32);
const tmp = () => mkdtempSync(join(tmpdir(), 'rb2-'));
function liveDb(dir) { const db = openDb(join(dir, 'live', 'app.db')); migrate(db); seedDemo(db); return db; }
const PAST = '2020-06-01T10:00:00.000Z';

test('D3: the kind, the time and a fingerprint of the data are inside the authenticated header, in the file and in its name', async () => {
  const dir = tmp();
  try {
    const db = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const r = await runBackup(db, { key: KEY, destination: dest, kind: 'daily', created: PAST });
    assert.equal(r.name, `backup-daily-${stampOf(PAST)}.db.gz.enc`); assert.match(r.name, NAME_RE);
    const bytes = readFileSync(join(dir, 'dest', r.name));
    assert.match(bytes.subarray(0, 400).toString('latin1'), /"kind":"daily","created":"2020-06-01T10:00:00.000Z"/, 'readable, so a person can see what it is without the key');
    const out = join(dir, 'x.db');
    const header = await decryptFile(join(dir, 'dest', r.name), out, KEY);
    assert.deepEqual([header.v, header.kind, header.created], [2, 'daily', PAST]);
    assert.deepEqual(header.fingerprint, fingerprintOf(db), 'the fingerprint is what the live database held');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D3: a renamed file, a forged newer time, a changed header byte and a data mismatch are all refused, and nothing is touched', async () => {
  const dir = tmp();
  try {
    const db = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const old = await runBackup(db, { key: KEY, destination: dest, kind: 'hourly', created: PAST });
    const target = join(dir, 'target.db'); writeFileSync(target, 'GOOD');
    const refuse = async (from, confirm, re) => { await assert.rejects(runRestore({ key: KEY, destination: dest, from, confirm, to: target, replace: true }), re); assert.equal(readFileSync(target, 'utf8'), 'GOOD'); };
    // rename an old backup so it looks newer, or like a different kind
    const newer = `backup-hourly-${stampOf('2020-06-02T10:00:00.000Z')}.db.gz.enc`;
    copyFileSync(join(dir, 'dest', old.name), join(dir, 'dest', newer));
    await refuse(newer, newer, /renamed or forged/);
    const otherKind = `backup-monthly-${stampOf(PAST)}.db.gz.enc`;
    copyFileSync(join(dir, 'dest', old.name), join(dir, 'dest', otherKind));
    await refuse(otherKind, otherKind, /renamed or forged/);
    // a changed byte inside the header fails the tag even though the header is plain text
    const bytes = readFileSync(join(dir, 'dest', old.name)); const at = bytes.indexOf('"hourly"') + 1; bytes[at] ^= 1;
    writeFileSync(join(dir, 'tampered.enc'), bytes);
    await refuse(join(dir, 'tampered.enc'), 'tampered.enc', /key is wrong or the file was changed/);
    // a validly encrypted file that claims a time in the future (someone with the key and the create credential)
    const plain = join(dir, 'p.db'); snapshot(db, plain);
    const fp = checkDatabase(plain).fingerprint;
    const future = new Date(Date.now() + 3600000).toISOString(), futureName = `backup-hourly-${stampOf(future)}.db.gz.enc`;
    await encryptFile(plain, join(dir, 'dest', futureName), KEY, { v: 2, kind: 'hourly', created: future, fingerprint: fp });
    await refuse(futureName, futureName, /in the future/);
    // a validly encrypted file whose data is not what its header says
    const lie = `backup-hourly-${stampOf('2020-06-03T10:00:00.000Z')}.db.gz.enc`;
    await encryptFile(plain, join(dir, 'dest', lie), KEY, { v: 2, kind: 'hourly', created: '2020-06-03T10:00:00.000Z', fingerprint: { counts: { tasks: 1 }, heads: {} } });
    await refuse(lie, lie, /does not match what was recorded/);
    // and the honest one still restores
    const ok = await runRestore({ key: KEY, destination: dest, from: old.name, confirm: old.name, to: join(dir, 'ok.db') });
    assert.equal(ok.header.kind, 'hourly');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D3: restore makes a person confirm the backup by name; it shows what the file really is first; the wrong name or no name changes nothing', async () => {
  const dir = tmp();
  try {
    const db = liveDb(dir);
    const dest = new LocalDirDestination(join(dir, 'dest'));
    const r = await runBackup(db, { key: KEY, destination: dest, kind: 'monthly', created: PAST });
    const to = join(dir, 'out.db');
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: r.name, to }), /confirm the backup by name/);
    await assert.rejects(runRestore({ key: KEY, destination: dest, from: r.name, to, confirm: 'something-else' }), /not the name of the backup being restored/);
    assert.ok(!existsSync(to));
    let shown;
    await runRestore({ key: KEY, destination: dest, from: r.name, to, confirm: async (info) => { shown = info; return info.name; } });
    assert.deepEqual([shown.name, shown.kind, shown.created], [r.name, 'monthly', PAST]);
    assert.ok(shown.counts.audit_events > 0);
    // the command line: a pipe cannot answer the question, a flag can
    const env = { DB_PATH: join(dir, 'live', 'app.db'), BACKUP_KEY_FILE: join(dir, 'key'), BACKUP_DEST: `file:${join(dir, 'dest')}` };
    writeFileSync(env.BACKUP_KEY_FILE, `${KEY.toString('hex')}\n`);
    const io = (isTTY) => { const out = [], err = []; return { out: { write: (s) => out.push(s), isTTY }, err: { write: (s) => err.push(s) }, in: { isTTY }, o: out, e: err }; };
    const a = io(false);
    assert.equal(await backupCli(['restore', '--from', r.name, '--to', join(dir, 'cli.db')], env, a), 1);
    assert.match(a.e.join(''), /confirm the backup by name: pass --confirm/);
    const b = io(false);
    assert.equal(await backupCli(['restore', '--from', r.name, '--to', join(dir, 'cli.db'), '--confirm', r.name], env, b), 0, b.e.join(''));
    assert.match(b.o.join(''), /Taken 2020-06-01T10:00:00.000Z \(monthly\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D1/D2: the key can come from a file (a systemd credential) instead of the environment; a bad or missing file is refused', () => {
  const dir = tmp();
  try {
    const f = join(dir, 'key'); writeFileSync(f, `${KEY.toString('hex')}\n`);
    assert.deepEqual(keyFromEnv({ BACKUP_KEY_FILE: f }), KEY);
    assert.deepEqual(keyFromEnv({ BACKUP_KEY: KEY.toString('hex') }), KEY);
    assert.deepEqual(keyFromEnv({ BACKUP_KEY_FILE: f, BACKUP_KEY: '0'.repeat(64) }), KEY, 'the file wins');
    assert.throws(() => keyFromEnv({ BACKUP_KEY_FILE: join(dir, 'nope') }), /cannot be read/);
    writeFileSync(f, '__REPLACE_ME__'); assert.throws(() => keyFromEnv({ BACKUP_KEY_FILE: f }), BackupError);
    assert.throws(() => keyFromEnv({}), /BACKUP_KEY is not set/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D1: sealing refuses a snapshot that is a symbolic link, a broken database, or one with a broken audit chain; the plain snapshot step needs no key', async () => {
  const dir = tmp();
  try {
    const db = liveDb(dir);
    const snap = join(dir, 'snap.db'); snapshot(db, snap);
    const out = join(dir, 'out');
    const link = join(dir, 'link.db'); symlinkSync(snap, link);
    await assert.rejects(sealSnapshot({ snapshotPath: link, key: KEY, kind: 'hourly', outDir: out }), /symbolic link/);
    writeFileSync(join(dir, 'junk.db'), 'not a database at all');
    await assert.rejects(sealSnapshot({ snapshotPath: join(dir, 'junk.db'), key: KEY, kind: 'hourly', outDir: out }), /failed its check/);
    const broken = join(dir, 'broken.db'); snapshot(db, broken);
    const raw = new DatabaseSync(broken); raw.exec('drop trigger audit_no_update'); raw.prepare("update audit_events set summary = 'edited' where seq = 1").run(); raw.close();
    await assert.rejects(sealSnapshot({ snapshotPath: broken, key: KEY, kind: 'hourly', outDir: out }), /audit chain broken/);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'nothing was written');
    const ok = await sealSnapshot({ snapshotPath: snap, key: KEY, kind: 'premigration', outDir: out, created: PAST });
    assert.equal(ok.header.kind, 'premigration');
    await assert.rejects(sealSnapshot({ snapshotPath: snap, key: KEY, kind: 'premigration', outDir: out, created: PAST }), /never overwritten/);
    // the snapshot command-line step runs with no key at all
    const io = { out: { write() {}, isTTY: false }, err: { write() {} } };
    assert.equal(await backupCli(['snapshot', '--out', join(dir, 'cli-snap.db')], { DB_PATH: join(dir, 'live', 'app.db') }, io), 0);
    assert.equal(checkDatabase(join(dir, 'cli-snap.db')).ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D14: the app refuses to start while any setting still holds a placeholder, and says which', () => {
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://__REPLACE_WITH_YOUR_DOMAIN__' }), /PUBLIC_URL still holds a placeholder/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test', DB_PATH: '/var/lib/__REPLACE_ME__/app.db' }), /DB_PATH still holds a placeholder/);
  assert.throws(() => loadConfig({ SOME_OTHER_SETTING: '__REPLACE_X__' }), /SOME_OTHER_SETTING/);
  assert.equal(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test' }).publicUrl, 'https://tasks.example.test');
});
