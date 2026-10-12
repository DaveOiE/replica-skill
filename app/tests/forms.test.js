import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';
import { verifyChain } from '../server/audit.js';

const pub = (app, slug, payload) => app.inject({ method: 'POST', url: `/api/v1/public/forms/${slug}/submit`, payload });
const qOf = async (app, slug) => Object.fromEntries((await app.inject(`/api/v1/public/forms/${slug}`)).json().questions.map((q) => [q.label, q]));
const answers = (q, a) => ({ [q['What do you need help with?'].id]: a.title, ...(a.more && { [q['Tell us more'].id]: a.more }), ...(a.urgent && { [q['How urgent is it?'].id]: a.urgent }) });

test('public form reveals only its name and questions: nothing internal, and unknown, closed and archived look identical', async () => {
  const { app, call, creds, db } = await freshApp();
  const r = await app.inject(`/api/v1/public/forms/${creds.forms.slug}`);
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.deepEqual(Object.keys(body).sort(), ['name', 'questions']);
  assert.deepEqual(Object.keys(body.questions[0]).sort(), ['id', 'kind', 'label', 'options', 'required']);
  const text = r.body;
  for (const secret of [creds.projects.pub, creds.workspaces.demo, 'Website refresh', 'Brightside', creds.admin.userId, creds.member.userId, '@example.test']) assert.ok(!text.includes(secret), `leaked ${secret}`);
  const unknown = await app.inject('/api/v1/public/forms/no-such-form');
  await call('admin', 'PATCH', `/api/v1/forms/${creds.forms.disposable}`, { isOpen: false });
  const closed = await app.inject('/api/v1/public/forms/demo-scratch-form-slug-00002');
  await call('admin', 'PATCH', `/api/v1/projects/${creds.projects.pub}`, { archived: true });
  const archived = await app.inject(`/api/v1/public/forms/${creds.forms.slug}`);
  for (const x of [unknown, closed, archived]) assert.deepEqual([x.statusCode, x.body], [404, '{"error":"This form is not available."}']);
  assert.equal(db.prepare('select count(*) n from tasks').get().n > 0, true);
});

