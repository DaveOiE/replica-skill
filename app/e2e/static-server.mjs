import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.svg': 'image/svg+xml', '.txt': 'text/plain' };
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = join('out', path === '/' ? 'index.html' : path);
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(3100, '127.0.0.1');
