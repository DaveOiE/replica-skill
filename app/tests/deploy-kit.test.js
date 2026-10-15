import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync, chmodSync } from 'node:fs';
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
import { keyFrom, LocalDirDestination, runRestore, tableCounts, checkDatabase } from '../server/backup.js';
import { loadConfig } from '../server/app.js';

setPasswordCost({ N: 1024, r: 8, p: 1 });
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KIT = join(ROOT, 'replica', 'deploy');
const BIN = join(KIT, 'bin');
const read = (p) => readFileSync(join(KIT, p), 'utf8');
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(KIT);
const scripts = files.filter((f) => f.endsWith('.sh'));
const strip = (s) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // the file without its comment lines

// ---------------------------------------------------------------- what is there
test('the kit has every piece that was asked for', () => {
  for (const f of ['README.md', 'systemd/taskapp.service', 'systemd/taskapp-backup@.service', 'systemd/taskapp-backup-hourly.timer', 'systemd/taskapp-backup-daily.timer', 'systemd/taskapp-backup-monthly.timer',
    'systemd/taskapp-backup-check.service', 'systemd/taskapp-backup-check.timer', 'systemd/taskapp-alert@.service', 'etc/taskapp.env.example', 'etc/backup-upload.env.example', 'etc/restore-drill.env.example',
    'caddy/Caddyfile', 'caddy/caddy.env.example', 'caddy/caddy-override.conf', 'firewall/taskapp.nft.template', 'logging/journald-taskapp.conf',
    'bin/backup.sh', 'bin/backup-check.sh', 'bin/restore-drill.sh', 'bin/install-firewall.sh', 'bin/check-node.sh', 'bin/alert.sh', 'bin/lib.sh'])
    assert.ok(existsSync(join(KIT, f)), `missing ${f}`);
  const readme = read('README.md');
  const order = ['**0. Decide first', '**1. Get a machine', '**2. User and folders', '**3. The pinned Node', '**4. The code', '**5. Settings', '**6. Firewall', '**7. Units', '**8. The first owner', '**9. Start the app', '**10. Caddy', '**11. Backups', '**12. Restore drill', '**13. Go-live checks'];
  const at = order.map((h) => readme.indexOf(h));
  assert.ok(at.every((n) => n >= 0), 'every step is in the README');
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the stated order');
  assert.match(readme, /Nothing in this folder has been run on a real machine/);
  assert.match(readme, /not\s+certified/i);
});

