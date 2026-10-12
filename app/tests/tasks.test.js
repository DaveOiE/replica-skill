import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

const P = (c) => c.projects.pub;

test('tasks: create, list, open, change, delete, each audited with before and after', async () => {
  const { call, db, creds } = await freshApp();
  const made = await call('member', 'POST', `/api/v1/projects/${P(creds)}/tasks`, { title: 'Order business cards', sectionId: creds.sections.todo, assigneeId: creds.member2.userId, dueDate: '2030-03-01', estimateMinutes: 30 });
  assert.equal(made.statusCode, 201);
  const id = made.json().id;
  const list = (await call('member', 'GET', `/api/v1/projects/${P(creds)}/tasks`)).json();
  const t = list.tasks.find((x) => x.id === id);
  assert.deepEqual([t.title, t.assigneeName, t.dueDate, t.status], ['Order business cards', 'Priya Nair', '2030-03-01', 'todo']);
  const ch = await call('member', 'PATCH', `/api/v1/tasks/${id}`, { status: 'in_progress', dueDate: null });
  assert.equal(ch.json().dueDate, null);
  const ev = db.prepare("select * from audit_events where action = 'task.update' order by seq desc limit 1").get();
  assert.deepEqual(JSON.parse(ev.before_json), { status: 'todo', dueDate: '2030-03-01' });
  assert.equal(JSON.parse(ev.after_json).status, 'in_progress');
  assert.equal((await call('member', 'DELETE', `/api/v1/tasks/${id}`)).statusCode, 200);
  assert.equal((await call('member', 'GET', `/api/v1/tasks/${id}`)).statusCode, 404);
});

test('tasks: completing sets and clears completed_at', async () => {
  const { call, db, creds } = await freshApp();
  await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { status: 'done' });
  assert.ok(db.prepare('select completed_at from tasks where id = ?').get(creds.tasks.a).completed_at);
  await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { status: 'todo' });
  assert.equal(db.prepare('select completed_at from tasks where id = ?').get(creds.tasks.a).completed_at, null);
});

test('tasks: bad input is refused with plain messages', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/projects/${P(creds)}/tasks`;
  assert.equal((await call('member', 'POST', url, { title: '' })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: 'x'.repeat(301) })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: 'x', dueDate: '31/10/2026' })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: 'x', dueDate: '2026-02-31x' })).statusCode, 400);
  const dates = await call('member', 'POST', url, { title: 'x', startDate: '2030-05-02', dueDate: '2030-05-01' });
  assert.equal(dates.statusCode, 400);
  assert.match(dates.json().error, /start date/);
  assert.equal((await call('member', 'POST', url, { title: 'x', sectionId: 'nope' })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: 'x', role: 'admin' })).statusCode, 400, 'unknown keys refused');
  assert.equal((await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, {})).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: '<img src=x onerror=alert(1)>' })).statusCode, 201, 'markup is stored as plain text');
});

test('assignees: only people who can see the project', async () => {
  const { call, creds } = await freshApp();
  const patch = (assignee, id = creds.tasks.a) => call('admin', 'PATCH', `/api/v1/tasks/${id}`, { assigneeId: assignee });
  assert.equal((await patch(creds.guest.userId)).statusCode, 200, 'the guest was added to this project');
  assert.equal((await patch(creds.outsider.userId)).statusCode, 400, 'someone from another workspace');
  const hidden = await call('admin', 'POST', '/api/v1/projects', { name: 'Admin only', visibility: 'private' });
  const t = await call('admin', 'POST', `/api/v1/projects/${hidden.json().id}/tasks`, { title: 'Secret', assigneeId: creds.member.userId });
  assert.equal(t.statusCode, 400, 'a member cannot be given work in a project they cannot see');
});

test('subtasks: one level only, same project, listed with the parent', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/projects/${P(creds)}/tasks`;
  const ok = await call('member', 'POST', url, { title: 'Proofread', parentId: creds.tasks.a });
  assert.equal(ok.statusCode, 201);
  assert.equal((await call('member', 'POST', url, { title: 'Too deep', parentId: ok.json().id })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { title: 'Wrong project', parentId: creds.tasks.otherTask })).statusCode, 400);
  const d = (await call('member', 'GET', `/api/v1/tasks/${creds.tasks.a}`)).json();
  assert.deepEqual(d.subtasks.map((s) => s.title), ['Proofread']);
  await call('member', 'DELETE', `/api/v1/tasks/${creds.tasks.a}`);
  assert.equal((await call('member', 'GET', `/api/v1/tasks/${ok.json().id}`)).statusCode, 404, 'subtasks go with their parent');
});

