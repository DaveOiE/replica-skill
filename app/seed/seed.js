import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId, nowIso, openDb, migrate, transaction } from '../server/db.js';
import { hashPassword, randomPassword } from '../server/password.js';
import { appendAudit } from '../server/audit.js';

// Everything here is fake: invented names, reserved example.test addresses. Passwords are random
// each time the seed runs; they are returned to the caller and written to a gitignored file,
// never stored in the repository.
const PEOPLE = [
  { key: 'owner', name: 'Avery Quinn', email: 'avery.quinn@example.test', role: 'owner' },
  { key: 'admin', name: 'Jordan Reyes', email: 'jordan.reyes@example.test', role: 'admin' },
  { key: 'member', name: 'Sam Okafor', email: 'sam.okafor@example.test', role: 'member' },
  { key: 'member2', name: 'Priya Nair', email: 'priya.nair@example.test', role: 'member' },
  { key: 'viewonly', name: 'Morgan Lee', email: 'morgan.lee@example.test', role: 'view_only' },
  { key: 'guest', name: 'Casey Dunn', email: 'casey.dunn@example.test', role: 'guest' },
];

export function seedDemo(db) {
  const creds = {};
  const now = nowIso();
  transaction(db, () => {
    const mkWorkspace = (name, slug) => {
      const id = newId();
      db.prepare('insert into workspaces(id,name,slug,created_at,updated_at) values (?,?,?,?,?)').run(id, name, slug, now, now);
      return id;
    };
    const mkUser = (p, workspaceId) => {
      const password = randomPassword();
      const userId = newId();
      db.prepare('insert into users(id,email,name,password_hash,created_at,updated_at) values (?,?,?,?,?,?)')
        .run(userId, p.email, p.name, hashPassword(password), now, now);
      db.prepare('insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values (?,?,?,?,?,?)')
        .run(newId(), workspaceId, userId, p.role, now, now);
      creds[p.key] = { email: p.email, password, userId, workspaceId, role: p.role };
    };
    const demo = mkWorkspace('Brightside IT Support (demo)', 'demo');
    for (const p of PEOPLE) mkUser(p, demo);
    // A second, unrelated workspace: used to prove one tenant never sees another.
    const other = mkWorkspace('Other Co (demo)', 'other');
    mkUser({ key: 'outsider', name: 'Riley Ahmed', email: 'riley.ahmed@example.test', role: 'owner' }, other);
    creds.workspaces = { demo, other };
    for (const ws of [demo, other]) {
      appendAudit(db, { workspaceId: ws, actorKind: 'system', action: 'workspace.seed', targetType: 'workspace', targetId: ws,
        summary: 'Demo data created (fake people and addresses)' });
    }
  });
  return creds;
}

// CLI: npm run seed   (recreates data/app.db and writes .local/demo-credentials.txt)
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dbPath = process.env.DB_PATH || join(root, 'data', 'app.db');
  const { rmSync } = await import('node:fs');
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true });
  const db = openDb(dbPath);
  migrate(db);
  const creds = seedDemo(db);
  const lines = ['Demo sign-ins (fake accounts; workspace slug "demo"; passwords change every seed run)', ''];
  for (const [k, v] of Object.entries(creds)) if (v.email) lines.push(`${k.padEnd(9)} ${v.role.padEnd(10)} ${v.email}  ${v.password}`);
  const out = join(root, '.local', 'demo-credentials.txt');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
  console.log(`Seeded ${dbPath}. Demo sign-ins are in ${out} (gitignored).`);
}
