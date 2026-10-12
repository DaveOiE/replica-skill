import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

const get = async (call, who) => (await call(who, 'GET', '/api/v1/reports/summary')).json();

test('summary numbers match the seeded work, counted by hand', async () => {
  const { call } = await freshApp();
  const r = await get(call, 'member');
  // Website refresh: open = a, b, sub, launch, scratch; done = the logo task. a(+3d) b(+5d) sub(+4d) are due inside a week.
  assert.deepEqual(r.totals, { open: 5, overdue: 0, dueSoon: 3, doneRecently: 0 });
  assert.deepEqual(r.byStatus, { todo: 4, in_progress: 1, blocked: 0, done: 1 });
  assert.deepEqual(r.byAssignee, [{ name: 'Priya Nair', open: 2 }, { name: 'Sam Okafor', open: 2 }, { name: null, open: 1 }]);
  assert.deepEqual(r.byProject.map((p) => [p.name, p.done, p.total]), [['Website refresh', 1, 6]]);
});

test('summary only counts what the caller can see', async () => {
  const { call, creds } = await freshApp();
  assert.deepEqual((await get(call, 'owner')).byProject.map((p) => p.name), ['Payroll cleanup', 'Website refresh'], 'owner sees the private project');
  assert.equal((await get(call, 'owner')).totals.open, 6);
  assert.deepEqual((await get(call, 'member')).byProject.map((p) => p.name), ['Website refresh'], 'members do not');
  assert.deepEqual((await get(call, 'guest')).byProject.map((p) => p.name), ['Website refresh']);
  const out = await get(call, 'outsider');
  assert.deepEqual(out.byProject.map((p) => p.name), ['Other Co onboarding']);
  assert.equal(out.totals.open, 1);
  assert.ok(!JSON.stringify(out).includes('Sam Okafor'), 'no names from another workspace');
  assert.equal((await call(null, 'GET', '/api/v1/reports/summary')).statusCode, 401);
});

test('the numbers move when the work does: overdue, done this week, archived projects drop out', async () => {
  const { call, creds } = await freshApp();
  await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { dueDate: '2020-01-01' });
  await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.disposable}`, { status: 'done' });
  const r = await get(call, 'member');
  assert.equal(r.totals.overdue, 1);
  assert.equal(r.totals.doneRecently, 1);
  assert.equal(r.totals.dueSoon, 2);
  assert.equal(r.totals.open, 4);
  await call('admin', 'PATCH', `/api/v1/projects/${creds.projects.pub}`, { archived: true });
  assert.deepEqual((await get(call, 'member')).byProject, []);
});
