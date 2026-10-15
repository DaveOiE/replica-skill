import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';
import { routeFor } from '../server/routes-ingest.js';
import { verifyChain } from '../server/audit.js';

// All invented: example.test staff, made-up client slugs and call ids.
let n = 0;
const body = (o = {}) => ({ idempotency_key: `test-key-${++n}-abcdefgh`, context: 'client_job', client_slug: 'brightwater-cafe', job_number: 'J9075P', title: 'Send the revised quote', ...o });
const post = (app, tok, payload) => app.inject({ method: 'POST', url: '/api/v1/ingest/tasks', payload, headers: { authorization: `Bearer ${tok}` } });
const proj = (db, id) => db.prepare('select p.* from projects p join tasks t on t.project_id = p.id where t.id = ?').get(id);

test('routing rules, as a pure function (ADL-066)', () => {
  assert.deepEqual(routeFor({ context: 'prospect', client_slug: 'a' }), { kind: 'sales' });
  assert.deepEqual(routeFor({ context: 'client_job', client_slug: 'a', job_number: 'J1' }), { kind: 'client', clientSlug: 'a' });
  assert.deepEqual(routeFor({ context: 'internal_job', job_number: 'J2' }), { kind: 'internal' });
  assert.deepEqual(routeFor({ context: 'internal_job', job_number: 'J2', subtype: 'Business Development' }), { kind: 'sales' });
  assert.deepEqual(routeFor({ context: 'internal_job', job_number: 'J2', subtype: '  business development ' }), { kind: 'sales' });
  assert.deepEqual(routeFor({ context: 'internal_job', job_number: 'J2', subtype: 'admin' }), { kind: 'internal' });
  for (const bad of [{ context: 'prospect' }, { context: 'client_job', client_slug: 'a' }, { context: 'client_job', job_number: 'J1' }, { context: 'internal_job' }, { context: 'internal_job', subtype: 'business development' }])
    assert.ok(routeFor(bad).reject, JSON.stringify(bad));
});

test('each rule files the task where ADL-066 says, and reuses the project next time', async () => {
  const { app, db, creds } = await freshApp();
  const t = creds.svc.write.token;
  const sales = await post(app, t, body({ context: 'prospect', job_number: undefined, client_slug: 'harbour-dental' }));
  const sales2 = await post(app, t, body({ context: 'prospect', job_number: undefined, client_slug: 'other-prospect' }));
  assert.deepEqual([sales.statusCode, sales.json().project.kind, sales.json().project.name], [201, 'sales', 'Sales']);
  assert.equal(sales2.json().project.id, sales.json().project.id, 'the one Sales project, whichever prospect');
  const c1 = await post(app, t, body()), c1b = await post(app, t, body({ title: 'Another action' })), c2 = await post(app, t, body({ client_slug: 'nimbus-legal', job_number: 'J9100A' }));
  assert.equal(c1b.json().project.id, c1.json().project.id, 'same client, same project');
  assert.notEqual(c2.json().project.id, c1.json().project.id, 'another client, another project');
  assert.deepEqual([c1.json().project.kind, c1.json().project.name], ['client', 'brightwater-cafe']);
  const i1 = await post(app, t, body({ context: 'internal_job', client_slug: undefined, job_number: 'J0007I' }));
  assert.deepEqual([i1.json().project.kind, i1.json().project.name], ['internal', 'Internal']);
  const bd = await post(app, t, body({ context: 'internal_job', client_slug: undefined, job_number: 'J0008I', subtype: 'business development' }));
  assert.equal(bd.json().project.id, sales.json().project.id, 'business development goes to Sales');
  assert.equal(db.prepare("select count(*) n from projects where kind = 'sales'").get().n, 1);
  assert.equal(db.prepare("select count(*) n from projects where kind = 'internal'").get().n, 1);
  assert.deepEqual(db.prepare('select name from sections where project_id = ? order by position').all(c1.json().project.id).map((x) => x.name), ['To do', 'In progress', 'Done']);
  assert.equal(db.prepare('select count(*) n from projects where job_number is not null').get().n, 0, 'imported per-job projects are never created or touched');
  assert.equal(db.prepare("select visibility from projects where id = ?").get(c1.json().project.id).visibility, 'workspace');
});

