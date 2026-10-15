// Backup commands. Settings come from the environment, never from the command line, so keys do not end up in shell history:
//   DB_PATH       the live database (default data/app.db)
//   BACKUP_KEY    32-byte key, 64 hex characters or base64 (make one with: npm run backup:keygen)
//   BACKUP_DEST   where encrypted backups go, for example file:/mnt/other-disk/backups
// Usage:
//   npm run backup -- [--kind hourly|daily|monthly|premigration|manual]
//   npm run backup:list
//   npm run restore -- --from <backup name or file> --to <database path> [--replace]
//   npm run backup:keygen
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDbOrExplain } from '../server/db.js';
import { loadConfig } from '../server/app.js';
import { BackupError, keyFrom, destinationFrom, runBackup, runRestore } from '../server/backup.js';

function opts(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--replace') o.replace = true;
    else if (a === '--allow-non-tty') o.allowNonTty = true;
    else if (/^--(kind|from|to)$/.test(a) && argv[i + 1] !== undefined) o[a.slice(2)] = argv[++i];
    else throw new BackupError(`Unknown or incomplete option: ${a}`);
  }
  return o;
}
const counts = (c) => Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');

export async function main(argv = process.argv.slice(2), env = process.env, io = { out: process.stdout, err: process.stderr }) {
  const [cmd, ...rest] = argv;
  try {
    const o = opts(rest);
    if (cmd === 'keygen') {
      if (!io.out.isTTY && !o.allowNonTty) throw new BackupError('The key is shown once, so run this in a terminal. Keep a copy somewhere other than this machine.');
      io.out.write(`\nBACKUP_KEY=${randomBytes(32).toString('hex')}\n\nPut this in the service's environment file and keep a second copy off this machine (a password manager).\nWithout it no backup can be opened. It is not stored by this tool.\n\n`);
      return 0;
    }
    if (cmd === 'backup') {
      const config = loadConfig(env);
      const db = openDbOrExplain(config.dbPath);
      const r = await runBackup(db, { key: keyFrom(env.BACKUP_KEY), destination: destinationFrom(env.BACKUP_DEST), kind: o.kind || 'manual' });
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
      const r = await runRestore({ key: keyFrom(env.BACKUP_KEY), destination: env.BACKUP_DEST ? destinationFrom(env.BACKUP_DEST) : null, from: o.from, to: o.to, replace: o.replace });
      io.out.write(`Restored to ${r.target}. It passed its integrity and audit-chain check before it was put in place.\n${r.kept ? `The previous database was kept at ${r.kept}.\n` : ''}Rows: ${counts(r.counts)}\nStart the app and check it before deleting anything.\n`);
      return 0;
    }
    throw new BackupError('Use one of: backup, list, restore, keygen.');
  } catch (e) {
    io.err.write(`\n${e instanceof BackupError ? e.message : `Failed: ${e.message}`}\n\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
