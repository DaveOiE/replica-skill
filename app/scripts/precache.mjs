// Lists every file in the static export so the service worker can cache the whole app on first visit.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const out = 'out';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push('/' + relative(out, p)); } })(out);
const list = new Set(['/']);
for (const f of files) {
  if (f === '/sw.js' || f === '/precache.json' || f.endsWith('.txt') && f.includes('__next')) continue;
  list.add(f);
  if (f.endsWith('/index.html')) list.add(f.slice(0, -'index.html'.length)); // /sync/index.html is also reached as /sync/
}
writeFileSync(join(out, 'precache.json'), JSON.stringify([...list]));
console.log(`precache: ${list.size} entries`);
