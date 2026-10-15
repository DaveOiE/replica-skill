import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp } from './helpers.js';
import { verifyChain } from '../server/audit.js';

const bearer = (t) => ({ authorization: `Bearer ${t}` });
const asToken = (app, token, method, url, payload) => app.inject({ method, url, payload, headers: bearer(token) });

test('management: admins create accounts and tokens; the token is shown once and only a hash is stored', async () => {
  const { app, call, db, creds } = await freshApp();
  const acct = await call('admin', 'POST', '/api/v1/service-accounts', { name: 'Zen ingestion' });
  assert.equal(acct.statusCode, 201);
  const made = await call('admin', 'POST', `/api/v1/service-accounts/${acct.json().id}/tokens`, { label: 'prod', scopes: ['tasks:write'], expiresInDays: 30 });
  assert.equal(made.statusCode, 201);
  const { token, id } = made.json();
  assert.match(token, /^dsk_[A-Za-z0-9_-]{43}$/);
  const stored = JSON.stringify(db.prepare('select * from api_tokens').all()) + JSON.stringify(db.prepare('select * from audit_events').all());
  assert.ok(!stored.includes(token), 'the raw token is in no table and not in the audit trail');
  const list = JSON.stringify((await call('admin', 'GET', '/api/v1/service-accounts')).json());
  assert.ok(!list.includes(token) && !list.includes('token_hash'), 'listing never shows a token');
  const mine = (await call('admin', 'GET', '/api/v1/service-accounts')).json().accounts.find((a) => a.id === acct.json().id);
  assert.deepEqual([mine.tokens[0].label, mine.tokens[0].scopes, mine.tokens[0].lastUsedAt, mine.tokens[0].revokedAt], ['prod', ['tasks:write'], null, null]);
  const used = await asToken(app, token, 'GET', '/api/v1/service/whoami');
  assert.deepEqual(used.json(), { account: 'Zen ingestion', scopes: ['tasks:write'] });
  assert.ok(db.prepare('select last_used_at from api_tokens where id = ?').get(id).last_used_at, 'last used time is recorded');
  for (const who of ['member', 'viewonly', 'guest']) {
    assert.equal((await call(who, 'POST', '/api/v1/service-accounts', { name: 'x' })).statusCode, 403, who);
    assert.equal((await call(who, 'GET', '/api/v1/service-accounts')).statusCode, 403, who);
  }
  assert.equal((await call('outsider', 'POST', `/api/v1/service-accounts/${acct.json().id}/tokens`, { label: 'x', scopes: ['tasks:read'] })).statusCode, 404, 'another workspace');
  assert.equal((await call('admin', 'POST', `/api/v1/service-accounts/${acct.json().id}/tokens`, { label: 'x', scopes: ['admin'] })).statusCode, 400, 'unknown scope refused');
  assert.equal((await call('admin', 'POST', `/api/v1/service-accounts/${acct.json().id}/tokens`, { label: 'x', scopes: [] })).statusCode, 400);
  assert.deepEqual(db.prepare("select action from audit_events where action like 'service_%' order by seq").all().map((e) => e.action), ['service_account.create', 'service_token.create']);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('a token can never manage tokens, accounts or anything else', async () => {
  const { app, creds } = await freshApp();
  for (const t of [creds.svc.write.token, creds.svc.read.token]) {
    assert.equal((await asToken(app, t, 'GET', '/api/v1/service-accounts')).statusCode, 403);
    assert.equal((await asToken(app, t, 'POST', '/api/v1/service-accounts', { name: 'x' })).statusCode, 403);
    assert.equal((await asToken(app, t, 'POST', `/api/v1/service-accounts/${creds.svc.write.accountId}/tokens`, { label: 'x', scopes: ['tasks:read'] })).statusCode, 403);
  }
});

test('scope isolation: against every route, a token may call only what names its scope: whoami for both, ingest for the write token only', async () => {
  const { app, db, creds } = await freshApp();
  const before = db.prepare("select (select count(*) from tasks) t, (select count(*) from projects) p, (select count(*) from users) u, (select count(*) from memberships) m").get();
  for (const [name, tok] of [['write', creds.svc.write.token], ['read', creds.svc.read.token]]) {
    for (const r of app.routeTable.filter((x) => !x.public)) {
      const s = r.sample({ creds, who: creds.owner });
      const res = await asToken(app, tok, r.method, s.url, s.payload);
      if (r.action === 'service:whoami') assert.equal(res.statusCode, 200, `${name} ${r.method} ${r.url}`);
      else if (r.action === 'tasks:ingest') assert.equal(res.statusCode, name === 'write' ? 201 : 403, `${name} token on ingest`);
      else assert.equal(res.statusCode, 403, `${name} token on ${r.method} ${r.url} got ${res.statusCode}`);
    }
  }
  const after = db.prepare("select (select count(*) from tasks) t, (select count(*) from projects) p, (select count(*) from users) u, (select count(*) from memberships) m").get();
  assert.deepEqual({ ...after }, { ...before, t: before.t + 1, p: before.p + 1 }, 'the only changes are the one task and its Internal project from the write token\'s allowed ingest call; every refused call changed nothing');
});

test('a token cannot reach the people directory, and service accounts are not people', async () => {
  const { app, call, creds } = await freshApp();
  assert.equal((await asToken(app, creds.svc.read.token, 'GET', '/api/v1/members')).statusCode, 403);
  assert.equal((await asToken(app, creds.svc.read.token, 'GET', `/api/v1/projects/${creds.projects.pub}/people`)).statusCode, 403);
  const people = JSON.stringify((await call('admin', 'GET', '/api/v1/members')).json());
  assert.ok(!people.includes('service.invalid') && !people.includes('Zen ingestion'), 'service accounts are not in the staff list');
  const email = (await call('admin', 'GET', '/api/v1/service-accounts')).json(); // an account's placeholder address can never sign in
  assert.ok(email.accounts.length >= 3);
  const { db } = await freshApp();
  const svcEmail = db.prepare("select email from users where kind = 'service' limit 1").get().email;
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: svcEmail, password: 'anything-long-enough-1' } })).statusCode, 401);
});

