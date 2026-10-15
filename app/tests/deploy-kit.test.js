import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, symlinkSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../server/db.js';
import { seedDemo } from '../seed/seed.js';
import { setPasswordCost } from '../server/password.js';
import { keyFrom, tableCounts, checkDatabase, NAME_RE, stampOf, encryptFile } from '../server/backup.js';
import { loadConfig } from '../server/app.js';

setPasswordCost({ N: 1024, r: 8, p: 1 });
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KIT = join(ROOT, 'replica', 'deploy');
const BIN = join(KIT, 'bin');
const read = (p) => readFileSync(join(KIT, p), 'utf8');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(KIT);
const scripts = files.filter((f) => f.endsWith('.sh'));
const strip = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// ================================================================ what is there
test('the kit has every piece, and the README gives the steps in order', () => {
  for (const f of ['README.md', 'systemd/taskapp.service', 'systemd/taskapp-snapshot@.service', 'systemd/taskapp-backup@.service', 'systemd/taskapp-backup.timer', 'systemd/taskapp-backup-check.service', 'systemd/taskapp-backup-check.timer',
    'systemd/taskapp-restore-drill.service', 'systemd/taskapp-storage-check@.service', 'systemd/taskapp-alert@.service', 'etc/app.env.example', 'etc/backup.env.example', 'caddy/Caddyfile', 'caddy/caddy.env.example', 'caddy/caddy-override.conf',
    'firewall/taskapp.nft.template', 'ssh/10-taskapp.conf', 'gcs/lifecycle.json', 'logging/journald-taskapp.conf',
    'bin/backup.sh', 'bin/snapshot.sh', 'bin/backup-check.sh', 'bin/restore-drill.sh', 'bin/verify-storage.sh', 'bin/install-credential.sh', 'bin/install-firewall.sh', 'bin/app-cli.sh', 'bin/check-node.sh', 'bin/alert.sh', 'bin/lib.sh'])
    assert.ok(existsSync(join(KIT, f)), `missing ${f}`);
  const timers = readdirSync(join(KIT, 'systemd')).filter((f) => f.endsWith('.timer')).sort();
  assert.deepEqual(timers, ['taskapp-backup-check.timer', 'taskapp-backup.timer'], 'one backup timer (and the freshness check), not three');
  const readme = read('README.md');
  const order = ['**0. Decide first', '**1. Get a machine', '**2. Users, groups and folders', '**3. The pinned Node', '**4. The code', '**5. Settings and credentials', '**6. SSH hardening and the firewall', '**7. Units', '**8. The first owner', '**9. Start the app', '**10. Caddy', '**11. Storage and backups', '**12. Restore drill', '**13. Go-live checks'];
  const at = order.map((h) => readme.indexOf(h));
  assert.ok(at.every((n) => n >= 0), 'every step is in the README');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the stated order');
  assert.match(readme, /Nothing in this folder has been run on a real machine/); assert.match(readme, /not\s+certified/i);
  assert.match(readme, /--ignore-scripts/); assert.match(readme, /app-cli\.sh first-owner/); assert.match(readme, /Prove each identity does only its job/);
  assert.match(readme, /sshd -t/); assert.match(readme, /install -d -o caddy -g caddy -m 0750 \/var\/log\/caddy/); assert.match(readme, /sudo -u caddy bash -c/);
  assert.doesNotMatch(readme, /npm run first-owner/, 'the first owner is made through the clean-environment runner, not npm from a shared home');
  assert.doesNotMatch(readme, /gsutil/i, 'gcloud storage with an explicit credential, not gsutil');
});

// ================================================================ no secrets, no real addresses
test('no file holds a secret, a key-shaped string or a real-looking address; credentials are never in a settings file', () => {
  const docRanges = /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;
  for (const f of files) {
    const text = readFileSync(f, 'utf8'), name = relative(KIT, f);
    assert.doesNotMatch(text, /[0-9a-fA-F]{64}/, `${name}: a 64-character hex string (looks like a key)`);
    assert.doesNotMatch(text, /dsk_[A-Za-z0-9_-]{20,}/, `${name}: a service token`);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY/, `${name}: a private key`);
    assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|xox[bap]-[0-9A-Za-z-]{10,}|ghp_[0-9A-Za-z]{30,}/, `${name}: a cloud or chat credential`);
    assert.doesNotMatch(text, /https?:\/\/[^\s"']*(hooks\.|webhook)[^\s"']*\/[A-Za-z0-9_-]{16,}/, `${name}: a webhook address with a secret path`);
    assert.doesNotMatch(text, /"private_key"\s*:|"client_email"\s*:\s*"[^"<]+@[^"]+\.iam/, `${name}: a service account key`);
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{60,}={0,2}/, `${name}: a long base64-looking string`);
    for (const ip of text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) || []) assert.match(ip, docRanges, `${name}: ${ip} is not a documentation or local address`);
  }
  for (const f of ['etc/app.env.example', 'etc/backup.env.example', 'caddy/caddy.env.example']) {
    for (const line of read(f).split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m) assert.doesNotMatch(m[1], /KEY|SECRET|TOKEN|PASSWORD|WEBHOOK|PING|CREDENTIAL/, `${f}: ${m[1]} looks like a secret, and secrets belong in /etc/taskapp/credentials, not in a settings file`);
    }
  }
});

