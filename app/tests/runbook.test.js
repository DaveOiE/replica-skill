import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the runbook matches the code: pinned Node, every setting and every command it tells you to run', () => {
  const nvmrc = read('.nvmrc').trim();
  assert.match(nvmrc, /^\d+\.\d+\.\d+$/, 'an exact version');
  const [maj, min] = nvmrc.split('.').map(Number), engines = JSON.parse(read('package.json')).engines.node.match(/(\d+)\.(\d+)/).slice(1).map(Number);
  assert.ok(maj > engines[0] || (maj === engines[0] && min >= engines[1]), 'the pinned version satisfies engines');
  const book = read('replica/runbook.md');
  assert.ok(book.includes(`**${nvmrc}, exactly**`), 'the runbook names the pinned version');
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const s of ['first-owner', 'backup', 'backup:list', 'backup:keygen', 'restore', 'start']) assert.ok(scripts[s], `package.json has ${s}`);
  for (const cmd of ['npm run first-owner', 'npm run backup:keygen', 'npm run backup -- --kind', 'npm run backup:list', 'npm run restore -- --from']) assert.ok(book.includes(cmd), `the runbook shows: ${cmd}`);
  const code = ['app/server/app.js', 'app/server/index.js', 'app/server/backup.js', 'app/cli/backup.js'].map(read).join('\n');
  for (const v of ['PORT', 'DB_PATH', 'PUBLIC_URL', 'TRUST_PROXY', 'COOKIE_SECURE', 'SESSION_HOURS', 'SESSION_IDLE_MINUTES', 'BACKUP_KEY', 'BACKUP_DEST']) {
    assert.ok(book.includes(`\`${v}\``), `the runbook explains ${v}`);
    assert.ok(code.includes(v), `the code reads ${v}`);
  }
  assert.match(book, /not (yet )?(been )?(used|hosted)|not yet used/i, 'says plainly it has not been used');
  assert.match(book, /not certified/i);
});
