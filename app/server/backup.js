// Backup and restore for the SQLite database: an online copy (the app keeps running), an integrity check, encryption with a key from the
// environment, and a destination that is an interface, so no particular storage service is built in. Nothing here creates an account.
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync, copyFileSync, renameSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, basename, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { verifyChain } from './audit.js';

const MAGIC = Buffer.from('DSKBK1');          // file type and version
const IV_LEN = 12, TAG_LEN = 16;
export const KINDS = ['hourly', 'daily', 'monthly', 'premigration', 'manual'];

export class BackupError extends Error {}

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
    return { ok: problems.length === 0, problems, counts: problems.length ? null : tableCounts(db) };
  } catch (e) {
    return { ok: false, problems: [`not a readable database: ${e.message}`], counts: null };
  } finally { try { db?.close(); } catch { /* ignore */ } }
}

/** Online copy of a live database. VACUUM INTO reads a consistent snapshot while the app keeps writing, and never locks it out. */
export function snapshot(db, destPath) {
  if (existsSync(destPath)) throw new BackupError(`${destPath} already exists.`);
  db.prepare('vacuum into ?').run(destPath);
}

// ---- encryption: gzip, then AES-256-GCM. File = magic | iv | ciphertext | tag. A wrong key or any changed byte fails the tag.
export async function encryptFile(src, dest, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(dest, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(src), createGzip(), cipher, out, { end: false });
  out.write(cipher.getAuthTag());
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
}

export async function decryptFile(src, dest, key) {
  const size = statSync(src).size;
  if (size < MAGIC.length + IV_LEN + TAG_LEN) throw new BackupError('That file is too short to be a backup.');
  const fd = openSync(src, 'r');
  const head = Buffer.alloc(MAGIC.length + IV_LEN), tag = Buffer.alloc(TAG_LEN);
  try { readSync(fd, head, 0, head.length, 0); readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN); } finally { closeSync(fd); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('That file is not a backup made by this tool.');
  const decipher = createDecipheriv('aes-256-gcm', key, head.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(src, { start: head.length, end: size - TAG_LEN - 1 }), decipher, createGunzip(), createWriteStream(dest, { mode: 0o600 }));
  } catch (e) {
    rmSync(dest, { force: true });
    throw new BackupError('Could not decrypt that backup: the key is wrong or the file was changed or damaged.');
  }
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const scratch = () => mkdtempSync(join(tmpdir(), 'backup-'));

/** Back up a live database: snapshot, check, encrypt, hand to the destination. Nothing is uploaded if the check fails. */
export async function runBackup(db, { key, destination, kind = 'manual', now = stamp }) {
  if (!KINDS.includes(kind)) throw new BackupError(`kind must be one of ${KINDS.join(', ')}.`);
  const dir = scratch();
  try {
    const plain = join(dir, 'copy.db'), enc = join(dir, 'copy.enc');
    snapshot(db, plain);
    const check = checkDatabase(plain);
    if (!check.ok) throw new BackupError(`The copy failed its check, so nothing was uploaded: ${check.problems.join(' | ')}`);
    await encryptFile(plain, enc, key);
    const name = `backup-${kind}-${now()}.db.gz.enc`;   // the kind comes first so a storage lifecycle rule can match a prefix such as backup-hourly-
    await destination.put(name, enc);
    return { name, kind, bytes: statSync(enc).size, counts: check.counts };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/**
 * Restore: fetch (or read a local file), decrypt, check, and only then place it. Nothing at the target changes unless every check passes.
 * An existing target is kept next to it as <target>.before-restore-<time>, never deleted. Stop the app first.
 */
export async function runRestore({ key, destination, from, to, replace = false, now = stamp }) {
  if (!to) throw new BackupError('Say where to put the restored database (--to).');
  const target = resolve(to);
  if (existsSync(target) && !replace) throw new BackupError(`${target} already exists. Restore to a new file, or pass --replace to keep the old one aside and put the backup in its place.`);
  const dir = scratch();
  try {
    const enc = join(dir, 'in.enc'), plain = join(dir, 'out.db');
    if (existsSync(from) && statSync(from).isFile()) copyFileSync(from, enc);
    else await destination.get(from, enc);
    await decryptFile(enc, plain, key);
    const check = checkDatabase(plain);
    if (!check.ok) throw new BackupError(`The backup failed its check, so nothing was replaced: ${check.problems.join(' | ')}`);
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
    return { target, kept, counts: check.counts };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
