import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Pool } from 'pg';
import { fromPool } from '../src/db/pg';
import { createHandlers, initServerDb } from './handler';

export async function startSyncServer(opts: { databaseUrl: string; token: string; port: number }) {
  const pool = new Pool({ connectionString: opts.databaseUrl });
  const db = fromPool(pool);
  await initServerDb(db);
  const h = createHandlers(db, opts.token);

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<any>((resolve, reject) => {
    let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (!h.authed(req.headers.authorization)) return send(res, 401, { error: 'unauthorized' });
      let r;
      if (req.method === 'POST' && url.pathname === '/sync/register') r = await h.register(await readBody(req));
      else if (req.method === 'POST' && url.pathname === '/sync/push') r = await h.push(await readBody(req));
      else if (req.method === 'GET' && url.pathname === '/sync/pull')
        r = await h.pull(Number(url.searchParams.get('since') ?? 0), url.searchParams.get('device') ?? '', Math.min(Number(url.searchParams.get('limit') ?? 200), 500));
      else return send(res, 404, { error: 'not_found' });
      send(res, r.status, r.body);
    } catch (e) {
      send(res, 500, { error: e instanceof Error ? e.message : 'error' });
    }
  });
  await new Promise<void>((ok) => server.listen(opts.port, ok));
  return { port: (server.address() as any).port as number, db, close: async () => { await new Promise((ok) => server.close(ok)); await pool.end(); } };
}

// Run directly: `npm run sync-server`
if (process.argv[1]?.endsWith('server/index.ts')) {
  const s = await startSyncServer({
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/tillbox',
    token: process.env.SYNC_TOKEN ?? 'dev-token',
    port: Number(process.env.PORT ?? 4100),
  });
  console.log(`sync server listening on :${s.port}`);
}
