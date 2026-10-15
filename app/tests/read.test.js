import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

// All invented. Tokens come from the seed (random each run).
let n = 0;
const ing = (app, tok, o) => app.inject({ method: 'POST', url: '/api/v1/ingest/tasks', headers: { authorization: `Bearer ${tok}` }, payload: { idempotency_key: `read-key-${++n}-abcdefgh`, context: 'client_job', client_slug: 'brightwater-cafe', job_number: 'J9075P', title: 'Action', ...o } });
const get = (app, tok, qs) => app.inject({ method: 'GET', url: `/api/v1/read/tasks${qs}`, headers: { authorization: `Bearer ${tok}` } });
const REG = ['Job No,Job Title / Folder,Start Date,Estimated Completion,Estimated Completion,Next Action Due,Client,Status,Team,Comment / Update / Action,Misc,Estimated Completion Date,Closed Date', 'J9075P,Imported job,01-Jul-24,,,,Some Client,Work in Progress,,,,,'].join('\n');

async function world() {
  const w = await freshApp();
  const W = w.creds.svc.write.token, R = w.creds.svc.read.token;
  const a1 = (await ing(w.app, W, { title: 'A one', assignee: 'Sam', promised_date: '2026-11-06', inferred: true, lane: 'Client and project work', source_call_id: 'call-1' })).json();
  const a2 = (await ing(w.app, W, { title: 'A two', job_number: 'J9100A' })).json();
  const b1 = (await ing(w.app, W, { title: 'B one', client_slug: 'nimbus-legal', job_number: 'J9200B' })).json();
  const pr = (await ing(w.app, W, { title: 'Prospect action', context: 'prospect', client_slug: 'brightwater-cafe', job_number: undefined })).json();
  const it = (await ing(w.app, W, { title: 'Internal action', context: 'internal_job', client_slug: undefined, job_number: 'J0007I' })).json();
  const hand = await w.call('member', 'POST', `/api/v1/projects/${a1.project.id}/tasks`, { title: 'Made by hand in the client project' });
  return { ...w, W, R, a1, a2, b1, pr, it, handId: hand.json().id };
}

test('reading by client_slug returns ALL tasks in that client project, including ones staff made by hand; the slug is inherited', async () => {
  const { app, db, R, a1, a2, pr, handId } = await world();
  assert.equal(db.prepare('select client_slug from tasks where id = ?').get(handId).client_slug, 'brightwater-cafe', 'inherited at creation');
  db.prepare('update tasks set client_slug = null where id = ?').run(handId);                 // an older row with no slug of its own
  const r = (await get(app, R, '?client_slug=brightwater-cafe')).json();
  const ids = r.tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, [a1.id, a2.id, handId, pr.id].sort(), 'both ingested tasks, the hand-made one (even with no slug of its own), and the prospect-stage task tagged with the slug');
  assert.ok(r.tasks.every((t) => t.client_slug === 'brightwater-cafe'), 'the effective slug is returned');
  const hand = r.tasks.find((t) => t.id === handId);
  assert.deepEqual([hand.source, hand.context, hand.project.kind], ['manual', null, 'client']);
  assert.deepEqual((await get(app, R, '?client_slug=nimbus-legal')).json().tasks.map((t) => t.title), ['B one']);
  assert.deepEqual((await get(app, R, '?client_slug=nobody')).json(), { tasks: [], count: 0, next_cursor: null });
});

test('a form task or a staff edit in a client project also carries the slug; other projects do not', async () => {
  const { app, call, db, creds, W, a1 } = await freshApp().then(async (w) => ({ ...w, W: w.creds.svc.write.token })).then(async (w) => ({ ...w, a1: (await ing(w.app, w.W, {})).json() }));
  const pid = a1.project.id;
  const form = await call('admin', 'POST', `/api/v1/projects/${pid}/forms`, { name: 'Client form', questions: [{ label: 'What?', kind: 'text', required: true, mapsTo: 'title' }] });
  await app.inject({ method: 'POST', url: `/api/v1/public/forms/${form.json().slug}/submit`, payload: { answers: Object.fromEntries((await app.inject(`/api/v1/public/forms/${form.json().slug}`)).json().questions.map((q) => [q.id, 'From the public form'])) } });
  assert.equal(db.prepare("select client_slug from tasks where title = 'From the public form'").get().client_slug, 'brightwater-cafe');
  const plain = await call('member', 'POST', `/api/v1/projects/${creds.projects.pub}/tasks`, { title: 'Ordinary project task' });
  assert.equal(db.prepare('select client_slug from tasks where id = ?').get(plain.json().id).client_slug, null);
});

