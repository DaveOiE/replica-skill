import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

test('projects: who sees what', async () => {
  const { call, creds } = await freshApp();
  const names = async (key) => (await call(key, 'GET', '/api/v1/projects')).json().projects.map((p) => p.name).sort();
  assert.deepEqual(await names('owner'), ['Payroll cleanup', 'Website refresh']);
  assert.deepEqual(await names('admin'), ['Payroll cleanup', 'Website refresh']);
  assert.deepEqual(await names('member'), ['Website refresh'], 'private project is invisible to a member');
  assert.deepEqual(await names('viewonly'), ['Website refresh']);
  assert.deepEqual(await names('guest'), ['Website refresh'], 'guest sees only where added');
  assert.equal((await call('member', 'GET', `/api/v1/projects/${creds.projects.priv}`)).statusCode, 404, 'hidden looks the same as missing');
  const roles = async (key) => (await call(key, 'GET', `/api/v1/projects/${creds.projects.pub}`)).json().myRole;
  assert.deepEqual([await roles('admin'), await roles('member'), await roles('viewonly'), await roles('guest')], ['admin', 'editor', 'viewer', 'editor']);
});

test('projects: create gives default sections and makes the creator project admin; audited', async () => {
  const { call, db } = await freshApp();
  const r = await call('member', 'POST', '/api/v1/projects', { name: 'Office move', visibility: 'private' });
  assert.equal(r.statusCode, 201);
  const p = (await call('member', 'GET', `/api/v1/projects/${r.json().id}`)).json();
  assert.deepEqual(p.sections.map((s) => s.name), ['To do', 'In progress', 'Done']);
  assert.equal(p.myRole, 'admin');
  assert.equal((await call('admin', 'GET', `/api/v1/projects/${r.json().id}`)).statusCode, 200, 'workspace admins see everything');
  assert.equal((await call('viewonly', 'POST', '/api/v1/projects', { name: 'x' })).statusCode, 403);
  assert.equal(db.prepare("select count(*) n from audit_events where action = 'project.create'").get().n, 1);
});

test('projects: only project admins change settings; members edit work but not settings', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/projects/${creds.projects.pub}`;
  assert.equal((await call('member', 'PATCH', url, { name: 'Nope' })).statusCode, 403);
  assert.equal((await call('guest', 'PATCH', url, { name: 'Nope' })).statusCode, 403);
  const r = await call('admin', 'PATCH', url, { name: 'Website refresh', archived: true });
  assert.equal(r.json().archived, true);
  assert.equal((await call('admin', 'PATCH', url, {})).statusCode, 400);
  assert.equal((await call('admin', 'PATCH', url, { visibility: 'everyone' })).statusCode, 400);
});

test('sections: add, rename, delete, only by project admins; deleting keeps the tasks', async () => {
  const { call, db, creds } = await freshApp();
  assert.equal((await call('member', 'POST', `/api/v1/projects/${creds.projects.pub}/sections`, { name: 'x' })).statusCode, 403);
  const add = await call('admin', 'POST', `/api/v1/projects/${creds.projects.pub}/sections`, { name: 'Blocked' });
  assert.equal(add.statusCode, 201);
  assert.equal((await call('admin', 'PATCH', `/api/v1/sections/${add.json().id}`, { name: 'Waiting' })).json().name, 'Waiting');
  const withTask = creds.sections.disposable;
  db.prepare('update tasks set section_id = ? where id = ?').run(withTask, creds.tasks.a);
  await call('admin', 'DELETE', `/api/v1/sections/${withTask}`);
  assert.equal(db.prepare('select section_id from tasks where id = ?').get(creds.tasks.a).section_id, null, 'task survives, just unsectioned');
  assert.equal((await call('outsider', 'PATCH', `/api/v1/sections/${creds.sections.todo}`, { name: 'x' })).statusCode, 404);
});

test('team rules: a view-only team caps its members at viewer; a team project reaches team members only', async () => {
  const { call, db, creds } = await freshApp();
  const mk = (id, vo) => db.prepare("insert into teams(id,workspace_id,name,view_only,created_at,updated_at) values (?,?,?,?,'t','t')").run(id, creds.workspaces.demo, id, vo);
  mk('t-ro', 1); mk('t-rw', 0);
  db.prepare("insert into team_members values ('t-ro', ?)").run(creds.member2.userId);
  db.prepare("insert into project_members(id,project_id,team_id,role) values ('pm1', ?, 't-ro', 'admin')").run(creds.projects.pub);
  assert.equal((await call('member2', 'GET', `/api/v1/projects/${creds.projects.pub}`)).json().myRole, 'editor', 'workspace-visible: editor');
  db.prepare("update projects set visibility = 'team', team_id = 't-rw' where id = ?").run(creds.projects.pub);
  assert.equal((await call('member2', 'GET', `/api/v1/projects/${creds.projects.pub}`)).json().myRole, 'viewer', 'only the view-only team grants access, at viewer');
  assert.equal((await call('member', 'GET', `/api/v1/projects/${creds.projects.pub}`)).statusCode, 404, 'not on the team, not in the project');
});

test('people on a project: only those who can see it, names only', async () => {
  const { call, creds } = await freshApp();
  const names = async (key, id) => (await call(key, 'GET', `/api/v1/projects/${id}/people`)).json().people?.map((x) => x.name).sort();
  assert.deepEqual(await names('member', creds.projects.pub), ['Avery Quinn', 'Casey Dunn', 'Jordan Reyes', 'Morgan Lee', 'Priya Nair', 'Sam Okafor']);
  assert.deepEqual(await names('admin', creds.projects.priv), ['Avery Quinn', 'Jordan Reyes'], 'private project: only owner and admin');
  assert.equal((await call('member', 'GET', `/api/v1/projects/${creds.projects.priv}/people`)).statusCode, 404);
  assert.ok(!JSON.stringify((await call('member', 'GET', `/api/v1/projects/${creds.projects.pub}/people`)).json()).includes('@'), 'no email addresses');
});
