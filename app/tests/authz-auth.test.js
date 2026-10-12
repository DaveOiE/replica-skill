import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can, canAssignRole, ACTIONS, ROLES } from '../server/authz.js';
import { signIn, actorFromToken, signOut, GENERIC_FAILURE, LOCKED_MESSAGE, MAX_FAILURES } from '../server/auth.js';
import { verifyChain } from '../server/audit.js';
import { freshDb } from './helpers.js';

const actor = (role, workspaceId = 'w1') => ({ userId: 'u', workspaceId, role, kind: 'user' });

test('authz matrix: every role against every action', () => {
  const expected = {
    'session:read': { owner: 1, admin: 1, member: 1, view_only: 1, guest: 1 },
    'workspace:read': { owner: 1, admin: 1, member: 1, view_only: 1, guest: 1 },
    'workspace:update': { owner: 1, admin: 1, member: 0, view_only: 0, guest: 0 },
    'members:read': { owner: 1, admin: 1, member: 0, view_only: 0, guest: 0 },
    'members:update_role': { owner: 1, admin: 1, member: 0, view_only: 0, guest: 0 },
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(ACTIONS).sort(), 'matrix covers every action');
  for (const [action, byRole] of Object.entries(expected))
    for (const role of ROLES) assert.equal(can(actor(role), action), !!byRole[role], `${role} ${action}`);
});

test('authz: no actor, unknown action, and other workspace are all denied', () => {
  assert.equal(can(null, 'workspace:read'), false);
  assert.equal(can(actor('owner'), 'not:an:action'), false);
  assert.equal(can(actor('owner', 'w1'), 'workspace:read', { workspaceId: 'w2' }), false);
  assert.equal(can(actor('owner', 'w1'), 'workspace:read', { workspaceId: 'w1' }), true);
});

test('authz: view-only and guest can never write, even if a table row said they could', () => {
  ACTIONS['test:write'] = { roles: ROLES, write: true };
  try {
    for (const role of ['view_only', 'guest']) assert.equal(can(actor(role), 'test:write'), false);
    assert.equal(can(actor('member'), 'test:write'), true);
  } finally { delete ACTIONS['test:write']; }
});

test('role assignment: only owners touch owners; admins cannot mint owners', () => {
  assert.equal(canAssignRole(actor('owner'), 'admin', 'owner'), true);
  assert.equal(canAssignRole(actor('admin'), 'member', 'owner'), false);
  assert.equal(canAssignRole(actor('admin'), 'owner', 'member'), false);
  assert.equal(canAssignRole(actor('admin'), 'member', 'view_only'), true);
  assert.equal(canAssignRole(actor('member'), 'guest', 'member'), false);
  assert.equal(canAssignRole(actor('owner'), 'member', 'superuser'), false);
});

const ctxOf = (db) => ({ db, ip: '127.0.0.1', requestId: 'test' });

test('sign-in: success creates a session whose token resolves to the actor; sign-out ends it', () => {
  const { db, creds } = freshDb();
  const r = signIn(ctxOf(db), { email: creds.member.email.toUpperCase(), password: creds.member.password });
  assert.equal(r.ok, true);
  assert.equal(r.actor.role, 'member');
  assert.equal(actorFromToken(db, r.token).userId, creds.member.userId);
  assert.equal(db.prepare('select count(*) n from sessions where id = ?').get(r.token).n, 0, 'raw token is never stored');
  assert.equal(signOut(ctxOf(db), r.token), true);
  assert.equal(actorFromToken(db, r.token), null);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('sign-in: wrong password and unknown email give the same answer', () => {
  const { db, creds } = freshDb();
  const a = signIn(ctxOf(db), { email: creds.member.email, password: 'wrong-password-1' });
  const b = signIn(ctxOf(db), { email: 'nobody@example.test', password: 'wrong-password-1' });
  assert.deepEqual([a.ok, a.status, a.error], [false, 401, GENERIC_FAILURE]);
  assert.deepEqual([b.ok, b.status, b.error], [false, 401, GENERIC_FAILURE]);
});

test('lockout: five failures lock a real account and an unknown email in the same way', () => {
  const { db, creds } = freshDb();
  for (const email of [creds.member.email, 'ghost@example.test']) {
    let last;
    for (let i = 0; i < MAX_FAILURES; i++) last = signIn(ctxOf(db), { email, password: 'wrong-password-1' });
    assert.equal(last.status, 429, email);
    assert.equal(last.error, LOCKED_MESSAGE);
  }
  const right = signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password });
  assert.equal(right.ok, false, 'correct password is refused while locked');
  assert.equal(right.status, 429);
  const later = new Date(Date.now() + 16 * 60000).toISOString();
  assert.equal(signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password, now: later }).ok, true, 'unlocks after 15 minutes');
});

test('sign-in: every attempt is audited, and the trail never holds a password', () => {
  const { db, creds } = freshDb();
  signIn(ctxOf(db), { email: creds.admin.email, password: 'wrong-password-1', workspaceSlug: 'demo' });
  signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password, workspaceSlug: 'demo' });
  const actions = db.prepare('select action from audit_events where workspace_id = ? order by seq').all(creds.workspaces.demo).map((r) => r.action);
  assert.deepEqual(actions.slice(-2), ['auth.signin_failed', 'auth.signin']);
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!dump.includes(creds.admin.password) && !dump.includes('wrong-password-1') && !dump.includes('scrypt$'));
});

test('sessions: expiry, deactivation and role changes take effect immediately', () => {
  const { db, creds } = freshDb();
  const { token } = signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password });
  assert.equal(actorFromToken(db, token, new Date(Date.now() + 13 * 3600000).toISOString()), null, 'expired after 12h');
  db.prepare("update memberships set role = 'view_only' where user_id = ?").run(creds.admin.userId);
  assert.equal(actorFromToken(db, token).role, 'view_only', 'role is read fresh each request');
  db.prepare("update users set status = 'deactivated' where id = ?").run(creds.admin.userId);
  assert.equal(actorFromToken(db, token), null);
  assert.equal(signIn(ctxOf(db), { email: creds.admin.email, password: creds.admin.password }).ok, false);
});

test('sign-in: a user in two workspaces must choose; a non-member cannot pick a workspace', () => {
  const { db, creds } = freshDb();
  db.prepare(`insert into memberships(id,workspace_id,user_id,role,created_at,updated_at) values ('m-x',?,?,'member','t','t')`)
    .run(creds.workspaces.other, creds.member.userId);
  const none = signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password });
  assert.equal(none.status, 409);
  assert.deepEqual(none.workspaces, ['demo', 'other']);
  assert.equal(signIn(ctxOf(db), { email: creds.member.email, password: creds.member.password, workspaceSlug: 'other' }).actor.workspaceId, creds.workspaces.other);
  assert.equal(signIn(ctxOf(db), { email: creds.outsider.email, password: creds.outsider.password, workspaceSlug: 'demo' }).ok, false);
});
