import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshApp } from './helpers.js';
import { PRODUCT_NAME } from '../shared/brand.js';

const web = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const files = (ext) => readdirSync(web, { recursive: true }).filter((f) => f.endsWith(ext)).map((f) => [f, readFileSync(join(web, f), 'utf8')]);

test('components use tokens only: no raw colours outside the generated tokens file', () => {
  for (const [f, text] of [...files('.css'), ...files('.js')].filter(([f]) => !f.endsWith('tokens.css')))
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${f} has a raw colour`);
});

test('no innerHTML or inline script anywhere: user text can only ever be text', () => {
  for (const [f, text] of files('.js')) assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, f);
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  assert.doesNotMatch(html, /\sstyle=|\sonclick=/);
});

test('the page the server sends has the product name from the one constant, and every asset it names exists', async () => {
  const { app } = await freshApp();
  const page = await app.inject('/');
  assert.match(page.body, new RegExp(`<title>${PRODUCT_NAME}</title>`));
  assert.ok(!page.body.includes('{{'));
  for (const url of ['/styles/tokens.css', '/styles/app.css', '/app.js', '/dom.js', '/api.js', '/strings.js', '/views.js', '/views-public.js', '/views-jobs.js', '/shared/brand.js', '/shared/titles.js', '/favicon.svg'])
    assert.equal((await app.inject(url)).statusCode, 200, url);
  assert.equal((await app.inject('/../server/auth.js')).statusCode >= 400, true, 'server code is not served');
  assert.equal((await app.inject('/server/auth.js')).statusCode, 404);
});

test('tokens.css served to the browser is in step with tokens.json', async () => {
  const { app } = await freshApp();
  const css = (await app.inject('/styles/tokens.css')).body;
  const tokens = JSON.parse(readFileSync(join(web, '..', '..', 'replica', 'design', 'tokens.json'), 'utf8'));
  for (const [k, v] of Object.entries(tokens.color)) assert.ok(css.includes(`--color-${k}: ${v};`), k);
});

test('every web module parses (a typo here would blank the whole app)', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const [f] of files('.js')) execFileSync(process.execPath, ['--check', join(web, f)], { stdio: 'pipe' });
});