test('tokens from another workspace work only in their own: the same call sees nothing of this one', async () => {
  const { app, creds } = await freshApp();
  const r = await asToken(app, creds.svc.other.token, 'GET', '/api/v1/service/whoami');
  assert.deepEqual(r.json(), { account: 'Other Co service', scopes: ['tasks:read', 'tasks:write'] });
});

test('bad tokens all look the same: garbage, revoked, expired, deactivated account, wrong prefix; no fallback to a cookie', async () => {
  const { app, call, db, creds } = await freshApp();
  const ask = async (h) => { const r = await app.inject({ method: 'GET', url: '/api/v1/service/whoami', headers: h }); return [r.statusCode, r.body]; };
  const good = creds.svc.read.token;
  const expected = [401, '{"error":"That token is not valid."}'];
  assert.deepEqual(await ask({ authorization: 'Bearer dsk_' + 'x'.repeat(43) }), expected);
  assert.deepEqual(await ask({ authorization: 'Bearer nonsense' }), expected);
  assert.deepEqual(await ask({ authorization: good }), expected, 'missing the Bearer word');
  assert.equal((await ask(bearer(good)))[0], 200);
  // a valid session cookie does not rescue a bad token
  const cookie = (await app.inject({ method: 'POST', url: '/api/v1/auth/signin', payload: { email: creds.admin.email, password: creds.admin.password } })).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  assert.deepEqual(await ask({ authorization: 'Bearer dsk_' + 'y'.repeat(43), cookie }), expected);
  // revoke
  const acct = creds.svc.read.accountId;
  const t = (await call('admin', 'GET', '/api/v1/service-accounts')).json().accounts.find((a) => a.id === acct).tokens[0];
  assert.equal((await call('admin', 'DELETE', `/api/v1/service-accounts/${acct}/tokens/${t.id}`)).statusCode, 200);
  assert.deepEqual(await ask(bearer(good)), expected, 'revoked');
  // expired
  const exp = await call('admin', 'POST', `/api/v1/service-accounts/${acct}/tokens`, { label: 'short', scopes: ['tasks:read'], expiresInDays: 1 });
  assert.equal((await ask(bearer(exp.json().token)))[0], 200);
  db.prepare('update api_tokens set expires_at = ? where id = ?').run('2000-01-01T00:00:00.000Z', exp.json().id);
  assert.deepEqual(await ask(bearer(exp.json().token)), expected, 'expired');
  // deactivated account kills every token
  const live = await call('admin', 'POST', `/api/v1/service-accounts/${acct}/tokens`, { label: 'live', scopes: ['tasks:read'] });
  assert.equal((await call('admin', 'DELETE', `/api/v1/service-accounts/${acct}`)).statusCode, 200);
  assert.deepEqual(await ask(bearer(live.json().token)), expected, 'deactivated');
  assert.equal((await call('admin', 'POST', `/api/v1/service-accounts/${acct}/tokens`, { label: 'x', scopes: ['tasks:read'] })).statusCode, 404, 'no new tokens for a deactivated account');
  assert.equal((await call('admin', 'DELETE', `/api/v1/service-accounts/${acct}/tokens/not-a-token`)).statusCode, 404, 'revoking something that is not there is a clean 404');
  assert.equal((await call('admin', 'DELETE', `/api/v1/service-accounts/${acct}/tokens/${t.id}`)).statusCode, 404, 'and so is revoking twice');
});