test('the database itself refuses a second Sales, Internal or client project (the race guard)', async () => {
  const { db, creds } = await freshApp();
  const ins = (kind, slug) => db.prepare("insert into projects(id,workspace_id,name,owner_id,visibility,created_at,updated_at,kind,client_slug) values (?,?,?,?,?,?,?,?,?)").run(`p-${Math.random()}`, creds.workspaces.demo, 'x', creds.admin.userId, 'workspace', 't', 't', kind, slug);
  ins('sales', null); ins('client', 'same-slug');
  assert.throws(() => ins('sales', null), /UNIQUE/);
  assert.throws(() => ins('client', 'same-slug'), /UNIQUE/);
  ins('client', 'a-different-slug');
});

test('unroutable and invalid input is rejected with a clear reason, and nothing is created', async () => {
  const { app, db, creds } = await freshApp();
  const t = creds.svc.write.token;
  const count = () => JSON.stringify(db.prepare('select (select count(*) from tasks) a, (select count(*) from projects) b').get());
  const start = count();
  for (const [payload, code] of [[body({ context: 'prospect', client_slug: undefined }), 'client_slug_required'], [body({ job_number: undefined }), 'job_number_required'], [body({ client_slug: undefined }), 'client_slug_required'], [body({ context: 'internal_job', job_number: undefined, client_slug: undefined }), 'job_number_required']]) {
    const r = await post(app, t, payload);
    assert.equal(r.statusCode, 422);
    assert.deepEqual([r.json().error, r.json().code], ['unroutable', code]);
    assert.ok(r.json().message.length > 20);
  }
  const bad = async (o) => (await post(app, t, body(o))).statusCode;
  assert.equal(await bad({ context: 'nonsense' }), 400);
  assert.equal(await bad({ context: undefined }), 400);
  assert.equal(await bad({ title: '' }), 400);
  assert.equal(await bad({ title: 'x'.repeat(301) }), 400);
  assert.equal(await bad({ idempotency_key: 'short' }), 400);
  assert.equal(await bad({ promised_date: '31/10/2026' }), 400);
  assert.equal(await bad({ due_date: '2026-02-31' }), 400);
  assert.equal(await bad({ client_slug: 'Has Capitals' }), 400);
  assert.equal(await bad({ job_number: ' J9075P' }), 400, 'stored exactly as sent, so no stray spaces');
  assert.equal(await bad({ job_number: 'J1\n2' }), 400);
  assert.equal(await bad({ estimate_minutes: -1 }), 400);
  assert.equal(await bad({ inferred: 'yes' }), 400);
  assert.equal(await bad({ project: 'Unsorted' }), 400, 'no way to name a project or an unsorted bucket');
  assert.equal(await bad({ owner_id: creds.admin.userId }), 400);
  assert.equal(count(), start, 'no task and no project was created by any rejected call');
  const denied = db.prepare("select action from audit_events where actor_kind = 'service' order by seq").all().map((e) => e.action);
  assert.ok(denied.length > 0 && denied.every((a) => a === 'api.denied'), 'every rejection is audited as a refusal');
});

test('a retry with the same idempotency_key returns the original task, never a duplicate', async () => {
  const { app, db, creds } = await freshApp();
  const t = creds.svc.write.token, b = body({ title: 'Call the supplier' });
  const first = await post(app, t, b), again = await post(app, t, b), changed = await post(app, t, { ...b, title: 'A different title on retry' });
  assert.deepEqual([first.statusCode, first.json().created, again.statusCode, again.json().created], [201, true, 200, false]);
  assert.equal(again.json().id, first.json().id);
  assert.equal(changed.json().id, first.json().id, 'same key, same task: the first write stands');
  assert.equal(db.prepare('select count(*) n from tasks where idempotency_key = ?').get(b.idempotency_key).n, 1);
  assert.equal(db.prepare('select title from tasks where id = ?').get(first.json().id).title, 'Call the supplier');
  const [x, y] = await Promise.all([post(app, t, body({ idempotency_key: 'race-key-same-0001' })), post(app, t, body({ idempotency_key: 'race-key-same-0001' }))]);
  assert.equal(x.json().id, y.json().id, 'two at once still make one');
  assert.equal(db.prepare("select count(*) n from tasks where idempotency_key = 'race-key-same-0001'").get().n, 1);
  const other = await post(app, creds.svc.other.token, { ...b, client_slug: 'brightwater-cafe' });
  assert.equal(other.statusCode, 201, 'the same key in another workspace is a different task');
  assert.notEqual(other.json().id, first.json().id);
});

