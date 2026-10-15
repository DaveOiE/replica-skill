import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME } from '../shared/brand.js';
import { registerRoutes } from './routes.js';
import { makeLimiter } from './rateLimit.js';
import { appendAudit } from './audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', 'web');
const sharedDir = join(here, '..', 'shared');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadConfig(env = process.env) {
  const publicUrl = (env.PUBLIC_URL || `http://127.0.0.1:${Number(env.PORT || 3000)}`).replace(/\/+$/, '');
  const https = publicUrl.startsWith('https://');
  // The session cookie is Secure whenever the public address is https, unless someone says otherwise on purpose.
  if (https && env.COOKIE_SECURE === 'false') throw new Error('PUBLIC_URL is https but COOKIE_SECURE=false. A session cookie must be Secure on an https site: remove COOKIE_SECURE or set it to true.');
  return {
    port: Number(env.PORT || 3000), dbPath: env.DB_PATH || join(here, '..', '..', 'data', 'app.db'),
    sessionHours: Number(env.SESSION_HOURS || 12), publicUrl, cookieSecure: env.COOKIE_SECURE === undefined ? https : env.COOKIE_SECURE === 'true',
    // true only when a reverse proxy on this machine sits in front: then the caller's address comes from the proxy's forwarded header.
    trustProxy: env.TRUST_PROXY === 'true',
  };
}

export async function buildApp({ db, config = loadConfig(), logger = false, signinPerMinute = 30, tokenPerMinute = 30, formPerMinute = 10, formPerHour = 60, tokenCallsPerMinute = 600 }) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization'],
    // Query strings can hold typed client names (job search), so only the path is logged.
    serializers: { req: (req) => ({ method: req.method, url: String(req.url).split('?')[0], host: req.headers?.host, remoteAddress: req.ip }) },
    ...(logger === true ? {} : logger) } : false, genReqId: () => randomUUID(), bodyLimit: 1_000_000,
    // The app only listens on this machine, so the only proxy it can trust is a local one; the right-most address that is not local is the caller.
    trustProxy: config.trustProxy ? ['127.0.0.1', '::1'] : false });
  app.routeTable = [];
  app.seenApiRoutes = [];
  app.addHook('onRoute', (r) => { if (String(r.url).startsWith('/api/v1')) app.seenApiRoutes.push(`${[].concat(r.method).join(',')} ${r.url}`); });
  await app.register(cookie);

  // Cross-site writes: a browser always sends Origin on POST/PATCH/DELETE; it must match this host.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* bad origin */ }
      if (host !== req.headers.host) return reply.code(403).send({ error: 'Cross-site request refused.' });
    }
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000'); // only sent when the site is https
  });
  // Every call made with a token is audited under the service account. Writes already record their own domain event, so only
  // reads, refusals and failed writes get an api.call or api.denied entry. The route pattern is logged, never the real URL or any value.
  app.addHook('onResponse', async (req, reply) => {
    const s = req.svc;
    if (!s || (s.spec.write && reply.statusCode < 400 && !s.audit)) return;   // s.audit is set for idempotent replays, which change nothing but are still recorded
    try {
      appendAudit(db, { workspaceId: s.actor.workspaceId, actorId: s.actor.userId, actorKind: 'service', action: reply.statusCode >= 400 ? 'api.denied' : 'api.call', targetType: 'api', targetId: s.spec.url,
        summary: `${s.spec.method} ${s.spec.url} answered ${reply.statusCode}`, after: { status: reply.statusCode, token: s.actor.tokenId }, ip: req.ip, requestId: req.id });
    } catch (e) { req.log.error({ err: { message: e.message } }, 'audit write failed'); }
  });
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'That request could not be read.' });
    req.log.error({ err: { message: err.message } }, 'request failed');
    return reply.code(500).send({ error: 'Something went wrong on our side. Nothing was changed.' });
  });

  registerRoutes(app, { db, config, limiters: { signin: makeLimiter({ max: signinPerMinute, windowMs: 60000 }), token: makeLimiter({ max: tokenPerMinute, windowMs: 60000 }),
      formSubmit: makeLimiter({ max: formPerMinute, windowMs: 60000 }), formHour: makeLimiter({ max: formPerHour, windowMs: 3600000 }), tokenCalls: makeLimiter({ max: tokenCallsPerMinute, windowMs: 60000 }) } });

  const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8').replaceAll('{{PRODUCT_NAME}}', escapeHtml(PRODUCT_NAME));
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
  await app.register(fastifyStatic, { root: sharedDir, prefix: '/shared/', decorateReply: false });
  await app.register(fastifyStatic, { root: webDir, prefix: '/', index: false, wildcard: true, decorateReply: false });
  return app;
}
