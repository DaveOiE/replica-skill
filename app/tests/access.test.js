import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { freshApp } from './helpers.js';
import { MAX_FAILURES } from '../server/auth.js';
import { verifyChain } from '../server/audit.js';

const tokenOf = (link) => link.split('/').pop();
const signin = (app, email, password) => app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email, password } });

test('unlock: an admin clears a locked account and the person can sign in again', async () => {
  const { app, call, db, creds } = await freshApp();
  for (let i = 0; i < MAX_FAILURES; i++) await signin(app, creds.member2.email, 'wrong-password-1');
  assert.equal((await signin(app, creds.member2.email, creds.member2.password)).statusCode, 429, 'locked even with the right password');
  assert.equal((await call('member', 'POST', `/api/v1/members/${creds.member2.userId}/unlock`)).statusCode, 403);
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/unlock`)).statusCode, 200);
  assert.equal((await signin(app, creds.member2.email, creds.member2.password)).statusCode, 200);
  assert.equal(db.prepare("select count(*) n from audit_events where action = 'member.unlock'").get().n, 1);
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.outsider.userId}/unlock`)).statusCode, 404, 'other workspace');
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.owner.userId}/unlock`)).statusCode, 403, 'admins cannot touch owners');
});

test('reset end to end: link works once, old password dies, sessions end, lock clears, B-006 is closed', async () => {
  const { app, call, db, creds } = await freshApp();
  const old = await signin(app, creds.member2.email, creds.member2.password);
  const oldCookie = old.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  for (let i = 0; i < MAX_FAILURES; i++) await signin(app, creds.member2.email, 'wrong-password-1'); // locked and forgotten
  const r = await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/reset`);
  assert.equal(r.statusCode, 201);
  const token = tokenOf(r.json().link);
  assert.equal(db.prepare('select count(*) n from password_resets where token_hash = ?').get(token).n, 0, 'the raw token is never stored');
  assert.deepEqual((await app.inject({ url: `/api/v1/resets/${token}` })).json(), { email: creds.member2.email, workspaceName: 'Brightside IT Support (demo)' });
  const weak = await app.inject({ method: 'POST', url: `/api/v1/resets/${token}/complete`, payload: { password: 'short' } });
  assert.equal(weak.statusCode, 400);
  const done = await app.inject({ method: 'POST', url: `/api/v1/resets/${token}/complete`, payload: { password: 'brand-new-password-9' } });
  assert.equal(done.statusCode, 200);
  assert.equal((await app.inject({ url: '/api/v1/auth/session', headers: { cookie: oldCookie } })).statusCode, 401, 'old session ended');
  assert.equal((await signin(app, creds.member2.email, creds.member2.password)).statusCode, 401, 'old password is dead');
  assert.equal((await signin(app, creds.member2.email, 'brand-new-password-9')).statusCode, 200, 'new password works, lock is gone');
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/resets/${token}/complete`, payload: { password: 'another-new-password-9' } })).statusCode, 404, 'single use');
  assert.equal((await app.inject({ url: `/api/v1/resets/${token}` })).statusCode, 404);
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes(token) && !dump.includes('brand-new-password-9'));
  assert.deepEqual(db.prepare("select action from audit_events where action like '%reset%' order by seq").all().map((x) => x.action), ['member.reset_issued', 'auth.password_reset']);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('reset rules: not yourself, not an owner unless you are one, not someone in two workspaces, links expire, a new link replaces the old', async () => {
  const { app, call, db, creds } = await freshApp();
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.admin.userId}/reset`)).statusCode, 400);
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.owner.userId}/reset`)).statusCode, 403);
  assert.equal((await call('owner', 'POST', `/api/v1/members/${creds.guest.userId}/reset`)).statusCode, 201);
  assert.equal((await call('member', 'POST', `/api/v1/members/${creds.member2.userId}/reset`)).statusCode, 403);
  assert.equal((await call('admin', 'POST', `/api/v1/members/${creds.outsider.userId}/reset`)).statusCode, 404);
  const first = tokenOf((await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/reset`)).json().link);
  const second = tokenOf((await call('admin', 'POST', `/api/v1/members/${creds.member2.userId}/reset`)).json().link);
  assert.equal((await app.inject({ url: `/api/v1/resets/${first}` })).statusCode, 404, 'the older link stopped working');
  db.prepare('update password_resets set expires_at = ?').run('2000-01-01T00:00:00.000Z');
  assert.equal((await app.inject({ url: `/api/v1/resets/${second}` })).statusCode, 404, 'expired');
  db.prepare("insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values ('m2','" + creds.workspaces.other + "', ?, 'member','t','t')").run(creds.member.userId);
  const two = await call('admin', 'POST', `/api/v1/members/${creds.member.userId}/reset`);
  assert.equal(two.statusCode, 409);
  assert.match(two.json().error, /more than one workspace/);
});