test('fields are stored as sent: promised_date apart from due_date, inferred, lane as free text, raw job number, source', async () => {
  const { app, db, creds } = await freshApp();
  const r = await post(app, creds.svc.write.token, body({ title: 'Confirm the backup window', description: 'Said "probably Friday".', promised_date: '2026-11-06', due_date: '2026-11-13', estimate_minutes: 45, inferred: true, source_call_id: 'call-0001', lane: 'Client and project work', job_number: 'J9075P' }));
  const t = db.prepare('select * from tasks where id = ?').get(r.json().id);
  assert.deepEqual([t.promised_date, t.due_date, t.estimate_minutes, t.inferred, t.source_call_id, t.lane, t.job_number, t.client_slug, t.source, t.status], ['2026-11-06', '2026-11-13', 45, 1, 'call-0001', 'Client and project work', 'J9075P', 'brightwater-cafe', 'ingestion', 'todo']);
  assert.equal(r.json().url, `http://127.0.0.1:3000/#/p/${r.json().project.id}/t/${r.json().id}`, 'canonical, stable pointer for Zen');
  const lane = await post(app, creds.svc.write.token, body({ lane: 'Any new lane the owner invents later' }));
  assert.equal(lane.statusCode, 201, 'lanes are free text, not a fixed list');
  const dflt = await post(app, creds.svc.write.token, body());
  const d = db.prepare('select inferred, lane, promised_date from tasks where id = ?').get(dflt.json().id);
  assert.deepEqual({ ...d }, { inferred: 0, lane: null, promised_date: null });
  const manual = await freshApp();
  const m = await manual.call('member', 'POST', `/api/v1/projects/${manual.creds.projects.pub}/tasks`, { title: 'Typed by hand' });
  assert.equal(manual.db.prepare('select source from tasks where id = ?').get(m.json().id).source, 'manual');
});

test('the assignee is matched by email, full name, or a first name only one person has; otherwise unassigned and the problem is recorded', async () => {
  const { app, db, creds } = await freshApp();
  const t = creds.svc.write.token;
  const who = async (assignee) => { const r = await post(app, t, body({ assignee })); return [db.prepare('select assignee_id from tasks where id = ?').get(r.json().id).assignee_id, r.json().warnings]; };
  assert.deepEqual(await who(creds.member.email.toUpperCase()), [creds.member.userId, []]);
  assert.deepEqual(await who('sam okafor'), [creds.member.userId, []]);
  assert.deepEqual(await who('Priya'), [creds.member2.userId, []]);
  assert.deepEqual(await who('Nobody Here'), [null, [{ field: 'assignee', problem: 'unresolved' }]]);
  db.prepare("insert into users(id,email,name,created_at,updated_at) values ('u-sam2','sam.other@example.test','Sam Other','t','t')").run();
  db.prepare("insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values ('m-sam2', ?, 'u-sam2', 'member','t','t')").run(creds.workspaces.demo);
  assert.deepEqual(await who('Sam'), [null, [{ field: 'assignee', problem: 'unresolved' }]], 'two Sams: no guessing');
  assert.deepEqual(await who('Sam Other'), ['u-sam2', []]);
  assert.deepEqual(await who(creds.outsider.email), [null, [{ field: 'assignee', problem: 'unresolved' }]], 'a person in another workspace is not found');
  db.prepare("update users set status = 'deactivated' where id = ?").run(creds.member2.userId);
  assert.deepEqual(await who('Priya'), [null, [{ field: 'assignee', problem: 'unresolved' }]], 'deactivated people are not assigned');
  // the caller only learns "unresolved"; the real reason (not found, ambiguous, cannot see the project) stays in the audit trail for admins
  const reasons = db.prepare("select after_json from audit_events where action = 'task.ingest' order by seq").all().flatMap((r) => JSON.parse(r.after_json).warnings);
  assert.ok(reasons.includes('not_found') && reasons.includes('ambiguous'), `audit keeps the reasons: ${reasons}`);
  assert.doesNotMatch(JSON.stringify((await post(app, t, body({ assignee: creds.outsider.email }))).json()), /not_found|ambiguous|cannot_see/);
  const none = await post(app, t, body());
  assert.deepEqual([none.statusCode, none.json().assigned, none.json().warnings], [201, false, []]);
  const rec = db.prepare("select after_json from audit_events where action = 'task.ingest' order by seq").all().map((e) => JSON.parse(e.after_json).warnings);
  assert.deepEqual(rec.filter((w) => w.length).map((w) => w[0]), ['not_found', 'ambiguous', 'not_found', 'not_found', 'not_found'], 'the problems are recorded in the audit trail');
});

