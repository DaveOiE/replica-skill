import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';
import { fieldsOnly, NOT_RECORDED, appendAudit, verifyChain } from '../server/audit.js';
import { parseCsv } from '../server/csv.js';
import { SAMPLE_CSV } from '../server/routes-jobs.js';

// The audit trail holds ids and field names, never text a person typed. Every kind of change below is made with
// invented marker text in every free-text field, and the audit rows written by that change are then scanned.
const M = 'zqxmark';
const word = (label) => `${label} ${M} ${label.length}`;
const email = (label) => `${label}.${M}@example.test`;

const rowsSince = (db, seq) => db.prepare('select * from audit_events where seq > ? order by seq').all(seq);
const lastSeq = (db) => db.prepare('select coalesce(max(seq),0) n from audit_events').get().n;
const STRING_OK = [/^[\w-]{1,64}$/, /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/, /^[a-z_:]{1,32}$/];
function strings(v, out = []) { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; }

function scan(rows, extra = []) {
  for (const r of rows) {
    const all = `${r.summary} ${r.before_json} ${r.after_json} ${r.target_id}`.toLowerCase();
    assert.ok(!all.includes(M), `free text reached the audit trail in ${r.action}: ${all}`);
    for (const x of extra) assert.ok(!all.includes(x.toLowerCase()), `${x} reached the audit trail in ${r.action}`);
    assert.doesNotMatch(all, /@example\.test/, `an email address reached the audit trail in ${r.action}`);
    for (const j of [r.before_json, r.after_json]) for (const s of strings(j ? JSON.parse(j) : null)) assert.ok(s === NOT_RECORDED || STRING_OK.some((re) => re.test(s)), `${r.action} recorded text-like value "${s}"`);
  }
}

