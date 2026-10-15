// The test-only container kit (Dockerfile, docker-compose.yml, replica/deploy/zimaos-test.md). No Docker is needed for most of this: the
// files are read, the settings the image sets are used to run the same commands here, and the image is only built when a Docker daemon answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { loadConfig } from '../server/app.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const docker = read('Dockerfile'), compose = read('docker-compose.yml'), guide = read('replica/deploy/zimaos-test.md'), ignore = read('.dockerignore');
const code = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const dockerUp = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 20000 }).status === 0;
const composeUp = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 20000 }).status === 0;

test('Dockerfile: the exact Node the project pins, an unprivileged user, production dependencies only, no install scripts, only what runs', () => {
  const c = code(docker);
  assert.match(c, new RegExp(`^FROM node:${read('.nvmrc').trim().replace(/\./g, '\\.')}-\\S+$`, 'm'), 'the same Node version as .nvmrc, not a moving tag');
  assert.match(c, /^USER node$/m); assert.doesNotMatch(c, /^USER (root|0)\b/m);
  assert.match(c, /npm ci --omit=dev --ignore-scripts/); assert.doesNotMatch(c, /npm (install|i)\b/);
  assert.match(c, /^ENV NODE_ENV=development/m, 'not production mode'); assert.doesNotMatch(c, /NODE_ENV=production/);
  for (const dir of ['server', 'shared', 'web', 'migrations', 'cli', 'seed']) assert.match(c, new RegExp(`COPY app/${dir} \\./app/${dir}`));
  assert.doesNotMatch(c, /COPY\s+(\.|app)\s/, 'no copy of the whole tree: tests, docs and design files stay out');
  assert.match(c, /^HEALTHCHECK /m); assert.match(c, /\/api\/v1\/health/);
  assert.match(c, /VOLUME \["\/data"\]/); assert.match(c, /chown -R node:node \/data/);
  assert.doesNotMatch(c, /BACKUP_KEY=|PASSWORD|SECRET|TOKEN/i, 'no secret in the image');
  assert.doesNotMatch(c, /\b(curl|wget)\b[^\n]*\|\s*(ba)?sh/, 'nothing downloaded and run');
  for (const x of ['.git', 'node_modules', 'data', '.local', 'app/tests', '.env', '*.csv', 'import']) assert.ok(ignore.split('\n').includes(x), `.dockerignore leaves out ${x}`);
});

