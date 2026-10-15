# Deployment kit for one small VM (files only)

**Nothing in this folder has been run on a real machine.** It creates no account, buys nothing, calls no cloud service and deploys
nothing. Every secret is a placeholder or a file you create yourself, on the server, outside git. The app is not
certified to any standard and has not been penetration tested. Read `../hosting-plan.md` (the reasoning, and what the Playbook
does NOT state) and `../runbook.md` (day-to-day operation) first. This kit was reworked after an independent review found real
problems in the first version (see `../security.md`, findings D1 to D16); it is **still untested on a real machine**.

The installed names (users, folders, units, settings files) all say `taskapp`. That is deliberately not the product name, so a rename never touches a server.

## The idea in one paragraph

Two unprivileged users. **`taskapp`** runs the app and nothing else: it holds the database, and it can see no credential, no key and no alert address. **`taskapp-backup`**
runs the backup, the upload, the freshness check, the restore drill and the alerts: it holds the backup key and the storage credentials (each delivered by systemd as a
private file for the one unit that needs it, with `LoadCredential=`), and it cannot see the live database. They meet in one folder: step 1 of a backup (as `taskapp`) leaves a checked, plain snapshot
there; step 2 (as `taskapp-backup`) checks it again, encrypts it, uploads it with a create-only credential and deletes it. Three storage identities, each able to do one thing:
the **uploader** can only add files, the **checker** can only list names, the **drill** can only list and read. An exploited app therefore cannot read the key, the credentials or the history,
and cannot erase or overwrite a backup; and someone who steals the upload credential can add files but cannot read, list, delete or replace anything.

## What is here