test('no audit row holds free text after any kind of change (projects, sections, tasks, comments, forms, people, invites, service accounts, workspace, sign-in, ingest, import)', async () => {
  const { app, db, call, creds } = await freshApp();
  const pub = creds.projects.pub;
  const seen = [];
  const step = async (name, fn, extra) => {
    const from = lastSeq(db);
    const out = await fn();
    const rows = rowsSince(db, from);
    assert.ok(rows.length > 0, `${name}: no audit row was written at all`);
    scan(rows, extra); seen.push(...rows.map((r) => r.action));
    return out;
  };
  const ok = (r, ...codes) => { assert.ok((codes.length ? codes : [200, 201]).includes(r.statusCode), `${r.statusCode} ${r.body}`); return r.json(); };

  const proj = await step('project create', async () => ok(await call('admin', 'POST', '/api/v1/projects', { name: word('Project name'), description: word('Project description') })));
  await step('project update', async () => ok(await call('admin', 'PATCH', `/api/v1/projects/${proj.id}`, { name: word('Renamed'), description: word('New description') })));
  const sec = await step('section create', async () => ok(await call('admin', 'POST', `/api/v1/projects/${proj.id}/sections`, { name: word('Section') })));
  await step('section rename', async () => ok(await call('admin', 'PATCH', `/api/v1/sections/${sec.id}`, { name: word('Section renamed') })));
  await step('section delete', async () => ok(await call('admin', 'DELETE', `/api/v1/sections/${sec.id}`)));

  const t1 = await step('task create', async () => ok(await call('member', 'POST', `/api/v1/projects/${pub}/tasks`, { title: word('Task title'), description: word('Task description') })));
  const t2 = await step('task create 2', async () => ok(await call('member', 'POST', `/api/v1/projects/${pub}/tasks`, { title: word('Second task') })));
  await step('task edit', async () => ok(await call('member', 'PATCH', `/api/v1/tasks/${t1.id}`, { title: word('Edited title'), description: word('Edited description'), status: 'in_progress', dueDate: '2030-01-02' })));
  await step('task edit staff fields', async () => ok(await call('member', 'PATCH', `/api/v1/tasks/${t1.id}`, { lane: word('Lane'), jobNumber: `${M}-J1`, promisedDate: '2030-02-03' })));
  await step('comment', async () => ok(await call('member', 'POST', `/api/v1/tasks/${t1.id}/comments`, { body: word('Comment body') })));
  await step('dependency add', async () => ok(await call('member', 'POST', `/api/v1/tasks/${t1.id}/dependencies`, { dependsOnId: t2.id })));
  await step('dependency remove', async () => ok(await call('member', 'DELETE', `/api/v1/tasks/${t1.id}/dependencies/${t2.id}`)));
  await step('task delete', async () => ok(await call('member', 'DELETE', `/api/v1/tasks/${t1.id}`)), [word('Edited title'), word('Task title')]);

  const form = await step('form create', async () => ok(await call('admin', 'POST', `/api/v1/projects/${pub}/forms`, { name: word('Form name'), questions: [{ label: word('Question'), kind: 'text', required: true, mapsTo: 'title' }, { label: word('Pick'), kind: 'single_select', options: [word('One'), word('Two')] }] })));
  await step('form update', async () => ok(await call('admin', 'PATCH', `/api/v1/forms/${form.id}`, { name: word('Form renamed') })));
  const q = (await app.inject(`/api/v1/public/forms/${form.slug}`)).json().questions;
  await step('form submit (public)', async () => ok(await app.inject({ method: 'POST', url: `/api/v1/public/forms/${form.slug}/submit`, payload: { answers: { [q[0].id]: word('Answer title'), [q[1].id]: word('One') }, email: email('submitter') } })));
  await step('form delete', async () => ok(await call('admin', 'DELETE', `/api/v1/forms/${form.id}`)));

  const person = await step('person added', async () => ok(await call('admin', 'POST', '/api/v1/members', { name: word('Person name'), email: email('newperson'), role: 'member' })));
  await step('role change', async () => ok(await call('admin', 'PATCH', `/api/v1/members/${person.userId}/role`, { role: 'view_only' })));
  const inv = await step('invite create', async () => ok(await call('admin', 'POST', '/api/v1/invites', { email: email('invitee'), role: 'guest' })));
  await step('invite revoke', async () => ok(await call('admin', 'DELETE', `/api/v1/invites/${inv.id}`)));
  await step('project member set', async () => ok(await call('admin', 'PUT', `/api/v1/projects/${pub}/members`, { userId: creds.member2.userId, role: 'commenter' })));
  await step('project member remove', async () => ok(await call('admin', 'DELETE', `/api/v1/projects/${pub}/members/${creds.member2.userId}`)));

  const acct = await step('service account create', async () => ok(await call('admin', 'POST', '/api/v1/service-accounts', { name: word('Service name') })));
  const tok = await step('service token create', async () => ok(await call('admin', 'POST', `/api/v1/service-accounts/${acct.id}/tokens`, { label: word('Token label'), scopes: ['tasks:read'] })));
  await step('service token revoke', async () => ok(await call('admin', 'DELETE', `/api/v1/service-accounts/${acct.id}/tokens/${tok.id}`)));
  await step('service account deactivate', async () => ok(await call('admin', 'DELETE', `/api/v1/service-accounts/${acct.id}`)));

  await step('workspace update', async () => ok(await call('admin', 'PATCH', '/api/v1/workspace', { name: word('Workspace name') })));
  // an attempt for an account that does not exist is not written to any workspace's trail at all (it is only counted)
  { const from = lastSeq(db);
    ok(await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: email('nobody'), password: 'not-a-real-password-1', workspace: 'demo' } }), 401);
    assert.equal(rowsSince(db, from).length, 0, 'unknown-account attempts leave no audit row'); }
  await step('failed sign-in, known email', async () => ok(await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.viewonly.email, password: 'not-a-real-password-2' } }), 401));

  await step('ingest', async () => ok(await app.inject({ method: 'POST', url: '/api/v1/ingest/tasks', headers: { authorization: `Bearer ${creds.svc.write.token}` },
    payload: { idempotency_key: `${M}-key-123456789`, context: 'client_job', client_slug: `${M}-client`, job_number: `${M}-J9`, title: word('Ingested title'), description: word('Ingested description'), assignee: word('Nobody Here'), lane: word('Ingested lane'), source_call_id: `${M}-call-1` } })));

  const rows = parseCsv(SAMPLE_CSV).flat().map((c) => String(c).trim()).filter((c) => c.length > 4 && !/^[\d\-/. :]+$/.test(c));
  await step('job import', async () => ok(await call('admin', 'POST', '/api/v1/jobs/import', { csv: SAMPLE_CSV, visibility: 'private' })), rows.slice(0, 25));

  for (const a of ['project.create', 'project.update', 'section.create', 'section.rename', 'section.delete', 'task.create', 'task.update', 'task.delete', 'comment.create', 'dependency.add', 'dependency.remove', 'form.create', 'form.update', 'form.submit', 'form.delete', 'member.create', 'member.role_change', 'invite.create', 'invite.revoke', 'project.member_set', 'project.member_remove', 'service_account.create', 'service_token.create', 'service_token.revoke', 'service_account.deactivate', 'workspace.update', 'auth.signin_failed', 'task.ingest', 'jobs.import'])
    assert.ok(seen.includes(a), `the scan never saw a ${a} event`);
  // the whole log, once more, and the chain still verifies
  scan(db.prepare('select * from audit_events').all().filter((r) => !/^workspace\.seed$/.test(r.action)));
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('what a change still records: ids, field names, numbers, booleans, dates and fixed-vocabulary values', async () => {
  const { db, call, creds } = await freshApp();
  const t = (await call('member', 'POST', `/api/v1/projects/${creds.projects.pub}/tasks`, { title: 'Plain title' })).json();
  await call('member', 'PATCH', `/api/v1/tasks/${t.id}`, { title: 'Another title', status: 'blocked', dueDate: '2030-05-06', estimateMinutes: 30 });
  const ev = db.prepare("select * from audit_events where action = 'task.update' order by seq desc").get();
  assert.deepEqual(JSON.parse(ev.after_json), { title: NOT_RECORDED, status: 'blocked', dueDate: '2030-05-06', estimateMinutes: 30 });
  assert.deepEqual(Object.keys(JSON.parse(ev.before_json)), ['title', 'status', 'dueDate', 'estimateMinutes']);
  assert.equal(ev.target_id, t.id);
  assert.deepEqual(fieldsOnly({ name: 'Acme', note: ['a b'], role: 'view_only', count: 3, ok: true, nope: null, taskId: 'abc-123', other: { title: 'x y' } }),
    { name: NOT_RECORDED, note: NOT_RECORDED, role: 'view_only', count: 3, ok: true, nope: null, taskId: 'abc-123', other: { title: NOT_RECORDED } });
});

test('the guard is in the write path: a careless caller passing typed text still records only field names', async () => {
  const { db, creds } = await freshApp();
  appendAudit(db, { workspaceId: creds.workspaces.demo, actorKind: 'system', action: 'test.careless', targetType: 'task', targetId: 't1', summary: 'Careless write',
    before: { title: 'Secret client title', lane: 'x y z' }, after: { description: 'More typed text', status: 'done', comment: 'hello there' } });
  const ev = db.prepare("select * from audit_events where action = 'test.careless'").get();
  assert.deepEqual([JSON.parse(ev.before_json), JSON.parse(ev.after_json)], [{ title: NOT_RECORDED, lane: NOT_RECORDED }, { description: NOT_RECORDED, status: 'done', comment: NOT_RECORDED }]);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});
