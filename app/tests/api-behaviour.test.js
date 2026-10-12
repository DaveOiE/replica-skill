import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';

test('sign-in sets a http-only, same-site cookie and never returns the token in the body', async () => {
  const { app, creds } = await freshApp();
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.owner.email, password: creds.owner.password } });
  assert.equal(r.statusCode, 200);
  const c = r.cookies[0];
  assert.equal(c.name, 'session');
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, 'Lax');
  assert.ok(!r.body.includes(c.value));
  assert.equal(r.json().role, 'owner');
});

test('sign-out ends the session on the server, not just in the browser', async () => {
  const { call, signIn, app } = await freshApp();
  const cookie = await signIn('member');
  assert.equal((await call('member', 'GET', '/api/v1/auth/session')).statusCode, 200);
  await call('member', 'POST', '/api/v1/auth/signout');
  const again = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } });
  assert.equal(again.statusCode, 401, 'old cookie is dead');
});

test('bad input gets a plain 400 with field messages; unknown keys are refused', async () => {
  const { call } = await freshApp();
  const r = await call('admin', 'PATCH', '/api/v1/workspace', { accent: 'teal' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().details[0].field, 'accent');
  assert.equal((await call('admin', 'PATCH', '/api/v1/workspace', { name: 'x', isAdmin: true })).statusCode, 400);
  assert.equal((await call('admin', 'PATCH', '/api/v1/workspace', {})).statusCode, 400);
});

test('workspace update by an admin is applied and audited with before and after', async () => {
  const { db, call, creds } = await freshApp();
  const r = await call('admin', 'PATCH', '/api/v1/workspace', { name: 'Renamed Co', accent: '#112233' });
  assert.equal(r.statusCode, 200);
  assert.equal((await call('member', 'GET', '/api/v1/workspace')).json().name, 'Renamed Co');
  const ev = db.prepare("select * from audit_events where action = 'workspace.update'").get();
  assert.equal(ev.actor_id, creds.admin.userId);
  assert.equal(JSON.parse(ev.before_json).name, 'Brightside IT Support (demo)');
  assert.equal(JSON.parse(ev.after_json).name, 'Renamed Co');
});

test('role changes: admins cannot mint owners or touch owners; the last owner is protected', async () => {
  const { call, creds, db } = await freshApp();
  assert.equal((await call('admin', 'PATCH', `/api/v1/members/${creds.member.userId}/role`, { role: 'owner' })).statusCode, 403);
  assert.equal((await call('admin', 'PATCH', `/api/v1/members/${creds.owner.userId}/role`, { role: 'member' })).statusCode, 403);
  assert.equal((await call('owner', 'PATCH', `/api/v1/members/${creds.owner.userId}/role`, { role: 'member' })).statusCode, 409);
  assert.equal((await call('admin', 'PATCH', `/api/v1/members/${creds.member.userId}/role`, { role: 'view_only' })).statusCode, 200);
  assert.equal((await call('admin', 'PATCH', '/api/v1/members/not-a-user/role', { role: 'member' })).statusCode, 404);
  const ev = db.prepare("select * from audit_events where action = 'member.role_change' order by seq desc limit 1").get();
  assert.equal(JSON.parse(ev.after_json).role, 'view_only');
});

test('a demoted user loses access on their very next request', async () => {
  const { call, creds } = await freshApp();
  assert.equal((await call('admin', 'GET', '/api/v1/members')).statusCode, 200);
  await call('owner', 'PATCH', `/api/v1/members/${creds.admin.userId}/role`, { role: 'view_only' });
  assert.equal((await call('admin', 'GET', '/api/v1/members')).statusCode, 403);
  assert.equal((await call('admin', 'PATCH', '/api/v1/workspace', { name: 'nope' })).statusCode, 403);
});

test('cross-site writes are refused; same-site writes pass', async () => {
  const { app, signIn } = await freshApp();
  const cookie = await signIn('admin');
  const evil = await app.inject({ method: 'PATCH', url: '/api/v1/workspace', payload: { name: 'pwned' }, headers: { cookie, origin: 'https://evil.example', host: 'app.local' } });
  assert.equal(evil.statusCode, 403);
  const ok = await app.inject({ method: 'PATCH', url: '/api/v1/workspace', payload: { name: 'fine' }, headers: { cookie, origin: 'http://app.local', host: 'app.local' } });
  assert.equal(ok.statusCode, 200);
});

test('sign-in is rate limited per address', async () => {
  const { app, creds } = await freshApp({ signinPerMinute: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.owner.email, password: 'wrong-password-1' } })).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});

test('security headers are on every response and API responses are not cached', async () => {
  const { app } = await freshApp();
  for (const url of ['/', '/api/v1/health', '/styles/tokens.css']) {
    const h = (await app.inject(url)).headers;
    assert.equal(h['x-content-type-options'], 'nosniff', url);
    assert.match(h['content-security-policy'], /default-src 'self'/, url);
    assert.equal(h['x-frame-options'], 'DENY', url);
  }
  assert.equal((await app.inject('/api/v1/health')).headers['cache-control'], 'no-store');
});

test('server errors never leak internals', async () => {
  const { app, db, call } = await freshApp();
  db.exec('drop table workspace_settings; drop table memberships;');
  const r = await call(null, 'GET', '/api/v1/health');
  assert.equal(r.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: 'not json', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.statusCode, 400);
  assert.ok(!bad.body.includes('Unexpected'));
});
