import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_NAME, TITLE_SEPARATOR } from '../shared/brand.js';
import { SCREEN_TITLES, pageTitle } from '../shared/titles.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'data' || name === '.local') continue;
    const p = join(dir, name);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

test('every screen in the recon map has a page title', () => {
  const recon = readFileSync(join(root, 'replica', 'recon.md'), 'utf8');
  const ids = [...recon.matchAll(/^\| (S\d\d) \|/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 34, `found ${ids.length} screens in recon.md`);
  for (const id of ids) assert.ok(SCREEN_TITLES[id], `missing title for ${id}`);
  assert.deepEqual(Object.keys(SCREEN_TITLES).sort(), [...ids].sort(), 'titles and recon map must match');
});

test('every page title ends with the product name from the one constant', () => {
  for (const id of Object.keys(SCREEN_TITLES)) {
    assert.ok(pageTitle(id).endsWith(TITLE_SEPARATOR + PRODUCT_NAME), id);
    assert.ok(pageTitle(id, 'Detail').startsWith('Detail' + TITLE_SEPARATOR), id);
  }
  assert.throws(() => pageTitle('S99'));
});

test('screen titles are unique', () => {
  const titles = Object.values(SCREEN_TITLES);
  assert.equal(new Set(titles).size, titles.length);
});

test('the product name is written out in exactly one source file', () => {
  const needle = PRODUCT_NAME.toLowerCase();
  const offenders = [];
  for (const dir of ['app', 'tools']) {
    for (const file of walk(join(root, dir))) {
      if (file.endsWith(join('shared', 'brand.js'))) continue;
      if (readFileSync(file, 'utf8').toLowerCase().includes(needle)) offenders.push(relative(root, file));
    }
  }
  assert.deepEqual(offenders, [], 'hard-coded product name found; import PRODUCT_NAME instead');
});

test('the HTML shell uses the placeholder, not a literal name', () => {
  const html = readFileSync(join(root, 'app', 'web', 'index.html'), 'utf8');
  assert.match(html, /<title>\{\{PRODUCT_NAME\}\}<\/title>/);
});
