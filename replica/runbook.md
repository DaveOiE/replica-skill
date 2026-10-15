# Runbook: running this app on one small VM

**Status: written, not yet used.** This build has not been hosted. No machine, account, domain or certificate exists, and nothing here has been
run on a real server; the commands are the ones the app provides and that the tests exercise locally. Read `hosting-plan.md` first for the
reasons and for what the Playbook does NOT state. This app is not certified to any standard and has not been penetration tested.

## 1. Versions

| what | value |
| --- | --- |
| Node | **22.22.0, exactly** (the version the suite was run on; also in `.nvmrc`). The app needs 22.13 or newer, and uses Node's built-in, still experimental `node:sqlite`, so do not upgrade Node on the server without running the tests on the new version first |
| Install | `npm ci --omit=dev` from a tagged commit (uses the lock file, installs no test tools) |
| Database | one SQLite file in WAL mode, one app process, never two |

## 2. Settings

Kept in a root-owned file outside the repository (mode 600, the kit uses `/etc/taskapp/taskapp.env`), loaded by the service manager with `EnvironmentFile=`. Never in git.

| setting | value on the VM | why |
| --- | --- | --- |
| `PORT` | `3000` | the app listens on 127.0.0.1 only; the proxy forwards to it |
| `DB_PATH` | `/var/lib/taskapp/app.db` | on the persistent disk. The folder is `0700`, owned by the service user; run the service with `UMask=0077` |
| `PUBLIC_URL` | `https://<your domain>` (no trailing slash) | links shown to admins are built from it. An https address also makes the session cookie Secure and turns on HSTS |
| `COOKIE_SECURE` | **leave unset** | it follows `PUBLIC_URL`; the app refuses to start if you set it to `false` on an https address |
| `TRUST_PROXY` | `true` | only with a reverse proxy on the same machine. The app then trusts that local proxy and takes the caller's address from the forwarded header. Without it all callers look like one address and the rate limits break. The proxy should set `X-Forwarded-For` itself and pass `Host` through unchanged |
| `SESSION_HOURS` | `12` | longest a session lives |
| `SESSION_IDLE_MINUTES` | `120` | a session unused for this long ends |
| `BACKUP_KEY` | 64 hex characters | see section 4. Also kept somewhere other than this machine |
| `BACKUP_DEST` | `file:/var/lib/taskapp-backup/outbox` | a LOCAL staging folder. The app writes each finished, encrypted backup there; `backup.sh` (the deployment kit) uploads it with a create-only credential through rclone or gsutil and then removes it. Uploading is not done by the app, and no cloud driver is built into it |

## 3. First start

The exact order, with every command, file and unit, is in `deploy/README.md` (the deployment kit). The short version follows; where they differ, the kit's README is the one that was written last.

1. Create the service user and the folders (`/var/lib/taskapp`, mode 700, owned by that user). Put the settings file in place.
2. `npm ci --omit=dev`
3. **Create the first owner** (once, in a terminal, as the service user, with the same environment as the service):
   `npm run first-owner -- --workspace "Your Company" --name "Your Name" --email you@your-company.example`
   It prints a one-time password once and stores only a hash. It refuses to run if an owner already exists, and refuses when its output is not a terminal. Copy the password, sign in, and change it under Account. **Do not run `npm run seed` on this machine**: it makes a demo workspace with invented people.
4. Start the app under the service manager (restart on failure), then put the proxy in front: TLS with a certificate that renews itself, port 80 only redirecting, forward to `127.0.0.1:3000`, overwrite `X-Forwarded-For`, keep `Host`.
5. Check `https://<your domain>/api/v1/health` answers `{"ok":true,...}`, sign in, and open the Audit log screen. Then run a backup (next section) and a restore drill before real data goes in.

## 4. Backups

Setup, once:
1. `npm run backup:keygen` in a terminal. It prints `BACKUP_KEY=...` once and stores nothing. Put it in the settings file **and** in a second place off the machine (a password manager). Without the key no backup can be opened, and the key cannot be recovered.
2. Set `BACKUP_DEST` (the staging folder) and the upload settings in `backup-upload.env` (`UPLOAD_TOOL`, `UPLOAD_TARGET`, the create-only credential file). A copy that never leaves the machine is not a backup: the freshness check alerts if uploads stop. Without the kit, `BACKUP_DEST` can instead point straight at a folder on a different disk or machine.

Scheduled runs are the kit's systemd timers (`replica/deploy/systemd/`), which start `backup.sh <kind>`; that script runs `npm run backup -- --kind <kind>`, uploads, records the time and alerts on failure. By hand (for example before a deploy): `systemctl start taskapp-backup@premigration.service`. Without the kit, any scheduler running `npm run backup -- --kind <kind>` does the same first half:

