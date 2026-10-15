import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

const newPerson = (extra = {}) => ({ name: 'Taylor Brooks', email: 'taylor.brooks@example.test', role: 'guest', ...extra });

test('add a person: admin creates a guest, sees a one-time temporary password, and it works', async () => {
  const { app, call, db, creds } = await freshApp();
  const r = await call('admin', 'POST', '/api/v1/members', newPerson());
  assert.equal(r.statusCode, 201);
  const { temporaryPassword, userId } = r.json();
  assert.ok(temporaryPassword.length >= 12);
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: 'taylor.brooks@example.test', password: temporaryPassword } });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().role, 'guest');
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes(temporaryPassword), 'never in the audit trail');
  assert.ok(!JSON.stringify(db.prepare('select * from users').all()).includes(temporaryPassword), 'only a hash is stored');
  const ev = db.prepare("select * from audit_events where action = 'member.create'").get();
  assert.equal(ev.actor_id, creds.admin.userId);
  assert.equal(ev.target_id, userId);
  assert.equal((await call('admin', 'GET', '/api/v1/members')).json().members.length, 8, 'seven seeded in this workspace plus the new guest');
});

test('add a person: rules on who and what', async () => {
  const { call } = await freshApp();
  assert.equal((await call('member', 'POST', '/api/v1/members', newPerson())).statusCode, 403);
  assert.equal((await call('viewonly', 'POST', '/api/v1/members', newPerson())).statusCode, 403);
  assert.equal((await call('admin', 'POST', '/api/v1/members', newPerson({ role: 'admin' }))).statusCode, 201, 'same rule as role changes: admins may add admins');
  assert.equal((await call('admin', 'POST', '/api/v1/members', newPerson({ role: 'owner' }))).statusCode, 400, 'owner is not on the menu');
  assert.equal((await call('admin', 'POST', '/api/v1/members', newPerson({ email: 'not-an-email' }))).statusCode, 400);
  assert.equal((await call('admin', 'POST', '/api/v1/members', newPerson({ email: 'avery.quinn@example.test' }))).statusCode, 409);
  assert.equal((await call('admin', 'POST', '/api/v1/members', newPerson({ email: 'RILEY.AHMED@EXAMPLE.TEST' }))).statusCode, 409, 'also blocks an address used in another workspace, case-insensitively');
});

test('a new guest sees nothing until added to a project, then only that project', async () => {
  const { app, call, creds } = await freshApp();
  const p = (await call('admin', 'POST', '/api/v1/members', newPerson())).json();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: p.email, password: p.temporaryPassword } });
  const headers = { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/password', payload: { current: p.temporaryPassword, next: 'my own chosen phrase 42' }, headers })).statusCode, 200, 'the temporary password has to be replaced before anything else works');
  const seen = async () => (await app.inject({ url: '/api/v1/projects', headers })).json().projects.map((x) => x.name);
  assert.deepEqual(await seen(), []);
  assert.equal((await app.inject({ url: '/api/v1/members', headers })).statusCode, 403, 'no staff directory for guests');
  await call('admin', 'PUT', `/api/v1/projects/${creds.projects.pub}/members`, { userId: p.userId, role: 'commenter' });
  assert.deepEqual(await seen(), ['Website refresh']);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/tasks/${creds.tasks.a}/comments`, payload: { body: 'hello' }, headers })).statusCode, 201);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/tasks/${creds.tasks.a}`, payload: { title: 'x' }, headers })).statusCode, 403, 'commenter cannot edit');
  assert.equal((await app.inject({ url: `/api/v1/tasks/${creds.tasks.secret}`, headers })).statusCode, 404);
  await call('admin', 'DELETE', `/api/v1/projects/${creds.projects.pub}/members/${p.userId}`);
  assert.deepEqual(await seen(), []);
});

test('per-project admin: a member made project admin manages that project only', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/projects/${creds.projects.pub}`;
  assert.equal((await call('member', 'GET', `${url}/members`)).statusCode, 403);
  await call('admin', 'PUT', `${url}/members`, { userId: creds.member.userId, role: 'admin' });
  assert.equal((await call('member', 'GET', `${url}/members`)).statusCode, 200);
  assert.equal((await call('member', 'PUT', `${url}/members`, { userId: creds.member2.userId, role: 'viewer' })).statusCode, 200);
  assert.equal((await call('member', 'PATCH', url, { name: 'Renamed by project admin' })).statusCode, 200);
  assert.equal((await call('member', 'GET', `/api/v1/projects/${creds.projects.priv}`)).statusCode, 404, 'no reach into other projects');
  assert.equal((await call('member', 'PATCH', '/api/v1/workspace', { name: 'x' })).statusCode, 403, 'no reach into workspace settings');
  assert.equal((await call('admin', 'PUT', `${url}/members`, { userId: creds.guest.userId, role: 'admin' })).statusCode, 400, 'guests cannot be project admins');
  assert.equal((await call('admin', 'PUT', `${url}/members`, { userId: creds.outsider.userId, role: 'viewer' })).statusCode, 404, 'other workspace');
});

test('view-only stays view-only even if a project makes them admin', async () => {
  const { call, creds } = await freshApp();
  const url = `/api/v1/projects/${creds.projects.pub}`;
  await call('admin', 'PUT', `${url}/members`, { userId: creds.viewonly.userId, role: 'admin' });
  assert.equal((await call('viewonly', 'GET', url)).json().myRole, 'viewer');
  assert.equal((await call('viewonly', 'PATCH', url, { name: 'x' })).statusCode, 403);
  assert.equal((await call('viewonly', 'POST', `${url}/tasks`, { title: 'x' })).statusCode, 403);
});

test('change password: needs the current one, enforces the rule, ends other sessions, old password dies', async () => {
  const { app, call, creds, signIn } = await freshApp();
  const other = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } });
  const otherCookie = other.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  await signIn('member');
  assert.equal((await call('member', 'POST', '/api/v1/auth/password', { current: 'wrong-password-123', next: 'a-new-long-password-1' })).statusCode, 403);
  assert.equal((await call('member', 'POST', '/api/v1/auth/password', { current: creds.member.password, next: 'short' })).statusCode, 400);
  assert.equal((await call('member', 'POST', '/api/v1/auth/password', { current: creds.member.password, next: 'a-new-long-password-1' })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/auth/session', headers: { cookie: otherCookie } })).statusCode, 401, 'other session ended');
  assert.equal((await call('member', 'GET', '/api/v1/auth/session')).statusCode, 200, 'this one continues');
  const old = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: creds.member.password } });
  assert.equal(old.statusCode, 401);
  const fresh = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.member.email, password: 'a-new-long-password-1' } });
  assert.equal(fresh.statusCode, 200);
});