test('by job_number is exact; by ids ignores unknown and hidden ids; filters combine; at least one filter is required', async () => {
  const { app, R, a1, a2, b1, it } = await world();
  assert.deepEqual((await get(app, R, '?job_number=J9100A')).json().tasks.map((t) => t.id), [a2.id]);
  assert.equal((await get(app, R, '?job_number=j9100a')).json().count, 0, 'raw text, exact, case-sensitive');
  assert.equal((await get(app, R, '?job_number=J9075')).json().count, 0, 'no partial matches');
  const byIds = (await get(app, R, `?ids=${a1.id},${b1.id},not-an-id,${it.id}`)).json();
  assert.deepEqual(byIds.tasks.map((t) => t.id).sort(), [a1.id, b1.id, it.id].sort());
  assert.equal((await get(app, R, `?client_slug=brightwater-cafe&job_number=J9100A`)).json().count, 1);
  assert.equal((await get(app, R, '')).statusCode, 400);
  assert.equal((await get(app, R, `?ids=${Array.from({ length: 201 }, (_, i) => `i${i}`).join(',')}`)).statusCode, 400);
  for (const bad of ['?updated_since=yesterday', '?limit=0', '?limit=501', '?cursor=%%%&job_number=J1', '?client_slug=Has%20Caps', '?bogus=1']) assert.equal((await get(app, R, bad)).statusCode, 400, bad);
});

test('updated_since returns what changed at or after that time, including a staff edit', async () => {
  const { app, call, db, R, a1, a2 } = await world();
  db.prepare("update tasks set updated_at = '2026-01-01T00:00:00.000Z'").run();
  assert.equal((await get(app, R, '?updated_since=2026-06-01T00:00:00Z')).json().count, 0);
  await call('member', 'PATCH', `/api/v1/tasks/${a2.id}`, { status: 'in_progress' });
  const r = (await get(app, R, '?updated_since=2026-06-01T00:00:00Z')).json();
  assert.deepEqual(r.tasks.map((t) => [t.id, t.status]), [[a2.id, 'in_progress']]);
  const t = r.tasks[0].updated_at;
  assert.equal((await get(app, R, `?updated_since=${t.replace('.', '.')}`)).json().count >= 1, true, 'the boundary itself is included');
  assert.equal((await get(app, R, '?updated_since=2025-12-31T23:59:59Z')).json().count, 5 + 1 - 0, 'everything touched since then');
});

test('the response has exactly the agreed fields (no description), with source, context and project kind', async () => {
  const { app, R, a1 } = await world();
  const t = (await get(app, R, `?ids=${a1.id}`)).json().tasks[0];
  assert.deepEqual(Object.keys(t).sort(), ['assignee', 'client_slug', 'completed_at', 'context', 'due_date', 'estimate_minutes', 'id', 'inferred', 'job_number', 'lane', 'project', 'promised_date', 'source', 'source_call_id', 'status', 'title', 'updated_at', 'url'].sort());
  assert.deepEqual([t.title, t.status, t.assignee.name, t.promised_date, t.inferred, t.lane, t.source_call_id, t.job_number, t.context, t.source, t.project.kind, t.project.name], ['A one', 'todo', 'Sam Okafor', '2026-11-06', true, 'Client and project work', 'call-1', 'J9075P', 'client_job', 'ingestion', 'client', 'brightwater-cafe']);
  assert.equal(t.url, `http://127.0.0.1:3000/#/p/${t.project.id}/t/${t.id}`);
  assert.ok(!JSON.stringify(t).includes('description'));
});

