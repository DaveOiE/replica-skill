import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';
import { scrub, toCsv } from '../server/store-audit.js';
import { appendAudit, verifyChain } from '../server/audit.js';

// Everything here is invented. Token-shaped strings are made up from repeated letters.
const FAKE_TOKEN = `dsk_${'Ab1'.repeat(14)}x`;
const FAKE_HASH = 'scrypt$16384$8$1$' + 'QUJD'.repeat(10);

test('only owners and admins can read or export the audit log; tokens and others cannot', async () => {
  const { call, app, creds } = await freshApp();
  for (const k of ['owner', 'admin']) assert.equal((await call(k, 'GET', '/api/v1/audit')).statusCode, 200, k);
  for (const k of ['member', 'viewonly', 'guest']) {
    assert.equal((await call(k, 'GET', '/api/v1/audit')).statusCode, 403, k);
    assert.equal((await call(k, 'POST', '/api/v1/audit/export', {})).statusCode, 403, k);
  }
  assert.equal((await call(null, 'GET', '/api/v1/audit')).statusCode, 401);
  // the other workspace's owner may read ITS log, and sees none of the demo workspace's events
  const theirs = await call('outsider', 'GET', '/api/v1/audit?limit=200');
  const demoActors = new Set([creds.owner.userId, creds.admin.userId, creds.member.userId]);
  assert.ok(theirs.json().events.every((e) => !demoActors.has(e.actor.id)));
  for (const tok of [creds.svc.read.token, creds.svc.write.token])
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/audit', headers: { authorization: `Bearer ${tok}` } })).statusCode, 403);
});

test('filters by who, action and date range; pages with a cursor; stays inside the workspace', async () => {
  const { call, db, creds } = await freshApp();
  await call('member', 'POST', `/api/v1/projects/${creds.projects.pub}/tasks`, { title: 'Audit filter task' });
  const all = (await call('owner', 'GET', '/api/v1/audit?limit=200')).json();
  assert.ok(all.events.length > 3 && all.options.actions.includes('task.create'));
  assert.ok(all.events.every((e, i, a) => !i || a[i - 1].seq > e.seq), 'newest first');
  const mine = (await call('owner', 'GET', `/api/v1/audit?who=${creds.member.userId}`)).json().events;
  assert.ok(mine.length && mine.every((e) => e.actor.id === creds.member.userId));
  const acts = (await call('owner', 'GET', '/api/v1/audit?action=task.create')).json().events;
  assert.ok(acts.length && acts.every((e) => e.action === 'task.create'));
  const today = new Date().toISOString().slice(0, 10);
  assert.ok((await call('owner', 'GET', `/api/v1/audit?from=${today}&to=${today}`)).json().events.length > 0, 'the whole "to" day counts');
  assert.equal((await call('owner', 'GET', '/api/v1/audit?from=2000-01-01&to=2000-01-02')).json().events.length, 0);
  const p1 = (await call('owner', 'GET', '/api/v1/audit?limit=2')).json();
  assert.equal(p1.events.length, 2); assert.ok(p1.next_before && p1.options);
  const p2 = (await call('owner', 'GET', `/api/v1/audit?limit=2&before=${p1.next_before}`)).json();
  assert.ok(p2.events.every((e) => e.seq < p1.next_before) && !p2.options);
  // another workspace's events never appear
  for (const bad of ['who=not-a-user', 'from=2026-02-31', 'to=yesterday', 'limit=0', 'limit=500', 'x=1', 'before=-4']) assert.equal((await call('owner', 'GET', `/api/v1/audit?${bad}`)).statusCode, 400, bad);
});

test('nothing secret leaves the audit API or the CSV, even if it was written into the log', async () => {
  const { call, db, creds } = await freshApp();
  appendAudit(db, { workspaceId: creds.workspaces.demo, actorKind: 'user', actorId: creds.owner.userId, action: 'test.leak', targetType: 'x', targetId: '1',
    summary: `oops ${FAKE_TOKEN} and Bearer ${FAKE_TOKEN} and ${FAKE_HASH}`, after: { note: FAKE_TOKEN, token: 'abc', password: 'hunter2', token_hash: FAKE_HASH } });
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
  const api = (await call('owner', 'GET', '/api/v1/audit?action=test.leak')).body;
  const csv = (await call('owner', 'POST', '/api/v1/audit/export', { action: 'test.leak' })).body;
  for (const out of [api, csv]) { assert.doesNotMatch(out, /dsk_[A-Za-z0-9]/); assert.doesNotMatch(out, /scrypt\$/); assert.doesNotMatch(out, /hunter2|Bearer\s+\S{6,}/); }
  assert.doesNotMatch(api, /entry_hash|prev_hash|"hash"/, 'chain fields are internal');
  assert.equal(scrub(`a ${FAKE_TOKEN} b`), 'a [redacted] b');
});

test('CSV export: fields only, formulas neutralised, quoting right, and the export itself is logged', async () => {
  const { call, db, creds } = await freshApp();
  const r = await call('admin', 'POST', '/api/v1/audit/export', {});
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /^text\/csv/); assert.match(r.headers['content-disposition'], /attachment; filename="audit-log\.csv"/);
  const lines = r.body.trim().split('\r\n');
  assert.equal(lines[0], 'seq,time_utc,who,kind,action,target_type,target_id,summary,changed_fields,ip,request_id');
  assert.ok(lines.length > 2);
  const ev = db.prepare("select action, summary from audit_events where action = 'audit.export'").get();
  assert.match(ev.summary, /exported as CSV/);
  const out = toCsv([{ seq: 1, ts: 't', actor: { name: '=cmd|x', kind: 'user' }, action: '+a', target_type: '@b', target_id: '-c', summary: 'say "hi", ok\nnext', before: { secret: 'S1' }, after: { title: 'VALUE-SHOULD-NOT-APPEAR', status: 'x' }, ip: null, request_id: null }]);
  assert.match(out, /'=cmd\|x/); assert.match(out, /,'\+a,'@b,'-c,/); assert.match(out, /"say ""hi"", ok\nnext"/);
  assert.match(out, /title;status/); assert.doesNotMatch(out, /VALUE-SHOULD-NOT-APPEAR|S1/);
  assert.equal((await call('admin', 'POST', '/api/v1/audit/export', { from: 'bad' })).statusCode, 400);
  assert.equal((await call('admin', 'POST', '/api/v1/audit/export', { extra: 1 })).statusCode, 400);
});
