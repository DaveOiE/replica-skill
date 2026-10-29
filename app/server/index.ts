import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { fromPool } from '../src/db/pg';
import { createHandlers, initServerDb, type Reply } from './handler';

export async function startSyncServer(opts: { databaseUrl: string; adminToken: string; port: number; host?: string }) {
  const pool = new Pool({ connectionString: opts.databaseUrl });
  const db = fromPool(pool);
  await initServerDb(db);
  const h = createHandlers(db, { adminToken: opts.adminToken });

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'content-type': 'application/json', 'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, authorization, x-schema-version', 'access-control-allow-methods': 'GET, POST, OPTIONS',
    });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<any>((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > 20_000_000) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const url = new URL(req.url ?? '/', 'http://x');
      const auth = req.headers.authorization, schema = req.headers['x-schema-version'] as string | undefined;
      let r: Reply;
      if (url.pathname === '/health') r = { status: 200, body: { ok: true } };
      else if (req.method === 'GET' && url.pathname === '/sync/info') r = await h.info();
      else if (req.method === 'POST' && url.pathname === '/sync/pair') r = await h.pair(await readBody(req));
      else if (req.method === 'POST' && url.pathname === '/sync/push') r = await h.push(auth, schema, await readBody(req));
      else if (req.method === 'GET' && url.pathname === '/sync/pull')
        r = await h.pull(auth, schema, Number(url.searchParams.get('since') ?? 0), Math.min(Number(url.searchParams.get('limit') ?? 200), 500));
      else if (url.pathname.startsWith('/admin/')) {
        if (!h.isAdmin(auth)) r = { status: 401, body: { error: 'unauthorized' } };
        else if (req.method === 'POST' && url.pathname === '/admin/pairing-codes') r = await h.createPairingCode((await readBody(req)).label);
        else if (req.method === 'POST' && /^\/admin\/devices\/[0-9a-f-]+\/revoke$/.test(url.pathname)) r = await h.revokeDevice(url.pathname.split('/')[3]);
        else r = { status: 404, body: { error: 'not_found' } };
      } else r = { status: 404, body: { error: 'not_found' } };
      send(res, r.status, r.body);
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : 'error' });
    }
  });
  server.keepAliveTimeout = 75_000;   // longer than any client's idle timeout, so a reused connection is never reset under it
  server.headersTimeout = 80_000;
  await new Promise<void>((ok) => server.listen(opts.port, opts.host ?? '0.0.0.0', ok));
  return { port: (server.address() as any).port as number, db, close: async () => { await new Promise((ok) => server.close(ok)); await pool.end(); } };
}

// Run directly: `npm run sync-server`
if (process.argv[1]?.endsWith('server/index.ts')) {
  const admin = process.env.ADMIN_TOKEN;
  if (!admin || admin.length < 24) { console.error('Set ADMIN_TOKEN to a random string of at least 24 characters.'); process.exit(1); }
  const s = await startSyncServer({ databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/tillbox', adminToken: admin, port: Number(process.env.PORT ?? 4100) });
  console.log(`sync server listening on :${s.port}`);
}
