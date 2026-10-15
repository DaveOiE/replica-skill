// Backup commands. Settings come from the environment (or, for the key, a file), never from the command line, so keys do not end up in shell history:
//   DB_PATH          the live database (default data/app.db)
//   BACKUP_KEY_FILE  a file holding the 32-byte key (64 hex characters or base64); systemd supplies one from a credential. Or BACKUP_KEY itself.
//   BACKUP_DEST      for the all-in-one `backup` and for `list`: file:/path/to/folder
// Usage:
//   snapshot --out <file>                                   copy and check the live database to a plain file (no key needed)
//   seal --snapshot <file> --kind <kind> --out <folder>     check a snapshot and encrypt it, with the kind and time inside the authenticated header
//   backup [--kind <kind>]                                  snapshot + seal + store, in one go (simple setups)
//   list                                                    names in BACKUP_DEST
//   restore --from <name or file> --to <path> [--replace] [--confirm <name>]    shows what the backup is, asks for its name, checks, then replaces
//   keygen                                                  make a key (shown once)
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { openDbOrExplain } from '../server/db.js';
import { loadConfig } from '../server/app.js';
import { BackupError, keyFromEnv, destinationFrom, runBackup, runRestore, sealSnapshot, snapshot, checkDatabase } from '../server/backup.js';

function opts(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--replace') o.replace = true;
    else if (a === '--allow-non-tty') o.allowNonTty = true;
    else if (/^--(kind|from|to|out|snapshot|confirm|created)$/.test(a) && argv[i + 1] !== undefined) o[a.slice(2)] = argv[++i];
    else throw new BackupError(`Unknown or incomplete option: ${a}`);
  }
  return o;
}
const counts = (c) => Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');

export async function main(argv = process.argv.slice(2), env = process.env, io = { out: process.stdout, err: process.stderr, in: process.stdin }) {
  const [cmd, ...rest] = argv;
  try {
    const o = opts(rest);
    if (cmd === 'keygen') {
      if (!io.out.isTTY && !o.allowNonTty) throw new BackupError('The key is shown once, so run this in a terminal. Keep a copy somewhere other than this machine.');
      io.out.write(`\n${randomBytes(32).toString('hex')}\n\nThis is the backup key. Install it with: bin/install-credential.sh backup-key   (paste it when asked), and keep a second copy off this machine\n(a password manager). Without it no backup can be opened. It is not stored by this tool.\n\n`);
      return 0;
    }
    if (cmd === 'snapshot') {
      if (!o.out) throw new BackupError('Say where to write the snapshot (--out).');
      const config = loadConfig(env);
      const db = openDbOrExplain(config.dbPath);
      const tmp = `${o.out}.partial`;
      rmSync(tmp, { force: true });
      snapshot(db, tmp);
      db.close();
      const check = checkDatabase(tmp);
      if (!check.ok) { rmSync(tmp, { force: true }); throw new BackupError(`The snapshot failed its check, so it was removed: ${check.problems.join(' | ')}`); }
      renameSync(tmp, o.out);
      io.out.write(`Snapshot written and checked. Rows: ${counts(check.counts)}\n`);
      return 0;
    }
    if (cmd === 'seal') {
      if (!o.snapshot || !o.kind || !o.out) throw new BackupError('seal needs --snapshot, --kind and --out.');
      const r = await sealSnapshot({ snapshotPath: o.snapshot, key: keyFromEnv(env), kind: o.kind, outDir: o.out, ...(o.created ? { created: o.created } : {}) });
      io.out.write(`Sealed: ${r.name} (${r.bytes} bytes, ${r.header.kind}). It passed its integrity and audit-chain check.\n`);
      return 0;
    }
    if (cmd === 'backup') {
      const config = loadConfig(env);
      const db = openDbOrExplain(config.dbPath);
      const r = await runBackup(db, { key: keyFromEnv(env), destination: destinationFrom(env.BACKUP_DEST), kind: o.kind || 'manual' });
      db.close();
      io.out.write(`Backup written: ${r.name} (${r.bytes} bytes, ${r.kind}). The copy passed its integrity and audit-chain check.\nRows: ${counts(r.counts)}\n`);
      return 0;
    }
    if (cmd === 'list') {
      const names = await destinationFrom(env.BACKUP_DEST).list('backup-');
      io.out.write(names.length ? `${names.join('\n')}\n` : 'No backups found.\n');
      return 0;
    }
    if (cmd === 'restore') {
      if (!o.from) throw new BackupError('Say which backup to restore (--from).');
      const confirm = o.confirm || (async (info) => {
        if (!io.out.isTTY || !io.in?.isTTY) throw new BackupError('Restore needs you to confirm the backup by name: pass --confirm <name>, or run it in a terminal and type the name when asked.');
        io.out.write(`\nBackup:   ${info.name}\nKind:     ${info.kind}\nTaken:    ${info.created} (from inside the file, not from its name)\nRows:     ${counts(info.counts)}\n\n`);
        const rl = createInterface({ input: io.in, output: io.out });
        try { return (await rl.question('Type the backup name to restore it (anything else cancels): ')).trim(); } finally { rl.close(); }
      });
      const r = await runRestore({ key: keyFromEnv(env), destination: env.BACKUP_DEST ? destinationFrom(env.BACKUP_DEST) : null, from: o.from, to: o.to, replace: o.replace, confirm });
      io.out.write(`Restored to ${r.target}. Taken ${r.header.created} (${r.header.kind}). It passed its integrity and audit-chain check, and its data matched the fingerprint recorded when it was taken, before it was put in place.\n${r.kept ? `The previous database was kept at ${r.kept}.\n` : ''}Rows: ${counts(r.counts)}\nStart the app and check it before deleting anything.\n`);
      return 0;
    }
    throw new BackupError('Use one of: snapshot, seal, backup, list, restore, keygen.');
  } catch (e) {
    io.err.write(`\n${e instanceof BackupError ? e.message : `Failed: ${e.message}`}\n\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