test('dependencies: no loops, no cross-project, blocked tasks cannot be completed except by a project admin', async () => {
  const { call, db, creds } = await freshApp();
  const { a, b } = creds.tasks; // seed: b waits on a
  const loop = await call('member', 'POST', `/api/v1/tasks/${a}/dependencies`, { dependsOnId: b });
  assert.equal(loop.statusCode, 409);
  assert.match(loop.json().error, /loop/);
  assert.equal((await call('member', 'POST', `/api/v1/tasks/${a}/dependencies`, { dependsOnId: a })).statusCode, 400);
  assert.equal((await call('member', 'POST', `/api/v1/tasks/${a}/dependencies`, { dependsOnId: creds.tasks.otherTask })).statusCode, 400);
  const blocked = await call('member', 'PATCH', `/api/v1/tasks/${b}`, { status: 'done' });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.json().error, /Draft new homepage copy/);
  const detail = (await call('member', 'GET', `/api/v1/tasks/${b}`)).json();
  assert.deepEqual(detail.blockedBy.map((x) => x.id), [a]);
  assert.equal((await call('admin', 'PATCH', `/api/v1/tasks/${b}`, { status: 'done' })).statusCode, 200, 'project admin may override');
  assert.equal(JSON.parse(db.prepare("select after_json from audit_events where action = 'task.update' order by seq desc limit 1").get().after_json).override, true);
  assert.equal((await call('member', 'DELETE', `/api/v1/tasks/${b}/dependencies/${a}`)).statusCode, 200);
  assert.equal((await call('member', 'DELETE', `/api/v1/tasks/${b}/dependencies/${a}`)).statusCode, 404);
});

test('comments: commenters and up may comment; viewers may not; author and time are the server\'s, not the client\'s', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/tasks/${creds.tasks.a}/comments`;
  assert.equal((await call('viewonly', 'POST', url, { body: 'hi' })).statusCode, 403);
  assert.equal((await call('guest', 'POST', url, { body: 'From the client side' })).statusCode, 201);
  assert.equal((await call('member', 'POST', url, { body: '  ' })).statusCode, 400);
  assert.equal((await call('member', 'POST', url, { body: 'x', authorId: creds.owner.userId })).statusCode, 400);
  const d = (await call('viewonly', 'GET', `/api/v1/tasks/${creds.tasks.a}`)).json();
  assert.deepEqual(d.comments.map((c) => c.author), ['Casey Dunn']);
});

test('hidden and foreign tasks: 404 for every call, never a hint they exist', async () => {
  const { call, creds } = await freshApp();
  const id = creds.tasks.secret;
  for (const [m, u, b] of [['GET', `/api/v1/tasks/${id}`], ['PATCH', `/api/v1/tasks/${id}`, { title: 'x' }], ['DELETE', `/api/v1/tasks/${id}`], ['POST', `/api/v1/tasks/${id}/comments`, { body: 'x' }]])
    for (const who of ['member', 'guest', 'viewonly', 'outsider']) assert.equal((await call(who, m, u, b)).statusCode, 404, `${who} ${m}`);
  assert.equal((await call('admin', 'GET', `/api/v1/tasks/${id}`)).statusCode, 200);
  assert.equal((await call('outsider', 'GET', `/api/v1/tasks/${creds.tasks.a}`)).statusCode, 404);
});

test('my tasks: only mine, only open, soonest first, never from a project I cannot see', async () => {
  const { call, db, creds } = await freshApp();
  const mine = (await call('member', 'GET', '/api/v1/me/tasks')).json().tasks;
  assert.ok(mine.length >= 2 && mine.every((t) => t.assigneeId === creds.member.userId && t.status !== 'done'));
  assert.ok(mine.every((t) => t.projectName === 'Website refresh'));
  const dues = mine.map((t) => t.dueDate).filter(Boolean);
  assert.deepEqual(dues, [...dues].sort());
  db.prepare('update tasks set assignee_id = ? where id = ?').run(creds.member.userId, creds.tasks.secret); // assigned, but project is private
  assert.ok(!(await call('member', 'GET', '/api/v1/me/tasks')).json().tasks.some((t) => t.id === creds.tasks.secret));
});

test('archived projects are read-only for tasks', async () => {
  const { call, creds } = await freshApp();
  await call('admin', 'PATCH', `/api/v1/projects/${P(creds)}`, { archived: true });
  assert.equal((await call('member', 'POST', `/api/v1/projects/${P(creds)}/tasks`, { title: 'x' })).statusCode, 409);
  assert.equal((await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { title: 'y' })).statusCode, 409);
  assert.equal((await call('member', 'GET', `/api/v1/tasks/${creds.tasks.a}`)).statusCode, 200);
});
