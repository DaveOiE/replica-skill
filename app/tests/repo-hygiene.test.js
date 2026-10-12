import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const text = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } };

test('no secrets in tracked files: key-shaped strings, private keys, token prefixes, stored hashes', () => {
  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/AKIA[0-9A-Z]{16}/, 'AWS key id'], [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
    [/sk_live_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{30,}/, 'API secret key'], [/xox[bpa]-[A-Za-z0-9-]{10,}/, 'Slack token'], [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, 'JWT'],
    [/scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]{10,}/, 'stored password hash'], [/\b\d{13,19}\b.*\b(cvv|card)\b/i, 'card number'],
  ];
  const hits = [];
  for (const f of tracked.filter((x) => !/package-lock\.json$|\.png$|\.svg$/.test(x))) {
    const t = text(f);
    for (const [re, label] of patterns) if (re.test(t)) hits.push(`${f}: ${label}`);
  }
  assert.deepEqual(hits, []);
});

test('files that must never be tracked are not: env files, keys, databases, local data and credentials', () => {
  const bad = tracked.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example') || /\.(pem|key|p12|db|sqlite|sqlite3)$/.test(f) || /^(\.local|data)\//.test(f));
  assert.deepEqual(bad, []);
  assert.ok(tracked.includes('.env.example'));
  assert.doesNotMatch(text('.env.example'), /=\s*\S*(secret|password|key|token)\S*/i, '.env.example lists names and harmless defaults only');
});

test('seed people are invented and use the reserved example.test domain; no real-looking addresses anywhere in code', () => {
  const emails = new Set();
  for (const f of tracked.filter((x) => x.startsWith('app/') && /\.(js|mjs|sql|html)$/.test(x)))
    for (const m of text(f).matchAll(/[\w.+-]+@([\w-]+\.)+[a-z]{2,}/gi)) emails.add(m[0].toLowerCase());
  const real = [...emails].filter((e) => !/@example\.test$/.test(e));
  assert.deepEqual(real, []);
});

test('compliance wording: certification and residency words appear only next to "not certified" in the app and the README section', () => {
  const words = /\b(certified|compliant|compliance|hipaa|soc ?2|iso ?27001|gdpr|data residency)\b/i;
  const readme = text('README.md');
  const section = readme.includes('<!-- app:start -->') ? readme.split('<!-- app:start -->')[1].split('<!-- app:end -->')[0] : '';
  const files = [...tracked.filter((f) => f.startsWith('app/') && !f.startsWith('app/tests/') && !f.startsWith('app/e2e/') && /\.(js|html|css)$/.test(f)).map((f) => [f, text(f)]), ['README.md (app section)', section]];
  const bad = [];
  for (const [f, t] of files) {
    const lines = t.split('\n');
    lines.forEach((l, i) => { if (words.test(l) && !/not certified|no claim|never claim|does not claim|not a claim|not built/i.test(lines.slice(Math.max(0, i - 2), i + 3).join(' '))) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(bad, []);
});

test('client data stays out of git: CSV files and the import folder are ignored, and only the three planning matrices are tracked', () => {
  const ignore = text('.gitignore');
  assert.match(ignore, /^import\/$/m);
  assert.match(ignore, /^\*\.csv$/m);
  for (const f of ['import/anything.txt', 'jobs-export.csv', 'app/tests/fixtures/real-clients.csv'])
    assert.doesNotThrow(() => execFileSync('git', ['check-ignore', '-q', f], { cwd: root }), `${f} must be ignored`);
  assert.deepEqual(tracked.filter((f) => f.endsWith('.csv')).sort(), ['replica-recon/features.csv', 'replica/features.csv', 'replica/milestones.csv']);
  assert.deepEqual(tracked.filter((f) => f.startsWith('import/')), []);
});
