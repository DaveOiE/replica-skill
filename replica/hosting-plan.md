# Hosting plan: one small VM (plan only)

Status: **a plan. Nothing here has been built, bought, signed up for or deployed.** No account, key or payment is needed to read it, and
none should be created until the owner decides. Prices are rough planning figures from general knowledge, not live quotes (no web
access in this build), so check them with the chosen provider before committing. Deskrail is not certified to any standard and has not
been penetration tested; this plan does not change that.

## Shape

One Linux VM with a persistent disk. Deskrail (Node 22) listens on 127.0.0.1 only, as it does today. A small reverse proxy on the same
VM terminates HTTPS and forwards to it. SQLite stays, in WAL mode. Zen reaches Deskrail over HTTPS with a token. Nothing else connects.

```
internet -> :443 reverse proxy (certificates renewed automatically)
              -> 127.0.0.1:3000 Deskrail (node, run by systemd, own unprivileged user)
                    -> /var/lib/deskrail/app.db  (+ app.db-wal, app.db-shm), on the persistent disk
backup timer -> consistent copy -> encrypted -> off-machine storage
```

Sizing: 1 to 2 vCPU, 2 GB memory, 20 to 40 GB disk is plenty for a few staff and Zen's task traffic. SQLite writes are serialised, which
is fine at this scale.

## Before it can be hosted: three small code items (not built)

These were found while writing the plan. Each is small and each needs its own tested commit and the owner's go.

1. **Real client addresses behind the proxy.** The app does not set Fastify's `trustProxy`, so behind a proxy every request looks like it
   comes from 127.0.0.1. The per-address sign-in limit, the bad-token guess limit and the public form limit would then share one bucket
   (one noisy visitor locks out everyone), and audit rows would record the proxy's address. Fix: a `TRUST_PROXY=true` setting, tested with a
   forwarded header, and the proxy must overwrite (not append to) the forwarded address header.
2. **A first owner without the fake seed.** Today the only way to get an owner is `npm run seed`, which makes the fake demo workspace. A
   real instance needs a one-off command that creates the workspace and the first owner, reading the password from a prompt (never from
   a file or the command line) and recording the event in the audit trail. Until then, do not host.
3. **A backup command.** There is no backup feature (the README says so). Add `npm run backup -- <target>` using SQLite's online backup
   (`VACUUM INTO` or the backup API), then an integrity check of the copy. Copying the three database files with `cp` while the app runs is
   not safe and must not be the method.

## HTTPS and PUBLIC_URL

- The reverse proxy gets and renews a free public certificate for the chosen domain automatically; HTTP on port 80 only redirects.
- Set `PUBLIC_URL=https://<the domain>` (no trailing slash; the app strips it) and `COOKIE_SECURE=true`. Links shown to admins (invites,
  resets, ingest results) are built from `PUBLIC_URL`, so a wrong value shows wrong links, not a security hole.
- The app already refuses cross-site writes by comparing the Origin header with the Host header, so the proxy must pass the original Host
  through unchanged.
- The proxy sets `Strict-Transport-Security` once HTTPS has been confirmed working. The app already sends its own security headers.
- Zen calls the same HTTPS address. There is no second port, no webhook and no outbound call from Deskrail.

## SQLite in WAL mode

- `db.js` already sets WAL, a 5 second busy timeout and foreign keys. Keep `DB_PATH` on the persistent disk, not the VM's temporary storage,
  and not on a network share (WAL needs real shared memory on one machine).
- One app process only. Do not run two copies against the same file.
- The database folder is owned by the service user, mode 700. The file is not encrypted by the app; use the provider's disk encryption if it
  offers it, and say so honestly rather than claiming more.
- Check after each deploy: `PRAGMA integrity_check` and the audit chain verify (a short script using the existing `verifyChain`).

## Backups off the machine, and a tested restore

| what | how often | where | kept |
| --- | --- | --- | --- |
| consistent copy of the database (backup command above) | hourly while staff work, plus nightly | object storage in a **different** provider account or region than the VM | 24 hourly, 30 daily, 12 monthly |
| provider disk snapshot (belt and braces, not the main backup) | nightly | provider | 7 |

- The copy is encrypted before it leaves the VM (for example with `age`), using a key whose private half is kept off the VM by the owner. The
  upload credential on the VM can add files but not delete or read them (append-only), so a break-in cannot erase the history.
- **Restore is tested, not assumed.** Monthly, and once before go-live: fetch the latest backup to a scratch machine, decrypt, run the
  integrity check and `verifyChain`, start the app on it, sign in as a fake test user, and read the audit log. Write the date and result in
  `replica/ops-log.md`. A backup that has never been restored counts as no backup.
- Targets: lose at most one hour of data; be running again from a backup in under two hours. Both are goals to be proven by the restore
  test, not promises.
- Alert if the newest backup is older than 3 hours (the backup job pings a free check-in monitor; no data goes in the ping).

## Token rotation

- Zen's write token and read token are separate tokens on separate service accounts (already supported). Rotate each every 90 days, and at once
  if anyone who held one leaves or a log or chat might have exposed one.
- No downtime: create the new token (shown once), give it to Zen, confirm Zen's calls succeed (the People screen shows last used), then
  revoke the old one. Both work during the overlap.
- Set an expiry on every token when creating it (supported) so a forgotten token dies by itself; a calendar reminder 2 weeks before.
- Revocation takes effect on the next request. The audit log shows token creation, revocation and use by account name, never the token.
- Staff passwords: the existing rules apply (12 characters minimum, lock after five failures). Reset links and invites are single use.

## Rate limits

- Already in the app: sign-in per address, bad bearer guesses per address, per-token calls per minute (600), public form per address and per
  form. These only work properly once `trustProxy` (item 1) is done.
