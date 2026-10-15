import { z } from 'zod';
import { mutate } from './audit.js';
import { SCOPES, listServiceAccounts, accountIn, createServiceAccount, createToken, revokeToken, deactivateAccount } from './store.js';

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

/** Service accounts and tokens: managed by owners and admins in the browser only. A token can never manage tokens. */
export function serviceRoutes(define, db) {
  const gone = (reply) => reply.code(404).send({ error: 'We could not find that service account.' });

  define({ method: 'GET', url: '/api/v1/service-accounts', action: 'service_accounts:read', write: false,
    sample: () => ({ url: '/api/v1/service-accounts' }),
    handler: async ({ actor }) => ({ scopes: SCOPES, accounts: listServiceAccounts(db, actor.workspaceId) }) });

  define({ method: 'POST', url: '/api/v1/service-accounts', action: 'service_accounts:manage', write: true,
    body: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
    sample: () => ({ url: '/api/v1/service-accounts', payload: { name: 'Walk account' } }),
    handler: async ({ ctx, actor, body, reply }) => {
      let id;
      mutate(ctx, (r) => ({ action: 'service_account.create', targetType: 'service_account', targetId: r, summary: `Service account created: ${body.name}`, after: { name: body.name } }), () => { id = createServiceAccount(db, actor.workspaceId, body.name, actor.userId); return id; });
      return reply.code(201).send({ id });
    } });

  define({ method: 'POST', url: '/api/v1/service-accounts/:id/tokens', action: 'service_accounts:manage', write: true,
    body: z.object({ label: z.string().trim().min(1).max(80), scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length), expiresInDays: z.number().int().min(1).max(730).optional() }).strict(),
    sample: (fx) => ({ url: `/api/v1/service-accounts/${fx.creds.svc.write.accountId}/tokens`, payload: { label: 'walk token', scopes: ['tasks:read'], expiresInDays: 30 } }),
    handler: async ({ ctx, req, actor, body, reply }) => {
      const acct = accountIn(db, actor.workspaceId, req.params.id);
      if (!acct || acct.status !== 'active') return gone(reply);
      const scopes = [...new Set(body.scopes)], expiresAt = body.expiresInDays ? inDays(body.expiresInDays) : null;
      const made = mutate(ctx, (r) => ({ action: 'service_token.create', targetType: 'service_account', targetId: acct.id, summary: `Token created for ${acct.name}: ${body.label}`, after: { tokenId: r.id, scopes, expiresAt } }),
        () => createToken(db, actor.workspaceId, acct.id, body.label, scopes, expiresAt));
      return reply.code(201).send({ id: made.id, token: made.token, scopes, expiresAt, note: 'Copy this token now. It is shown once and only a hash is stored.' });
    } });

  define({ method: 'DELETE', url: '/api/v1/service-accounts/:id/tokens/:tokenId', action: 'service_accounts:manage', write: true,
    sample: (fx) => ({ url: `/api/v1/service-accounts/${fx.creds.svc.write.accountId}/tokens/${fx.creds.svc.disposableTokenId}` }),
    handler: async ({ ctx, req, actor, reply }) => {
      const acct = accountIn(db, actor.workspaceId, req.params.id);
      if (!acct) return gone(reply);
      if (!db.prepare('select 1 from api_tokens where id = ? and user_id = ? and workspace_id = ? and revoked_at is null').get(req.params.tokenId, acct.id, actor.workspaceId)) return reply.code(404).send({ error: 'We could not find that token, or it is already revoked.' });
      mutate(ctx, { action: 'service_token.revoke', targetType: 'service_account', targetId: acct.id, summary: `Token revoked for ${acct.name}`, after: { tokenId: req.params.tokenId } }, () => revokeToken(db, actor.workspaceId, acct.id, req.params.tokenId));
      return { ok: true };
    } });

  define({ method: 'DELETE', url: '/api/v1/service-accounts/:id', action: 'service_accounts:manage', write: true,
    sample: (fx) => ({ url: `/api/v1/service-accounts/${fx.creds.svc.disposableAccountId}` }),
    handler: async ({ ctx, req, actor, reply }) => {
      const acct = accountIn(db, actor.workspaceId, req.params.id);
      if (!acct) return gone(reply);
      mutate(ctx, { action: 'service_account.deactivate', targetType: 'service_account', targetId: acct.id, summary: `Service account deactivated: ${acct.name} (all its tokens revoked)` }, () => deactivateAccount(db, actor.workspaceId, acct.id));
      return { ok: true };
    } });

  // The one call a token can make in this phase: lets Zen check that its token works and see its scopes.
  define({ method: 'GET', url: '/api/v1/service/whoami', action: 'service:whoami', write: false,
    sample: () => ({ url: '/api/v1/service/whoami' }),
    handler: async ({ actor }) => ({ account: actor.name, scopes: actor.scopes }) });
}