// ---------------------------------------------------------------- no secrets, no real addresses
test('no file holds a secret, a key-shaped string or a real-looking address; every credential is a placeholder', () => {
  const docRanges = /^(127\.0\.0\.1|0\.0\.0\.0|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/;
  for (const f of files) {
    const text = readFileSync(f, 'utf8'), name = relative(KIT, f);
    assert.doesNotMatch(text, /[0-9a-fA-F]{64}/, `${name}: a 64-character hex string (looks like a key)`);
    assert.doesNotMatch(text, /dsk_[A-Za-z0-9_-]{20,}/, `${name}: a service token`);
    assert.doesNotMatch(text, /-----BEGIN [A-Z ]*PRIVATE KEY/, `${name}: a private key`);
    assert.doesNotMatch(text, /AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|xox[bap]-[0-9A-Za-z-]{10,}|ghp_[0-9A-Za-z]{30,}/, `${name}: a cloud or chat credential`);
    assert.doesNotMatch(text, /https?:\/\/[^\s"']*(hooks\.|webhook)[^\s"']*\/[A-Za-z0-9_-]{16,}/, `${name}: a webhook address with a secret path`);
    assert.doesNotMatch(text, /[A-Za-z0-9+/]{60,}={0,2}/, `${name}: a long base64-looking string`);
    for (const ip of text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/g) || []) assert.match(ip, docRanges, `${name}: ${ip} is not a documentation or local address`);
  }
  for (const f of files.filter((x) => x.includes(`${join('deploy', 'etc')}`) || x.endsWith('caddy.env.example'))) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (!m) continue;
      if (/KEY|SECRET|TOKEN|PASSWORD|DOMAIN|EMAIL|TARGET|SOURCE|URL(?!.*PUBLIC)/.test(m[1]) && m[1] !== 'PUBLIC_URL') assert.ok(m[2] === '' || /__REPLACE|^\/etc\/taskapp\//.test(m[2]), `${relative(KIT, f)}: ${m[1]} must be a placeholder, empty, or a file path under /etc/taskapp`);
    }
  }
});

// ---------------------------------------------------------------- settings files
test('settings examples: valid for systemd and for the shell, with every setting asked for, and placeholders the app refuses to run on', () => {
  const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
  for (const f of ['etc/taskapp.env.example', 'etc/backup-upload.env.example', 'etc/restore-drill.env.example', 'caddy/caddy.env.example']) {
    for (const line of read(f).split('\n')) assert.match(line, /^(#.*|[A-Z][A-Z0-9_]*=[^\s"'`$\;&|<>()]*|)$/, `${f}: "${line}" would be read differently by systemd and the shell`);
    const dump = spawnSync('bash', ['-c', `set -a; . "${join(KIT, f)}"; env`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(dump.status, 0, `${f} does not source in the shell`);
  }
  const env = Object.fromEntries(read('etc/taskapp.env.example').split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
  for (const k of ['PORT', 'DB_PATH', 'PUBLIC_URL', 'TRUST_PROXY', 'SESSION_HOURS', 'SESSION_IDLE_MINUTES', 'BACKUP_KEY', 'BACKUP_DEST', 'NODE_VERSION_PIN']) assert.ok(k in env, `taskapp.env.example sets ${k}`);
  assert.equal(env.NODE_VERSION_PIN, nvmrc, 'the Node pin equals .nvmrc');
  assert.equal(env.NODE_VERSION_PIN, '22.22.0');
  assert.equal(env.TRUST_PROXY, 'true');
  assert.ok(!('COOKIE_SECURE' in env), 'COOKIE_SECURE is left unset');
  assert.match(env.PUBLIC_URL, /^https:\/\//);
  assert.throws(() => keyFrom(env.BACKUP_KEY), /BACKUP_KEY must be 32 bytes/, 'the placeholder key cannot be used by accident');
  const cfg = loadConfig({ ...env, PUBLIC_URL: 'https://tasks.example.test' });
  assert.deepEqual([cfg.trustProxy, cfg.cookieSecure, cfg.idleMinutes, cfg.dbPath], [true, true, 120, '/var/lib/taskapp/app.db'], 'the app reads these settings the way the file intends');
  assert.match(env.BACKUP_DEST, /^file:\/var\/lib\/taskapp-backup\/outbox$/);
  const up = read('etc/backup-upload.env.example');
  assert.match(up, /MAX_AGE_SECONDS=10800/);
  assert.match(up, /create-only|only add files|ADD files/i, 'says what the upload credential may do');
});

// ---------------------------------------------------------------- systemd units
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
const units = Object.fromEntries(readdirSync(join(KIT, 'systemd')).map((n) => [n, parseUnit(read(`systemd/${n}`))]));

test('the app unit: non-root, read-only system, one writable folder, no privileges, restarts on failure, refuses the wrong Node', () => {
  const s = units['taskapp.service'].Service, u = units['taskapp.service'].Unit;
  const one = (k) => { assert.equal(s[k]?.length, 1, `${k} set once`); return s[k][0]; };
  assert.equal(one('User'), 'taskapp'); assert.equal(one('Group'), 'taskapp');
  assert.equal(one('Restart'), 'on-failure');
  assert.equal(one('NoNewPrivileges'), 'true'); assert.equal(one('ProtectSystem'), 'strict'); assert.equal(one('ProtectHome'), 'true');
  assert.equal(one('PrivateTmp'), 'true'); assert.equal(one('PrivateDevices'), 'true'); assert.equal(one('UMask'), '0077');
  assert.equal(one('CapabilityBoundingSet'), '', 'no capabilities at all');
  assert.equal(one('ReadWritePaths'), '/var/lib/taskapp', 'one writable folder');
  assert.equal(one('StateDirectory'), 'taskapp'); assert.equal(one('StateDirectoryMode'), '0700');
  assert.equal(one('EnvironmentFile'), '/etc/taskapp/taskapp.env');
  assert.match(one('ExecStart'), /^\/opt\/node\/bin\/node --no-warnings app\/server\/index\.js$/);
  assert.match(one('ExecStartPre'), /\/bin\/check-node\.sh$/);
  assert.ok(s.SystemCallFilter.includes('@system-service') && s.SystemCallFilter.some((x) => x.startsWith('~')));
  assert.match(one('RestrictAddressFamilies'), /AF_INET/); assert.doesNotMatch(one('RestrictAddressFamilies'), /AF_NETLINK|AF_PACKET/);
  assert.ok(!s.MemoryDenyWriteExecute || s.MemoryDenyWriteExecute[0] !== 'true', 'Node needs writable and executable memory for its JIT');
  assert.ok(u.OnFailure[0].startsWith('taskapp-alert@'));
  assert.ok(units['taskapp.service'].Install.WantedBy.includes('multi-user.target'));
  assert.ok(Number(one('MemoryMax').replace(/G$/, '')) <= 2);
});

test('every service unit runs as the unprivileged user with the same protections, and every timer points at a real unit with a calendar systemd can read', () => {
  for (const [name, def] of Object.entries(units).filter(([n]) => n.endsWith('.service'))) {
    const s = def.Service;
    assert.equal(s.User?.[0], 'taskapp', `${name}: runs as the service user`);
    assert.notEqual(s.User[0], 'root');
    for (const k of ['NoNewPrivileges', 'ProtectSystem', 'ProtectHome', 'PrivateTmp']) assert.ok(s[k], `${name}: ${k}`);
    assert.equal(s.ProtectSystem[0], 'strict', name);
    assert.equal(s.CapabilityBoundingSet?.[0], '', `${name}: no capabilities`);
    for (const k of ['ExecStart', 'ExecStartPre'].filter((x) => s[x])) for (const cmd of s[k]) assert.match(cmd, /^\//, `${name}: ${k} is an absolute path`);
    for (const p of (s.ReadWritePaths || []).flatMap((x) => x.split(' '))) assert.match(p, /^\/var\/lib\/taskapp(-backup)?$/, `${name}: writable only under /var/lib/taskapp*`);
    assert.ok(!s.EnvironmentFile || s.EnvironmentFile.every((e) => /^\/etc\/taskapp\/[a-z-]+\.env$/.test(e)), `${name}: settings come from /etc/taskapp`);
    assert.notEqual(def.Service.Restart?.[0], 'always');
  }
  assert.equal(units['taskapp-backup@.service'].Service.Type[0], 'oneshot');
  assert.match(units['taskapp-backup@.service'].Service.ExecStart[0], /backup\.sh %i$/);
  for (const k of ['hourly', 'daily', 'monthly']) {
    const t = units[`taskapp-backup-${k}.timer`];
    assert.equal(t.Timer.Unit[0], `taskapp-backup@${k}.service`);
    assert.equal(t.Timer.Persistent[0], 'true');
    assert.ok(t.Install.WantedBy.includes('timers.target'));
  }
  assert.equal(units['taskapp-backup-check.timer'].Timer.Unit[0], 'taskapp-backup-check.service');
  assert.match(units['taskapp-backup-check.service'].Service.ExecStart[0], /backup-check\.sh$/);
  // each calendar must parse, and the hourly one must fire hourly
  const cal = (e) => spawnSync('systemd-analyze', ['calendar', e], { encoding: 'utf8' });
  const have = spawnSync('systemd-analyze', ['--version']).status === 0;
  if (have) for (const [n, def] of Object.entries(units).filter(([k]) => k.endsWith('.timer'))) {
    const r = cal(def.Timer.OnCalendar[0]);
    assert.equal(r.status, 0, `${n}: ${def.Timer.OnCalendar[0]} is not a calendar systemd understands: ${r.stderr}`);
  }
  if (have) {
    const next = spawnSync('systemd-analyze', ['calendar', '--iterations=3', units['taskapp-backup-hourly.timer'].Timer.OnCalendar[0]], { encoding: 'utf8' }).stdout;
    const times = [...next.matchAll(/(?:Next elapse|Iteration #\d+): \w+ (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/g)].map((m) => Date.parse(`${m[1]}T${m[2]}Z`));
    assert.equal(times.length, 3); assert.equal(times[1] - times[0], 3600000);
  }
  // the kinds a timer starts are the kinds the script accepts
  const accepted = /case "\$kind" in ([a-z|]+\|premigration)\)/.exec(readFileSync(join(BIN, 'backup.sh'), 'utf8'))[1].split('|');
  assert.deepEqual(accepted.sort(), ['daily', 'hourly', 'monthly', 'premigration']);
});

test('systemd-analyze finds nothing wrong with the units except that the programs are not installed on this machine', { skip: spawnSync('systemd-analyze', ['--version']).status !== 0 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'units-'));
  try {
    const names = readdirSync(join(KIT, 'systemd'));
    const asInstance = (n) => n.replace('@.service', n.startsWith('taskapp-alert') ? '@test.service' : '@hourly.service');
    for (const n of names) writeFileSync(join(dir, asInstance(n)), read(`systemd/${n}`));
    const r = spawnSync('systemd-analyze', ['verify', ...names.map((n) => join(dir, asInstance(n)))], { encoding: 'utf8' });
    const problems = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l.trim() && !/is not executable: No such file or directory$/.test(l));
    assert.deepEqual(problems, []);
    // and the programs it could not find are exactly the ones this kit ships (or the pinned node)
    for (const m of `${r.stdout}${r.stderr}`.matchAll(/Command (\S+) is not executable/g)) {
      const p = m[1];
      assert.ok(p === '/opt/node/bin/node' || existsSync(join(KIT, 'bin', p.split('/').pop())), `${p} is not something this kit ships`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- scripts: static
test('scripts: parse, stop on errors, are executable, never run a string as a command, and never print a secret', () => {
  for (const f of scripts) {
    const name = relative(KIT, f), text = readFileSync(f, 'utf8'), code = strip(text);
    assert.equal(spawnSync('bash', ['-n', f]).status, 0, `${name} does not parse`);
    assert.match(text, /^#!\/usr\/bin\/env bash\n/, name);
    if (!name.endsWith('lib.sh')) { assert.match(text, /^set -euo pipefail$/m, `${name}: set -euo pipefail`); assert.ok(statSync(f).mode & 0o111, `${name} is not executable`); }
    assert.doesNotMatch(code, /\beval\b/, `${name}: eval`);
    assert.doesNotMatch(code, /\bbash -c "\$|\bsh -c "\$|\|\s*(ba)?sh\b/, `${name}: runs text as a command`);
    assert.doesNotMatch(code, /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\|\s*(python3?|node|perl|ruby|xargs|source|eval)\b/, `${name}: runs something it downloaded or piped`);
    assert.doesNotMatch(code, /echo[^\n]*\$\{?(BACKUP_KEY|ALERT_WEBHOOK_URL|HEALTHCHECK_PING_URL|GOOGLE_APPLICATION|RCLONE_CONFIG)/, `${name}: prints a secret`);
    assert.doesNotMatch(code, /(printf|log|die|alert)\b[^\n]*\$\{?(BACKUP_KEY|ALERT_WEBHOOK_URL|HEALTHCHECK_PING_URL)\b/, `${name}: logs a secret`);
    assert.doesNotMatch(code, /\bset -x\b|\bset -[a-z]*x/, `${name}: tracing would print secrets`);
    for (const m of code.matchAll(/\bchmod\s+(?:-R\s+)?(\S+)/g)) assert.match(m[1], /^[0-7]00$/, `${name}: chmod ${m[1]} gives access to someone other than the owner`);
    for (const m of code.matchAll(/rm -rf?\s+(?:-- )?("[^"]*"|\S+)/g)) assert.match(m[1], /scratch|\$\{?outbox|"\$f"|"\$file"|"\$out"/, `${name}: rm of ${m[1]} is not clearly a scratch path`);
  }
  assert.match(readFileSync(join(BIN, 'backup.sh'), 'utf8'), /rclone copyto --no-check-dest/);
  assert.doesNotMatch(readFileSync(join(BIN, 'backup.sh'), 'utf8'), /rclone (sync|move|delete|purge|deletefile)|gsutil (rm|mv|rsync)|\bcp -n/, 'the upload never deletes or moves anything remote');
});

test('Caddyfile: automatic https, only the local app port behind it, caller address set by the proxy, app headers passed through, no secrets', () => {
  const c = read('caddy/Caddyfile'), code = strip(c);
  assert.equal((code.match(/{/g) || []).length, (code.match(/}/g) || []).length, 'braces balance');
  assert.match(code, /^\{\$TASKAPP_DOMAIN\} \{/m, 'the site address is the domain setting');
  assert.doesNotMatch(code, /^\s*(http:\/\/|:80\b)/m, 'no plain-http site');
  assert.doesNotMatch(code, /auto_https\s+(off|disable_redirects)|tls\s+internal|skip_install_trust/);
  assert.equal([...code.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]).join(), '127.0.0.1:3000', 'one upstream, on this machine');
  assert.match(code, /header_up X-Forwarded-For \{remote_host\}/, 'overwrites the forwarded address');
  assert.match(code, /header_up -X-Real-IP/); assert.match(code, /header_up -Forwarded/);
  assert.doesNotMatch(code, /header_up Host/, 'Host passes through unchanged');
  for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'Permissions-Policy', 'Referrer-Policy', 'X-Content-Type-Options']) assert.doesNotMatch(code, new RegExp(h, 'i'), `Caddy must not set ${h}: the app's own is passed through`);
  assert.match(code, /header \{\s*-Server/);
  assert.match(code, /max_size 4MB/);
  assert.match(code, /request>uri delete/); assert.match(code, /request>headers delete/); assert.match(code, /Set-Cookie delete/);
  assert.match(code, /roll_size/); assert.match(code, /roll_keep /);
  assert.match(code, /admin localhost:2019/);
  assert.match(read('caddy/caddy-override.conf'), /EnvironmentFile=\/etc\/caddy\/taskapp-caddy\.env/);
  assert.match(read('caddy/caddy-override.conf'), /__REPLACE/);
  // what the app does with that header is proved in security-hardening.test.js (TRUST_PROXY); here, the app's headers really are the ones we rely on
  assert.match(readFileSync(join(ROOT, 'app/server/app.js'), 'utf8'), /Content-Security-Policy[\s\S]*Permissions-Policy[\s\S]*Strict-Transport-Security/);
});

test('journald settings keep logs for 14 days and 1 GB', () => {
  const j = read('logging/journald-taskapp.conf');
  assert.match(j, /^\[Journal\]$/m); assert.match(j, /^MaxRetentionSec=14day$/m); assert.match(j, /^SystemMaxUse=1G$/m); assert.match(j, /^Storage=persistent$/m);
});

// ---------------------------------------------------------------- firewall
const fw = (range, extra = {}) => spawnSync('bash', [join(BIN, 'install-firewall.sh')], { encoding: 'utf8', env: { PATH: process.env.PATH, ...(range === undefined ? {} : { SSH_RANGE: range }), ...extra } });
test('firewall: built with a stated SSH range, checked by nft, only 80, 443 and that range; refuses a missing, placeholder or open range', { skip: spawnSync('nft', ['--version']).status !== 0 }, () => {
  for (const [range, fam] of [['192.0.2.0/24', 'ip'], ['198.51.100.7', 'ip'], ['2001:db8::/32', 'ip6']]) {
    const r = fw(range);
    assert.equal(r.status, 0, `${range}: ${r.stderr}`);
    assert.match(r.stdout, /pass the syntax check/);
    const rules = r.stdout.slice(r.stdout.indexOf('table inet'));
    assert.match(rules, new RegExp(`${fam} saddr ${range.replace(/[.:/]/g, '\\$&')} tcp dport 22 ct state new limit rate 10/minute accept`));
    assert.match(rules, /policy drop/); assert.match(rules, /tcp dport \{ 80, 443 \} accept/);
    assert.equal((rules.match(/tcp dport/g) || []).length, 2, 'only the web rule and the ssh rule open a port');
    assert.doesNotMatch(strip(rules), /\b3000\b/, 'the app port is never opened');
    assert.doesNotMatch(strip(rules), /@SSH_RULE@/);
    assert.match(rules, /chain forward[\s\S]*policy drop/);
  }
  for (const bad of [undefined, '', '__REPLACE_WITH_RANGE__', '0.0.0.0/0', '::/0', '0.0.0.0/8', '10.0.0.0/4', 'not-an-address', '999.1.1.1/24', '192.0.2.0/33', '192.0.2.0/24; accept']) {
    const r = fw(bad);
    assert.notEqual(r.status, 0, `${bad} was accepted`);
    assert.doesNotMatch(r.stdout, /table inet/, `${bad}: rules were printed`);
  }
  assert.notEqual(spawnSync('bash', [join(BIN, 'install-firewall.sh'), '--wipe'], { encoding: 'utf8', env: { PATH: process.env.PATH, SSH_RANGE: '192.0.2.0/24' } }).status, 0);
  const t = readFileSync(join(KIT, 'firewall/taskapp.nft.template'), 'utf8');
  assert.equal((t.match(/@SSH_RULE@/g) || []).length, 1);
  assert.doesNotMatch(strip(t), /saddr/, 'the template has no address in it; the range is always supplied');
});

// ---------------------------------------------------------------- scripts: behaviour, with a fake rclone that uses folders
function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'kit-'));
  const live = join(dir, 'live'), remote = join(dir, 'remote'), fakebin = join(dir, 'fakebin'), state = join(dir, 'state'), outbox = join(dir, 'outbox');
  for (const d of [remote, fakebin, state, outbox]) mkdirSync(d, { recursive: true });
  const db = openDb(join(live, 'app.db')); migrate(db); seedDemo(db); db.close();
  const log = join(dir, 'rclone.log');
  writeFileSync(join(fakebin, 'rclone'), `#!/usr/bin/env bash
# a stand-in for rclone: "remote:bucket/path/NAME" is a file in $FAKE_REMOTE
echo "$*" >> "$FAKE_LOG"
[ -z "\${FAKE_RCLONE_FAIL:-}" ] || { echo "simulated failure" >&2; exit 1; }
map() { echo "$FAKE_REMOTE/$(basename "$1")"; }
case "$1" in
  copyto) shift; args=(); for a in "$@"; do case "$a" in --*) ;; *) args+=("$a");; esac; done
          if [[ "\${args[0]}" == remote:* ]]; then cp "$(map "\${args[0]}")" "\${args[1]}"; else cp "\${args[0]}" "$(map "\${args[1]}")"; fi ;;
  lsf) ls "$FAKE_REMOTE" ;;
  *) echo "unexpected rclone command: $*" >&2; exit 9 ;;
esac
`, { mode: 0o755 });
  const key = randomBytes(32).toString('hex');
  const env = { PATH: `${fakebin}:${process.env.PATH}`, HOME: dir, npm_config_cache: join(dir, '.npm'), npm_config_update_notifier: 'false',
    DB_PATH: join(live, 'app.db'), PORT: '3000', BACKUP_KEY: key, BACKUP_DEST: `file:${outbox}`, UPLOAD_TOOL: 'rclone', UPLOAD_TARGET: 'remote:bucket/path',
    STATE_DIR: state, APP_DIR: ROOT, FAKE_REMOTE: remote, FAKE_LOG: log, NODE_BIN: process.execPath, NODE_VERSION_PIN: process.version.slice(1) };
  return { dir, live, remote, state, outbox, log, key, env, db: join(live, 'app.db'), done: () => rmSync(dir, { recursive: true, force: true }) };
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
const names = (dir) => readdirSync(dir).filter((n) => n.startsWith('backup-'));

test('backup.sh: takes a checked copy, uploads it with a create-only command, clears the staging folder, records the time; the file restores with the same counts', async () => {
  const r = rig();
  try {
    const out = await run('backup.sh', ['hourly'], r.env);
    assert.equal(out.code, 0, out.stderr + out.stdout);
    assert.deepEqual(names(r.remote).length, 1);
    assert.match(names(r.remote)[0], /^backup-hourly-\d{8}T\d{6}Z\.db\.gz\.enc$/);
    assert.deepEqual(names(r.outbox), [], 'the local copy is removed after a successful upload');
    assert.ok(Number(readFileSync(join(r.state, 'last-success'), 'utf8')) > Date.now() / 1000 - 120);
    assert.ok(existsSync(join(r.state, 'last-success-hourly')));
    const calls = readFileSync(r.log, 'utf8').trim().split('\n');
    assert.equal(calls.length, 1); assert.match(calls[0], /^copyto --no-check-dest \S+ remote:bucket\/path\/backup-hourly-/);
    assert.ok(!out.stdout.includes(r.key) && !out.stderr.includes(r.key) && !readFileSync(r.log, 'utf8').includes(r.key), 'the key appears nowhere in output or in the upload command');
    // the uploaded file is a real backup: restore it and compare with the live database
    const restored = join(r.dir, 'restored.db');
    await runRestore({ key: keyFrom(r.key), destination: new LocalDirDestination(r.remote), from: names(r.remote)[0], to: restored });
    const a = new DatabaseSync(r.db, { readOnly: true }), b = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(tableCounts(b), tableCounts(a)); a.close(); b.close();
    assert.equal((await run('backup.sh', ['daily'], r.env)).code, 0);
    assert.equal(names(r.remote).length, 2);
  } finally { r.done(); }
});

test('backup.sh: a failed upload keeps the copy, raises an alert, does not record success, and the next run sends the leftovers', async () => {
  const r = rig(); const hook = await webhook();
  try {
    const env = { ...r.env, ALERT_WEBHOOK_URL: hook.url };
    const bad = await run('backup.sh', ['hourly'], { ...env, FAKE_RCLONE_FAIL: '1' });
    assert.equal(bad.code, 1);
    assert.equal(names(r.outbox).length, 1, 'the finished copy stays on the machine');
    assert.equal(names(r.remote).length, 0);
    assert.ok(!existsSync(join(r.state, 'last-success')), 'no success is recorded');
    assert.equal(hook.got.length, 1);
    assert.equal(hook.got[0].method, 'POST'); assert.equal(hook.got[0].type, 'application/json');
    const msg = JSON.parse(hook.got[0].body).text;
    assert.match(msg, /could not be uploaded/);
    assert.ok(!msg.includes(r.key) && !msg.includes(r.dir), 'the alert holds no key and no path');
    await new Promise((res) => setTimeout(res, 1100));   // names carry the second, so a retry in the same second would be refused as a duplicate
    const good = await run('backup.sh', ['hourly'], env);
    assert.equal(good.code, 0, good.stderr);
    assert.equal(names(r.remote).length, 2, 'the leftover and the new copy both went up');
    assert.deepEqual(names(r.outbox), []);
    assert.equal(hook.got.length, 1, 'no new alert on success');
  } finally { await hook.close(); r.done(); }
});

test('backup.sh: a copy that cannot be made (bad key) uploads nothing and alerts; placeholders, odd kinds and odd tools are refused before anything runs', async () => {
  const r = rig(); const hook = await webhook();
  try {
    const env = { ...r.env, ALERT_WEBHOOK_URL: hook.url };
    const bad = await run('backup.sh', ['hourly'], { ...env, BACKUP_KEY: 'too-short' });
    assert.equal(bad.code, 1); assert.equal(names(r.remote).length, 0); assert.equal(hook.got.length, 1);
    assert.match(JSON.parse(hook.got[0].body).text, /failed while taking or checking the copy/);
    assert.ok(!existsSync(r.log), 'rclone was never called');
    for (const [name, patch, args] of [['placeholder key', { BACKUP_KEY: '__REPLACE_WITH_OUTPUT_OF_npm_run_backup_keygen__' }, ['hourly']], ['placeholder target', { UPLOAD_TARGET: '__REPLACE_WITH_DESTINATION__' }, ['hourly']],
      ['unset tool', { UPLOAD_TOOL: '' }, ['hourly']], ['odd tool', { UPLOAD_TOOL: 'rclone; touch pwned' }, ['hourly']], ['sh as tool', { UPLOAD_TOOL: 'sh' }, ['hourly']],
      ['odd kind', {}, ['weekly']], ['no kind', {}, []], ['injection kind', {}, ['hourly; touch pwned']], ['not a staging folder', { BACKUP_DEST: 's3://bucket' }, ['hourly']]]) {
      const x = await run('backup.sh', args, { ...env, ...patch });
      assert.notEqual(x.code, 0, name);
      assert.equal(names(r.remote).length, 0, name);
      assert.ok(!existsSync(join(ROOT, 'pwned')) && !existsSync(join(r.dir, 'pwned')), name);
    }
    const placeholder = await run('backup.sh', ['hourly'], { ...env, BACKUP_KEY: '__REPLACE_X__' });
    assert.match(placeholder.stderr, /placeholder/);
  } finally { await hook.close(); r.done(); }
});

test('backup.sh: files that are not backups are never uploaded, and a second run at the same time just skips', async () => {
  const r = rig();
  try {
    writeFileSync(join(r.outbox, 'notes.txt'), 'not a backup'); writeFileSync(join(r.outbox, 'backup-hourly-bad.enc'), 'wrong name shape');
    assert.equal((await run('backup.sh', ['hourly'], r.env)).code, 0);
    assert.equal(names(r.remote).length, 1);
    assert.ok(existsSync(join(r.outbox, 'notes.txt')) && existsSync(join(r.outbox, 'backup-hourly-bad.enc')), 'strangers are left alone');
    assert.ok(!readFileSync(r.log, 'utf8').includes('notes.txt'));
    const holder = spawn('flock', [join(r.state, 'backup.lock'), 'sleep', '4'], { stdio: 'ignore' });
    await new Promise((res) => setTimeout(res, 400));
    const skipped = await run('backup.sh', ['hourly'], r.env);
    assert.equal(skipped.code, 0); assert.match(skipped.stdout, /another backup is running; skipping/);
    assert.equal(names(r.remote).length, 1, 'nothing new was taken');
    holder.kill();
  } finally { r.done(); }
});

const stamp = (epoch) => new Date(epoch * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
test('backup-check.sh: alerts when the newest backup is older than 3 hours, when there is none, or when copies are stuck; quiet when fresh', async () => {
  const r = rig(); const hook = await webhook();
  try {
    const now = 1900000000, env = { ...r.env, ALERT_WEBHOOK_URL: hook.url, NOW_EPOCH: String(now), MAX_AGE_SECONDS: '10800' };
    const check = (e = {}) => run('backup-check.sh', [], { ...env, ...e });
    let x = await check(); assert.equal(x.code, 2); assert.match(JSON.parse(hook.got.at(-1).body).text, /no backup has been recorded/);
    writeFileSync(join(r.state, 'last-success'), `${now - 3600}\n`);
    x = await check(); assert.equal(x.code, 0, x.stderr); assert.match(x.stdout, /1\.0 hours old/); const n1 = hook.got.length;
    writeFileSync(join(r.state, 'last-success'), `${now - 10800}\n`); assert.equal((await check()).code, 0, 'exactly 3 hours is still allowed');
    writeFileSync(join(r.state, 'last-success'), `${now - 4 * 3600 - 1800}\n`);
    x = await check(); assert.equal(x.code, 2); assert.equal(hook.got.length, n1 + 1);
    assert.match(JSON.parse(hook.got.at(-1).body).text, /4\.5 hours old \(limit 3\.0\)/);
    // finished copies waiting in the staging folder for more than 3 hours
    writeFileSync(join(r.state, 'last-success'), `${now - 60}\n`);
    const stuck = join(r.outbox, 'backup-hourly-20300101T000000Z.db.gz.enc'); writeFileSync(stuck, 'x');
    const old = new Date(Date.now() - 5 * 3600 * 1000); utimesSync(stuck, old, old);
    x = await check(); assert.equal(x.code, 2); assert.match(JSON.parse(hook.got.at(-1).body).text, /stuck in the staging folder/);
    rmSync(stuck);
    assert.equal((await check()).code, 0);
    assert.equal((await check({ MAX_AGE_SECONDS: 'abc' })).code, 1);
    // from another machine, reading the destination's file names
    const listed = (...ages) => { for (const f of readdirSync(r.remote)) rmSync(join(r.remote, f)); for (const a of ages) writeFileSync(join(r.remote, `backup-hourly-${stamp(now - a)}.db.gz.enc`), 'x'); writeFileSync(join(r.remote, 'README.txt'), 'ignored'); writeFileSync(join(r.remote, 'backup-hourly-99999999T999999Z.db.gz.enc'), 'bad stamp'); };
    listed(7200, 90000, 100); rmSync(join(r.remote, readdirSync(r.remote).find((n) => n.includes(stamp(now - 100)))));   // newest real one: 2 hours ago
    x = await check({ CHECK_REMOTE: '1', STATE_DIR: join(r.dir, 'nowhere') }); assert.equal(x.code, 0, x.stderr + x.stdout); assert.match(x.stdout, /2\.0 hours old/);
    listed(11000, 50000); x = await check({ CHECK_REMOTE: '1', STATE_DIR: join(r.dir, 'nowhere') }); assert.equal(x.code, 2); assert.match(JSON.parse(hook.got.at(-1).body).text, /3\.1 hours old/);
    x = await check({ CHECK_REMOTE: '1', FAKE_RCLONE_FAIL: '1' }); assert.equal(x.code, 1); assert.match(JSON.parse(hook.got.at(-1).body).text, /could not list/);
    for (const f of readdirSync(r.remote)) rmSync(join(r.remote, f));
    x = await check({ CHECK_REMOTE: '1' }); assert.equal(x.code, 2); assert.match(JSON.parse(hook.got.at(-1).body).text, /no backup/);
  } finally { await hook.close(); r.done(); }
});

function drillRig(r, port) {
  const envFile = join(r.dir, 'taskapp.env'), drillEnv = join(r.dir, 'drill.env');
  writeFileSync(envFile, `DB_PATH=${r.db}\nPORT=3000\nBACKUP_KEY=${r.key}\n`);
  writeFileSync(drillEnv, `DRILL_TOOL=rclone\nDRILL_SOURCE=remote:bucket/path\nDRILL_DIR=${join(r.dir, 'drill-scratch')}\nDRILL_PORT=${port}\n`);
  return { env: { ...r.env, TASKAPP_ENV_FILE: envFile, TASKAPP_DRILL_ENV_FILE: drillEnv }, envFile, drillEnv, scratch: join(r.dir, 'drill-scratch') };
}
test('restore-drill.sh: fetches a real backup, restores it to a scratch folder, starts a throw-away app that answers, removes everything, and leaves the live database alone', async () => {
  const r = rig();
  try {
    assert.equal((await run('backup.sh', ['hourly'], r.env)).code, 0);
    assert.equal((await run('backup.sh', ['daily'], r.env)).code, 0);
    const d = drillRig(r, await freePort());
    const before = (() => { const x = new DatabaseSync(r.db, { readOnly: true }); const c = tableCounts(x); x.close(); return JSON.stringify(c); })();
    const liveFiles = readdirSync(r.live).sort().join();
    const out = await run('restore-drill.sh', [], d.env);
    assert.equal(out.code, 0, out.stderr + out.stdout);
    assert.match(out.stdout, /DRILL PASSED/); assert.match(out.stdout, /backup-(hourly|daily)-\d{8}T\d{6}Z\.db\.gz\.enc restored/);
    assert.ok(!existsSync(d.scratch), 'the scratch folder is gone');
    assert.ok(!out.stdout.includes(r.key) && !out.stderr.includes(r.key));
    const after = (() => { const x = new DatabaseSync(r.db, { readOnly: true }); const c = tableCounts(x); x.close(); return JSON.stringify(c); })();
    assert.equal(after, before, 'the live database is unchanged'); assert.equal(readdirSync(r.live).sort().join(), liveFiles, 'no new file next to the live database');
    // a named backup
    const name = names(r.remote).sort().at(0);
    const named = await run('restore-drill.sh', [name], d.env); assert.equal(named.code, 0, named.stderr); assert.match(named.stdout, new RegExp(name.replace(/\./g, '\\.')));
    // it picks the NEWEST by the time in the name, not by kind or by file order
    for (const f of names(r.remote)) rmSync(join(r.remote, f));
    const copy = (n, t) => writeFileSync(join(r.remote, `backup-${n}-${stamp(t)}.db.gz.enc`), readFileSync(join(r.dir, 'seed.enc')));
    assert.equal((await run('backup.sh', ['monthly'], r.env)).code, 0);
    const only = names(r.remote)[0]; writeFileSync(join(r.dir, 'seed.enc'), readFileSync(join(r.remote, only)));
    rmSync(join(r.remote, only));
    copy('hourly', 1700000000); copy('monthly', 1800000000); copy('daily', 1750000000);
    const newest = await run('restore-drill.sh', [], d.env);
    assert.equal(newest.code, 0, newest.stderr); assert.match(newest.stdout, new RegExp(`backup-monthly-${stamp(1800000000)}`));
  } finally { r.done(); }
});

test('restore-drill.sh: the wrong key, a damaged backup, an empty destination and every unsafe setting stop it, and the scratch folder is always cleaned', async () => {
  const r = rig();
  try {
    assert.equal((await run('backup.sh', ['hourly'], r.env)).code, 0);
    const d = drillRig(r, await freePort());
    const wrong = { ...d.env }; writeFileSync(d.envFile, `DB_PATH=${r.db}\nPORT=3000\nBACKUP_KEY=${randomBytes(32).toString('hex')}\n`);
    let x = await run('restore-drill.sh', [], wrong);
    assert.notEqual(x.code, 0); assert.match(x.stderr + x.stdout, /DRILL FAILED: the backup did not restore/); assert.ok(!existsSync(d.scratch));
    writeFileSync(d.envFile, `DB_PATH=${r.db}\nPORT=3000\nBACKUP_KEY=${r.key}\n`);
    const f = join(r.remote, names(r.remote)[0]); const bytes = readFileSync(f); bytes[bytes.length >> 1] ^= 1; writeFileSync(f, bytes);
    x = await run('restore-drill.sh', [], d.env); assert.notEqual(x.code, 0); assert.match(x.stderr + x.stdout, /did not restore/); assert.ok(!existsSync(d.scratch));
    rmSync(f);
    x = await run('restore-drill.sh', [], d.env); assert.notEqual(x.code, 0); assert.match(x.stderr, /no backups found/);
    assert.equal(readdirSync(r.live).sort().join(), 'app.db,app.db-shm,app.db-wal'.split(',').filter((n) => existsSync(join(r.live, n))).join());
    const nested = join(r.dir, 'drill-parent'); mkdirSync(join(nested, 'live'), { recursive: true });
    const cases = [
      ['no drill in the name', `DRILL_DIR=${join(r.dir, 'scratch')}`, /'drill' in its name/], ['the live folder', `DRILL_DIR=${r.live}`, /'drill' in its name/],
      ['a folder inside the live one', `DRILL_DIR=${join(r.live, 'drill-x')}`, /inside the live database folder/],
      ['a folder containing the live one', `DRILL_DIR=${nested}`, /contains the live database folder/, `DB_PATH=${join(nested, 'live', 'app.db')}`],
      ['root', 'DRILL_DIR=/', /'drill' in its name/], ['the live port', 'DRILL_PORT=3000', /must differ from the live PORT/], ['placeholder source', 'DRILL_SOURCE=__REPLACE_WITH_DESTINATION__', /placeholder/],
      ['odd tool', 'DRILL_TOOL=sh', /must be rclone or gsutil/], ['relative folder', 'DRILL_DIR=drill-scratch', /absolute path/]];
    for (const [name, drill, expected, dbPath] of cases) {
      const base = readFileSync(d.drillEnv, 'utf8').split('\n').filter((l) => !l.startsWith(`${drill.split('=')[0]}=`)).concat(drill).join('\n');
      const f2 = join(r.dir, 'drill-unsafe.env'); writeFileSync(f2, base);
      const envFile = join(r.dir, 'unsafe-taskapp.env'); writeFileSync(envFile, `DB_PATH=${dbPath ? dbPath.slice(8) : r.db}\nPORT=3000\nBACKUP_KEY=${r.key}\n`);
      x = await run('restore-drill.sh', [], { ...d.env, TASKAPP_DRILL_ENV_FILE: f2, TASKAPP_ENV_FILE: envFile });
      assert.notEqual(x.code, 0, name); assert.match(x.stderr, expected, `${name}: stopped for the right reason (${x.stderr.trim()})`);
      assert.ok(existsSync(r.db), `${name}: the live database is still there`); assert.ok(existsSync(r.live) && existsSync(r.dir), `${name}: nothing was deleted`);
    }
    x = await run('restore-drill.sh', ['../../etc/passwd'], d.env); assert.notEqual(x.code, 0); assert.match(x.stderr, /not a backup file name/);
    x = await run('restore-drill.sh', [], { ...d.env, TASKAPP_ENV_FILE: join(r.dir, 'missing.env') }); assert.notEqual(x.code, 0);
  } finally { r.done(); }
});

test('check-node.sh, alert.sh: the wrong Node stops the service; an alert is one JSON post with nothing but the message', async () => {
  const r = rig(); const hook = await webhook();
  try {
    let x = await run('check-node.sh', [], r.env); assert.equal(x.code, 0, x.stderr); assert.match(x.stdout, /node v\d+\.\d+\.\d+ ok/);
    x = await run('check-node.sh', [], { ...r.env, NODE_VERSION_PIN: '20.0.0' }); assert.notEqual(x.code, 0); assert.match(x.stderr, /pinned to v20\.0\.0/);
    x = await run('check-node.sh', [], { ...r.env, NODE_VERSION_PIN: '' }); assert.notEqual(x.code, 0);
    x = await run('check-node.sh', [], { ...r.env, NODE_BIN: join(r.dir, 'no-node') }); assert.notEqual(x.code, 0);
    const app = join(r.dir, 'app'); mkdirSync(app); writeFileSync(join(app, '.nvmrc'), '22.1.1\n');
    x = await run('check-node.sh', [], { ...r.env, APP_DIR: app }); assert.notEqual(x.code, 0); assert.match(x.stderr, /differs from \.nvmrc/);
    const pin = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
    const real = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' }).stdout.trim() === `v${pin}`;
    x = await run('check-node.sh', [], { ...r.env, NODE_VERSION_PIN: pin }); assert.equal(x.code === 0, real, 'the pin in .nvmrc is checked against the real Node');
    x = await run('alert.sh', ['unit taskapp.service failed "quoted" \\ back'], { ...r.env, ALERT_WEBHOOK_URL: hook.url });
    assert.equal(x.code, 0); assert.equal(hook.got.length, 1);
    const body = JSON.parse(hook.got[0].body); assert.deepEqual(Object.keys(body), ['text']); assert.match(body.text, /unit taskapp\.service failed "quoted" \\ back/);
    x = await run('alert.sh', ['no webhook configured'], { ...r.env, ALERT_WEBHOOK_URL: '' }); assert.equal(x.code, 0); assert.match(x.stderr, /ALERT: no webhook configured/);
    x = await run('alert.sh', ['webhook is down'], { ...r.env, ALERT_WEBHOOK_URL: 'http://127.0.0.1:1/none' }); assert.equal(x.code, 0, 'a dead webhook must not make the alert step fail');
  } finally { await hook.close(); r.done(); }
});
