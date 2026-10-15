// Backup and restore for the SQLite database: an online copy (the app keeps running), an integrity check, encryption with a key from the
// environment, and a destination that is an interface, so no particular storage service is built in. Nothing here creates an account.
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, fstatSync, copyFileSync, renameSync, existsSync, readdirSync, openSync, readSync, closeSync, readFileSync, writeSync as fsWrite, constants as fsc } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyChain } from './audit.js';

const MAGIC = Buffer.from('DSKBK2');          // file type and version 2: an authenticated header (kind, time, fingerprint) comes before the encrypted data
const IV_LEN = 12, TAG_LEN = 16;
export const KINDS = ['hourly', 'daily', 'monthly', 'premigration', 'manual'];

export class BackupError extends Error {}

/** Backup file names: kind first, so a storage lifecycle rule can match a prefix, then the creation time. */
export const NAME_RE = /^backup-(hourly|daily|monthly|premigration|manual)-(\d{8}T\d{6}Z)\.db\.gz\.enc$/;
export const stampOf = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const MAX_FUTURE_MS = 10 * 60000;   // a backup claiming to be from more than ten minutes ahead is a forgery or a broken clock

/** The key comes from a file (BACKUP_KEY_FILE, which systemd fills from a credential only this service can read) or from the environment (BACKUP_KEY). */
export function keyFromEnv(env = process.env) {
  if (env.BACKUP_KEY_FILE) {
    let text;
    try { text = readFileSync(env.BACKUP_KEY_FILE, 'utf8'); } catch { throw new BackupError('BACKUP_KEY_FILE cannot be read.'); }
    return keyFrom(text);
  }
  return keyFrom(env.BACKUP_KEY);
}

/** The key comes from the environment as 64 hex characters or 44 base64 characters (32 bytes). It is never printed or stored. */
export function keyFrom(value) {
  const v = String(value || '').trim();
  if (!v) throw new BackupError('BACKUP_KEY is not set. Generate one with "npm run backup:keygen" and keep a copy somewhere other than this machine.');
  const buf = /^[0-9a-fA-F]{64}$/.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (buf.length !== 32) throw new BackupError('BACKUP_KEY must be 32 bytes, written as 64 hex characters or as base64.');
  // A key such as all zeros or a short repeated pattern protects nothing. A random 32-byte key has around 30 different byte values.
  if (new Set(buf).size < 16) throw new BackupError('BACKUP_KEY looks made up (too few different bytes). Make one with npm run backup:keygen.');
  return buf;
}

// ---- destinations: put(name, localPath), get(name, localPath), list(prefix). Add a driver here for a cloud store; none is built in.
export class LocalDirDestination {
  constructor(dir) { this.dir = resolve(dir); }
  async put(name, localPath) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (existsSync(join(this.dir, name))) throw new BackupError(`${name} already exists in ${this.dir}. Backups are never overwritten.`);
    const tmp = join(this.dir, `${name}.partial`);
    copyFileSync(localPath, tmp);
    renameSync(tmp, join(this.dir, name));
  }
  async get(name, localPath) {
    const p = join(this.dir, basename(name));
    if (!existsSync(p)) throw new BackupError(`No backup named ${name} in ${this.dir}.`);
    copyFileSync(p, localPath);
  }
  async list(prefix = '') {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir).filter((f) => f.startsWith(prefix) && f.endsWith('.enc')).sort();
  }
}

/** BACKUP_DEST is "file:/some/folder" (a mounted disk or a folder another machine syncs). Other schemes need a driver. */
export function destinationFrom(value) {
  const v = String(value || '').trim();
  if (!v) throw new BackupError('BACKUP_DEST is not set. Use file:/path/to/folder for a folder on a different disk or machine.');
  const m = /^file:(?:\/\/)?(\/.+|[A-Za-z]:[\\/].+)$/.exec(v);
  if (m) return new LocalDirDestination(m[1]);
  throw new BackupError(`The destination "${v.split(':')[0]}:" has no driver yet. Add one in app/server/backup.js (put, get, list); no account is created by this code.`);
}

// ---- checks
export const tableCounts = (db) => Object.fromEntries(db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all()
  .map((t) => [t.name, db.prepare(`select count(*) n from "${t.name}"`).get().n]));

/** What a database holds, in a form that can be compared: rows per table, and the length and head hash of every workspace's audit chain. */
export function fingerprintOf(db) {
  const heads = {};
  for (const w of db.prepare('select id from workspaces order by id').all()) {
    const last = db.prepare('select hash, seq from audit_events where workspace_id = ? order by seq desc limit 1').get(w.id);
    heads[w.id] = last ? { rows: last.seq, head: last.hash } : { rows: 0, head: null };
  }
  return { counts: tableCounts(db), heads };
}

