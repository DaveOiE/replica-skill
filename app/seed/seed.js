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
    // Fake projects and tasks. 'pub' is visible to the whole workspace and the guest is added to it;
    // 'priv' is private (only owner and admin see it); 'otherProj' belongs to the other workspace.
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const mkProject = (ws, owner, nm, desc, vis) => {
      const id = newId();
      db.prepare('insert into projects(id,workspace_id,name,description,owner_id,visibility,created_at,updated_at) values (?,?,?,?,?,?,?,?)').run(id, ws, nm, desc, owner, vis, now, now);
      db.prepare('insert into project_members(id,project_id,user_id,role) values (?,?,?,?)').run(newId(), id, owner, 'admin');
      return id;
    };
    const mkSection = (project, nm, pos) => { const id = newId(); db.prepare('insert into sections(id,project_id,name,position) values (?,?,?,?)').run(id, project, nm, pos); return id; };
    let pos = 0;
    const mkTask = (ws, project, section, owner, title, extra = {}) => {
      const id = newId();
      db.prepare(`insert into tasks(id,workspace_id,project_id,section_id,parent_id,title,description,assignee_id,owner_id,status,start_date,due_date,is_milestone,estimate_minutes,position,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, ws, project, section, extra.parent || null, title, extra.description || '', extra.assignee || null, owner,
        extra.status || 'todo', extra.start || null, extra.due || null, extra.milestone ? 1 : 0, extra.estimate || null, pos++, now, now);
      return id;
    };
    const pub = mkProject(demo, creds.admin.userId, 'Website refresh', 'Give the public website a fresh look and clearer pricing.', 'workspace');
    const priv = mkProject(demo, creds.admin.userId, 'Payroll cleanup', 'Private: only owners and admins can see this.', 'private');
    const sTodo = mkSection(pub, 'To do', 0), sDoing = mkSection(pub, 'In progress', 1), sDone = mkSection(pub, 'Done', 2), sDisposable = mkSection(pub, 'Scratch', 3);
    const a = mkTask(demo, pub, sTodo, creds.admin.userId, 'Draft new homepage copy', { assignee: creds.member.userId, due: day(3), estimate: 120, description: 'Short, plain, no jargon.' });
    const b = mkTask(demo, pub, sDoing, creds.admin.userId, 'Choose a new colour palette', { assignee: creds.member2.userId, status: 'in_progress', start: day(-2), due: day(5), estimate: 90 });
    const sub = mkTask(demo, pub, sDoing, creds.admin.userId, 'Test contrast on the buttons', { parent: b, assignee: creds.member2.userId, due: day(4) });
    mkTask(demo, pub, sDone, creds.admin.userId, 'Collect the old logo files', { assignee: creds.member.userId, status: 'done', due: day(-4) });
    mkTask(demo, pub, sTodo, creds.admin.userId, 'Launch day', { milestone: true, due: day(14) });
    const disposable = mkTask(demo, pub, sTodo, creds.admin.userId, 'Scratch task to delete', { assignee: creds.member.userId });
    db.prepare('insert into task_dependencies(task_id, depends_on_id) values (?, ?)').run(b, a);   // choosing colours waits on the copy
    const secret = mkTask(demo, priv, null, creds.admin.userId, 'Fix the Friday payroll export');
    db.prepare('insert into project_members(id,project_id,user_id,role) values (?,?,?,?)').run(newId(), pub, creds.guest.userId, 'editor');
    const otherProj = mkProject(other, creds.outsider.userId, 'Other Co onboarding', 'Belongs to another workspace.', 'workspace');
    const otherTask = mkTask(other, otherProj, null, creds.outsider.userId, 'Other Co task');
    const inv = newId();
    db.prepare("insert into invites(id,workspace_id,email,role,token_hash,invited_by,expires_at,created_at) values (?,?,?,?,?,?,?,?)")
      .run(inv, demo, 'new.hire@example.test', 'member', newId() + newId(), creds.admin.userId, new Date(Date.now() + 7 * 86400000).toISOString(), now);
    creds.invites = { pending: inv };
    const mkForm = (nm, slug) => {
      const id = newId();
      db.prepare('insert into forms(id,workspace_id,project_id,name,slug,target_section_id,created_by,created_at,updated_at) values (?,?,?,?,?,?,?,?,?)').run(id, demo, pub, nm, slug, sTodo, creds.admin.userId, now, now);
      return id;
    };
    const supportForm = mkForm('IT support request', 'demo-support-form-slug-0001');
    [['What do you need help with?', 'text', '[]', 1, 'title'], ['Tell us more', 'long_text', '[]', 0, 'description'], ['How urgent is it?', 'single_select', '["Low","Normal","Urgent"]', 0, 'description']]
      .forEach(([label, kind, opts, req, maps], i) => db.prepare('insert into form_questions(id,form_id,label,kind,options_json,required,position,maps_to) values (?,?,?,?,?,?,?,?)').run(newId(), supportForm, label, kind, opts, req, i, maps));
    db.prepare('insert into rules(id,workspace_id,project_id,name,trigger_json,conditions_json,actions_json,enabled,created_by,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId(), demo, pub, 'Assign IT support requests', JSON.stringify({ type: 'form_submitted', formId: supportForm }), '[]', JSON.stringify([{ type: 'assign', userId: creds.member.userId }]), 1, creds.admin.userId, now, now);
    const scratchForm = mkForm('Scratch form', 'demo-scratch-form-slug-00002');
    db.prepare('insert into form_questions(id,form_id,label,kind,options_json,required,position,maps_to) values (?,?,?,?,?,?,?,?)').run(newId(), scratchForm, 'Anything?', 'text', '[]', 0, 0, 'title');
    creds.forms = { pub: supportForm, slug: 'demo-support-form-slug-0001', disposable: scratchForm };
    creds.projects = { pub, priv, otherProj };
    creds.sections = { todo: sTodo, doing: sDoing, done: sDone, disposable: sDisposable };
    creds.tasks = { a, b, sub, disposable, secret, otherTask };
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
