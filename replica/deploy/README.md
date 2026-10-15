# Deployment kit for one small VM (files only)

**Nothing in this folder has been run on a real machine.** It creates no account, buys nothing, calls no cloud service and deploys
nothing. Every secret is a placeholder; fill in the real values yourself, on the server, in files outside git. The app is not
certified to any standard and has not been penetration tested. Read `../hosting-plan.md` (the reasoning, and what the Playbook
does NOT state) and `../runbook.md` (day-to-day operation) first.

The installed names (user, folders, units, settings files) all say `taskapp`. That is deliberately not the product name, so a rename never touches a server.

## What is here

| file | what it is |
| --- | --- |
| `systemd/taskapp.service` | the app: own non-root user, read-only code, one writable folder, no capabilities, system-call filter, restart on failure, alert on repeated failure, refuses to start on the wrong Node |
| `systemd/taskapp-backup@.service` | one backup run; the name after `@` is the kind (hourly, daily, monthly, premigration) |
| `systemd/taskapp-backup-{hourly,daily,monthly}.timer` | the schedules (07 past every hour; 00:17 daily; 00:27 on the 1st) |
| `systemd/taskapp-backup-check.{service,timer}` | every 30 minutes: alert if the newest backup is older than 3 hours |
| `systemd/taskapp-alert@.service` | what runs when another unit fails: sends one alert |
| `etc/*.env.example` | the settings, all placeholders: `taskapp.env` (PUBLIC_URL, TRUST_PROXY, SESSION_IDLE_MINUTES, BACKUP_KEY, Node pin), `backup-upload.env` (how backups leave, who is alerted), `restore-drill.env` (read-only credential for drills) |
| `caddy/` | `Caddyfile` (automatic HTTPS, only 127.0.0.1:3000 behind it, headers passed through), `caddy.env.example`, `caddy-override.conf` |
| `firewall/taskapp.nft.template` | host firewall: 80, 443, and SSH from one stated range; the app port is never open |
| `logging/journald-taskapp.conf` | log retention (14 days, 1 GB). Caddy rotates its own access log |
| `bin/backup.sh` | `npm run backup`, then upload with a create-only credential (rclone or gsutil), remove the local copy only after success, record the time, alert on failure |
| `bin/backup-check.sh` | the 3-hour freshness check (local record, or `CHECK_REMOTE=1` from another machine) |
| `bin/restore-drill.sh` | fetch, restore to a scratch folder, start a throw-away app, check it answers, delete it all. Never touches the live database |
| `bin/install-firewall.sh` | puts your SSH range into the template, checks it with `nft -c`, loads it only if you pass `--apply` or `--persist` |
| `bin/check-node.sh`, `alert.sh`, `lib.sh` | Node pin check, one-line alert, shared helpers |

## Order of steps

Each step says whether it is on the server (S), on your own computer (C) or in an account of yours (A). This kit does none of the A steps.

**0. Decide first (C).** Domain and who controls its DNS; region; where backups go and which tool (rclone or gsutil); the address range that may use SSH;
where alerts go; who holds the second copy of the backup key. These are open decisions in `../hosting-plan.md`.

**1. Get a machine (A).** One Linux server with systemd 250 or newer (for example a current Debian or Ubuntu LTS), a persistent disk, a public address, and
your domain pointing at it. Turn on the provider's disk encryption if it has one. Also set the provider's own network firewall to the same rule as step 6 if it has one.

**2. User and folders (S, as root).**
```
useradd --system --home-dir /var/lib/taskapp --shell /usr/sbin/nologin taskapp
install -d -o taskapp -g taskapp -m 0700 /var/lib/taskapp /var/lib/taskapp-backup /var/lib/taskapp-backup/outbox
install -d -o root -g root -m 0755 /opt/taskapp /opt/taskapp/releases /etc/taskapp
install -d -o root -g root -m 0750 /var/log/caddy
```

**3. The pinned Node (S).** Download Node 22.22.0 for Linux from nodejs.org together with its `SHASUMS256.txt`, check the checksum
(`sha256sum -c --ignore-missing SHASUMS256.txt`), unpack to `/opt/node-v22.22.0-linux-x64`, then `ln -sfn /opt/node-v22.22.0-linux-x64 /opt/node`.
`/opt/node/bin/node --version` must print `v22.22.0`. The same number is in `.nvmrc` and in `NODE_VERSION_PIN`; the units refuse to run on any other.

**4. The code (S, as root).** From a tagged commit, so it is exactly what was tested:
```
git clone --branch <tag> <your repository address> /opt/taskapp/releases/<tag>
cd /opt/taskapp/releases/<tag> && PATH=/opt/node/bin:$PATH npm ci --omit=dev
ln -sfn /opt/taskapp/releases/<tag> /opt/taskapp/current
```
The code stays owned by root: the service can read it and cannot change it.

**5. Settings (S, as root).** Copy each example, edit it, and lock it:
```
install -m 0600 -o root -g root etc/taskapp.env.example       /etc/taskapp/taskapp.env
install -m 0600 -o root -g root etc/backup-upload.env.example  /etc/taskapp/backup-upload.env
install -m 0600 -o root -g root etc/restore-drill.env.example  /etc/taskapp/restore-drill.env
install -m 0600 -o root -g root caddy/caddy.env.example        /etc/caddy/taskapp-caddy.env
```
Replace every `__REPLACE_...__`. Make the backup key with `npm run backup:keygen` (it prints once, stores nothing) and put a second copy off this machine
before going further. Do not put any of these files in git.