| file | what it is |
| --- | --- |
| `systemd/taskapp.service` | the app: own user, read-only code, one writable folder, no capabilities, system-call filter, `PrivateUsers`, no network except this machine, the credentials folder not visible, restart on failure, alert on repeated failure, refuses to start on the wrong Node |
| `systemd/taskapp-snapshot@.service` | backup step 1, as the app user: a consistent, checked, plain copy into the shared snapshot folder. No key, no credential, no network |
| `systemd/taskapp-backup@.service` | backup step 2, as the backup user: check, encrypt (kind and time inside the authenticated header), upload, delete the plain copy, record the time. `scheduled` or `premigration` |
| `systemd/taskapp-backup.timer` | the ONE timer: every hour at 07 past. The script makes the hourly copy, the daily copy at the first run at or after `DAILY_HOUR`, and the monthly copy at the first run each month |
| `systemd/taskapp-backup-check.{service,timer}` | every 30 minutes: alert if the newest hourly (3 h), daily (26 h) or monthly (32 days) copy is too old or missing, if a name claims to be from the future, or if copies are stuck. Uses the list-only credential |
| `systemd/taskapp-restore-drill.service` | the restore drill, run by hand, as the backup user, with the read-only credential |
| `systemd/taskapp-storage-check@.service` | proves what each storage identity can and cannot do (`uploader`, `checker`, `drill`) |
| `systemd/taskapp-alert@.service` | what runs when another unit fails: sends one alert |
| `etc/app.env.example`, `etc/backup.env.example`, `caddy/caddy.env.example` | the settings, placeholders only. **No secret in any of them.** The app refuses to start while a placeholder is left |
| `caddy/` | `Caddyfile` (automatic HTTPS, admin API off, only 127.0.0.1:3000 behind it, caller address set by Caddy, the app's own headers passed through), `caddy-override.conf` |
| `firewall/taskapp.nft.template`, `bin/install-firewall.sh` | host firewall: 80, 443 and SSH from one range you state (IPv4 no wider than /16, IPv6 no wider than /48), SSH slowed per source address; the app port is never open |
| `ssh/10-taskapp.conf` | key-only SSH hardening |
| `gcs/lifecycle.json` | age-based clean-up of the backup bucket by name prefix (replaces "keep the last N") |
| `logging/journald-taskapp.conf` | log retention (14 days, 1 GB). Caddy rotates its own access log |
| `bin/snapshot.sh`, `backup.sh`, `backup-check.sh`, `restore-drill.sh`, `verify-storage.sh` | the scripts the units run |
| `bin/install-credential.sh` | installs one credential as a root-only file, reading the value from standard input (never a command line) |
| `bin/app-cli.sh` | runs first-owner or break-glass as the app user in a clean environment, from root |
| `bin/check-node.sh`, `alert.sh`, `lib.sh` | Node pin check, one-line alert, shared helpers |

## Order of steps

Each step says whether it is on the server (S), on your own computer (C) or in an account of yours (A). This kit does none of the A steps.

**0. Decide first (C).** Domain and who controls its DNS; region; the separate Google Cloud project for backups; the address range that may use SSH; where alerts go; who holds the second copy of the backup key.
These are open decisions in `../hosting-plan.md`.

**1. Get a machine (A).** One Linux server with systemd 250 or newer (for example a current Debian or Ubuntu LTS), a persistent disk, a public address, and your domain pointing at it. Turn on the provider's disk encryption if it has one.
Also set the provider's own network firewall to the same rule as step 6 if it has one. **The VM's own service account must have no access to the backup project** (or any other): attach none, or one with no roles.

**2. Users, groups and folders (S, as root).**
```
groupadd --system taskapp-backup
useradd --system --home-dir /var/lib/taskapp --shell /usr/sbin/nologin --user-group taskapp
useradd --system --home-dir /var/lib/taskapp-backup --shell /usr/sbin/nologin --gid taskapp-backup taskapp-backup
install -d -o root -g root -m 0755 /opt/taskapp /opt/taskapp/releases
install -d -o root -g root -m 0700 /etc/taskapp /etc/taskapp/credentials
install -d -o root -g caddy -m 0750 /etc/caddy 2>/dev/null || install -d -o root -g root -m 0755 /etc/caddy
install -d -o taskapp -g taskapp -m 0700 /var/lib/taskapp
```
`/var/lib/taskapp-backup` and `/var/lib/taskapp-snapshot` are made by systemd (`StateDirectory=`) the first time their units run. Create the Caddy log folder **owned by caddy** after installing Caddy in step 10.

**3. The pinned Node (S).** Download Node 22.22.0 for Linux from nodejs.org together with its `SHASUMS256.txt`, check the checksum (`sha256sum -c --ignore-missing SHASUMS256.txt`), unpack to `/opt/node-v22.22.0-linux-x64`, then
`ln -sfn /opt/node-v22.22.0-linux-x64 /opt/node`. `/opt/node/bin/node --version` must print `v22.22.0`. The same number is in `.nvmrc` and in `NODE_VERSION_PIN`; the units refuse to run on any other.

**4. The code (S, as root).** From a tagged commit, so it is exactly what was tested. Use a clone address with no token in it, and check the tag:
```
git clone --branch <tag> <your repository address> /opt/taskapp/releases/<tag>
cd /opt/taskapp/releases/<tag> && git verify-tag <tag>     # only if you sign your tags; otherwise check the commit hash against the one you tested
HOME=/root PATH=/opt/node/bin:$PATH npm ci --omit=dev --ignore-scripts --userconfig /dev/null
chmod -R go-rwx .git
ln -sfn /opt/taskapp/releases/<tag> /opt/taskapp/current
```
`--ignore-scripts` stops any dependency running code as root during the install. The code stays owned by root: the services can read it and cannot change it.

**5. Settings and credentials (S, as root).** Settings (nothing secret in them):
```
install -m 0600 -o root -g root replica/deploy/etc/app.env.example     /etc/taskapp/app.env
install -m 0600 -o root -g root replica/deploy/etc/backup.env.example  /etc/taskapp/backup.env
install -m 0640 -o root -g caddy replica/deploy/caddy/caddy.env.example /etc/caddy/taskapp-caddy.env
```
Replace every `__REPLACE_...__`. The app and the scripts refuse to run while one is left.

Credentials, one file each, root-only, installed through standard input so no value appears on a command line or in shell history:
```
./replica/deploy/bin/install-credential.sh backup-key            # paste the key from `node app/cli/backup.js keygen` when asked; keep a second copy off this machine
./replica/deploy/bin/install-credential.sh alert-webhook         # a chat or paging webhook address; may be left empty (then alerts reach only the journal, which nobody is watching)
./replica/deploy/bin/install-credential.sh healthcheck-ping      # a dead-man's-switch address; may be left empty
```
The three storage key files (`uploader-key.json`, `checker-key.json`, `drill-key.json`) come from step 11 and are installed the same way. Do not put any of these in git. systemd gives each unit only the credentials it names, as private files for that run.

**6. SSH hardening and the firewall (S).** First make sure key login works for your account **in a second session you keep open**. Then:
```
sed 's/__REPLACE_WITH_YOUR_LOGIN_NAME__/<your login name>/' replica/deploy/ssh/10-taskapp.conf > /etc/ssh/sshd_config.d/10-taskapp.conf
sshd -t && systemctl reload ssh        # (the service is called sshd on some systems)
# test a NEW login before closing the old one. Then the firewall: check first, then apply with a second session open:
SSH_RANGE=<your range> replica/deploy/bin/install-firewall.sh            # check only
SSH_RANGE=<your range> replica/deploy/bin/install-firewall.sh --apply    # loaded, not saved
# open a NEW ssh session and confirm you can still get in; then
SSH_RANGE=<your range> replica/deploy/bin/install-firewall.sh --persist
```
The range must be IPv4 no wider than /16 or IPv6 no wider than /48; the script refuses anything wider, and the whole internet. It replaces the machine's whole firewall ruleset (`flush ruleset`): move any rule you rely on into the template first.

**7. Units (S).**
```
cp replica/deploy/systemd/* /etc/systemd/system/
install -d /etc/systemd/journald.conf.d && cp replica/deploy/logging/journald-taskapp.conf /etc/systemd/journald.conf.d/taskapp.conf
systemctl restart systemd-journald && systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/taskapp.service /etc/systemd/system/taskapp-backup@scheduled.service
```
Only the user units reach their own credentials: check with `systemd-analyze security taskapp.service` and `systemd-analyze security 'taskapp-backup@scheduled.service'` and read what they flag.

**8. The first owner (S).** Once, in a terminal, before the app starts. This prints a one-time password once; copy it. The owner must replace it at the first sign-in.
```
sudo replica/deploy/bin/app-cli.sh first-owner --workspace "Your Company" --name "Your Name" --email you@your-company.example
```
That script loads the settings as root, then runs the tool as the app user in an **empty environment** (no HOME, no npm), so nothing the app could plant in its own folder is ever run with those privileges. Never run `npm run seed` here.

**9. Start the app (S).** `systemctl enable --now taskapp`, then `journalctl -u taskapp -n 30` and `curl -fsS http://127.0.0.1:3000/api/v1/health`. It is reachable only from this machine at this point.

**10. Caddy (S).** Install Caddy from its own distribution package (not part of this kit). Then:
```
install -d -o caddy -g caddy -m 0750 /var/log/caddy
cp replica/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d && cp replica/deploy/caddy/caddy-override.conf /etc/systemd/system/caddy.service.d/override.conf
systemctl daemon-reload
sudo -u caddy bash -c 'set -a; . /etc/caddy/taskapp-caddy.env; set +a; caddy validate --config /etc/caddy/Caddyfile'
systemctl enable --now caddy
curl -fsS https://<your domain>/api/v1/health
```
`caddy validate` must pass, **as the caddy user**, before you start it. Then sign in with the owner, choose your own password, and look at the response headers (`curl -sI https://<your domain>/`): the app's own `Content-Security-Policy`,
`Strict-Transport-Security` and `Permissions-Policy` should all be there, and no `Server`. Check that the admin API is off: `curl -s localhost:2019` must be refused.

**11. Storage and backups (A for the account steps, then S).** In your own Google Cloud account, in a **separate project that holds nothing else** (call it the backup project). These are commands for you to run; nothing in the kit runs them.
```
# a bucket that cannot be made public, with versions kept and the clean-up rules applied
gcloud storage buckets create gs://<bucket> --project=<backup project> --location=<region> --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://<bucket> --versioning
gcloud storage buckets update gs://<bucket> --lifecycle-file=replica/deploy/gcs/lifecycle.json
# three service accounts, one job each
gcloud iam service-accounts create taskapp-uploader --project=<backup project>
gcloud iam service-accounts create taskapp-checker  --project=<backup project>
gcloud iam service-accounts create taskapp-drill    --project=<backup project>
# uploader: may ONLY create objects.   drill: may list and read.   checker: may ONLY list (a custom role with just storage.objects.list)
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:taskapp-uploader@<backup project>.iam.gserviceaccount.com --role=roles/storage.objectCreator
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:taskapp-drill@<backup project>.iam.gserviceaccount.com --role=roles/storage.objectViewer
gcloud iam roles create taskappLister --project=<backup project> --title="List backup names" --permissions=storage.objects.list
gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:taskapp-checker@<backup project>.iam.gserviceaccount.com --role=projects/<backup project>/roles/taskappLister
# a key file for each (long-lived secrets: install them, then delete the local copies)
gcloud iam service-accounts keys create uploader-key.json --iam-account=taskapp-uploader@<backup project>.iam.gserviceaccount.com   # and the same for checker and drill
```
Then on the server install each key (`install-credential.sh uploader-key.json < uploader-key.json`, and the other two), delete your local copies, and set `GCS_PREFIX` in `/etc/taskapp/backup.env`.

**Prove each identity does only its job (this is the step that matters).** The uploader first, because the other two read what it wrote:
```
systemctl start --wait taskapp-storage-check@uploader.service ; journalctl -u taskapp-storage-check@uploader -n 20
systemctl start --wait taskapp-storage-check@checker.service  ; journalctl -u taskapp-storage-check@checker  -n 20
systemctl start --wait taskapp-storage-check@drill.service    ; journalctl -u taskapp-storage-check@drill    -n 20
```
Every line must say PASS: the uploader can add a file and **cannot list, read, delete or overwrite**; the checker can list and cannot read, add or delete; the drill can list and read and cannot add or delete.
If the uploader cannot even add a file, `gcloud storage cp` needs a permission this recipe does not give it: **do not widen it until you have read exactly which permission the error names, and re-run the proof afterwards.**
If a check says "CAN", the credential is too strong: fix the permissions. Note that on a cloud VM `gcloud` would otherwise use the VM's own identity; the scripts set an explicit credential file for it, and the check would show a broad identity as a FAIL.

Retention is by **age**, set in the bucket (`gcs/lifecycle.json`): hourly copies 2 days, daily 31 days, monthly 400 days, premigration 90 days, test files 1 day, old versions 30 days. An outage longer than a window leaves nothing of that kind: the freshness check is what tells you.
Optionally add a bucket retention policy (do not lock it until you are sure; locking cannot be undone).

Then run the first backup and switch on the timers:
```
systemctl start --wait taskapp-backup@scheduled.service ; journalctl -u 'taskapp-backup@scheduled' -n 30      # should say it uploaded an hourly (and a daily and monthly) copy
systemctl enable --now taskapp-backup.timer taskapp-backup-check.timer
systemctl start --wait taskapp-backup-check.service ; journalctl -u taskapp-backup-check -n 10
systemctl start taskapp-alert@test.service      # proves the alert path (with a real webhook address installed)
```

**12. Restore drill (S, before any real data).**
```
systemctl start --wait taskapp-restore-drill.service ; journalctl -u taskapp-restore-drill -n 30
```
It must end with `DRILL PASSED`. Write the date and result in `replica/ops-log.md`. Try it once with a wrong backup key credential to see it refuse. Repeat monthly.
A **real** restore is different: it asks you to type the backup's name after showing what the file really is (kind and time from inside it), and refuses a renamed or forged file. See `../runbook.md`.

**13. Go-live checks (S and C).** Health answers over https; the owner can sign in and the audit log shows it; `ss -ltn` shows port 3000 on 127.0.0.1 only and nothing on 2019; from another machine, ports other than 80 and 443
(and SSH from your range) time out; password SSH login is refused; a deliberate wrong-password burst from your own address is rate limited and recorded once with a count; `systemctl list-timers 'taskapp*'` shows both timers;
`sudo -u taskapp cat /etc/taskapp/credentials/backup-key` is refused (the app user cannot read any credential); `ps eww` for the app process shows no backup key or storage credential.

## Updating

`systemctl start --wait taskapp-backup@premigration.service` (it takes the snapshot, seals and uploads one `premigration` copy), then repeat step 4 with the new tag (new folder, new `current` link), `systemctl restart taskapp`,
check health and the audit log. To go back: stop, restore the premigration backup (see `../runbook.md`), point `current` at the old folder.

## What was and was not tested

Tested in this repository (`app/tests/deploy-kit.test.js`, `review-batch2.test.js`): every shell script parses; the unit files are checked structurally and with `systemd-analyze` where it can run; the units' users, credentials,
folders and sandbox settings are checked against each other (the app unit holds no credential, the backup units hold only theirs, nobody but the app user can see the live database); the firewall template is built with documentation
address ranges and checked with `nft -c` where that can run, and every too-wide or malformed range is refused; the Caddyfile is checked for the required directives; no file holds a secret, a real address or a key-shaped string; the settings
examples work as both systemd and shell files; the Node pin equals `.nvmrc`; the snapshot, backup, freshness-check, restore-drill and storage-proof scripts are run end to end against a **fake `gcloud`** that applies role-based permissions
(real encrypted backups made by the app, a real restore, a real throw-away app, forged and renamed files, hostile object names, a too-strong credential, a squatter on the drill port); and the scripts refuse placeholders.

**Not tested:** anything on a real machine; systemd actually running these units (so `LoadCredential=`, `PrivateUsers=`, `StateDirectory=` ownership, `OnFailure=` and the `+` start step are untested, and the syscall filter has not been tried against Node); Caddy itself (not installed
here, so `caddy validate` is your step 10); real `gcloud` and real cloud permissions (whether `roles/storage.objectCreator` is enough for `gcloud storage cp`, and whether the lifecycle rules behave, is yours to prove in step 11); real firewall behaviour;
certificate issue; the alert webhook. Treat the first install as a rehearsal on a machine with no real data.