test('audit: every token call is recorded under the service account; refusals too; nothing secret; rate-limit refusals are not', async () => {
  const lines = [];
  const { app, db, creds } = await freshApp({ tokenCallsPerMinute: 4, logger: { level: 'trace', stream: { write: (l) => lines.push(l) } } });
  const t = creds.svc.read.token;
  await asToken(app, t, 'GET', '/api/v1/service/whoami');                 // allowed read
  await asToken(app, t, 'GET', '/api/v1/members');                        // refused
  await asToken(app, t, 'POST', '/api/v1/service-accounts', { name: 'x' }); // refused write
  const rows = db.prepare("select action, actor_id, actor_kind, summary from audit_events where actor_kind = 'service' order by seq").all();
  assert.deepEqual(rows.map((r) => r.action), ['api.call', 'api.denied', 'api.denied']);
  assert.ok(rows.every((r) => r.actor_id === creds.svc.read.accountId));
  assert.match(rows[1].summary, /GET \/api\/v1\/members answered 403/);
  const r4 = await asToken(app, t, 'GET', '/api/v1/service/whoami');
  const r5 = await asToken(app, t, 'GET', '/api/v1/service/whoami');
  assert.deepEqual([r4.statusCode, r5.statusCode, r5.headers['retry-after']], [200, 429, '60'], 'the per-token limit');
  assert.equal(db.prepare("select count(*) n from audit_events where actor_kind = 'service'").get().n, 4, 'the rate-limited call is not audited, so a flood cannot fill the trail');
  assert.equal((await asToken(app, creds.svc.write.token, 'GET', '/api/v1/service/whoami')).statusCode, 200, 'another token is unaffected');
  const everything = JSON.stringify(db.prepare('select * from audit_events').all()) + lines.join('');
  assert.ok(lines.length > 0);
  for (const tok of [creds.svc.read.token, creds.svc.write.token]) assert.ok(!everything.includes(tok.slice(4)), 'no token in the audit trail or the logs');
  assert.ok(!everything.includes('Bearer '), 'no authorization header in the logs');
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('guessing tokens is rate limited per address', async () => {
  const { app } = await freshApp({ tokenPerMinute: 3 });
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'GET', url: '/api/v1/service/whoami', headers: bearer('dsk_' + String(i).repeat(43)) })).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
});