/** Integrity of a database file: SQLite's own check, foreign keys, and the audit hash chain of every workspace. Never throws on a bad file: returns { ok, problems }. */
export function checkDatabase(path) {
  const problems = [];
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const ic = db.prepare('pragma integrity_check').all().map((r) => Object.values(r)[0]);
    if (ic.length !== 1 || ic[0] !== 'ok') problems.push(`integrity_check: ${ic.slice(0, 3).join('; ')}`);
    if (db.prepare('pragma foreign_key_check').all().length) problems.push('foreign_key_check found rows that point at nothing');
    for (const w of db.prepare('select id from workspaces').all()) {
      const c = verifyChain(db, w.id);
      if (!c.ok) problems.push(`audit chain broken in workspace ${w.id} at row ${c.brokenAtSeq}`);
    }
    if (problems.length) return { ok: false, problems, counts: null, fingerprint: null };
    const fingerprint = fingerprintOf(db);
    return { ok: true, problems, counts: fingerprint.counts, fingerprint };
  } catch (e) {
    return { ok: false, problems: [`not a readable database: ${e.message}`], counts: null, fingerprint: null };
  } finally { try { db?.close(); } catch { /* ignore */ } }
}

/** Online copy of a live database. VACUUM INTO reads a consistent snapshot while the app keeps writing, and never locks it out. */
export function snapshot(db, destPath) {
  if (existsSync(destPath)) throw new BackupError(`${destPath} already exists.`);
  db.prepare('vacuum into ?').run(destPath);
}

// ---- encryption: gzip, then AES-256-GCM. File = magic | header length (2 bytes) | header (JSON: kind, creation time, fingerprint) | iv | ciphertext | tag.
// The header is readable but AUTHENTICATED: it is the GCM additional data, so changing the kind or the time (renaming a file, forging a newer one) fails the tag.
export async function encryptFile(src, dest, key, header) {
  const h = Buffer.from(JSON.stringify(header));
  if (h.length > 60000) throw new BackupError('The backup header is too large.');
  const len = Buffer.alloc(2); len.writeUInt16BE(h.length);
  const prefix = Buffer.concat([MAGIC, len, h]);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(prefix);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([prefix, iv]));
  await pipeline(createReadStream(src), createGzip(), cipher, out, { end: false });
  out.write(cipher.getAuthTag());
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
}

/** Decrypts to dest and returns the authenticated header. A wrong key or any changed byte, in the header too, fails. */
export async function decryptFile(src, dest, key) {
  const size = statSync(src).size;
  if (size < MAGIC.length + 2 + IV_LEN + TAG_LEN) throw new BackupError('That file is too short to be a backup.');
  const fd = openSync(src, 'r');
  let prefix, iv; const tag = Buffer.alloc(TAG_LEN);
  try {
    const first = Buffer.alloc(MAGIC.length + 2);
    readSync(fd, first, 0, first.length, 0);
    if (!first.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('That file is not a backup made by this tool (or is from an older version).');
    const hlen = first.readUInt16BE(MAGIC.length);
    if (size < first.length + hlen + IV_LEN + TAG_LEN) throw new BackupError('That file is too short to be a backup.');
    prefix = Buffer.alloc(first.length + hlen); readSync(fd, prefix, 0, prefix.length, 0);
    iv = Buffer.alloc(IV_LEN); readSync(fd, iv, 0, IV_LEN, prefix.length);
    readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally { closeSync(fd); }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(prefix);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(src, { start: prefix.length + IV_LEN, end: size - TAG_LEN - 1 }), decipher, createGunzip(), createWriteStream(dest, { mode: 0o600 }));
  } catch (e) {
    rmSync(dest, { force: true });
    throw new BackupError('Could not decrypt that backup: the key is wrong or the file was changed or damaged.');
  }
  try { return JSON.parse(prefix.subarray(MAGIC.length + 2).toString()); } catch { throw new BackupError('The backup header is not readable.'); }
}

const scratch = () => mkdtempSync(join(tmpdir(), 'backup-'));
const nowIsoMs = () => new Date().toISOString();

/** Copy a snapshot file into a private scratch file through an open handle that refuses symbolic links, so a file planted in a shared folder cannot point us elsewhere. */
function copyRegularFile(from, to) {
  let fd;
  try { fd = openSync(from, fsc.O_RDONLY | fsc.O_NOFOLLOW); } catch (e) { throw new BackupError(`Cannot read the snapshot ${basename(from)}: ${e.code === 'ELOOP' ? 'it is a symbolic link' : e.code || e.message}.`); }
  try {
    if (!fstatSync(fd).isFile()) throw new BackupError('The snapshot is not a regular file.');
    const out = openSync(to, 'w', 0o600), buf = Buffer.alloc(1 << 20);
    try { for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) { let o = 0; while (o < n) o += fsWrite(out, buf, o, n - o); } } finally { closeSync(out); }
  } finally { closeSync(fd); }
}

/**
 * Check a snapshot and seal it: check integrity and the audit chain, then encrypt with a header that carries the kind, the creation time and the fingerprint.
 * Writes backup-<kind>-<time>.db.gz.enc into outDir and returns { name, path, header }. Nothing is written if the check fails.
 */