test('a request creates a task in the chosen section, assigned by the rule, with a full audit trail and no answers in it', async () => {
  const { app, db, creds } = await freshApp();
  const q = await qOf(app, creds.forms.slug);
  const before = db.prepare('select count(*) n from tasks').get().n;
  const r = await pub(app, creds.forms.slug, { answers: answers(q, { title: 'Printer offline', more: 'Second floor, since 9am', urgent: 'Urgent' }), email: 'client@example.test' });
  assert.deepEqual([r.statusCode, r.json()], [200, { ok: true }], 'nothing about the task comes back');
  assert.equal(db.prepare('select count(*) n from tasks').get().n, before + 1);
  const t = db.prepare("select * from tasks where title = 'Printer offline'").get();
  assert.deepEqual([t.section_id, t.assignee_id, t.status, t.owner_id], [creds.sections.todo, creds.member.userId, 'todo', creds.admin.userId]);
  assert.match(t.description, /Tell us more: Second floor, since 9am/);
  assert.match(t.description, /How urgent is it\?: Urgent/);
  assert.match(t.description, /Submitted by: client@example.test/);
  assert.equal(db.prepare('select count(*) n from form_submissions where task_id = ?').get(t.id).n, 1);
  assert.deepEqual(db.prepare("select status, detail from rule_runs where task_id = ?").all(t.id).map((x) => [x.status, x.detail]), [['ok', 'assigned']]);
  const ev = db.prepare("select action, actor_kind from audit_events where target_id in (?, ?) order by seq").all(t.id, creds.forms.pub).map((e) => `${e.actor_kind}:${e.action}`);
  assert.deepEqual(ev, ['anonymous:form.submit', 'system:rule.assign'].sort((a, b) => ev.indexOf(a) - ev.indexOf(b)));
  assert.ok(ev.includes('anonymous:form.submit') && ev.includes('system:rule.assign'));
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  for (const s of ['Printer offline', 'Second floor', 'client@example.test']) assert.ok(!dump.includes(s), `audit leaked ${s}`);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('validation: required, unknown questions, choices, lengths, email, extra fields, and plain text only', async () => {
  const { app, db, creds } = await freshApp();
  const q = await qOf(app, creds.forms.slug);
  const n = () => db.prepare('select count(*) n from tasks').get().n;
  const start = n();
  const code = async (payload) => (await pub(app, creds.forms.slug, payload)).statusCode;
  assert.equal(await code({ answers: {} }), 400, 'missing required');
  assert.equal(await code({ answers: { ...answers(q, { title: 'x' }), nope: 'y' } }), 400, 'unknown question');
  assert.equal(await code({ answers: answers(q, { title: 'x', urgent: 'Whenever' }) }), 400, 'not one of the choices');
  assert.equal(await code({ answers: answers(q, { title: 'x'.repeat(301) }) }), 400, 'title too long');
  assert.equal(await code({ answers: answers(q, { title: 'x', more: 'y'.repeat(5001) }) }), 400);
  assert.equal(await code({ answers: answers(q, { title: 'x' }), email: 'not-an-email' }), 400);
  assert.equal(await code({ answers: answers(q, { title: 'x' }), admin: true }), 400, 'extra field refused');
  assert.equal(await code({ answers: [] }), 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/public/forms/${creds.forms.slug}/submit`, payload: 'x'.repeat(200000), headers: { 'content-type': 'application/json' } })).statusCode, 413);
  assert.equal(n(), start, 'nothing created by any bad request');
  assert.equal(await code({ answers: answers(q, { title: '<img src=x onerror=alert(1)>\u0007 hi' }) }), 200);
  assert.equal(db.prepare("select title from tasks order by created_at desc, rowid desc limit 1").get().title, '<img src=x onerror=alert(1)> hi', 'control characters removed, markup kept as text');
});

test('spam controls: a filled honeypot creates nothing, and submissions are rate limited per address and per form', async () => {
  const { app, db, creds } = await freshApp({ formPerMinute: 3, formPerHour: 5 });
  const q = await qOf(app, creds.forms.slug);
  const start = db.prepare('select count(*) n from tasks').get().n;
  const bot = await pub(app, creds.forms.slug, { answers: answers(q, { title: 'Buy cheap watches' }), website: 'http://spam.example' });
  assert.deepEqual([bot.statusCode, bot.json()], [200, { ok: true }]);
  assert.equal(db.prepare('select count(*) n from tasks').get().n, start, 'honeypot created nothing');
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await pub(app, creds.forms.slug, { answers: answers(q, { title: `Real ${i}` }) })).statusCode);
  assert.deepEqual(codes, [200, 200, 429, 429, 429], 'three a minute per address (the honeypot counted as one)');
  const { app: app2, creds: c2 } = await freshApp({ formPerMinute: 100, formPerHour: 2 });
  const q2 = await qOf(app2, c2.forms.slug);
  const c = [];
  for (let i = 0; i < 4; i++) c.push((await pub(app2, c2.forms.slug, { answers: answers(q2, { title: `T${i}` }) })).statusCode);
  assert.deepEqual(c, [200, 200, 429, 429], 'per-form hourly cap');
});

test('the rule fails safely: if the chosen person loses access, the task is still created, unassigned, and the problem is recorded', async () => {
  const { app, call, db, creds } = await freshApp();
  await call('admin', 'PATCH', `/api/v1/projects/${creds.projects.pub}`, { visibility: 'private' }); // Sam is now outside the project
  const q = await qOf(app, creds.forms.slug);
  assert.equal((await pub(app, creds.forms.slug, { answers: answers(q, { title: 'Nobody can take this' }) })).statusCode, 200);
  const t = db.prepare("select * from tasks where title = 'Nobody can take this'").get();
  assert.equal(t.assignee_id, null);
  assert.equal(db.prepare('select status from rule_runs where task_id = ?').get(t.id).status, 'error');
  assert.match(db.prepare('select last_error from rules where json_extract(trigger_json, \'$.formId\') = ?').get(creds.forms.pub).last_error, /can no longer see/);
  assert.equal((await call('admin', 'GET', `/api/v1/projects/${creds.projects.pub}/forms`)).json().forms.find((f) => f.id === creds.forms.pub).lastRuleError !== null, true, 'admins can see the problem');
});

test('building forms: project admins only, assignee must see the project, one title question, choices needed, delete closes the public link', async () => {
  const { app, call, db, creds } = await freshApp();
  const url = `/api/v1/projects/${creds.projects.pub}/forms`;
  const good = { name: 'Access request', questions: [{ label: 'Who?', kind: 'text', required: true, mapsTo: 'title' }], assigneeId: creds.member2.userId };
  for (const who of ['member', 'viewonly', 'guest']) assert.equal((await call(who, 'POST', url, good)).statusCode, 403, who);
  assert.equal((await call('outsider', 'POST', url, good)).statusCode, 404);
  assert.equal((await call('admin', 'POST', url, { ...good, assigneeId: creds.outsider.userId })).statusCode, 400, 'assignee from another workspace');
  assert.equal((await call('admin', 'POST', url, { ...good, questions: [{ label: 'A', kind: 'text', mapsTo: 'title' }, { label: 'B', kind: 'text', mapsTo: 'title' }] })).statusCode, 400);
  assert.equal((await call('admin', 'POST', url, { ...good, questions: [{ label: 'Pick', kind: 'single_select', options: ['Only one'] }] })).statusCode, 400);
  assert.equal((await call('admin', 'POST', url, { ...good, targetSectionId: 'nope' })).statusCode, 400);
  const made = await call('admin', 'POST', url, good);
  assert.equal(made.statusCode, 201);
  const slug = made.json().slug;
  assert.ok(slug.length >= 20, 'unguessable link');
  assert.equal((await app.inject(`/api/v1/public/forms/${slug}`)).statusCode, 200);
  assert.equal((await call('admin', 'PATCH', `/api/v1/forms/${made.json().id}`, { assigneeId: null })).json().assigneeId, null);
  assert.equal(db.prepare("select count(*) n from rules where json_extract(trigger_json, '$.formId') = ?").get(made.json().id).n, 0, 'clearing the assignee removes the rule');
  assert.equal((await call('admin', 'DELETE', `/api/v1/forms/${made.json().id}`)).statusCode, 200);
  assert.equal((await app.inject(`/api/v1/public/forms/${slug}`)).statusCode, 404);
  const ev = db.prepare("select action from audit_events where action like 'form.%' order by seq").all().map((e) => e.action);
  assert.deepEqual(ev, ['form.create', 'form.update', 'form.delete']);
});
