import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.data': 'application/octet-stream', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const ROOT = process.env.STATIC_DIR ?? 'out'; // set STATIC_DIR (and SPA=1) to run the same tests against another build
const SPA = process.env.SPA === '1';
createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(ROOT, path);
  try {
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    if (SPA && !(await stat(file).catch(() => null)) && !extname(file)) file = join(ROOT, 'index.html');
    const b = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(b);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(3100, '127.0.0.1');