test('a read token never sees imported job projects, staff projects or private projects, even by id, job number or client slug', async () => {
  const { app, call, db, creds, R, a1 } = await world();
  assert.equal((await call('admin', 'POST', '/api/v1/jobs/import', { csv: REG, visibility: 'private' })).statusCode, 200);
  const imported = db.prepare("select id from projects where job_number = 'J9075P'").get().id;
  const t = await call('admin', 'POST', `/api/v1/projects/${imported}/tasks`, { title: 'Inside the imported private project' });
  await call('admin', 'PATCH', `/api/v1/tasks/${t.json().id}`, { jobNumber: 'J9075P' });   // the very job number Zen reads by
  const staffTask = await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.a}`, { jobNumber: 'J9075P' });
  assert.equal(staffTask.statusCode, 200);
  db.prepare("update tasks set client_slug = 'brightwater-cafe' where id = ?").run(creds.tasks.a);
  const byJob = (await get(app, R, '?job_number=J9075P')).json();
  assert.deepEqual(byJob.tasks.map((x) => x.project.kind), ['client'], 'only the ingested task, not the imported project\'s nor the staff project\'s');
  const bySlug = (await get(app, R, '?client_slug=brightwater-cafe')).json();
  assert.ok(!bySlug.tasks.some((x) => [t.json().id, creds.tasks.a, creds.tasks.secret].includes(x.id)));
  const byIds = (await get(app, R, `?ids=${t.json().id},${creds.tasks.a},${creds.tasks.secret},${a1.id}`)).json();
  assert.deepEqual(byIds.tasks.map((x) => x.id), [a1.id]);
  const all = (await get(app, R, '?updated_since=2000-01-01T00:00:00Z')).json();
  assert.ok(all.tasks.every((x) => x.project.kind), 'every returned task is in an ingested project');
  const projects = (await app.inject({ url: '/api/v1/read/projects', headers: { authorization: `Bearer ${R}` } })).json().projects;
  assert.deepEqual([...new Set(projects.map((p) => p.kind))].sort(), ['client', 'internal', 'sales']);
  assert.ok(!projects.some((p) => [imported, creds.projects.pub, creds.projects.priv].includes(p.id)));
  assert.deepEqual(projects.find((p) => p.kind === 'client'), { id: a1.project.id, name: 'brightwater-cafe', kind: 'client', client_slug: 'brightwater-cafe', archived: false, url: `http://127.0.0.1:3000/#/p/${a1.project.id}` });
  assert.equal((await app.inject({ url: '/api/v1/read/projects?kind=sales', headers: { authorization: `Bearer ${R}` } })).json().projects.length, 1);
  assert.equal((await app.inject({ url: '/api/v1/read/projects?kind=imported', headers: { authorization: `Bearer ${R}` } })).statusCode, 400);
});