test('docker-compose.yml: one service, the port on a LAN address only, a named volume for the data and backups, a healthcheck, nothing privileged, not production', () => {
  const c = code(compose);
  assert.match(c, /^\s+- "\$\{LAN_IP:\?[^}]+\}:3000:3000"$/m, 'the port is published on the LAN address');
  assert.doesNotMatch(c, /^\s+- "(0\.0\.0\.0:)?3000:3000"/m, 'never every address');
  assert.match(c, /taskapp-test-data:\/data/); assert.match(c, /^volumes:\n\s+taskapp-test-data:/m);
  assert.match(c, /healthcheck:/); assert.match(c, /\/api\/v1\/health/);
  assert.match(c, /NODE_ENV: development/); assert.doesNotMatch(c, /NODE_ENV: ["']?production/);
  assert.match(c, /PUBLIC_URL: "http:\/\/\$\{LAN_IP/, 'http, from the same address'); assert.doesNotMatch(c, /https:/);
  assert.match(c, /read_only: true/); assert.match(c, /cap_drop:\n\s+- ALL/); assert.match(c, /no-new-privileges:true/);
  assert.doesNotMatch(c, /privileged:|network_mode: host|pid: host|\/var\/run\/docker\.sock|user: ["']?(root|0)/);
  assert.equal((c.split(/^services:\n/m)[1].split(/^volumes:/m)[0].match(/^  [a-z][a-z-]*:\s*$/gm) || []).length, 1, 'exactly one service');
  assert.doesNotMatch(c, /BACKUP_KEY:|PASSWORD|SECRET|TOKEN/i, 'no secret in the compose file');
  assert.match(read('replica/deploy/zimaos-test.env.example'), /^LAN_IP=__REPLACE_/m, 'the example holds a placeholder the app refuses');
});

test('docker compose reads the file: it needs LAN_IP, and the result has the port on that address (when the compose tool is installed)', { skip: !composeUp && 'the docker compose tool is not installed' }, () => {
  const cfg = (env) => spawnSync('docker', ['compose', '-f', join(ROOT, 'docker-compose.yml'), 'config', '--format', 'json'], { env: { ...process.env, ...env, LAN_IP: env.LAN_IP ?? '' }, encoding: 'utf8', timeout: 30000 });
  const without = cfg({ LAN_IP: '' }); assert.notEqual(without.status, 0, 'no address, no start'); assert.match(without.stderr, /LAN_IP/);
  const ok = cfg({ LAN_IP: '192.0.2.10' }); assert.equal(ok.status, 0, ok.stderr);
  const svc = JSON.parse(ok.stdout).services.app;
  assert.deepEqual(svc.ports.map((p) => [p.host_ip, p.published, p.target]), [['192.0.2.10', '3000', 3000]]);
  assert.equal(svc.environment.PUBLIC_URL, 'http://192.0.2.10:3000'); assert.equal(svc.environment.NODE_ENV, 'development');
  assert.equal(svc.read_only, true); assert.ok(svc.healthcheck);
});

test('the guide says what it must: invented data only, https for production, the production pieces are not exercised, no internet without a tunnel, nothing run on a real ZimaOS', () => {
  assert.match(guide, /invented data only/i); assert.match(guide, /production mode without an \*\*https\*\* address/);
  for (const w of ['systemd', 'Caddy', 'firewall', 'Google Cloud Storage']) assert.match(guide, new RegExp(w)); assert.match(guide, /not exercised/);
  assert.match(guide, /Do not expose it to the internet/i); assert.match(guide, /tunnel/i);
  assert.match(guide, /Nothing was run on a real ZimaOS/); assert.match(guide, /not certified/i);
  for (const cmd of ['seed.js --force', 'first-owner.js', 'backup.js keygen', 'backup.js backup', 'backup.js list', 'backup.js restore']) assert.ok(guide.includes(cmd), `shows ${cmd}`);
  assert.match(guide, /Custom Install/); assert.match(guide, /<your address>:3000:3000/);
  assert.doesNotMatch(guide, /[0-9a-f]{64}/); assert.doesNotMatch(guide, /[\w.+-]+@(?!example\.test)([\w-]+\.)+[a-z]{2,}/i, 'only example.test addresses');
});

// ---- the settings the image sets, used to run the same commands here (the paths move into a scratch folder)
const imageEnv = (dir) => {
  const env = {};
  for (const m of docker.matchAll(/^ENV ([\s\S]*?)(?=\n[A-Z]+ |\n\n)/gm)) for (const kv of m[1].replace(/\\\n/g, ' ').split(/\s+/).filter(Boolean)) { const [k, ...v] = kv.split('='); env[k] = v.join('=').replace('/data', dir); }
  return env;
};
const node = (args, env, input) => spawnSync(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', input, timeout: 120000 });
const freePort = () => new Promise((res) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

test('the image settings work: seed, the app answers on its address, key, backup, list, restore and first-owner, as the guide shows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ztest-'));
  const port = await freePort();
  const env = { ...imageEnv(dir), PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`, HOME: dir };
  try {
    assert.equal(env.NODE_ENV, 'development'); assert.equal(env.HOST, '0.0.0.0'); assert.ok(env.DB_PATH.startsWith(dir));
    mkdirSyncSafe(join(dir, 'backups'));
    // seed (the database does not exist yet, but --force is what the guide says)
    let r = node(['app/seed/seed.js', '--force'], env); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(existsSync(join(dir, 'demo-credentials.txt')), 'the fake sign-ins are in the volume');
    assert.match(readFileSync(join(dir, 'demo-credentials.txt'), 'utf8'), /@example\.test/);
    // the app, listening on the container address
    const app = spawn(process.execPath, ['--no-warnings', 'app/server/index.js'], { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, stdio: 'ignore' });
    try {
      let ok = false;
      for (let i = 0; i < 50 && !ok; i++) { try { const h = await fetch(`http://127.0.0.1:${port}/api/v1/health`); ok = h.ok; } catch { await new Promise((s) => setTimeout(s, 200)); } }
      assert.ok(ok, 'the health check answers');
      // Reached by the machine's own network address too, as a phone or laptop on the LAN would (only where such an address exists)
      const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
      if (lan) assert.ok((await fetch(`http://${lan.address}:${port}/api/v1/health`)).ok, 'answers on the network address, not only on loopback');
      assert.match(readFileSync(join(ROOT, 'app/server/index.js'), 'utf8'), /listen\(\{ port: config\.port, host: config\.host \}\)/, 'the listening address comes from the HOST setting');
    } finally { app.kill(); }
    // key, backup, list, restore: the exact commands in the guide
    r = node(['app/cli/backup.js', 'keygen', '--allow-non-tty'], env); assert.equal(r.status, 0, r.stderr);
    const key = r.stdout.split('\n').filter((l) => /^[0-9a-f]{64}$/.test(l)); assert.equal(key.length, 1);
    writeFileSync(join(dir, 'backup-key'), key[0] + '\n', { mode: 0o600 });
    r = node(['app/cli/backup.js', 'backup', '--kind', 'manual'], env); assert.equal(r.status, 0, r.stderr + r.stdout);
    r = node(['app/cli/backup.js', 'list'], env); assert.equal(r.status, 0, r.stderr); const name = r.stdout.split(/\s+/).find((w) => /^backup-manual-.*\.enc$/.test(w)); assert.ok(name, r.stdout);
    r = node(['app/cli/backup.js', 'restore', '--from', name, '--to', join(dir, 'check.db'), '--confirm', name], env); assert.equal(r.status, 0, r.stderr + r.stdout); assert.ok(existsSync(join(dir, 'check.db')));
    assert.ok(!(r.stdout + r.stderr).includes(key[0]), 'the key is never printed again');
    // first owner, on an empty database
    const empty = { ...env, DB_PATH: join(dir, 'empty.db') };
    r = node(['app/cli/first-owner.js', '--allow-non-tty', '--workspace', 'Test Co', '--name', 'Test Owner', '--email', 'owner@example.test'], empty); assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.ok(readdirSync(join(dir, 'backups')).some((n) => n === name), 'the backup is in its own folder on the volume');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
function mkdirSyncSafe(p) { spawnSync('mkdir', ['-p', p]); }

test('HOST: this machine by default; wider only outside production; production refuses a wider address', () => {
  assert.equal(loadConfig({}).host, '127.0.0.1');
  assert.equal(loadConfig({ HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test', HOST: '0.0.0.0' }), /HOST must stay on this machine/);
  assert.equal(loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test', HOST: '127.0.0.1' }).host, '127.0.0.1');
  assert.throws(() => loadConfig({ PUBLIC_URL: 'http://__REPLACE_WITH_THIS_SERVERS_LAN_ADDRESS__:3000' }), /placeholder/, 'the example address cannot be used as it is');
});

test('docker build: the image builds, runs as a non-root user on the pinned Node with no dev dependencies (skipped without a Docker daemon)', { skip: !dockerUp && 'no Docker daemon is available', timeout: 600000 }, () => {
  const tag = `taskapp-test-build:${process.pid}`;
  const sh = (args) => spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8', timeout: 540000 });
  try {
    const b = sh(['build', '-t', tag, '.']); assert.equal(b.status, 0, b.stderr.slice(-2000));
    const run = (...cmd) => sh(['run', '--rm', '--entrypoint', cmd[0], tag, ...cmd.slice(1)]);
    assert.equal(run('id', '-u').stdout.trim(), '1000', 'not root');
    assert.equal(run('node', '--version').stdout.trim(), `v${read('.nvmrc').trim()}`);
    assert.notEqual(run('test', '-d', '/srv/taskapp/node_modules/@playwright').status, 0, 'no dev dependencies');
    assert.notEqual(run('test', '-d', '/srv/taskapp/app/tests').status, 0, 'no tests in the image');
    assert.equal(run('test', '-w', '/data').status, 0, 'the data folder is writable by that user');
  } finally { sh(['rmi', '-f', tag]); }
});
