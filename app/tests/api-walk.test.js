import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, ROLES, can } from '../server/authz.js';
import { projectAccess } from '../server/access.js';
import { verifyChain } from '../server/audit.js';
import { freshApp } from './helpers.js';

const ROLE_KEY = { owner: 'owner', admin: 'admin', member: 'member', view_only: 'viewonly', guest: 'guest' };
// Deletes and sign-out change what later calls can see, so they run last (sign-out very last).
const order = (routes) => [...routes].sort((a, b) => (a.action === 'session:signout') - (b.action === 'session:signout') || (a.method === 'DELETE') - (b.method === 'DELETE'));
const auditCount = (db) => db.prepare('select count(*) n from audit_events').get().n;

/** What the permission rules say should happen: 404 hidden, 403 refused, 2xx allowed. */
export function expected(db, creds, roleKey, spec, url) {
  const c = creds[roleKey];
  const actor = { userId: c.userId, workspaceId: c.workspaceId, role: c.role };
  if (!spec.projectOf) return can(actor, spec.action) ? 'ok' : 403;
  const params = {};
  spec.url.split('/').forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = url.split('?')[0].split('/')[i]; });
  const pid = spec.projectOf({ params }, db, actor);
  const access = pid ? projectAccess(db, actor, pid) : null;
  if (!access) return 404;
  return can(actor, spec.action, { workspaceId: actor.workspaceId, projectRole: access.role }) ? 'ok' : 403;
}

test('route table: every API route is declared once, has a known action, and a sample request', async () => {
  const { app } = await freshApp();
  const declared = app.routeTable.map((r) => `${r.method} ${r.url}`).sort();
  assert.deepEqual(declared, [...app.seenApiRoutes].filter((r) => !r.startsWith('HEAD')).sort(), 'no route registered outside define()');
  for (const r of app.routeTable) {
    assert.equal(typeof r.sample, 'function', `${r.method} ${r.url} needs a sample`);
    assert.equal(typeof r.write, 'boolean', `${r.method} ${r.url} must say whether it writes`);
    if (r.public) assert.equal(r.action, null);
    else assert.ok(ACTIONS[r.action], `${r.method} ${r.url} names unknown action ${r.action}`);
    if (ACTIONS[r.action]?.project) assert.equal(typeof r.projectOf, 'function', `${r.method} ${r.url} is a project action and needs projectOf`);
    if (r.projectOf) assert.ok(ACTIONS[r.action]?.project, `${r.method} ${r.url} has projectOf but a workspace-level action`);
  }
});

test('walk: signed-out callers get 401 on every protected route', async () => {
  const { app, creds } = await freshApp();
  for (const r of app.routeTable.filter((x) => !x.public)) {
    const s = r.sample({ creds, who: creds.owner });
    assert.equal((await app.inject({ method: r.method, url: s.url, payload: s.payload })).statusCode, 401, `${r.method} ${r.url}`);
  }
});

for (const role of ROLES) {
  test(`walk: ${role} gets exactly what the permission rules say on every route`, async () => {
    const { app, db, creds, call, signIn } = await freshApp();
    await signIn(ROLE_KEY[role]); // signing in is itself audited, so do it before counting
    for (const r of order(app.routeTable.filter((x) => !x.public))) {
      const s = r.sample({ creds, who: creds[ROLE_KEY[role]] });
      const want = expected(db, creds, ROLE_KEY[role], r, s.url);
      const before = auditCount(db);
      const res = await call(ROLE_KEY[role], r.method, s.url, s.payload);
      const label = `${role} ${r.method} ${s.url} -> ${res.statusCode} ${res.body.slice(0, 120)}`;
      if (want === 'ok') {
        assert.ok(res.statusCode >= 200 && res.statusCode < 300, label);
        if (r.write) assert.ok(auditCount(db) > before, `${label}: write without an audit row`);
      } else {
        assert.equal(res.statusCode, want, label);
        assert.equal(auditCount(db), before, `${label}: a refused call must change nothing`);
      }
    }
    assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
  });
}

test('walk: view-only gets no successful write anywhere; guests only write tasks and comments in projects they were added to', async () => {
  const { app, creds, call } = await freshApp();
  for (const r of order(app.routeTable.filter((x) => x.write && !x.public && !['session:signout', 'session:password'].includes(x.action)))) {
    const s = r.sample({ creds, who: creds.viewonly });
    const vo = await call('viewonly', r.method, s.url, s.payload);
    assert.ok(vo.statusCode === 403 || vo.statusCode === 404, `view-only ${r.method} ${s.url} -> ${vo.statusCode}`);
    const sg = r.sample({ creds, who: creds.guest });
    const g = await call('guest', r.method, sg.url, sg.payload);
    if (!['task:write', 'task:comment'].includes(r.action)) assert.ok(g.statusCode === 403 || g.statusCode === 404, `guest ${r.method} ${sg.url} -> ${g.statusCode}`);
  }
});

test('tenancy: another workspace sees none of this workspace and cannot reach its people or projects', async () => {
  const { db, creds, call } = await freshApp();
  const members = (await call('outsider', 'GET', '/api/v1/members')).json().members;
  assert.deepEqual(members.map((m) => m.email), [creds.outsider.email]);
  assert.equal((await call('outsider', 'GET', '/api/v1/workspace')).json().slug, 'other');
  const before = db.prepare('select role from memberships where user_id = ?').get(creds.member.userId).role;
  assert.equal((await call('outsider', 'PATCH', `/api/v1/members/${creds.member.userId}/role`, { role: 'guest' })).statusCode, 404);
  assert.equal(db.prepare('select role from memberships where user_id = ?').get(creds.member.userId).role, before);
  const mine = (await call('outsider', 'GET', '/api/v1/projects')).json().projects;
  assert.deepEqual(mine.map((p) => p.name), ['Other Co onboarding']);
  for (const url of [`/api/v1/projects/${creds.projects.pub}`, `/api/v1/projects/${creds.projects.priv}`])
    assert.equal((await call('outsider', 'GET', url)).statusCode, 404, url);
});

test('audit: no secret ever lands in the trail, whatever the routes did', async () => {
  const { app, db, creds, call } = await freshApp();
  for (const r of order(app.routeTable.filter((x) => !x.public))) { const s = r.sample({ creds, who: creds.owner }); await call('owner', r.method, s.url, s.payload); }
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes('scrypt$'));
  for (const c of Object.values(creds).filter((x) => x.password)) assert.ok(!dump.includes(c.password));
});