test('scope: only the read scope reads; a write token cannot; no people directory; another workspace sees only its own; no webhooks exist', async () => {
  const { app, creds, W, R, a1 } = await world();
  assert.equal((await get(app, W, `?ids=${a1.id}`)).statusCode, 403, 'a write token cannot read');
  assert.equal((await ing(app, R, {})).statusCode, 403, 'a read token cannot write');
  assert.equal((await app.inject({ url: '/api/v1/members', headers: { authorization: `Bearer ${R}` } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/v1/read/tasks?ids=x' })).statusCode, 401, 'no token');
  assert.equal((await get(app, creds.svc.other.token, `?ids=${a1.id}`)).json().count, 0, 'another workspace cannot read this one');
  const routes = (await import('../server/app.js')).buildApp && app.routeTable.map((r) => r.url);
  assert.ok(!routes.some((u) => /webhook/i.test(u)), 'no outgoing webhooks');
});

test('large pages: 1200 tasks come back in stable order with no repeats or gaps, across any page size', async () => {
  const { app, db, creds, R, a1 } = await world();
  const ins = db.prepare("insert into tasks(id,workspace_id,project_id,title,owner_id,status,position,created_at,updated_at,source) values (?,?,?,?,?,'todo',?,?,?, 'ingestion')");
  db.exec('BEGIN');
  for (let i = 0; i < 1200; i++) ins.run(`bulk-${String(i).padStart(4, '0')}`, creds.workspaces.demo, a1.project.id, `Bulk ${i}`, creds.admin.userId, i, 't', `2026-03-01T00:00:${String(Math.floor(i / 40)).padStart(2, '0')}.000Z`); // 40 tasks share every timestamp
  db.exec('COMMIT');
  for (const limit of [500, 137]) {
    const seen = []; let cursor = null, pages = 0;
    do { const r = (await get(app, R, `?client_slug=brightwater-cafe&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)).json(); seen.push(...r.tasks.map((t) => t.id)); cursor = r.next_cursor; pages++; assert.ok(r.count <= limit); } while (cursor);
    assert.equal(new Set(seen).size, seen.length, `no repeats at limit ${limit}`);
    assert.equal(seen.filter((id) => id.startsWith('bulk-')).length, 1200, `none missing at limit ${limit}`);
    assert.equal(pages, Math.ceil(seen.length / limit));
    const stamps = seen.map((id) => db.prepare('select updated_at u from tasks where id = ?').get(id).u);
    assert.deepEqual(stamps, [...stamps].sort(), 'ordered by updated_at then id');
  }
  const first = (await get(app, R, '?client_slug=brightwater-cafe&limit=500')).json();
  assert.equal(first.count, 500);
  assert.ok(first.next_cursor);
});

test('staff can set job number, promised date and lane on a task by hand; checked, audited, and the client slug cannot be edited', async () => {
  const { call, db, creds } = await freshApp();
  const url = `/api/v1/tasks/${creds.tasks.a}`;
  const r = await call('member', 'PATCH', url, { jobNumber: 'J9075P', promisedDate: '2026-11-06', lane: 'Operations, finance and admin' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.json().jobNumber, r.json().promisedDate, r.json().lane, r.json().source], ['J9075P', '2026-11-06', 'Operations, finance and admin', 'manual']);
  const ev = db.prepare("select before_json, after_json from audit_events where action = 'task.update' order by seq desc limit 1").get();
  assert.deepEqual([JSON.parse(ev.before_json), JSON.parse(ev.after_json)], [{ jobNumber: null, promisedDate: null, lane: null }, { jobNumber: '[not recorded]', promisedDate: '2026-11-06', lane: '[not recorded]' }]);
  assert.equal((await call('member', 'GET', url)).json().task.jobNumber, 'J9075P');
  assert.equal((await call('member', 'PATCH', url, { jobNumber: null, lane: null })).json().jobNumber, null, 'can be cleared');
  for (const bad of [{ jobNumber: ' J9075P' }, { jobNumber: 'J1\n2' }, { jobNumber: '' }, { promisedDate: '2026-02-31' }, { lane: 'x'.repeat(81) }, { clientSlug: 'brightwater-cafe' }, { source: 'ingestion' }]) assert.equal((await call('member', 'PATCH', url, bad)).statusCode, 400, JSON.stringify(bad));
  assert.equal((await call('viewonly', 'PATCH', url, { lane: 'x' })).statusCode, 403);
  assert.equal((await call('member', 'PATCH', `/api/v1/tasks/${creds.tasks.secret}`, { lane: 'x' })).statusCode, 404, 'hidden project');
});

test('every read is audited under the service account by route pattern only: no filter values, no ids, no tokens', async () => {
  const lines = [];
  const { app, db, creds } = await freshApp({ logger: { level: 'trace', stream: { write: (l) => lines.push(l) } } });
  const R = creds.svc.read.token;
  assert.equal((await get(app, R, '?job_number=J-SECRET-4471&client_slug=very-private-client')).statusCode, 200);
  await get(app, R, '?job_number=J-SECRET-4471&client_slug=very-private-client');
  await app.inject({ url: '/api/v1/read/projects', headers: { authorization: `Bearer ${R}` } });
  await new Promise((r) => setTimeout(r, 50)); // the audit row is written just after the response is sent
  const rows = db.prepare("select action, summary, actor_id from audit_events where actor_kind = 'service' order by seq").all();
  assert.deepEqual(rows.map((r) => r.action), ['api.call', 'api.call', 'api.call'], 'one per read');
  assert.ok(rows.every((r) => r.actor_id === creds.svc.read.accountId));
  const dump = JSON.stringify(db.prepare('select * from audit_events').all()) + lines.join('');
  for (const s of ['J-SECRET-4471', 'very-private-client', R.slice(4)]) assert.ok(!dump.includes(s), `leaked ${s}`);
});
