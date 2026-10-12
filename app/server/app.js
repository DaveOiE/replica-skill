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

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..', 'web');
const sharedDir = join(here, '..', 'shared');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000), dbPath: env.DB_PATH || join(here, '..', '..', 'data', 'app.db'),
    sessionHours: Number(env.SESSION_HOURS || 12), cookieSecure: env.COOKIE_SECURE === 'true',
  };
}

export async function buildApp({ db, config = loadConfig(), logger = false, signinPerMinute = 30, tokenPerMinute = 30, formPerMinute = 10, formPerHour = 60 }) {
  const app = Fastify({ logger: logger ? { redact: ['req.headers.cookie', 'req.headers.authorization'],
    // Query strings can hold typed client names (job search), so only the path is logged.
    serializers: { req: (req) => ({ method: req.method, url: String(req.url).split('?')[0], host: req.headers?.host, remoteAddress: req.ip }) },
    ...(logger === true ? {} : logger) } : false, genReqId: () => randomUUID(), bodyLimit: 1_000_000 });
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
  });
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'That request could not be read.' });
    req.log.error({ err: { message: err.message } }, 'request failed');
    return reply.code(500).send({ error: 'Something went wrong on our side. Nothing was changed.' });
  });

  registerRoutes(app, { db, config, limiters: { signin: makeLimiter({ max: signinPerMinute, windowMs: 60000 }), token: makeLimiter({ max: tokenPerMinute, windowMs: 60000 }),
      formSubmit: makeLimiter({ max: formPerMinute, windowMs: 60000 }), formHour: makeLimiter({ max: formPerHour, windowMs: 3600000 }) } });

  const indexHtml = readFileSync(join(webDir, 'index.html'), 'utf8').replaceAll('{{PRODUCT_NAME}}', escapeHtml(PRODUCT_NAME));
  app.get('/', async (req, reply) => reply.type('text/html; charset=utf-8').send(indexHtml));
  await app.register(fastifyStatic, { root: sharedDir, prefix: '/shared/', decorateReply: false });
  await app.register(fastifyStatic, { root: webDir, prefix: '/', index: false, wildcard: true, decorateReply: false });
  return app;
}
