import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const out = 'out';
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push('/' + relative(out, p)); } })(out);
const list = ['/', ...files.filter((f) => !['/sw.js', '/precache.json'].includes(f))];
writeFileSync(join(out, 'precache.json'), JSON.stringify(list));
console.log(`precache: ${list.length} files`);