**6. Firewall (S).** Check first, then apply with a second SSH session open:
```
SSH_RANGE=<your range> /opt/taskapp/current/replica/deploy/bin/install-firewall.sh            # check only
SSH_RANGE=<your range> /opt/taskapp/current/replica/deploy/bin/install-firewall.sh --apply    # loaded, not saved
# open a NEW ssh session and confirm you can still get in; then
SSH_RANGE=<your range> /opt/taskapp/current/replica/deploy/bin/install-firewall.sh --persist
```

**7. Units (S).**
```
cp /opt/taskapp/current/replica/deploy/systemd/* /etc/systemd/system/
install -d /etc/systemd/journald.conf.d && cp /opt/taskapp/current/replica/deploy/logging/journald-taskapp.conf /etc/systemd/journald.conf.d/taskapp.conf
systemctl restart systemd-journald && systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/taskapp.service /etc/systemd/system/taskapp-backup@hourly.service
```

**8. The first owner (S).** Once, in a terminal, before the app starts. This prints a one-time password once; copy it.
```
bash -c 'set -a; . /etc/taskapp/taskapp.env; set +a; cd /opt/taskapp/current && exec setpriv --reuid=taskapp --regid=taskapp --init-groups \
  env PATH=/opt/node/bin:/usr/bin:/bin HOME=/var/lib/taskapp npm_config_cache=/var/lib/taskapp/.npm \
  npm run first-owner -- --workspace "Your Company" --name "Your Name" --email you@your-company.example'
```
Never run `npm run seed` here.

**9. Start the app (S).** `systemctl enable --now taskapp`, then `journalctl -u taskapp -n 30` and
`curl -fsS http://127.0.0.1:3000/api/v1/health`. It is reachable only from this machine at this point.

**10. Caddy (S).** Install Caddy from its own distribution package (not part of this kit). Then:
```
cp /opt/taskapp/current/replica/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d && cp /opt/taskapp/current/replica/deploy/caddy/caddy-override.conf /etc/systemd/system/caddy.service.d/override.conf
systemctl daemon-reload
( set -a; . /etc/caddy/taskapp-caddy.env; set +a; caddy validate --config /etc/caddy/Caddyfile )
systemctl enable --now caddy
curl -fsS https://<your domain>/api/v1/health
```
`caddy validate` must pass before you start it. Then sign in with the owner, change the password under Account, and look at the response headers
(`curl -sI https://<your domain>/`): the app's own `Content-Security-Policy`, `Strict-Transport-Security` and `Permissions-Policy` should all be there, and no `Server`.

**11. Backups (S, then A for the credential).**
1. In your own account, create a credential that can **only add files** to the backup location (no read, no list, no overwrite, no delete), and a bucket
   with retention or versioning plus a lifecycle rule that keeps the last 48 `backup-hourly-`, 30 `backup-daily-`, 12 `backup-monthly-` and 5 `backup-premigration-` files.
2. Put the credential file where `backup-upload.env` says, root-owned, mode 0600.
3. **Prove it is write-only:** with that credential try to list and to delete (`rclone lsf <target>`, or `gsutil ls <target>/`). Both must fail. If either works, the credential is too strong: fix it before continuing.
4. `systemctl start taskapp-backup@hourly.service`, then `journalctl -u 'taskapp-backup@hourly' -n 30`. It should say it uploaded one file.
5. `systemctl enable --now taskapp-backup-hourly.timer taskapp-backup-daily.timer taskapp-backup-monthly.timer taskapp-backup-check.timer`
6. Make the dead-man's-switch address (`HEALTHCHECK_PING_URL`) and the alert webhook real, then test the alert path once: `systemctl start taskapp-alert@test.service`.

**12. Restore drill (S, before any real data).** Use a separate, read-and-list-only credential in `restore-drill.env`:
`sudo -u taskapp /opt/taskapp/current/replica/deploy/bin/restore-drill.sh`. It must end with `DRILL PASSED`. Write the date and result in `replica/ops-log.md`. Try it once with a wrong
`BACKUP_KEY` to see it refuse. Repeat monthly.

**13. Go-live checks (S and C).** Health answers over https; the owner can sign in and the audit log shows it; `ss -ltn` shows port 3000 on 127.0.0.1 only; from another machine, ports other than 80 and 443
(and SSH from your range) time out; a deliberate wrong-password burst from your own address is rate limited and recorded once with a count; `systemctl list-timers 'taskapp*'` shows all four timers; the freshness check passes
(`systemctl start taskapp-backup-check.service`).

## Updating

`systemctl start taskapp-backup@premigration.service`, then repeat step 4 with the new tag (new folder, new `current` link), `systemctl restart taskapp`, check health and the audit log. To go back: stop, restore the premigration backup (see `../runbook.md`), point `current` at the old folder.

## What was and was not tested

Tested in this repository (`app/tests/deploy-kit.test.js`): every shell script parses; the unit files are checked structurally and with `systemd-analyze` where it can run;
the firewall template is built with a documentation address range and checked with `nft -c` where that can run; the Caddyfile is checked for the required directives; no file holds a secret, a real address
or a key-shaped string; the settings examples work as both systemd and shell files; the Node pin equals `.nvmrc`; the backup, freshness-check and restore-drill scripts are run end to end against a **fake** `rclone` that uses folders (real encrypted
backups made by the app, a real restore, a real throw-away app); and the scripts refuse placeholders.

**Not tested:** anything on a real machine, systemd actually running these units, Caddy itself (it is not installed here, so `caddy validate` is your step 10), real rclone or gsutil, real cloud permissions (whether a credential is truly write-only
is yours to prove in step 11), real firewall behaviour, certificate issue, and the alert webhook. Treat the first install as a rehearsal on a machine with no real data.