- Add at the proxy as a second layer: a request rate cap per address and a body size cap (the app caps bodies at 1 MB), and a connection
  limit. The audit CSV export is capped by the app at 50,000 rows.
- Ingest volume from Zen is small; raise `tokenCallsPerMinute` only if Zen proves it needs it.

## Secrets handling

- The app needs almost none: no third-party keys exist. The only secrets are the service tokens (stored as hashes in the database), staff
  passwords (hashed), and the backup encryption key and upload credential.
- Put environment settings in a root-owned file outside the repository, mode 600, read by systemd (`EnvironmentFile=`). Never in git; `.env*`
  is already ignored and `.env.example` lists names only.
- The backup private key lives with the owner, off the VM. The VM holds only the public key and the upload-only credential.
- SSH: keys only, no password login, no root login, access limited to named people; the firewall allows 22 (ideally from known addresses),
  80 and 443 only.
- Never paste a token or password into chat, tickets or logs. The app's log already drops cookies, authorization headers and query strings.
- Do not run the demo seed on this machine. Its fake accounts have known-pattern emails.

## Logging

- Application log: JSON lines from Fastify to the systemd journal, with cookie, authorization header and query string already excluded;
  request ids tie a log line to an audit row. Rotate by journal size (for example keep 14 days, cap 1 GB).
- Proxy access log: keep the default fields, but drop query strings too, since typed search terms travel there.
- Audit log: the in-app screen and the CSV export (owners and admins). Back it up with the database; it is the record of who changed what.
- Watch: process up, certificate expiry, disk above 80 percent, newest backup age, 5xx rate, repeated 429s or token denials
  (`api.denied` events). A free external uptime check on `/api/v1/health`.
- No client data in logs: the logging privacy tests stay part of the suite and must pass before each deploy.

## Deploying and updating

- Deploy by pulling a tagged commit on the VM, `npm ci --omit=dev`, running migrations (the app applies them at start; take a backup first),
  and restarting the service. Keep the previous release folder for rollback; migrations are forward only, so rollback after a migration
  means restoring the pre-deploy backup.
- Run the JS suite and the browser suite on the build machine before tagging. Security updates for the OS applied automatically, with a
  monthly reboot window.
- A runbook of the exact commands goes in `replica/ops-log.md` when hosting is actually built.

## Monthly cost estimate (rough, USD, not live prices)

| item | low | high |
| --- | --- | --- |
| small VM (2 GB memory, 1 to 2 vCPU) | 6 | 14 |
| disk 20 to 40 GB, if not bundled | 0 | 4 |
| provider snapshots | 1 | 3 |
| off-machine backup storage, different account (a few GB, lifecycle rules) | 0.5 | 2 |
| domain name (about 10 to 20 a year) | 1 | 2 |
| uptime monitor and certificates | 0 | 0 |
| **total** | **about 9** | **about 25** |

Add 10 percent for tax and exchange rate. Expect roughly USD 15 a month for a comfortable setup. A managed database would add about
USD 15 to 30 a month on its own, which is one reason to stay on SQLite until it hurts. One-off: my build time for the three code items and
the runbook is about 60 to 90 thousand tokens, plus the owner's time to create the accounts.

## Open decisions for the owner (do not guess)

1. Provider and region (Australian data location matters for a Sydney business; this is a preference, not a compliance claim).
2. The domain name and who controls its DNS.
3. Who holds the backup private key, and who gets the monthly restore test.
4. Whether Zen runs on the same network (then a private address or allow-list at the proxy is possible) or elsewhere (then HTTPS and tokens only).
5. Whether staff reach the screens from anywhere or only through a VPN or an allow-list.

## What a later move to Postgres would touch

Do it only if one of these becomes true: more than one app process is needed, writes start to queue, or a managed database with
point-in-time recovery is wanted. Sizes are rough token counts for my work (reading, editing, testing), not dollars.

| area | what changes | rough size |
| --- | --- | --- |
| Driver and calls | `node:sqlite` is synchronous; the 162 `prepare(` calls across 17 server files become async queries, so every handler, helper and the transaction wrapper in `audit.js` (`mutate`) need `await`. This is the bulk of the work | 70 to 100k |
| Schema and migrations | six SQLite migrations rewritten for Postgres (types, booleans stored as 0 and 1, text timestamps, `insert or ignore`, partial unique indexes, `rowid` use if any), keeping 0001 equal to `schema.sql` and its guard test | 15 to 25k |
| Audit chain | the append-only triggers become plpgsql; the sequence number and the hash chain must be appended under an advisory lock so two writers cannot fork the chain; verify-chain retested | 15 to 20k |
| Race-safe writes | ingest idempotency and one-project-per-client rely on SQLite unique errors being raised inside a transaction; error codes and retry behaviour differ | 10 to 15k |
| Store layer | `store*.js` (154 lines) are the intended seam and move first; older routes still bypass it and need moving into it | 20 to 30k |
| Tests | `freshDb()` builds an in-memory SQLite per test; replace with a template database or schema-per-test, keep the 135 JS tests fast; the browser server and the seed change too | 25 to 35k |
| Operations | `pg_dump` and point-in-time recovery replace the backup command; connection settings and secrets; restore test redone | 10 to 15k |
| Docs and gates | architecture, security, parity, brief and this plan updated | 5 to 10k |
| **total** | | **about 180 to 250k tokens**, plus a data migration script (one-off export from SQLite, import, verify counts and the audit chain) of about 15 to 25k |

The hash chain is the delicate part: moving data must keep every row and hash byte for byte, then `verifyChain` must pass on the new
database before the old one is retired.
