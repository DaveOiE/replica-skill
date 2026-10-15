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
import { nowIso } from './db.js';
import { BusyError } from './password.js';
import { cleanupSessions } from './auth.js';
import { foldOrRecord, flushFolds, takeAnonymousCount } from './audit-fold.js';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', 'web');
const sharedDir = join(here, '..', 'shared');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadConfig(env = process.env) {
  // A setting still holding a placeholder from an example file means the file was never filled in. Stop, and say which one.
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string' && v.includes('__REPLACE')) throw new Error(`${k} still holds a placeholder (__REPLACE...). Fill in the settings file before starting.`);
  const publicUrl = (env.PUBLIC_URL || `http://127.0.0.1:${Number(env.PORT || 3000)}`).replace(/\/+$/, '');
  const https = publicUrl.startsWith('https://');
  // The session cookie is Secure whenever the public address is https, unless someone says otherwise on purpose.
  // The service runs with NODE_ENV=production: there, an address that is missing or not https is a mistake to stop on, not to guess around.
  if (env.NODE_ENV === 'production' && !https) throw new Error('NODE_ENV is production, so PUBLIC_URL must be set to the public https address (for example https://tasks.example.test).');
  // Where the app listens. Always this machine unless a test container needs it wider. In production a wider address is refused: Caddy on this machine is the only thing that may reach the app.
  const host = env.HOST || '127.0.0.1';
  if (env.NODE_ENV === 'production' && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('NODE_ENV is production, so HOST must stay on this machine (127.0.0.1). Only the reverse proxy may be reachable from outside.');
  if (https && env.COOKIE_SECURE === 'false') throw new Error('PUBLIC_URL is https but COOKIE_SECURE=false. A session cookie must be Secure on an https site: remove COOKIE_SECURE or set it to true.');
  return {
    host, port: Number(env.PORT || 3000), dbPath: env.DB_PATH || join(here, '..', '..', 'data', 'app.db'),
    sessionHours: Number(env.SESSION_HOURS || 12), publicUrl, cookieSecure: env.COOKIE_SECURE === undefined ? https : env.COOKIE_SECURE === 'true',
    // true only when a reverse proxy on this machine sits in front: then the caller's address comes from the proxy's forwarded header.
    trustProxy: env.TRUST_PROXY === 'true',
    idleMinutes: Number(env.SESSION_IDLE_MINUTES || 120),   // a session unused for this long ends, even before its 12 hours are up
  };
}

export async function buildApp({ db, config = loadConfig(), logger = false, signinPerMinute = 30, tokenPerMinute = 30, formPerMinute = 10, formPerHour = 60, tokenCallsPerMinute = 600, housekeeping = true }) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization'],
    // Query strings can hold typed client names (job search), so only the path is logged.
    // The route pattern, not the address: reset and invite links and public form addresses carry a secret in the path.
    serializers: { req: (req) => ({ method: req.method, route: req.routeOptions?.url ?? '(no route)', host: req.headers?.host, remoteAddress: req.ip }) },
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
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    if (config.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000'); // only sent when the site is https
  });
  // Every call made with a token is audited under the service account. Writes already record their own domain event, so only
  // reads, refusals and failed writes get an api.call or api.denied entry. The route pattern is logged, never the real URL or any value.
  app.addHook('onResponse', async (req, reply) => {
    const s = req.svc;
    if (!s || (s.spec.write && reply.statusCode < 400 && !s.audit)) return;   // s.audit is set for idempotent replays, which change nothing but are still recorded
    try {
      const action = reply.statusCode >= 400 ? 'api.denied' : 'api.call', now = nowIso();
      // One row per token, route and status in each window; the rest are counted and summarised (a poller must not be able to fill the trail).
      const first = foldOrRecord(db, `${action}|${s.actor.tokenId}|${s.spec.method} ${s.spec.url}|${reply.statusCode}`, { ws: s.actor.workspaceId, actorId: s.actor.userId, actorKind: 'service',
        targetType: 'api', targetId: s.spec.url, summaryAction: 'api.calls_repeated', summary: `More ${s.spec.method} ${s.spec.url} calls with the same result in the same window`, countKey: 'moreCalls', afterBase: { status: reply.statusCode, tokenId: s.actor.tokenId } }, now, req.ip);
      if (first) appendAudit(db, { workspaceId: s.actor.workspaceId, actorId: s.actor.userId, actorKind: 'service', action, targetType: 'api', targetId: s.spec.url,
        summary: `${s.spec.method} ${s.spec.url} answered ${reply.statusCode}`, after: { status: reply.statusCode, tokenId: s.actor.tokenId }, ip: req.ip, requestId: req.id });
    } catch (e) { req.log.error({ err: { message: e.message } }, 'audit write failed'); }
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof BusyError) return reply.code(503).header('Retry-After', '5').send({ error: 'The server is busy. Try again in a few seconds.' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'That request could not be read.' });
    req.log.error({ err: { message: err.message } }, 'request failed');
    return reply.code(500).send({ error: 'Something went wrong on our side. Nothing was changed.' });
  });

  registerRoutes(app, { db, config, limiters: { signin: makeLimiter({ max: signinPerMinute, windowMs: 60000 }), token: makeLimiter({ max: tokenPerMinute, windowMs: 60000 }),
      formSubmit: makeLimiter({ max: formPerMinute, windowMs: 60000 }), formHour: makeLimiter({ max: formPerHour, windowMs: 3600000 }), tokenCalls: makeLimiter({ max: tokenCallsPerMinute, windowMs: 60000 }) } });

  // The framework's own 404 echoes the requested path back; ours says the same thing for every unknown address.
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'We could not find that.' }));

  // Housekeeping: old sessions are cleared at start and every six hours; failed-sign-in summaries are written when their window ends and on shutdown.
  const tick = () => { try { cleanupSessions(db); flushFolds(db); } catch (e) { app.log.error({ err: { message: e.message } }, 'housekeeping failed'); } };
  if (housekeeping) {
    tick();
    const sessions = setInterval(tick, 6 * 3600000).unref(), flush = setInterval(() => { try { flushFolds(db); const n = takeAnonymousCount(db); if (n) app.log.warn({ failedSignInsUnknownAccounts: n }, 'failed sign-ins for accounts that do not exist since the last check'); } catch { /* next time */ } }, 60000).unref();
    app.addHook('onClose', async () => { clearInterval(sessions); clearInterval(flush); try { flushFolds(db, { all: true }); } catch { /* database already closed */ } });
  }

  const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8').replaceAll('{{PRODUCT_NAME}}', escapeHtml(PRODUCT_NAME));
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
  await app.register(fastifyStatic, { root: sharedDir, prefix: '/shared/', decorateReply: false });
  await app.register(fastifyStatic, { root: webDir, prefix: '/', index: false, wildcard: true, decorateReply: false });
  return app;
}