export async function sealSnapshot({ snapshotPath, key, kind, outDir, created = nowIsoMs() }) {
  if (!KINDS.includes(kind)) throw new BackupError(`kind must be one of ${KINDS.join(', ')}.`);
  const dir = scratch();
  try {
    const plain = join(dir, 'copy.db');
    copyRegularFile(snapshotPath, plain);
    const check = checkDatabase(plain);
    if (!check.ok) throw new BackupError(`The copy failed its check, so nothing was uploaded: ${check.problems.join(' | ')}`);
    const header = { v: 2, kind, created, fingerprint: check.fingerprint };
    const name = `backup-${kind}-${stampOf(created)}.db.gz.enc`;
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const path = join(outDir, name);
    if (existsSync(path)) throw new BackupError(`${name} already exists. Backups are never overwritten.`);
    await encryptFile(plain, `${path}.partial`, key, header);
    renameSync(`${path}.partial`, path);
    return { name, path, header, bytes: statSync(path).size, counts: check.counts };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** All in one, for simple setups and tests: snapshot a live database, check, seal, hand to a destination. */
export async function runBackup(db, { key, destination, kind = 'manual', created = nowIsoMs() }) {
  const dir = scratch();
  try {
    const snap = join(dir, 'snapshot.db');
    snapshot(db, snap);
    const sealed = await sealSnapshot({ snapshotPath: snap, key, kind, outDir: join(dir, 'sealed'), created });
    await destination.put(sealed.name, sealed.path);
    return { name: sealed.name, kind, bytes: sealed.bytes, counts: sealed.counts, header: sealed.header };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Restore: fetch (or read a local file), decrypt, check, and only then place it. Nothing at the target changes unless every check passes, and the
 * operator has typed the backup's name. `confirm` is that name, or a function that is shown what was found and returns what the operator typed.
 * The kind and time in the file's name must match the authenticated ones inside it (a renamed or forged file is refused), the time must not be in
 * the future, and the restored data must match the fingerprint recorded when the backup was taken.
 * An existing target is kept next to it as <target>.before-restore-<time>, with its write-ahead log, never deleted. Stop the app first.
 */
export async function runRestore({ key, destination, from, to, replace = false, confirm, now = () => stampOf(nowIsoMs()) }) {
  if (!to) throw new BackupError('Say where to put the restored database (--to).');
  if (!confirm) throw new BackupError('Restore needs you to confirm the backup by name (--confirm <name>, or type it when asked).');
  const target = resolve(to);
  if (existsSync(target) && !replace) throw new BackupError(`${target} already exists. Restore to a new file, or pass --replace to keep the old one aside and put the backup in its place.`);
  const dir = scratch();
  try {
    const enc = join(dir, 'in.enc'), plain = join(dir, 'out.db');
    const isFile = existsSync(from) && statSync(from).isFile();
    if (isFile) copyFileSync(from, enc); else await destination.get(from, enc);
    const header = await decryptFile(enc, plain, key);
    const name = basename(from);
    const m = NAME_RE.exec(name);
    if (m && (m[1] !== header.kind || m[2] !== stampOf(header.created))) throw new BackupError(`The name says ${m[1]} taken ${m[2]}, but inside the file it says ${header.kind} taken ${stampOf(header.created)}. The file was renamed or forged. Nothing was changed.`);
    if (!m && !isFile) throw new BackupError('That is not a backup file name.');
    if (!KINDS.includes(header.kind) || Number.isNaN(Date.parse(header.created))) throw new BackupError('The backup header is not valid.');
    if (Date.parse(header.created) > Date.now() + MAX_FUTURE_MS) throw new BackupError(`The backup says it was taken at ${header.created}, which is in the future. Nothing was changed.`);
    const check = checkDatabase(plain);
    if (!check.ok) throw new BackupError(`The backup failed its check, so nothing was replaced: ${check.problems.join(' | ')}`);
    if (!same(check.fingerprint, header.fingerprint)) throw new BackupError('The data in the backup does not match what was recorded when it was taken. Nothing was changed.');
    const typed = typeof confirm === 'function' ? await confirm({ name, kind: header.kind, created: header.created, counts: check.counts }) : confirm;
    if (typed !== name) throw new BackupError(`That is not the name of the backup being restored (${name}). Nothing was changed.`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    let kept = null;
    if (existsSync(target)) { kept = `${target}.before-restore-${now()}`; renameSync(target, kept); }
    // The write-ahead log holds the newest committed changes of a database that stopped without a clean shutdown. It moves aside WITH its file, so
    // the kept copy is whole, and the restored file never inherits it.
    for (const ext of ['-wal', '-shm']) {
      if (!existsSync(`${target}${ext}`)) continue;
      if (kept) renameSync(`${target}${ext}`, `${kept}${ext}`); else rmSync(`${target}${ext}`, { force: true });
    }
    const staged = `${target}.restoring`;
    copyFileSync(plain, staged);
    renameSync(staged, target);
    return { target, kept, counts: check.counts, header };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