| kind | when | keep (set in the destination, not by the app) |
| --- | --- | --- |
| `hourly` | every hour | the last 48 |
| `daily` | every night | the last 30 |
| `monthly` | the 1st of each month | the last 12 |
| `premigration` | by hand, before each deploy that adds a migration | the last 5 |

Names look like `backup-hourly-20301231T235959Z.db.gz.enc`, with the kind first so a storage lifecycle rule can match a prefix. The app never deletes old backups; the destination's own clean-up does (or you do). Each run takes an online copy (the app keeps running), checks it (SQLite integrity, foreign keys, the audit hash chain of every workspace), encrypts it, and only then stores it. If the check fails nothing is stored and the command exits non-zero: wire that exit code to an alert. Also alert when `npm run backup:list` shows no new file for 3 hours.

**Restore drill** (before go-live, then monthly). The kit's `restore-drill.sh` does all of this for you, with a read-only credential: it fetches the newest backup, restores it into a scratch folder, starts a throw-away app on a spare port, checks it answers, deletes everything, and never touches the live database (`sudo -u taskapp /opt/taskapp/current/replica/deploy/bin/restore-drill.sh`; it must end with `DRILL PASSED`). By hand, on a scratch machine or folder, never over the live file:
1. `npm run backup:list`, pick a name.
2. `npm run restore -- --from <name> --to /tmp/drill/app.db`
3. It prints the row counts and says the copy passed its checks before it was put in place. Point a throwaway instance at it (`DB_PATH=/tmp/drill/app.db`, another `PORT`), sign in, read the audit log, then delete the scratch copy. Write the date and result in `replica/ops-log.md`.
4. Try it with the wrong key once, to see it refuse.

**Real restore** (after a failure): stop the app. `npm run restore -- --from <name> --to /var/lib/taskapp/app.db --replace`. The damaged file is kept beside it as `app.db.before-restore-<time>`. Start the app, check it, then decide what to delete. Changes made after that backup are lost (up to an hour with hourly copies), and any forget-me deletions made since must be repeated (see the plan).

## 5. Updating

1. Take a `premigration` backup: `npm run backup -- --kind premigration`.
2. Check out the new tag, `npm ci --omit=dev`, restart. Migrations apply at start, once each, in order, each in a transaction; they only go forward.
3. Check health, sign in, read the audit log. If something is wrong: stop, restore the premigration backup with `--replace`, and go back to the previous tag.
4. Before tagging, on the build machine: `npm test`, `python3 -m unittest discover -s tests`, `npx playwright test` all pass.

## 6. Routine

| how often | what |
| --- | --- |
| every deploy | premigration backup first; health check after |
| weekly | glance at the audit log for sign-in lock-outs, token denials and repeated-failure summaries; check disk use stays under 80 percent |
| monthly | restore drill; confirm the second copy of `BACKUP_KEY` still opens a backup |
| every 90 days | rotate the Zen tokens: create the new token on its service account (shown once), give it to Zen, confirm Zen's calls work (People screen shows last used), then revoke the old one; set an expiry on every token |
| when a person leaves | deactivate them (ends their sessions); if they held a token or the backup key, rotate it |

## 7. When something goes wrong

- **The app will not start:** the message says why (a protected folder, `PUBLIC_URL` is https while `COOKIE_SECURE=false`, a migration failed and rolled back). Fix the setting; do not delete the database.
- **A person is locked out:** an owner or admin uses People, then Unlock or Reset password. Locks also end after 15 minutes. If the only owner is locked, wait 15 minutes; there is no command-line unlock.
- **A token leaked:** revoke it on People at once (effect is immediate), create a new one, and read the audit log for that service account's calls.
- **The backup key is lost:** existing backups cannot be opened. Make a new key (`backup:keygen`), take a fresh backup straight away, and keep two copies this time.
- **A backup check failed:** do not ignore it. It means the live database failed an integrity or audit-chain check: stop writes if you can, restore the newest good backup to a scratch file, and compare.
- **Disk nearly full:** the audit trail and backups grow; clear old backups at the destination first.

## 8. Not covered here

The deployment kit (`deploy/`) is written and its scripts, units, firewall rules and settings are linted and run against fakes in the test suite, but **nothing has been run on a real machine**: systemd running the units, Caddy and certificates, real rclone or gsutil, the create-only credential, the firewall in force, the alert webhook and the VM itself are untested, and the cloud account is yours to make. Hosting
location, region, domain, backup retention, recovery targets and the forget-me ruling are NOT STATED in the Playbook and are listed in `hosting-plan.md`.
