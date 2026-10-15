// Creates the first owner of an empty database, with a generated one-time password shown once on the terminal.
// Usage: npm run first-owner -- --workspace "Acme Support" --name "Pat Lee" --email pat@example.test [--slug acme]
// The password is never written to a file, a log or the audit trail. Run it on the machine that holds the database, in a terminal you control.
import { pathToFileURL } from 'node:url';
import { newId, nowIso, openDbOrExplain, migrate, transaction } from '../server/db.js';
import { hashPassword, randomPassword } from '../server/password.js';
import { appendAudit } from '../server/audit.js';
import { loadConfig } from '../server/app.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slugOf = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export class RefusedError extends Error {}

/** Core of the command, separate from the terminal so it can be tested. Returns { userId, workspaceId, email, slug, password }. */
export function createFirstOwner(db, { workspace, name, email, slug }) {
  const w = String(workspace || '').trim(), n = String(name || '').trim(), e = String(email || '').trim().toLowerCase();
  if (!w || w.length > 80) throw new RefusedError('Give a workspace name of 1 to 80 characters (--workspace).');
  if (!n || n.length > 100) throw new RefusedError('Give the owner\'s name of 1 to 100 characters (--name).');
  if (!EMAIL.test(e) || e.length > 254) throw new RefusedError('Give a valid email address for the owner (--email).');
  const s = slug ? String(slug).trim() : slugOf(w);
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(s)) throw new RefusedError('The workspace short name (--slug) may use lower-case letters, digits and hyphens.');
  const password = randomPassword();
  const hash = hashPassword(password);
  const now = nowIso();
  const out = { userId: newId(), workspaceId: newId(), email: e, slug: s, password };
  transaction(db, () => {
    // Checked inside the transaction so two runs at once cannot both succeed.
    if (db.prepare("select 1 from memberships where role = 'owner'").get()) throw new RefusedError('This database already has an owner. Nothing was changed. To add people, sign in and use People; to start again, use a new database file (DB_PATH).');
    if (db.prepare('select 1 from users where email = ?').get(e)) throw new RefusedError('That email address already has an account. Nothing was changed.');
    db.prepare('insert into workspaces(id,name,slug,created_at,updated_at) values (?,?,?,?,?)').run(out.workspaceId, w, s, now, now);
    db.prepare('insert into users(id,email,name,password_hash,created_at,updated_at) values (?,?,?,?,?,?)').run(out.userId, e, n, hash, now, now);
    db.prepare('insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?,?)').run(newId(), out.workspaceId, out.userId, 'owner', now, now);
    // ids and a fixed word only: no name, no email, no password
    appendAudit(db, { workspaceId: out.workspaceId, actorKind: 'system', action: 'workspace.first_owner', targetType: 'user', targetId: out.userId, summary: 'First owner created from the command line', after: { role: 'owner' } });
  });
  return out;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--allow-non-tty') o.allowNonTty = true;
    else if (/^--(workspace|name|email|slug)$/.test(a) && argv[i + 1] !== undefined) o[a.slice(2)] = argv[++i];
    else throw new RefusedError(`Unknown or incomplete option: ${a}`);
  }
  return o;
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { out: process.stdout, err: process.stderr }) {
  try {
    const o = parseArgs(argv);
    if (!io.out.isTTY && !o.allowNonTty) throw new RefusedError('The password is shown once, so run this in a terminal, not with the output sent to a file or a log. (Pass --allow-non-tty only if you are sure where the output goes.)');
    const config = loadConfig(env);
    const db = openDbOrExplain(config.dbPath);
    migrate(db);
    const r = createFirstOwner(db, o);
    io.out.write(`\nFirst owner created.\n\n  Workspace: ${o.workspace.trim()}  (short name: ${r.slug})\n  Email:     ${r.email}\n  Password:  ${r.password}\n\nThis password is shown once and is not stored anywhere in readable form. Sign in, then change it under Account.\nCopy it now, and clear this terminal afterwards.\n\n`);
    return 0;
  } catch (e) {
    io.err.write(`\n${e instanceof RefusedError ? e.message : `Could not create the owner: ${e.message}`}\n\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
