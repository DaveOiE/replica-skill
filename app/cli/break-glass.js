// Break-glass tool: unlock an account, or make a one-time password-reset link, from the server's command line. For when the only owner is locked out
// or has lost their password. It needs shell access to the machine and the database, which is the point: no request over the network can do this.
//   npm run break-glass -- unlock --email you@your-company.example
//   npm run break-glass -- reset  --email you@your-company.example      (prints a link once; needs a terminal)
// Every use is recorded in the audit trail (ids only, no names or emails) as a system action "from the command line".
import { pathToFileURL } from 'node:url';
import { nowIso, openDbOrExplain, migrate, transaction } from '../server/db.js';
import { appendAudit } from '../server/audit.js';
import { loadConfig } from '../server/app.js';
import { createReset } from '../server/store-access.js';
import { revokeUserSessions } from '../server/auth.js';

export class RefusedError extends Error {}

/** The one active human with this email, and the workspace the record belongs in (their first, by short name). */
function find(db, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new RefusedError('Give the person\'s email address (--email).');
  const u = db.prepare("select id, status, kind, failed_logins, locked_until from users where email = ?").get(e);
  if (!u || u.kind !== 'human' || u.status !== 'active') throw new RefusedError('No active person has that email address. Nothing was changed.');
  const m = db.prepare('select m.workspace_id from memberships m join workspaces w on w.id = m.workspace_id where m.user_id = ? order by w.slug limit 1').get(u.id);
  if (!m) throw new RefusedError('That person belongs to no workspace. Nothing was changed.');
  return { ...u, workspaceId: m.workspace_id };
}
const record = (db, u, action, summary, after) => appendAudit(db, { workspaceId: u.workspaceId, actorKind: 'system', action, targetType: 'user', targetId: u.id, summary, ...(after ? { after } : {}) });

export function unlockAccount(db, { email }) {
  const u = find(db, email);
  const wasLocked = !!(u.locked_until && u.locked_until > nowIso()) || u.failed_logins > 0;
  transaction(db, () => {
    db.prepare('update users set failed_logins = 0, locked_until = null, updated_at = ? where id = ?').run(nowIso(), u.id);
    record(db, u, 'member.unlock', 'Sign-in lock cleared from the command line');
  });
  return { wasLocked };
}

/** Returns the secret link path to show once. Ends the person's sessions, since a reset is what you do when an account may be in the wrong hands. */
export function issueResetLink(db, { email }) {
  const u = find(db, email);
  return transaction(db, () => {
    revokeUserSessions(db, u.id);
    const r = createReset(db, { workspaceId: u.workspaceId, userId: u.id, createdBy: u.id });
    record(db, u, 'member.reset_issued', 'Password reset link issued from the command line (valid 24 hours); their sessions ended', { expiresAt: r.expires });
    return { path: `/#/reset/${r.token}`, expires: r.expires };
  });
}

function parse(argv) {
  const [cmd, ...rest] = argv, o = { cmd };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--allow-non-tty') o.allowNonTty = true;
    else if (rest[i] === '--email' && rest[i + 1] !== undefined) o.email = rest[++i];
    else throw new RefusedError(`Unknown or incomplete option: ${rest[i]}`);
  }
  return o;
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { out: process.stdout, err: process.stderr }) {
  try {
    const o = parse(argv);
    if (!['unlock', 'reset'].includes(o.cmd)) throw new RefusedError('Use one of: unlock, reset  (each with --email).');
    if (o.cmd === 'reset' && !io.out.isTTY && !o.allowNonTty) throw new RefusedError('The link is shown once, so run this in a terminal, not with the output sent to a file or a log.');
    const config = loadConfig(env);
    const db = openDbOrExplain(config.dbPath);
    migrate(db);
    if (o.cmd === 'unlock') {
      const r = unlockAccount(db, o);
      io.out.write(`${r.wasLocked ? 'Unlocked.' : 'That account was not locked; its failure count is cleared anyway.'} Recorded in the audit trail.\n`);
    } else {
      const r = issueResetLink(db, o);
      io.out.write(`\nOne-time password reset link (valid until ${r.expires.slice(0, 16).replace('T', ' ')} UTC, works once; their sessions were ended):\n\n  ${config.publicUrl}${r.path}\n\nGive it to the person privately. It is shown once and stored only as a hash. Clear this terminal afterwards.\n\n`);
    }
    return 0;
  } catch (e) {
    io.err.write(`\n${e instanceof RefusedError ? e.message : `Failed: ${e.message}`}\n\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