test('invites end to end: create, read, accept, sign in, single use', async () => {
  const { app, call, db, creds } = await freshApp();
  const made = await call('admin', 'POST', '/api/v1/invites', { email: 'Pat.Lee@Example.test', role: 'guest' });
  assert.equal(made.statusCode, 201);
  const token = tokenOf(made.json().link);
  assert.equal(db.prepare('select count(*) n from invites where token_hash = ?').get(token).n, 0, 'raw token never stored');
  assert.ok(!JSON.stringify((await call('admin', 'GET', '/api/v1/invites')).json()).includes(token), 'listing never shows a link');
  assert.deepEqual((await call('admin', 'GET', '/api/v1/invites')).json().invites.map((i) => i.email).sort(), ['new.hire@example.test', 'pat.lee@example.test']);
  assert.deepEqual((await app.inject({ url: `/api/v1/invites/${token}` })).json(), { email: 'pat.lee@example.test', role: 'guest', workspaceName: 'Brightside IT Support (demo)' });
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/invites/${token}/accept`, payload: { name: 'Pat Lee', password: 'short' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/invites/${token}/accept`, payload: { name: 'Pat Lee', password: 'a-long-enough-password-1' } })).statusCode, 201);
  const login = await signin(app, 'pat.lee@example.test', 'a-long-enough-password-1');
  assert.equal(login.json().role, 'guest');
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/invites/${token}/accept`, payload: { name: 'Pat Again', password: 'a-long-enough-password-1' } })).statusCode, 404, 'single use');
  const ev = db.prepare("select * from audit_events where action = 'invite.accept'").get();
  assert.equal(ev.actor_kind, 'anonymous');
  assert.ok(!JSON.stringify(db.prepare('select * from audit_events').all()).includes(token));
});

test('invite rules: who may invite, no existing accounts, revoke, expiry, bad links all look the same', async () => {
  const { app, call, db, creds } = await freshApp();
  assert.equal((await call('member', 'POST', '/api/v1/invites', { email: 'x@example.test', role: 'member' })).statusCode, 403);
  assert.equal((await call('admin', 'POST', '/api/v1/invites', { email: 'x@example.test', role: 'owner' })).statusCode, 400);
  assert.equal((await call('admin', 'POST', '/api/v1/invites', { email: creds.member.email, role: 'member' })).statusCode, 409);
  const a = (await call('admin', 'POST', '/api/v1/invites', { email: 'dup@example.test', role: 'member' })).json();
  const b = (await call('admin', 'POST', '/api/v1/invites', { email: 'dup@example.test', role: 'guest' })).json();
  assert.equal((await app.inject({ url: `/api/v1/invites/${tokenOf(a.link)}` })).statusCode, 404, 'a new invite replaces the old one');
  assert.equal((await call('admin', 'DELETE', `/api/v1/invites/${b.id}`)).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/v1/invites/${tokenOf(b.link)}` })).statusCode, 404, 'revoked');
  const c = (await call('admin', 'POST', '/api/v1/invites', { email: 'late@example.test', role: 'member' })).json();
  db.prepare('update invites set expires_at = ?').run('2000-01-01T00:00:00.000Z');
  const expired = await app.inject({ url: `/api/v1/invites/${tokenOf(c.link)}` });
  const garbage = await app.inject({ url: '/api/v1/invites/not-a-real-token' });
  assert.deepEqual([expired.statusCode, expired.body], [garbage.statusCode, garbage.body], 'expired and invalid are indistinguishable');
  assert.equal((await call('outsider', 'DELETE', `/api/v1/invites/${creds.invites.pending}`)).statusCode, 404, 'other workspace cannot revoke');
  db.prepare("insert into users(id,email,name,created_at,updated_at) values ('late-u','race@example.test','R','t','t')").run();
  const race = (await call('admin', 'POST', '/api/v1/invites', { email: 'race2@example.test', role: 'member' })).json();
  db.prepare("update invites set email = 'race@example.test' where id = ?").run(race.id);
  assert.equal((await app.inject({ method: 'POST', url: `/api/v1/invites/${tokenOf(race.link)}/accept`, payload: { name: 'R', password: 'a-long-enough-password-1' } })).statusCode, 409, 'an account appeared after the invite');
});

test('public token routes are rate limited', async () => {
  const { app } = await freshApp({ tokenPerMinute: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject({ url: '/api/v1/invites/guess-' + i })).statusCode);
  assert.deepEqual(codes, [404, 404, 404, 429, 429]);
});