test('exactly one audit entry per created task (plus one the first time a project is created); retries add none but a call record; nothing secret', async () => {
  const lines = [];
  const { app, db, creds } = await freshApp({ logger: { level: 'trace', stream: { write: (l) => lines.push(l) } } });
  const t = creds.svc.write.token;
  const ev = () => db.prepare("select action, actor_kind, actor_id from audit_events where actor_kind = 'service' order by seq").all().map((e) => `${e.action}`);
  const b1 = body({ title: 'Secret-sounding title about invoice 4471', description: 'Private detail for the client', assignee: 'sam.okafor@example.test', source_call_id: 'call-0002' });
  await post(app, t, b1);
  assert.deepEqual(ev(), ['project.auto_create', 'task.ingest'], 'new project: its creation and the task');
  await post(app, t, body({ title: 'Second task same project' }));
  assert.deepEqual(ev().slice(2), ['task.ingest'], 'existing project: one entry per task');
  await post(app, t, b1);
  assert.deepEqual(ev().slice(3), ['api.call'], 'a retry creates nothing, and is recorded as a call');
  const all = db.prepare("select * from audit_events where actor_kind = 'service'").all();
  assert.ok(all.every((e) => e.actor_id === creds.svc.write.accountId));
  const dump = JSON.stringify(db.prepare('select * from audit_events').all()) + lines.join('');
  for (const secret of ['invoice 4471', 'Private detail', 'sam.okafor@example.test', t.slice(4), 'Bearer ']) assert.ok(!dump.includes(secret), `leaked: ${secret}`);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('permissions: only a write token can ingest; people and read tokens cannot; tokens cannot be used with a cookie; nothing leaks across workspaces', async () => {
  const { app, call, db, creds } = await freshApp();
  assert.equal((await post(app, creds.svc.read.token, body())).statusCode, 403, 'a read token');
  assert.equal((await call('admin', 'POST', '/api/v1/ingest/tasks', body())).statusCode, 403, 'a signed-in admin is a person, not Zen');
  assert.equal((await call(null, 'POST', '/api/v1/ingest/tasks', body())).statusCode, 401);
  const r = await post(app, creds.svc.other.token, body({ client_slug: 'only-in-other-co' }));
  assert.equal(db.prepare('select workspace_id from tasks where id = ?').get(r.json().id).workspace_id, creds.workspaces.other);
  assert.equal(db.prepare("select count(*) n from projects where client_slug = 'only-in-other-co' and workspace_id = ?").get(creds.workspaces.demo).n, 0);
  assert.equal(db.prepare("select count(*) n from tasks where source = 'ingestion'").get().n, 1, 'the refused calls created nothing');
});

test('a person can open an ingested task like any other, and the tokens never see it through the people routes', async () => {
  const { app, call, creds } = await freshApp();
  const r = await post(app, creds.svc.write.token, body({ title: 'Visible to staff', assignee: 'Sam' }));
  const id = r.json().id;
  assert.equal((await call('member', 'GET', `/api/v1/tasks/${id}`)).json().task.title, 'Visible to staff');
  assert.ok((await call('member', 'GET', '/api/v1/me/tasks')).json().tasks.some((x) => x.id === id), 'it shows up in the assignee\'s My tasks');
  assert.equal((await call('outsider', 'GET', `/api/v1/tasks/${id}`)).statusCode, 404);
});