// ================================================================ settings files
test('settings examples: valid for systemd and for the shell, every setting asked for, no secret, the Node pin right, and the app refuses them while placeholders are left', () => {
  const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
  for (const f of ['etc/app.env.example', 'etc/backup.env.example', 'caddy/caddy.env.example']) {
    for (const line of read(f).split('\n')) assert.match(line, /^(#.*|[A-Z][A-Z0-9_]*=[^\s"'`$\;&|<>()]*|)$/, `${f}: "${line}" would be read differently by systemd and the shell`);
    assert.equal(spawnSync('bash', ['-c', `set -a; . "${join(KIT, f)}"; env`], { encoding: 'utf8', env: { PATH: process.env.PATH } }).status, 0, `${f} does not source in the shell`);
  }
  const parse = (f) => Object.fromEntries(read(f).split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
  const app = parse('etc/app.env.example'), bk = parse('etc/backup.env.example');
  for (const k of ['PORT', 'DB_PATH', 'PUBLIC_URL', 'TRUST_PROXY', 'SESSION_HOURS', 'SESSION_IDLE_MINUTES', 'NODE_VERSION_PIN']) assert.ok(k in app, `app.env.example sets ${k}`);
  for (const k of ['GCS_PREFIX', 'DAILY_HOUR', 'MAX_AGE_HOURLY', 'MAX_AGE_DAILY', 'MAX_AGE_MONTHLY', 'NODE_VERSION_PIN', 'SNAPSHOT_DIR', 'OUTBOX', 'STATE_DIR', 'LIVE_DB_PATH', 'LIVE_PORT', 'DRILL_BASE', 'DRILL_PORT']) assert.ok(k in bk, `backup.env.example sets ${k}`);
  assert.equal(app.NODE_VERSION_PIN, nvmrc); assert.equal(bk.NODE_VERSION_PIN, nvmrc); assert.equal(nvmrc, '22.22.0');
  assert.equal(app.TRUST_PROXY, 'true'); assert.ok(!('COOKIE_SECURE' in app)); assert.match(app.PUBLIC_URL, /^https:\/\//);
  assert.equal(bk.LIVE_DB_PATH, app.DB_PATH, 'the drill guards the same database the app uses'); assert.equal(bk.LIVE_PORT, app.PORT);
  assert.deepEqual([bk.MAX_AGE_HOURLY, bk.MAX_AGE_DAILY, bk.MAX_AGE_MONTHLY], ['10800', '93600', '2764800']);
  assert.match(bk.GCS_PREFIX, /^gs:\/\/__REPLACE_WITH_BUCKET_NAME__\/backups$/);
  // the app refuses the file as shipped (placeholders), and accepts it once they are replaced
  assert.throws(() => loadConfig({ ...app, NODE_ENV: 'production' }), /still holds a placeholder/);
  const cfg = loadConfig({ ...app, NODE_ENV: 'production', PUBLIC_URL: 'https://tasks.example.test' });
  assert.deepEqual([cfg.trustProxy, cfg.cookieSecure, cfg.idleMinutes, cfg.dbPath], [true, true, 120, '/var/lib/taskapp/app.db']);
});

// ================================================================ systemd units
const parseUnit = (text) => {
  const out = {}; let section = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('#')) continue;
    const s = /^\[(\w+)\]$/.exec(l); if (s) { section = s[1]; out[section] ??= {}; continue; }
    const kv = /^([A-Za-z]+)=(.*)$/.exec(l); assert.ok(kv && section, `bad unit line: ${l}`);
    (out[section][kv[1]] ??= []).push(kv[2]);
  }
  return out;
};
const unitNames = readdirSync(join(KIT, 'systemd'));
const units = Object.fromEntries(unitNames.map((n) => [n, parseUnit(read(`systemd/${n}`))]));
const svc = Object.fromEntries(Object.entries(units).filter(([n]) => n.endsWith('.service')));
const one = (name, k) => { const v = svc[name].Service[k]; assert.equal(v?.length, 1, `${name}: ${k} set once`); return v[0]; };

test('the app unit runs ONLY the app: unprivileged, read-only system, one writable folder, no credential, no outside network, credentials and backup folders invisible', () => {
  const n = 'taskapp.service', s = svc[n].Service;
  assert.deepEqual([one(n, 'User'), one(n, 'Group'), one(n, 'Restart')], ['taskapp', 'taskapp', 'on-failure']);
  for (const [k, v] of [['NoNewPrivileges', 'true'], ['ProtectSystem', 'strict'], ['ProtectHome', 'true'], ['PrivateTmp', 'true'], ['PrivateDevices', 'true'], ['PrivateUsers', 'true'], ['UMask', '0077'], ['LimitCORE', '0'], ['StateDirectoryMode', '0700'], ['CapabilityBoundingSet', '']]) assert.equal(one(n, k), v, k);
  assert.equal(one(n, 'ReadWritePaths'), '/var/lib/taskapp', 'one writable folder');
  assert.equal(one(n, 'EnvironmentFile'), '/etc/taskapp/app.env', 'only the app settings, nothing with a secret in it');
  assert.equal(one(n, 'Environment'), 'NODE_ENV=production');
  assert.equal(s.LoadCredential, undefined, 'the app is given no credential at all');
  assert.deepEqual(one(n, 'InaccessiblePaths').split(' ').sort(), ['/etc/taskapp', '/var/lib/taskapp-backup', '/var/lib/taskapp-snapshot'], 'the credentials folder and the backup user\'s folders are not even visible');
  assert.deepEqual([one(n, 'IPAddressDeny'), one(n, 'IPAddressAllow')], ['any', 'localhost'], 'no network but this machine');
  assert.match(one(n, 'ExecStart'), /^\/opt\/node\/bin\/node --no-warnings app\/server\/index\.js$/); assert.match(one(n, 'ExecStartPre'), /\/bin\/check-node\.sh$/);
  assert.ok(s.SystemCallFilter.includes('@system-service') && s.SystemCallFilter.some((x) => x.startsWith('~')));
  assert.doesNotMatch(one(n, 'RestrictAddressFamilies'), /AF_NETLINK|AF_PACKET/);
  assert.ok(!s.MemoryDenyWriteExecute || s.MemoryDenyWriteExecute[0] !== 'true', 'Node needs writable and executable memory for its JIT');
  assert.ok(svc[n].Unit.OnFailure[0].startsWith('taskapp-alert@')); assert.ok(units[n].Install.WantedBy.includes('multi-user.target'));
  assert.ok(Number(one(n, 'MemoryMax').replace(/G$/, '')) <= 2);
});

test('two users: the backup, check, drill, storage-check and alert units run as taskapp-backup, hold only their own credentials, and cannot see the live database or the settings folder', () => {
  const bkUnits = ['taskapp-backup@.service', 'taskapp-backup-check.service', 'taskapp-restore-drill.service', 'taskapp-storage-check@.service', 'taskapp-alert@.service'];
  for (const n of bkUnits) {
    assert.deepEqual([one(n, 'User'), one(n, 'Group')], ['taskapp-backup', 'taskapp-backup'], n);
    assert.deepEqual(one(n, 'InaccessiblePaths').split(' ').sort(), ['/etc/taskapp', '/var/lib/taskapp'], `${n}: the live database and the settings folder are invisible`);
    for (const [k, v] of [['ProtectSystem', 'strict'], ['NoNewPrivileges', 'true'], ['PrivateUsers', 'true'], ['PrivateTmp', 'true'], ['CapabilityBoundingSet', ''], ['LimitCORE', '0'], ['UMask', '0077']]) assert.equal(one(n, k), v, `${n}: ${k}`);
    assert.ok(svc[n].Service.SystemCallFilter, `${n}: a system-call filter`);
    assert.ok(!(svc[n].Service.ReadWritePaths || []).join(' ').includes('/var/lib/taskapp '), `${n}: cannot write the live database`);
  }
  // who holds which credential
  const creds = (n) => (svc[n].Service.LoadCredential || []).map((c) => c.split(':')).map(([name, src]) => [name, src]);
  const holders = {}; for (const n of Object.keys(svc)) for (const [, src] of creds(n)) (holders[src] ??= []).push(n);
  assert.deepEqual(holders['/etc/taskapp/credentials/uploader-key.json'], ['taskapp-backup@.service'], 'the upload credential reaches only the backup unit');
  assert.deepEqual(holders['/etc/taskapp/credentials/checker-key.json'], ['taskapp-backup-check.service']);
  assert.deepEqual(holders['/etc/taskapp/credentials/drill-key.json'], ['taskapp-restore-drill.service']);
  assert.deepEqual((holders['/etc/taskapp/credentials/backup-key'] || []).sort(), ['taskapp-backup@.service', 'taskapp-restore-drill.service'], 'the backup key: sealing and the drill, nobody else');
  assert.ok(!(holders['/etc/taskapp/credentials/backup-key'] || []).some((n) => /^taskapp\.service|snapshot/.test(n)));
  assert.deepEqual(creds('taskapp-storage-check@.service'), [['gcs-key', '/etc/taskapp/credentials/%i-key.json']]);
  assert.deepEqual(creds('taskapp-alert@.service'), [['alert-webhook', '/etc/taskapp/credentials/alert-webhook']]);
  for (const n of Object.keys(svc)) for (const [, src] of creds(n)) assert.match(src, /^\/etc\/taskapp\/credentials\/[%\w.-]+$/, `${n}: credentials come only from /etc/taskapp/credentials`);
  for (const n of ['taskapp.service', 'taskapp-snapshot@.service']) assert.equal(svc[n].Service.LoadCredential, undefined, `${n} holds no credential`);
  // no credential and no key in any settings file a unit loads
  for (const n of Object.keys(svc)) for (const f of svc[n].Service.EnvironmentFile || []) assert.match(f, /^\/etc\/taskapp\/(app|backup)\.env$/, `${n}: ${f}`);
  assert.ok(!(svc['taskapp-backup@.service'].Service.EnvironmentFile || []).includes('/etc/taskapp/app.env'));
  // step 1 runs as the APP user with no credential and no network; the folder it writes is shared with the backup group only
  const sn = 'taskapp-snapshot@.service';
  assert.deepEqual([one(sn, 'User'), one(sn, 'Group'), one(sn, 'StateDirectory'), one(sn, 'StateDirectoryMode'), one(sn, 'UMask'), one(sn, 'IPAddressDeny'), one(sn, 'RestrictAddressFamilies')], ['taskapp', 'taskapp-backup', 'taskapp-snapshot', '0770', '0027', 'any', 'AF_UNIX']);
  assert.deepEqual(one(sn, 'ReadWritePaths').split(' ').sort(), ['/var/lib/taskapp', '/var/lib/taskapp-snapshot']);
  assert.equal(one(sn, 'InaccessiblePaths').includes('/etc/taskapp'), true);
  assert.equal(one('taskapp-backup@.service', 'ReadWritePaths'), '/var/lib/taskapp-snapshot');
  // the only step that runs as root is the one that asks systemd to run step 1 and wait; nothing else uses the + prefix
  const plus = []; for (const [n, def] of Object.entries(svc)) for (const k of ['ExecStartPre', 'ExecStart', 'ExecStartPost']) for (const c of def.Service[k] || []) if (c.startsWith('+')) plus.push([n, c]);
  assert.deepEqual(plus, [['taskapp-backup@.service', '+/usr/bin/systemctl start --wait taskapp-snapshot@%i.service']]);
  assert.match(read('systemd/taskapp-backup@.service'), /Environment=CLOUDSDK_CONFIG=\/var\/lib\/taskapp-backup\/gcloud/);
  assert.ok(!read('systemd/taskapp-backup@.service').match(/^Environment=.*(KEY|WEBHOOK|SECRET)/m), 'no secret in an Environment= line');
});

test('one hourly timer drives every backup; the check runs twice an hour; every calendar parses and the hourly one fires hourly', () => {
  const t = units['taskapp-backup.timer'];
  assert.equal(t.Timer.Unit[0], ['taskapp-backup', 'scheduled.service'].join('@')); assert.equal(t.Timer.Persistent[0], 'true'); assert.ok(t.Install.WantedBy.includes('timers.target'));
  assert.equal(units['taskapp-backup-check.timer'].Timer.Unit[0], 'taskapp-backup-check.service');
  assert.equal(one('taskapp-backup@.service', 'Type'), 'oneshot');
  assert.match(one('taskapp-backup@.service', 'ExecStart'), /backup\.sh %i$/);
  const have = spawnSync('systemd-analyze', ['--version']).status === 0;
  if (have) {
    for (const [n, def] of Object.entries(units).filter(([k]) => k.endsWith('.timer'))) { const r = spawnSync('systemd-analyze', ['calendar', def.Timer.OnCalendar[0]], { encoding: 'utf8' }); assert.equal(r.status, 0, `${n}: ${def.Timer.OnCalendar[0]}: ${r.stderr}`); }
    const next = spawnSync('systemd-analyze', ['calendar', '--iterations=3', t.Timer.OnCalendar[0]], { encoding: 'utf8' }).stdout;
    const times = [...next.matchAll(/(?:Next elapse|Iteration #\d+): \w+ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/g)].map((m) => Date.parse(`${m[1]}T${m[2]}Z`));
    assert.equal(times.length, 3); assert.equal(times[1] - times[0], 3600000);
  }
  const mode = /case "\$mode" in ([a-z|]+)\)/.exec(readFileSync(join(BIN, 'backup.sh'), 'utf8'))[1].split('|').sort();
  assert.deepEqual(mode, ['premigration', 'scheduled'], 'the instances the units start are the ones the script accepts');
});

test('systemd-analyze finds nothing wrong with the units except that the programs are not installed on this machine', { skip: spawnSync('systemd-analyze', ['--version']).status !== 0 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'units-'));
  try {
    const inst = (n) => n.replace('@.service', n.startsWith('taskapp-alert') ? '@test.service' : n.startsWith('taskapp-storage') ? '@uploader.service' : '@scheduled.service');
    for (const n of unitNames) writeFileSync(join(dir, inst(n)), read(`systemd/${n}`));
    const r = spawnSync('systemd-analyze', ['verify', ...unitNames.map((n) => join(dir, inst(n)))], { encoding: 'utf8' });
    const all = `${r.stdout}${r.stderr}`;
    const problems = all.split('\n').filter((l) => l.trim() && !/is not executable: No such file or directory$/.test(l));
    assert.deepEqual(problems, []);
    for (const m of all.matchAll(/Command (\S+) is not executable/g)) {
      const p = m[1];
      assert.ok(['/opt/node/bin/node', '/usr/bin/systemctl'].includes(p) || existsSync(join(KIT, 'bin', p.split('/').pop())), `${p} is not something this kit ships`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ================================================================ scripts: static
test('scripts: parse, stop on errors, are executable, never run a string as a command, never print or pass a secret on a command line, and only ever use the storage commands they should', () => {
  for (const f of scripts) {
    const name = relative(KIT, f), text = readFileSync(f, 'utf8'), code = strip(text);
    assert.equal(spawnSync('bash', ['-n', f]).status, 0, `${name} does not parse`);
    assert.match(text, /^#!\/usr\/bin\/env bash\n/, name);
    if (!name.endsWith('lib.sh')) { assert.match(text, /^set -euo pipefail$/m, `${name}: set -euo pipefail`); assert.ok(statSync(f).mode & 0o111, `${name} is not executable`); }
    assert.doesNotMatch(code, /\beval\b/, `${name}: eval`);
    assert.doesNotMatch(code, /\bbash -c "\$|\bsh -c "\$|\|\s*(ba)?sh\b/, `${name}: runs text as a command`);
    assert.doesNotMatch(code, /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\|\s*(python3?|node|perl|ruby|xargs|source|eval)\b/, `${name}: runs something it downloaded or piped`);
    assert.doesNotMatch(code, /\bset -x\b|\bset -[a-z]*x/, `${name}: tracing would print secrets`);
    for (const m of code.matchAll(/\bchmod\s+(?:-R\s+)?(\S+)/g)) assert.match(m[1], /^[0-7]00$/, `${name}: chmod ${m[1]} gives access to someone other than the owner`);
    for (const m of code.matchAll(/rm -rf?\s+(?:-- )?("[^"]*"|\S+)/g)) assert.match(m[1], /"\$work"|"\$f"|"\$out"|"\$tmp"|"\$body"|"\$snap/, `${name}: rm of ${m[1]} is not clearly a path this script made`);
    // secrets are files, not variables: nothing reads a secret into the environment, and no secret goes in a curl command line
    assert.doesNotMatch(code, /export\s+(BACKUP_KEY|ALERT_WEBHOOK_URL|HEALTHCHECK_PING_URL|GOOGLE_APPLICATION_CREDENTIALS)=/, `${name}: exports a secret`);
    assert.doesNotMatch(code, /\bcurl\b[^\n]*"\$\{?(url|webhook|ping)/i, `${name}: a secret address on a curl command line`);
    assert.doesNotMatch(code, /\bBACKUP_KEY=|\bALERT_WEBHOOK_URL\b|\bHEALTHCHECK_PING_URL\b/, `${name}: a secret in an environment variable`);
    assert.doesNotMatch(code, /gsutil|rclone/, `${name}: this kit uses gcloud storage with an explicit credential`);
  }
  const bk = strip(readFileSync(join(BIN, 'backup.sh'), 'utf8'));
  assert.match(bk, /gcs_put/); assert.doesNotMatch(bk, /gcs_(rm|cat|get|ls)\b/, 'the upload script can add a file and nothing else: no delete, read, fetch or list');
  assert.doesNotMatch(strip(readFileSync(join(BIN, 'backup-check.sh'), 'utf8')), /gcs_(rm|cat|get|put)\b/, 'the check only lists');
  assert.doesNotMatch(strip(readFileSync(join(BIN, 'restore-drill.sh'), 'utf8')), /gcs_(rm|put)\b/, 'the drill only reads');
  assert.match(strip(readFileSync(join(BIN, 'restore-drill.sh'), 'utf8')), /work=\$\(mktemp -d -p "\$DRILL_BASE" drill\.XXXXXX\)/, 'the scratch folder is a fresh unpredictable mktemp one');
  const lib = strip(readFileSync(join(BIN, 'lib.sh'), 'utf8'));
  assert.match(lib, /CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE/); assert.match(lib, /"\$GCLOUD" storage cp "\$1" "\$GCS_PREFIX\/\$2"/);
  assert.doesNotMatch(lib, /storage cp[^\n]*(--no-clobber|-n )/, 'no-clobber needs read access, which the uploader must not have');
  assert.match(lib, /printf 'url = "%s"\\n' "\$url" \| curl [^\n]*-K -/, 'the webhook address reaches curl on standard input');
});

// ================================================================ Caddy, journald, ssh, lifecycle
test('Caddyfile: automatic https, no admin API, only the local app port behind it, caller address set by the proxy, the app\'s headers passed through, no secrets', () => {
  const c = read('caddy/Caddyfile'), code = strip(c);
  assert.equal((code.match(/{/g) || []).length, (code.match(/}/g) || []).length, 'braces balance');
  assert.match(code, /^\{\$TASKAPP_DOMAIN\} \{/m);
  assert.doesNotMatch(code, /^\s*(http:\/\/|:80\b)/m); assert.doesNotMatch(code, /auto_https\s+(off|disable_redirects)|tls\s+internal|skip_install_trust/);
  assert.match(code, /^\s*admin off$/m, 'the admin API is off'); assert.doesNotMatch(code, /admin localhost|admin :|2019/);
  assert.equal([...code.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]).join(), '127.0.0.1:3000');
  assert.match(code, /header_up X-Forwarded-For \{remote_host\}/); assert.match(code, /header_up -X-Real-IP/); assert.match(code, /header_up -Forwarded/); assert.doesNotMatch(code, /header_up Host/);
  for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'Permissions-Policy', 'Referrer-Policy', 'X-Content-Type-Options']) assert.doesNotMatch(code, new RegExp(h, 'i'), `Caddy must not set ${h}`);
  assert.match(code, /header \{\s*-Server/); assert.match(code, /max_size 4MB/);
  assert.match(code, /request>uri delete/); assert.match(code, /request>headers delete/); assert.match(code, /Set-Cookie delete/); assert.match(code, /roll_size/); assert.match(code, /roll_keep /);
  const o = read('caddy/caddy-override.conf');
  assert.match(o, /EnvironmentFile=\/etc\/caddy\/taskapp-caddy\.env/);
  assert.match(o, /^ExecStartPre=\+\/bin\/sh -c 'grep -q __REPLACE \/etc\/caddy\/taskapp-caddy\.env; \[ \$\? -eq 1 \]'$/m, 'the placeholder guard runs as root and fails on a read error as well as on a match');
  const run = (content, extra = ':') => spawnSync('sh', ['-c', `f=$(mktemp); printf '%s' "$1" > "$f"; ${extra}; grep -q __REPLACE "$f"; [ $? -eq 1 ]; r=$?; rm -f "$f"; exit $r`, 'sh', content]);
  assert.equal(run('DOMAIN=a.example.test').status, 0, 'a filled-in file passes'); assert.notEqual(run('DOMAIN=__REPLACE_X__').status, 0, 'a placeholder fails');
  assert.notEqual(spawnSync('sh', ['-c', 'grep -q __REPLACE /nonexistent/file; [ $? -eq 1 ]']).status, 0, 'a file that cannot be read fails (it used to pass)');
  assert.equal(readFileSync(join(KIT, 'caddy/caddy.env.example'), 'utf8').includes('0640'), true);
});

test('journald, SSH hardening and the bucket lifecycle', () => {
  const j = read('logging/journald-taskapp.conf');
  assert.match(j, /^\[Journal\]$/m); assert.match(j, /^MaxRetentionSec=14day$/m); assert.match(j, /^SystemMaxUse=1G$/m); assert.match(j, /^Storage=persistent$/m);
  const ssh = read('ssh/10-taskapp.conf'), cfg = strip(ssh);
  for (const l of ['PermitRootLogin no', 'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'AuthenticationMethods publickey', 'MaxAuthTries 3', 'X11Forwarding no', 'AllowTcpForwarding no']) assert.match(cfg, new RegExp(`^${l}$`, 'm'), l);
  assert.match(cfg, /^AllowUsers __REPLACE_WITH_YOUR_LOGIN_NAME__$/m); assert.doesNotMatch(cfg, /PasswordAuthentication yes|PermitRootLogin (yes|prohibit)/);
  const lc = JSON.parse(read('gcs/lifecycle.json')).rule;
  const byPrefix = Object.fromEntries(lc.filter((r) => r.condition.matchesPrefix).map((r) => [r.condition.matchesPrefix[0], r.condition.age]));
  assert.deepEqual(byPrefix, { 'backups/backup-hourly-': 2, 'backups/backup-daily-': 31, 'backups/backup-monthly-': 400, 'backups/backup-premigration-': 90, 'backups/verify-': 1 }, 'age-based rules, one per name prefix');
  assert.ok(lc.every((r) => r.action.type === 'Delete'));
  assert.ok(lc.some((r) => r.condition.isLive === false), 'old versions are cleaned too');
  assert.doesNotMatch(read('gcs/lifecycle.json'), /numNewerVersions|last \d+/i);
  for (const kind of ['hourly', 'daily', 'monthly', 'premigration']) assert.ok(NAME_RE.test(`backup-${kind}-${stampOf('2020-01-01T00:00:00Z')}.db.gz.enc`), 'the prefixes match what the app names files');
});

// ================================================================ firewall
const fw = (range, extra = {}) => spawnSync('bash', [join(BIN, 'install-firewall.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, ...(range === undefined ? {} : { SSH_RANGE: range }), ...extra } });
test('firewall: built from a stated range and checked by nft; only 80, 443 and SSH from that range; per-source SSH limit; refuses missing, placeholder, open, too-wide and malformed ranges', { skip: spawnSync('nft', ['--version']).status !== 0 }, () => {
  for (const [range, fam] of [['192.0.2.0/24', 'ip'], ['198.51.100.7', 'ip'], ['203.0.113.0/16', 'ip'], ['2001:db8::/48', 'ip6'], ['2001:db8:1:2::5', 'ip6']]) {
    const r = fw(range);
    assert.equal(r.status, 0, `${range}: ${r.stderr}`);
    const rules = r.stdout.slice(r.stdout.indexOf('table inet'));
    assert.match(rules, new RegExp(`${fam} saddr ${range.replace(/[.:/]/g, '\\$&')} tcp dport 22 ct state new meter ssh_${fam} \\{ ${fam} saddr timeout 5m limit rate 10/minute \\} accept`), 'a limit per source address, not one shared bucket');
    assert.match(rules, /policy drop/); assert.match(rules, /tcp dport \{ 80, 443 \} accept/);
    assert.equal((rules.match(/tcp dport/g) || []).length, 2); assert.doesNotMatch(strip(rules), /\b3000\b|2019/);
  }
  for (const bad of [undefined, '', '__REPLACE_WITH_RANGE__', '0.0.0.0/0', '::/0', '::0/0', '0::/0', '0000::/0', '::/1', '8000::/1', '2001:db8::/16', '2001:db8::/32', '2001:db8::/47', '0.0.0.0/8', '10.0.0.0/8', '10.0.0.0/15', '192.0.2.0/0',
    '127.0.0.1', '0.0.0.0/16', '224.0.0.1', 'not-an-address', '999.1.1.1/24', '192.0.2.0/33', '2001:db8::/129', '192.0.2.0/24; accept', '192.0.2.0/24 accept', '::', ':::']) {
    const r = fw(bad);
    assert.notEqual(r.status, 0, `${bad} was accepted`); assert.doesNotMatch(r.stdout, /table inet/, `${bad}: rules were printed`);
  }
  assert.notEqual(spawnSync('bash', [join(BIN, 'install-firewall.sh'), '--wipe'], { encoding: 'utf8', env: { PATH: process.env.PATH, SSH_RANGE: '192.0.2.0/24' } }).status, 0);
  const t = readFileSync(join(KIT, 'firewall/taskapp.nft.template'), 'utf8');
  assert.equal((t.match(/@SSH_RULE@/g) || []).length, 1); assert.doesNotMatch(strip(t), /saddr/);
});

// ================================================================ scripts: behaviour, with a fake gcloud that applies role-based permissions
const PERMS = { uploader: 'create', 'uploader-list': 'create list', checker: 'list', drill: 'list read', 'drill-write': 'list read create', admin: 'create list read delete' };
function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  const d = (n) => { const p = join(dir, n); mkdirSync(p, { recursive: true }); return p; };
  const live = d('live'), remote = d('remote'), fakebin = d('fakebin'), state = d('state'), outbox = d('outbox'), snaps = d('snaps'), creds = d('creds'), drillbase = d('drillbase');
  const db = openDb(join(live, 'app.db')); migrate(db); seedDemo(db); db.close();
  const log = join(dir, 'gcloud.log');
  writeFileSync(join(fakebin, 'gcloud'), `#!/usr/bin/env bash
# a stand-in for gcloud: "gs://test-bucket/backups/NAME" is a file in $FAKE_REMOTE. What you may do depends on the "role" in the credential file named by the override.
echo "override=\${CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE:-<unset>} $*" >> "$FAKE_LOG"
[ -z "\${FAKE_FAIL:-}" ] || { echo "simulated failure" >&2; exit 1; }
[ "$1" = storage ] || exit 9
op=$2; shift 2
role=ambient-admin
if [ -n "\${CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE:-}" ]; then role=$(sed -n 's/.*"role" *: *"\\([^"]*\\)".*/\\1/p' "$CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE"); fi
case "$role" in ambient-admin) perms="create list read delete" ;; ${Object.entries(PERMS).map(([k, v]) => `${k}) perms="${v}" ;;`).join(' ')} *) perms="" ;; esac
can() { case " $perms " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
deny() { echo "403 Forbidden: $role may not $1" >&2; exit 1; }
file() { echo "$FAKE_REMOTE/$(basename "$1")"; }
case "$op" in
  cp) src=$1; dst=$2
      if [[ "$dst" == gs://* ]]; then can create || deny create; f=$(file "$dst"); if [ -e "$f" ]; then can delete || deny overwrite; fi; cp "$src" "$f"
      else can read || deny read; [ -e "$(file "$src")" ] || { echo "not found" >&2; exit 1; }; cp "$(file "$src")" "$dst"; fi ;;
  ls) can list || deny list; for f in "$FAKE_REMOTE"/*; do [ -e "$f" ] || continue; if [ -d "$f" ]; then echo "gs://test-bucket/backups/$(basename "$f")/"; else echo "gs://test-bucket/backups/$(basename "$f")"; fi; done; [ -z "\${FAKE_LS_EXTRA:-}" ] || printf '%b\\n' "$FAKE_LS_EXTRA" ;;
  cat) can read || deny read; cat "$(file "$1")" ;;
  rm) can delete || deny delete; rm -f "$(file "$1")" ;;
  *) echo "unexpected: $op" >&2; exit 9 ;;
esac
`, { mode: 0o755 });
  const key = randomBytes(32).toString('hex');
  const cred = (name, value) => writeFileSync(join(creds, name), `${value}\n`, { mode: 0o600 });
  cred('backup-key', key); cred('gcs-key', '{"role":"uploader"}'); cred('alert-webhook', ''); cred('healthcheck-ping', '');
  const env = { PATH: `${fakebin}:${process.env.PATH}`, HOME: dir, CREDENTIALS_DIRECTORY: creds, CLOUDSDK_CONFIG: join(dir, 'gcloud-config'),
    DB_PATH: join(live, 'app.db'), GCS_PREFIX: 'gs://test-bucket/backups', STATE_DIR: state, OUTBOX: outbox, SNAPSHOT_DIR: snaps, APP_DIR: ROOT, NODE_BIN: process.execPath, NODE_VERSION_PIN: process.version.slice(1),
    DAILY_HOUR: '2', FAKE_REMOTE: remote, FAKE_LOG: log, LIVE_DB_PATH: join(live, 'app.db'), LIVE_PORT: '3000', DRILL_BASE: drillbase };
  return { dir, live, remote, state, outbox, snaps, creds, drillbase, log, key, env, cred, db: join(live, 'app.db'), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const run = (script, args, env, timeout = 90000) => new Promise((resolve) => {
  const p = spawn('bash', [join(BIN, script), ...args], { env, cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; p.stdout.on('data', (d) => { stdout += d; }); p.stderr.on('data', (d) => { stderr += d; });
  const t = setTimeout(() => p.kill('SIGKILL'), timeout);
  p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
});
const webhook = () => new Promise((resolve) => {
  const got = [];
  const srv = createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push({ method: req.method, body: b, type: req.headers['content-type'] }); res.end('ok'); }); });
  srv.listen(0, '127.0.0.1', () => resolve({ got, url: `http://127.0.0.1:${srv.address().port}/hook`, close: () => new Promise((r) => srv.close(r)) }));
});
const freePort = () => new Promise((resolve) => { const s = netServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const names = (dir) => readdirSync(dir).filter((n) => n.startsWith('backup-')).sort();
const at = (iso) => String(Math.floor(Date.parse(iso) / 1000));
const stamp = (epoch) => new Date(epoch * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const snapAndBackup = async (r, mode, extra = {}) => { const s = await run('snapshot.sh', [mode], { ...r.env, ...extra }); if (s.code !== 0) return { snapshot: s, code: s.code, stdout: s.stdout, stderr: s.stderr }; const b = await run('backup.sh', [mode], { ...r.env, ...extra }); return { snapshot: s, ...b }; };
const kinds = (r) => names(r.remote).map((n) => NAME_RE.exec(n)[1]).sort();

test('snapshot.sh then backup.sh: a checked plain copy, then sealed and uploaded with the create-only identity; the plain copy and the staged file are gone; the key appears nowhere', async () => {
  const r = rig();
  try {
    const s = await run('snapshot.sh', ['scheduled'], r.env);
    assert.equal(s.code, 0, s.stderr);
    assert.ok(existsSync(join(r.snaps, 'scheduled.db')), 'the plain snapshot is where the backup user will look');
    assert.equal(checkDatabase(join(r.snaps, 'scheduled.db')).ok, true);
    const out = await run('backup.sh', ['scheduled'], { ...r.env, NOW_EPOCH: at('2030-05-10T03:00:00Z') });
    assert.equal(out.code, 0, out.stderr + out.stdout);
    assert.deepEqual(kinds(r), ['daily', 'hourly', 'monthly'], 'the first run of a day after DAILY_HOUR makes all three');
    assert.deepEqual(readdirSync(r.outbox), [], 'the staged files are removed after a successful upload');
    assert.ok(!existsSync(join(r.snaps, 'scheduled.db')), 'the plain copy never lingers');
    for (const k of ['hourly', 'daily', 'monthly']) assert.equal(readFileSync(join(r.state, `last-success-${k}`), 'utf8').trim(), at('2030-05-10T03:00:00Z'));
    assert.equal(readFileSync(join(r.state, 'last-daily-date'), 'utf8').trim(), '2030-05-10'); assert.equal(readFileSync(join(r.state, 'last-monthly-month'), 'utf8').trim(), '2030-05');
    const calls = readFileSync(r.log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 3); for (const c of calls) { assert.match(c, /^override=\S*\/creds\/gcs-key storage cp \S+ gs:\/\/test-bucket\/backups\/backup-(hourly|daily|monthly)-/, 'an explicit credential, upload only'); }
    const everything = out.stdout + out.stderr + s.stdout + s.stderr + readFileSync(r.log, 'utf8');
    assert.ok(!everything.includes(r.key), 'the key is nowhere in the output or the upload commands');
    assert.ok(!everything.includes('{"role"') , 'nor is the credential\'s content');
    // the files are real backups: restore one and compare with the live database
    const file = join(r.remote, names(r.remote).find((n) => n.includes('-hourly-')));
    const restored = join(r.dir, 'restored.db');
    const cli = spawnSync(process.execPath, ['--no-warnings', 'app/cli/backup.js', 'restore', '--from', file, '--to', restored, '--confirm', file.split('/').pop()], { cwd: ROOT, env: { PATH: process.env.PATH, BACKUP_KEY_FILE: join(r.creds, 'backup-key') }, encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const a = new DatabaseSync(r.db, { readOnly: true }), b = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(tableCounts(b), tableCounts(a)); a.close(); b.close();
  } finally { r.done(); }
});

test('backup.sh: one timer, many days: the daily copy once a day at or after DAILY_HOUR, the monthly once a month, catch-up after a gap, premigration on its own', async () => {
  const r = rig();
  try {
    const go = async (iso, mode = 'scheduled') => { const o = await snapAndBackup(r, mode, { NOW_EPOCH: at(iso) }); assert.equal(o.code, 0, `${iso}: ${o.stderr}`); await new Promise((res) => setTimeout(res, 1100)); };   // names carry the second
    const before = () => kinds(r).length;
    await go('2030-05-10T01:07:00Z');                 // before the daily hour: only hourly
    assert.deepEqual(kinds(r), ['hourly']);
    await go('2030-05-10T02:07:00Z');                 // first run at the hour: daily and monthly too
    assert.deepEqual(kinds(r), ['daily', 'hourly', 'hourly', 'monthly']);
    await go('2030-05-10T03:07:00Z'); await go('2030-05-10T23:07:00Z');   // later the same day: hourly only
    assert.deepEqual(kinds(r).filter((k) => k !== 'hourly'), ['daily', 'monthly']);
    await go('2030-05-11T00:07:00Z');                 // next day, before the hour: hourly only
    assert.equal(kinds(r).filter((k) => k === 'daily').length, 1);
    await go('2030-05-11T05:07:00Z');                 // the machine was off at 02:00: the daily copy catches up
    assert.equal(kinds(r).filter((k) => k === 'daily').length, 2);
    assert.equal(kinds(r).filter((k) => k === 'monthly').length, 1, 'not monthly again in the same month');
    await go('2030-06-01T02:07:00Z');                 // a new month
    assert.equal(kinds(r).filter((k) => k === 'monthly').length, 2);
    assert.equal(kinds(r).filter((k) => k === 'daily').length, 3);
    const n = names(r.remote).length;
    await go('2030-06-02T04:07:00Z', 'premigration');
    assert.deepEqual(names(r.remote).slice(n).map((x) => NAME_RE.exec(x)[1]), ['premigration'], 'a premigration run makes exactly one premigration copy and never a daily or monthly one');
    assert.equal(kinds(r).filter((k) => k === 'daily').length, 3);
    assert.ok(before() > 8);
  } finally { r.done(); }
});

test('backup.sh: a second run WAITS for the lock and then does its work; it never silently skips', async () => {
  const r = rig();
  try {
    const hold = spawn('flock', [join(r.state, 'backup.lock'), 'sleep', '3'], { stdio: 'ignore' });
    await new Promise((res) => setTimeout(res, 400));
    const s = await run('snapshot.sh', ['scheduled'], r.env); assert.equal(s.code, 0);
    const t0 = Date.now();
    const b = await run('backup.sh', ['scheduled'], { ...r.env, NOW_EPOCH: at('2030-05-10T03:00:00Z') });
    assert.equal(b.code, 0, b.stderr);
    assert.ok(Date.now() - t0 > 1500, `it waited (${Date.now() - t0} ms)`);
    assert.doesNotMatch(b.stdout, /skipping/); assert.deepEqual(kinds(r), ['daily', 'hourly', 'monthly']);
    hold.kill();
  } finally { r.done(); }
});

test('backup.sh: a failed upload keeps the sealed file, removes the plain copy, alerts, records nothing, and the next run sends the leftovers', async () => {
  const r = rig(); const hook = await webhook();
  try {
    r.cred('alert-webhook', hook.url);
    const bad = await snapAndBackup(r, 'scheduled', { FAKE_FAIL: '1', NOW_EPOCH: at('2030-05-10T01:00:00Z') });
    assert.equal(bad.code, 1);
    assert.equal(names(r.outbox).length, 1, 'the sealed file stays on the machine'); assert.equal(names(r.remote).length, 0);
    assert.ok(!existsSync(join(r.snaps, 'scheduled.db')), 'the plain copy is gone even on failure');
    assert.ok(!existsSync(join(r.state, 'last-success-hourly')));
    assert.equal(hook.got.length, 1); assert.equal(hook.got[0].method, 'POST'); assert.equal(hook.got[0].type, 'application/json');
    const msg = JSON.parse(hook.got[0].body).text; assert.match(msg, /could not be uploaded/); assert.ok(!msg.includes(r.key) && !msg.includes(r.dir) && !msg.includes(hook.url));
    await new Promise((res) => setTimeout(res, 1100));
    const good = await snapAndBackup(r, 'scheduled', { NOW_EPOCH: at('2030-05-10T01:30:00Z') });
    assert.equal(good.code, 0, good.stderr);
    assert.equal(names(r.remote).length, 2, 'the leftover and the new copy both went up'); assert.deepEqual(names(r.outbox), []); assert.equal(hook.got.length, 1);
  } finally { await hook.close(); r.done(); }
});

test('backup.sh: a broken snapshot, a symbolic link, a missing snapshot, a missing key, a placeholder: nothing is uploaded, the plain copy goes, and it says why', async () => {
  const r = rig(); const hook = await webhook();
  try {
    r.cred('alert-webhook', hook.url);
    const env = { ...r.env, NOW_EPOCH: at('2030-05-10T03:00:00Z') };
    // a snapshot whose audit chain is broken
    await run('snapshot.sh', ['scheduled'], r.env);
    const raw = new DatabaseSync(join(r.snaps, 'scheduled.db')); raw.exec('drop trigger audit_no_update'); raw.prepare("update audit_events set summary = 'edited' where seq = 1").run(); raw.close();
    let x = await run('backup.sh', ['scheduled'], env);
    assert.equal(x.code, 1); assert.equal(names(r.remote).length, 0); assert.match(JSON.parse(hook.got.at(-1).body).text, /could not check and seal/); assert.ok(!existsSync(join(r.snaps, 'scheduled.db')));
    // a symbolic link planted in the shared folder
    writeFileSync(join(r.dir, 'elsewhere.db'), 'x'); symlinkSync(join(r.dir, 'elsewhere.db'), join(r.snaps, 'scheduled.db'));
    x = await run('backup.sh', ['scheduled'], env); assert.notEqual(x.code, 0); assert.equal(names(r.remote).length, 0); assert.match(x.stderr, /no snapshot|not a regular/);
    assert.ok(existsSync(join(r.dir, 'elsewhere.db')), 'what the link pointed at was not touched');
    x = await run('backup.sh', ['scheduled'], env); assert.notEqual(x.code, 0); assert.match(x.stderr, /no snapshot/);
    await run('snapshot.sh', ['scheduled'], r.env);
    for (const [name, patch, re] of [['no key', { CREDENTIALS_DIRECTORY: join(r.dir, 'empty') }, /backup key is not available/], ['placeholder prefix', { GCS_PREFIX: 'gs://__REPLACE_WITH_BUCKET_NAME__/backups' }, /placeholder/],
      ['bad prefix', { GCS_PREFIX: 'gs://bucket/backups/' }, /GCS_PREFIX must look like/], ['bad hour', { DAILY_HOUR: '25' }, /DAILY_HOUR/], ['injection hour', { DAILY_HOUR: '2; touch pwned' }, /DAILY_HOUR/]]) {
      mkdirSync(join(r.dir, 'empty'), { recursive: true });
      x = await run('backup.sh', ['scheduled'], { ...env, ...patch }); assert.notEqual(x.code, 0, name); assert.match(x.stderr, re, name); assert.equal(names(r.remote).length, 0, name);
      assert.ok(!existsSync(join(ROOT, 'pwned')) && !existsSync(join(r.dir, 'pwned')), name);
    }
    for (const bad of [[], ['weekly'], ['hourly'], ['scheduled; touch pwned']]) { x = await run('backup.sh', bad, env); assert.notEqual(x.code, 0, bad.join()); }
    assert.ok(!existsSync(join(ROOT, 'pwned')));
  } finally { await hook.close(); r.done(); }
});

test('backup-check.sh: each kind on its own clock; a missing kind once the system is old enough; names from the future; stuck copies; hostile names; the list-only identity', async () => {
  const r = rig(); const hook = await webhook();
  try {
    r.cred('alert-webhook', hook.url); r.cred('gcs-key', '{"role":"checker"}');
    const now = 1900000000, env = { ...r.env, NOW_EPOCH: String(now) };
    const check = (e = {}) => run('backup-check.sh', [], { ...env, ...e });
    const lastAlert = () => JSON.parse(hook.got.at(-1).body).text;
    // local record
    let x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /no backup has been recorded at all/);
    const rec = (k, ago) => writeFileSync(join(r.state, `last-success-${k}`), `${now - ago}\n`);
    writeFileSync(join(r.state, 'first-success'), `${now - 3600}\n`);          // a new install: only an hour old
    rec('hourly', 600);
    x = await check(); assert.equal(x.code, 0, x.stderr); assert.match(x.stdout, /hourly 10 min, daily none yet, monthly none yet/);
    rec('hourly', 4 * 3600); x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /newest hourly backup is 4\.0 hours old \(limit 3\.0\)/);
    rec('hourly', 10800); assert.equal((await check()).code, 0, 'exactly the limit is allowed');
    // the system is two days old: a daily copy must exist by now
    writeFileSync(join(r.state, 'first-success'), `${now - 2 * 86400}\n`); rec('hourly', 600);
    x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /no daily backup exists/); assert.doesNotMatch(lastAlert(), /monthly/, 'a monthly copy is not expected for 32 days');
    rec('daily', 27 * 3600); x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /newest daily backup is 27\.0 hours old \(limit 26\.0\)/);
    rec('daily', 20 * 3600); assert.equal((await check()).code, 0);
    writeFileSync(join(r.state, 'first-success'), `${now - 40 * 86400}\n`); x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /no monthly backup exists/);
    rec('monthly', 33 * 86400); x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /monthly backup is 792\.0 hours old/);
    rec('monthly', 5 * 86400); assert.equal((await check()).code, 0);
    // a record from the future is ignored, not trusted
    rec('hourly', -86400); x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /future/);
    rec('hourly', 600);
    // finished copies stuck in the staging folder
    const stuck = join(r.outbox, 'backup-hourly-20300101T000000Z.db.gz.enc'); writeFileSync(stuck, 'x'); const old = new Date(Date.now() - 5 * 3600000); utimesSync(stuck, old, old);
    x = await check(); assert.equal(x.code, 2); assert.match(lastAlert(), /stuck in the staging folder/); rmSync(stuck); assert.equal((await check()).code, 0);
    assert.equal((await check({ MAX_AGE_HOURLY: 'abc' })).code, 1);
    // from the destination's file names, with the list-only identity
    const put = (k, ago) => writeFileSync(join(r.remote, `backup-${k}-${stamp(now - ago)}.db.gz.enc`), 'x');
    const clear = () => { for (const f of readdirSync(r.remote)) rmSync(join(r.remote, f), { recursive: true }); };
    const remote = (e = {}) => check({ CHECK_REMOTE: '1', STATE_DIR: join(r.dir, 'nowhere'), ...e });
    clear(); put('hourly', 1800); put('daily', 10 * 3600); put('monthly', 86400);
    x = await remote(); assert.equal(x.code, 0, x.stderr + x.stdout); assert.match(x.stdout, /hourly 30 min, daily 10\.0 h, monthly 24\.0 h/);
    assert.match(readFileSync(r.log, 'utf8'), /override=\S*\/creds\/gcs-key storage ls gs:\/\/test-bucket\/backups\//, 'listing, with the explicit credential');
    // hostile and odd entries in the listing do not break it
    x = await remote({ FAKE_LS_EXTRA: '-x\\n\\n   \\ngs://test-bucket/backups/--help\\ngs://test-bucket/backups/backup-hourly-99999999T999999Z.db.gz.enc\\ngs://test-bucket/backups/backup-hourly-20291231T235959Z.db.gz.enc/\\ngs://test-bucket/backups/backup-hourly-20400101T000000Z.db.gz.enc\\nREADME' });
    assert.equal(x.code, 2, 'the impossible-date name is ignored, and the one in the future is called out'); assert.match(lastAlert(), /future|claim/);
    mkdirSync(join(r.remote, `backup-daily-${stamp(now - 100)}.db.gz.enc`)); rmSync(join(r.remote, `backup-daily-${stamp(now - 10 * 3600)}.db.gz.enc`)); put('hourly', 3 * 86400);   // an old hourly copy: the system is old enough to have a daily one
    x = await remote(); assert.equal(x.code, 2); assert.match(lastAlert(), /newest daily|no daily/, 'a directory named like a backup does not count as one');
    clear(); put('hourly', 1800); put('daily', 50 * 3600); put('monthly', 86400);
    x = await remote(); assert.equal(x.code, 2); assert.match(lastAlert(), /newest daily backup is 50\.0 hours old/);
    // a forged name from the future cannot make the check pass for ever
    clear(); put('hourly', -86400 * 3650); x = await remote(); assert.equal(x.code, 2); assert.match(lastAlert(), /future/);
    x = await remote({ FAKE_FAIL: '1' }); assert.equal(x.code, 1); assert.match(lastAlert(), /could not list/);
    const bad = await remote({ CREDENTIALS_DIRECTORY: join(r.dir, 'none') }); assert.notEqual(bad.code, 0);
    r.cred('gcs-key', '{"role":"uploader"}'); clear(); x = await remote(); assert.equal(x.code, 1, 'the upload identity cannot list, so a mistake in which credential is loaded shows up'); assert.match(lastAlert(), /could not list/);
  } finally { await hook.close(); r.done(); }
});

const seedRemote = async (r, extra = {}) => { const o = await snapAndBackup(r, 'scheduled', { NOW_EPOCH: at('2030-05-10T03:00:00Z'), ...extra }); assert.equal(o.code, 0, o.stderr); };
const drillEnv = (r, port) => { r.cred('gcs-key', '{"role":"drill"}'); return { ...r.env, DRILL_PORT: String(port) }; };
test('restore-drill.sh: reads a real backup with the read-only identity, restores it into a scratch folder it made, proves the throw-away app is the process that answered, removes everything, and leaves the live database alone', async () => {
  const r = rig();
  try {
    await seedRemote(r);
    const port = await freePort(), env = drillEnv(r, port);
    const live = () => { const x = new DatabaseSync(r.db, { readOnly: true }); const c = JSON.stringify(tableCounts(x)); x.close(); return c; };
    const before = live(), liveFiles = readdirSync(r.live).sort().join();
    const out = await run('restore-drill.sh', [], env);
    assert.equal(out.code, 0, out.stderr + out.stdout);
    assert.match(out.stdout, /DRILL PASSED/); assert.match(out.stdout, /matched the fingerprint recorded when it was taken/); assert.match(out.stdout, /process \d+\) answered on port/);
    assert.deepEqual(readdirSync(r.drillbase), [], 'the scratch folder is gone');
    assert.ok(!out.stdout.includes(r.key) && !out.stderr.includes(r.key));
    assert.equal(live(), before, 'the live database is unchanged'); assert.equal(readdirSync(r.live).sort().join(), liveFiles);
    assert.match(readFileSync(r.log, 'utf8'), /override=\S*\/creds\/gcs-key storage (ls|cp gs:)/, 'the read-only identity, with an explicit credential');
    assert.doesNotMatch(readFileSync(r.log, 'utf8'), /storage (rm|cat) /);
    // a named backup, and one it would not choose
    const name = names(r.remote).find((n) => n.includes('-monthly-'));
    const named = await run('restore-drill.sh', [name], env); assert.equal(named.code, 0, named.stderr); assert.match(named.stdout, new RegExp(name.replace(/\./g, '\\.')));
    assert.notEqual((await run('restore-drill.sh', ['../../etc/passwd'], env)).code, 0);
  } finally { r.done(); }
});

test('restore-drill.sh: it takes the newest plausible name, skips a name from the future, FAILS on a renamed or forged file (it cannot be tricked into passing), and ignores hostile names', async () => {
  const r = rig();
  try {
    await seedRemote(r);
    const port = await freePort(), env = drillEnv(r, port);
    const base = names(r.remote).find((n) => n.includes('-hourly-')), bytes = readFileSync(join(r.remote, base));
    // a name 100 years ahead: skipped, the real newest is used
    writeFileSync(join(r.remote, 'backup-hourly-21301231T235959Z.db.gz.enc'), bytes);
    let x = await run('restore-drill.sh', [], env); assert.equal(x.code, 0, x.stderr); assert.match(x.stderr, /skipping backup-hourly-21301231T235959Z.*future/); assert.match(x.stdout, new RegExp(`using ${base.replace(/\./g, '\\.')}|DRILL PASSED`));
    rmSync(join(r.remote, 'backup-hourly-21301231T235959Z.db.gz.enc'));
    // a hostile or odd listing does not break it
    x = await run('restore-drill.sh', [], { ...env, FAKE_LS_EXTRA: '-x\\n\\ngs://test-bucket/backups/--help\\ngs://test-bucket/backups/backup-hourly-20300101T000000Z.db.gz.enc/' }); assert.equal(x.code, 0, x.stderr);
    // an OLD backup renamed to look like the newest (plausible time, not in the future): chosen, then refused as forged
    const forged = `backup-hourly-${stamp(Math.floor(Date.now() / 1000) + 5)}.db.gz.enc`;   // newer than the real one, inside the clock tolerance
    writeFileSync(join(r.remote, forged), bytes);
    x = await run('restore-drill.sh', [], env); assert.notEqual(x.code, 0); assert.match(x.stdout + x.stderr, /DRILL FAILED: the backup did not restore/); assert.match(x.stderr, /renamed or forged/); assert.deepEqual(readdirSync(r.drillbase), []);
    rmSync(join(r.remote, forged));
    // the wrong key
    r.cred('backup-key', randomBytes(32).toString('hex'));
    x = await run('restore-drill.sh', [], env); assert.notEqual(x.code, 0); assert.match(x.stderr, /key is wrong or the file was changed/); assert.deepEqual(readdirSync(r.drillbase), []);
    r.cred('backup-key', r.key);
    // a damaged file
    const b = Buffer.from(bytes); b[b.length >> 1] ^= 1; writeFileSync(join(r.remote, base), b);
    x = await run('restore-drill.sh', [base], env); assert.notEqual(x.code, 0); assert.deepEqual(readdirSync(r.drillbase), []);
    for (const f of readdirSync(r.remote)) rmSync(join(r.remote, f));
    x = await run('restore-drill.sh', [], env); assert.notEqual(x.code, 0); assert.match(x.stderr, /no usable backups/);
  } finally { r.done(); }
});

test('restore-drill.sh: refuses when the spare port is taken, when the scratch base is unsafe, or when a setting is a placeholder; the scratch folder is a fresh mktemp one and only it is deleted', async () => {
  const r = rig();
  try {
    await seedRemote(r);
    const port = await freePort(), env = drillEnv(r, port);
    // something already listening on the spare port: refused before anything starts
    const squat = createServer((q, s) => s.end('{"ok":true}')); await new Promise((res) => squat.listen(port, '127.0.0.1', res));
    let x = await run('restore-drill.sh', [], env); assert.notEqual(x.code, 0); assert.match(x.stderr, /already listening on port/); squat.close();
    // a pre-existing file in the base folder survives: only the folder this script made is removed
    writeFileSync(join(r.drillbase, 'precious.txt'), 'keep'); mkdirSync(join(r.drillbase, 'drill.preexisting')); writeFileSync(join(r.drillbase, 'drill.preexisting', 'x'), 'keep');
    x = await run('restore-drill.sh', [], env); assert.equal(x.code, 0, x.stderr);
    assert.deepEqual(readdirSync(r.drillbase).sort(), ['drill.preexisting', 'precious.txt'], 'only its own scratch folder was removed');
    const nested = join(r.dir, 'drill-parent'); mkdirSync(join(nested, 'live'), { recursive: true });
    for (const [name, patch, re] of [['base missing', { DRILL_BASE: join(r.dir, 'no-such') }, /does not exist/], ['base is the live folder', { DRILL_BASE: r.live }, /inside the live database folder|contains the live database folder/], ['base inside the live folder', { DRILL_BASE: (() => { const p = join(r.live, 'd'); mkdirSync(p); return p; })() }, /inside the live database folder/],
      ['base contains the live folder', { DRILL_BASE: nested, LIVE_DB_PATH: join(nested, 'live', 'app.db') }, /contains the live database folder/], ['base is /', { DRILL_BASE: '/' }, /drill base|contains the live|inside the live/],
      ['live port', { DRILL_PORT: '3000' }, /must differ from the live port/], ['port word', { DRILL_PORT: '30x0' }, /must be a number/], ['placeholder', { DRILL_PORT: '__REPLACE_PORT__' }, /placeholder/],
      ['no key', { CREDENTIALS_DIRECTORY: join(r.dir, 'no-creds') }, /backup key is not available/]]) {
      x = await run('restore-drill.sh', [], { ...env, ...patch }); assert.notEqual(x.code, 0, name); assert.match(x.stderr, re, `${name}: ${x.stderr.trim()}`);
      assert.ok(existsSync(r.db) && existsSync(r.live) && existsSync(r.dir), `${name}: nothing was deleted`);
    }
  } finally { r.done(); }
});

test('lib: the process answering on a port is checked against the one we started, so a squatter cannot pass for the app', async () => {
  const port = await freePort();
  const squat = spawn(process.execPath, ['-e', `require('http').createServer((q, s) => s.end('{"ok":true}')).listen(${port}, '127.0.0.1')`], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 40 && !(await new Promise((res) => { const s = netServer().once('error', () => res(true)).once('listening', () => s.close(() => res(false))); s.listen(port, '127.0.0.1'); })); i++) await new Promise((r) => setTimeout(r, 100));
    const bash = (code) => spawnSync('bash', ['-c', `. ${join(BIN, 'lib.sh')}; ${code}`], { encoding: 'utf8' });
    assert.equal(bash(`port_in_use ${port}`).status, 0, 'a listener is seen');
    assert.equal(bash(`port_owned_by_pid ${port} ${squat.pid}`).status, 0, 'the real owner passes');
    assert.notEqual(bash(`port_owned_by_pid ${port} 1`).status, 0, 'another process does not');
    assert.notEqual(bash(`port_owned_by_pid ${port} $$`).status, 0);
    assert.notEqual(bash(`port_in_use ${await freePort()}`).status, 0, 'a free port is free');
  } finally { squat.kill(); }
});

test('verify-storage.sh: proves each identity can do its one job and nothing more; a too-strong credential FAILS', async () => {
  const r = rig();
  try {
    const verify = (role, cred) => { r.cred('gcs-key', JSON.stringify({ role: cred })); return run('verify-storage.sh', [role], r.env); };
    let x = await verify('uploader', 'uploader');
    assert.equal(x.code, 0, x.stderr + x.stdout); for (const l of ['can add a file', 'cannot list the folder', 'cannot read a file', 'cannot delete a file', 'cannot overwrite a file']) assert.match(x.stdout, new RegExp(`PASS: uploader ${l}`));
    assert.equal(names(r.remote).length, 0); assert.equal(readdirSync(r.remote).filter((n) => n.startsWith('verify-')).length, 1, 'the test file stays (the uploader cannot delete it; the lifecycle rule does)');
    assert.match(readFileSync(r.log, 'utf8'), /override=\S*\/creds\/gcs-key storage cp /, 'with an explicit credential file');
    for (const [role, cred, re] of [['uploader', 'uploader-list', /FAIL: uploader must NOT be able to list the folder, and CAN/], ['uploader', 'admin', /FAIL: uploader must NOT be able to (list|read|delete|overwrite)/], ['uploader', 'drill-write', /FAIL/], ['uploader', 'checker', /FAIL: uploader should be able to add a file, and cannot/]]) {
      x = await verify(role, cred); assert.notEqual(x.code, 0, `${role} with ${cred}`); assert.match(x.stderr, re, `${role} with ${cred}`);
    }
    writeFileSync(join(r.remote, 'backup-hourly-20300101T000000Z.db.gz.enc'), 'x');
    x = await verify('checker', 'checker'); assert.equal(x.code, 0, x.stderr + x.stdout); assert.match(x.stdout, /PASS: checker can list the folder/); assert.match(x.stdout, /PASS: checker cannot read a file/);
    x = await verify('checker', 'drill'); assert.notEqual(x.code, 0); assert.match(x.stderr, /checker must NOT be able to read a file, and CAN/);
    x = await verify('drill', 'drill'); assert.equal(x.code, 0, x.stderr + x.stdout); assert.match(x.stdout, /PASS: drill can read a file/);
    x = await verify('drill', 'drill-write'); assert.notEqual(x.code, 0); assert.match(x.stderr, /drill must NOT be able to add a file, and CAN/);
    x = await verify('drill', 'checker'); assert.notEqual(x.code, 0); assert.match(x.stderr, /drill should be able to read a file, and cannot/);
    for (const f of readdirSync(r.remote)) rmSync(join(r.remote, f));
    x = await verify('checker', 'checker'); assert.notEqual(x.code, 0); assert.match(x.stderr, /nothing in the folder yet/);
    assert.notEqual((await run('verify-storage.sh', ['admin'], r.env)).code, 0);
    assert.notEqual((await run('verify-storage.sh', ['uploader'], { ...r.env, CREDENTIALS_DIRECTORY: join(r.dir, 'none') })).code, 0);
  } finally { r.done(); }
});

test('install-credential.sh: only the named credentials, the value only from standard input, root-only mode, no echo, no overwrite without --replace, the key checked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cred-'));
  try {
    const inst = (name, input, extra = []) => spawnSync('bash', [join(BIN, 'install-credential.sh'), name, ...extra], { input, encoding: 'utf8', env: { PATH: process.env.PATH, CRED_DIR: dir } });
    const key = randomBytes(32).toString('hex');
    let x = inst('backup-key', `${key}\n`); assert.equal(x.status, 0, x.stderr);
    assert.equal(readFileSync(join(dir, 'backup-key'), 'utf8').trim(), key); assert.equal(statSync(join(dir, 'backup-key')).mode & 0o777, 0o600);
    assert.ok(!x.stdout.includes(key) && !x.stderr.includes(key), 'the value is not echoed');
    x = inst('backup-key', `${randomBytes(32).toString('hex')}\n`); assert.notEqual(x.status, 0); assert.match(x.stderr, /already exists/); assert.equal(readFileSync(join(dir, 'backup-key'), 'utf8').trim(), key);
    assert.equal(inst('backup-key', `${randomBytes(32).toString('hex')}\n`, ['--replace']).status, 0);
    for (const bad of ['not hex', 'ab'.repeat(31), `${key}00`, '']) { x = inst('backup-key', `${bad}\n`, ['--replace']); assert.notEqual(x.status, 0, bad); }
    assert.equal(inst('uploader-key.json', '{"type":"service_account"}\n').status, 0);
    assert.notEqual(inst('uploader-key.json', '\n', ['--replace']).status, 0, 'a key file cannot be empty');
    assert.equal(inst('alert-webhook', '\n').status, 0, 'the alert address may be blank'); assert.equal(inst('healthcheck-ping', '').status, 0);
    for (const bad of ['../evil', 'backup-key/../x', '', 'other', '/etc/passwd', 'backup-key;touch x']) assert.notEqual(inst(bad, 'x\n').status, 0, bad);
    assert.deepEqual(readdirSync(dir).sort(), ['alert-webhook', 'backup-key', 'healthcheck-ping', 'uploader-key.json']);
    assert.ok(readdirSync(dir).every((n) => (statSync(join(dir, n)).mode & 0o077) === 0), 'nothing readable by anyone else, and no temp file left');
    assert.notEqual(spawnSync('bash', [join(BIN, 'install-credential.sh'), 'backup-key'], { input: 'x\n', encoding: 'utf8', env: { PATH: process.env.PATH, CRED_DIR: join(dir, 'missing') } }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('app-cli.sh: the tools run as the app user in an EMPTY environment (no npm, no HOME, no other setting), from root, with the placeholders refused', async () => {
  const r = rig();
  try {
    const envFile = join(r.dir, 'app.env'), record = join(r.dir, 'record');
    writeFileSync(envFile, `DB_PATH=${r.db}\nPORT=3000\nPUBLIC_URL=https://tasks.example.test\nSECRET_LOOKING_SETTING=do-not-pass-me\nHOME=/home/attacker\nNODE_OPTIONS=--require=/tmp/evil.js\n`);
    // a stand-in for setpriv that records how it was called and then runs the command it was given
    writeFileSync(join(r.dir, 'fakebin', 'setpriv'), `#!/usr/bin/env bash\necho "setpriv $*" > "${record}"\nwhile [[ "$1" == --* ]]; do shift; done\nexec "$@"\n`, { mode: 0o755 });
    writeFileSync(join(r.dir, 'fakebin', 'node-spy'), `#!/usr/bin/env bash\n{ echo "node-spy $*"; env | sort; } >> "${record}"\n`, { mode: 0o755 });
    const env = { PATH: r.env.PATH, APP_ENV_FILE: envFile, APP_DIR: ROOT, NODE_BIN: join(r.dir, 'fakebin', 'node-spy'), APP_USER: 'taskapp' };
    const x = await run('app-cli.sh', ['first-owner', '--workspace', 'W', '--name', 'N', '--email', 'a@example.test'], env);
    assert.equal(x.code, 0, x.stderr);
    const rec = readFileSync(record, 'utf8');
    if (process.getuid() === 0) assert.match(rec, /^setpriv --reuid=taskapp --regid=taskapp --init-groups --no-new-privs env -i PATH=\/usr\/bin:\/bin /, 'dropped to the app user first');
    assert.match(rec, /node-spy --no-warnings \S+\/app\/cli\/first-owner\.js --workspace W --name N --email a@example\.test/);
    const vars = rec.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]).sort();
    assert.deepEqual(vars.filter((v) => !['PWD', 'SHLVL', '_', 'OLDPWD'].includes(v)), ['DB_PATH', 'PATH', 'PORT', 'PUBLIC_URL'], 'an empty environment plus the four settings the tools need');
    assert.doesNotMatch(rec, /do-not-pass-me|attacker|NODE_OPTIONS|evil\.js|npm/);
    for (const [args, patch, re] of [[['seed'], {}, /usage/], [[], {}, /usage/], [['first-owner'], { APP_ENV_FILE: join(r.dir, 'nope') }, /cannot read/]]) { const y = await run('app-cli.sh', args, { ...env, ...patch }); assert.notEqual(y.code, 0); assert.match(y.stderr, re); }
    writeFileSync(envFile, `DB_PATH=${r.db}\nPUBLIC_URL=https://__REPLACE_WITH_YOUR_DOMAIN__\n`);
    const z = await run('app-cli.sh', ['break-glass', 'unlock', '--email', 'a@example.test'], env); assert.notEqual(z.code, 0); assert.match(z.stderr, /placeholder/);
  } finally { r.done(); }
});

test('check-node.sh and alert.sh: the wrong Node stops the service; an alert is one JSON post, the address reaches curl on standard input, and a dead webhook does not fail the step', async () => {
  const r = rig(); const hook = await webhook();
  try {
    let x = await run('check-node.sh', [], r.env); assert.equal(x.code, 0, x.stderr); assert.match(x.stdout, /node v\d+\.\d+\.\d+ ok/);
    x = await run('check-node.sh', [], { ...r.env, NODE_VERSION_PIN: '20.0.0' }); assert.notEqual(x.code, 0); assert.match(x.stderr, /pinned to v20\.0\.0/);
    x = await run('check-node.sh', [], { ...r.env, NODE_VERSION_PIN: '' }); assert.notEqual(x.code, 0);
    const app = join(r.dir, 'app'); mkdirSync(app); writeFileSync(join(app, '.nvmrc'), '22.1.1\n');
    x = await run('check-node.sh', [], { ...r.env, APP_DIR: app }); assert.notEqual(x.code, 0); assert.match(x.stderr, /differs from \.nvmrc/);
    r.cred('alert-webhook', hook.url);
    x = await run('alert.sh', ['unit taskapp.service failed "quoted" \\ back'], r.env);
    assert.equal(x.code, 0); assert.equal(hook.got.length, 1);
    const body = JSON.parse(hook.got[0].body); assert.deepEqual(Object.keys(body), ['text']); assert.match(body.text, /unit taskapp\.service failed "quoted" \\ back/);
    assert.ok(!x.stdout.includes(hook.url) && !x.stderr.includes(hook.url), 'the address is not printed');
    // the address must not appear on curl's command line: a spy curl records its arguments and its standard input
    const spy = join(r.dir, 'curl-record');
    writeFileSync(join(r.dir, 'fakebin', 'curl'), `#!/usr/bin/env bash\necho "ARGV: $*" > "${spy}"\ncat >> "${spy}"\n`, { mode: 0o755 });
    await run('alert.sh', ['hello'], r.env);
    const rec = readFileSync(spy, 'utf8'); assert.doesNotMatch(rec.split('\n')[0], new RegExp(hook.url.replace(/[.\/:?]/g, '\\$&')), 'not in the arguments'); assert.match(rec, new RegExp(`url = "${hook.url.replace(/[.\/:?]/g, '\\$&')}"`), 'on standard input');
    rmSync(join(r.dir, 'fakebin', 'curl'));
    r.cred('alert-webhook', ''); x = await run('alert.sh', ['no webhook configured'], r.env); assert.equal(x.code, 0); assert.match(x.stderr, /ALERT: no webhook configured/);
    r.cred('alert-webhook', 'http://127.0.0.1:1/none'); x = await run('alert.sh', ['webhook is down'], r.env); assert.equal(x.code, 0, 'a dead webhook must not make the alert step fail');
  } finally { await hook.close(); r.done(); }
});
