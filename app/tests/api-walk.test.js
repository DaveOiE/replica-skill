import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, ROLES, can } from '../server/authz.js';
import { verifyChain } from '../server/audit.js';
import { freshApp } from './helpers.js';

const ROLE_KEY = { owner: 'owner', admin: 'admin', member: 'member', view_only: 'viewonly', guest: 'guest' };
// Sign-out ends the session the other calls rely on, so it always runs last.
const signoutLast = (routes) => [...routes].sort((a, b) => (a.action === 'session:signout') - (b.action === 'session:signout'));
const auditCount = (db) => db.prepare('select count(*) n from audit_events').get().n;

test('route table: every API route is declared once, has a known action, and a sample request', async () => {
  const { app } = await freshApp();
  const declared = app.routeTable.map((r) => `${r.method} ${r.url}`).sort();
  assert.deepEqual(declared, [...app.seenApiRoutes].filter((r) => !r.startsWith('HEAD')).sort(), 'no route registered outside define()');
  for (const r of app.routeTable) {
    assert.equal(typeof r.sample, 'function', `${r.method} ${r.url} needs a sample`);
    assert.equal(typeof r.write, 'boolean', `${r.method} ${r.url} must say whether it writes`);
    if (r.public) assert.equal(r.action, null);
    else assert.ok(ACTIONS[r.action], `${r.method} ${r.url} names unknown action ${r.action}`);
  }
});

test('walk: signed-out callers get 401 on every protected route', async () => {
  const { app, creds } = await freshApp();
  for (const r of app.routeTable.filter((x) => !x.public)) {
    const s = r.sample({ creds });
    const res = await app.inject({ method: r.method, url: s.url, payload: s.payload });
    assert.equal(res.statusCode, 401, `${r.method} ${r.url}`);
  }
});

for (const role of ROLES) {
  test(`walk: ${role} gets exactly what the permission table says on every route`, async () => {
    const { app, db, creds, call } = await freshApp();
    const actor = { role, workspaceId: creds.workspaces.demo };
    for (const r of signoutLast(app.routeTable.filter((x) => !x.public))) {
      const s = r.sample({ creds });
      const before = auditCount(db);
      const res = await call(ROLE_KEY[role], r.method, s.url, s.payload);
      const allowed = can(actor, r.action);
      const label = `${role} ${r.method} ${r.url}`;
      if (!allowed) {
        assert.equal(res.statusCode, 403, label);
        assert.equal(auditCount(db), before, `${label}: a refused call must change nothing`);
      } else {
        assert.ok(res.statusCode >= 200 && res.statusCode < 300, `${label} -> ${res.statusCode} ${res.body}`);
        if (r.write) assert.ok(auditCount(db) > before, `${label}: write without an audit row`);
      }
    }
    assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
  });
}

test('walk: view-only and guest cannot change anything, by any route', async () => {
  const { app, db, creds, call } = await freshApp();
  const snapshot = () => JSON.stringify([db.prepare('select * from workspaces').all(), db.prepare('select * from memberships').all()]);
  const before = snapshot();
  for (const key of ['viewonly', 'guest'])
    for (const r of app.routeTable.filter((x) => x.write && !x.public && x.action !== 'session:signout')) {
      const s = r.sample({ creds });
      assert.equal((await call(key, r.method, s.url, s.payload)).statusCode, 403, `${key} ${r.method} ${r.url}`);
    }
  assert.equal(snapshot(), before);
});

test('tenancy: another workspace sees none of this workspace and cannot reach its people', async () => {
  const { db, creds, call } = await freshApp();
  const members = (await call('outsider', 'GET', '/api/v1/members')).json().members;
  assert.deepEqual(members.map((m) => m.email), [creds.outsider.email]);
  const ws = (await call('outsider', 'GET', '/api/v1/workspace')).json();
  assert.equal(ws.slug, 'other');
  const before = db.prepare('select role from memberships where user_id = ?').get(creds.member.userId).role;
  const res = await call('outsider', 'PATCH', `/api/v1/members/${creds.member.userId}/role`, { role: 'guest' });
  assert.equal(res.statusCode, 404);
  assert.equal(db.prepare('select role from memberships where user_id = ?').get(creds.member.userId).role, before);
  const everything = JSON.stringify([members, ws]);
  for (const c of [creds.owner, creds.admin, creds.member]) assert.ok(!everything.includes(c.email));
});

test('audit: no secret ever lands in the trail, whatever the routes did', async () => {
  const { app, db, creds, call } = await freshApp();
  for (const r of signoutLast(app.routeTable.filter((x) => !x.public))) { const s = r.sample({ creds }); await call('owner', r.method, s.url, s.payload); }
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes('scrypt$'));
  for (const c of Object.values(creds).filter((x) => x.password)) assert.ok(!dump.includes(c.password));
});
