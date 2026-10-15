# Hosting plan: one small VM (plan only)

Status: **a plan. Nothing here has been built, bought, signed up for or deployed.** No account, key or payment is needed to read it, and
none should be created until the owner decides. Updated after the Playbook check (see "Playbook alignment" below). Prices are rough planning figures from general knowledge, not live quotes (no web
access in this build), so check them with the chosen provider before committing. Deskrail is not certified to any standard and has not
been penetration tested; this plan does not change that.

## Decisions from the Playbook check

1. **Stay on SQLite (WAL mode), one VM, one persistent disk.** The Playbook sets no database for the task system. ADL-062 applies only to Zen's
   own database, so it does not bind Deskrail. No Postgres port now (the touch-list is kept at the end for reference only).
2. **Hosting location is NOT STATED in the Playbook.** This plan therefore does not assume `oie-zen-core` or any existing project. It is
   written for a **separate GCP project dedicated to Deskrail**. Minimum acceptable fallback: a separate service account with no access to
   the Credential Service or the Reseller key. Which of the two, and the project name, is the owner's call.
3. **Backups:** daily, encrypted, off the machine, restore tested, plus a backup before every migration. Counts kept are in the Backups section.
4. **Forget-me:** not ruled by the Playbook (Blockers #7). The forget-me section describes what would be involved and what exists today.

## Shape

One Compute Engine VM (Linux) with a persistent disk, in the dedicated project. Deskrail (Node 22) listens on 127.0.0.1 only, as it does
today. A small reverse proxy on the same VM terminates HTTPS and forwards to it. SQLite stays, in WAL mode. Zen reaches Deskrail over HTTPS
with a token. Deskrail makes no outgoing calls.

```
internet -> :443 reverse proxy (certificates renewed automatically)
              -> 127.0.0.1:3000 Deskrail (node, run by systemd, own unprivileged user)
                    -> /var/lib/deskrail/app.db  (+ app.db-wal, app.db-shm), on the persistent disk
backup timer (daily, and before each migration) -> consistent copy -> encrypted -> storage bucket in a different project
```

Sizing: 1 to 2 vCPU, 2 GB memory, 20 to 40 GB disk is plenty for a few staff and Zen's task traffic. SQLite writes are serialised, which
is fine at this scale. GCP names (Compute Engine, a Cloud Storage bucket, a service account) are used because the owner mentioned GCP; none of
them exists yet and nothing here needs them to be created now.

## Isolation from the rest of the Zen estate

- Own GCP project, own billing line, own service accounts. Deskrail's VM service account has **no roles** on any other project, and none on
  the Credential Service or the Reseller key. It holds no secret that belongs to another system.
- If a shared project is chosen instead (not recommended): a dedicated service account for the VM, no Secret Manager access to other
  systems' secrets, no access to the Credential Service, firewall rules tagged to this VM only. The owner must confirm that is acceptable.
- Deskrail needs no credentials for Toggl, QuickBooks, Drive, Gmail, Calendar, Reseller or TPP (the connection rule: Zen only), so the VM
  should be unable to reach them by identity even by accident.
- The backup bucket is in a **second project** (or at least a second account), writable by the VM's backup identity but not readable or
  deletable by it.
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

| what | when | where | kept |
| --- | --- | --- | --- |
| **daily** consistent copy of the database (backup command, below), encrypted | every night | storage bucket in the second project | **30 daily backups, plus 12 monthly (the first of each month), so at most 42** |
| **pre-migration** backup, taken by the deploy step before any migration runs | before every deploy that adds a migration | same bucket, separate folder | **the last 5**, never deleted by the daily clean-up |
| disk snapshot (extra safety, not the main backup) | nightly | GCP snapshot schedule | 7 |

So at any time there are up to 47 off-machine backups. Older ones are removed by a bucket lifecycle rule, not by the VM.

- The copy is encrypted before it leaves the VM (for example with `age`), to a key whose private half is held by the owner off the VM. The
  VM's backup identity can add objects but not read, overwrite or delete them (use bucket retention or object versioning), so a break-in
  cannot erase the history.
- **Restore is tested, not assumed:** once before go-live and monthly after. Fetch the latest backup to a scratch machine, decrypt, run the
  integrity check and `verifyChain`, start the app on it, sign in as a fake test user, read the audit log. Record date and result in
  `replica/ops-log.md` (created when hosting is actually built). A backup that has never been restored counts as no backup.
- **Honest recovery goal:** with daily backups, a failure could lose up to one day of changes. Whether Zen can safely re-send a day of
  ingestion (ingest is idempotent on its key, so a replay creates no duplicates, but staff edits and comments in that day would be lost) is
  **NOT STATED** in the Playbook. If a day is too much, hourly copies can be added; that is a decision for the owner, not assumed here.
- Alert if the newest backup is older than 30 hours (a check-in ping carrying no data).
- Deleting data interacts with backups; see the forget-me section.
## Forget-me: what deleting a client's data would involve

**The Playbook has not ruled whether a forget-me request removes tasks (Blockers #7).** Nothing below is a recommendation to delete or to
keep; it describes the work for each place data sits, what exists today, and what would have to be built. Nothing here is built by this plan.

| where client data sits | what is there | exists today | would need building |
| --- | --- | --- | --- |
| **Tasks** | title, description, assignee, dates, job number, lane, client slug, source call id, context | `DELETE /api/v1/tasks/:id` removes one task and its subtasks (staff with edit access), audited | a "delete everything for client X" action by client slug that finds every task (ingested and hand-made), previews counts, asks for confirmation, runs in one transaction, and is owner/admin only |
| **Client project** (one per client, named after the client) | the project name is the client's name; sections; members | there is **no project delete**, only archive | a project delete (cascades to sections, tasks and comments by the schema) or an anonymise-rename; also decide what happens to the Sales and Internal projects, which hold prospects' tasks |
| **Comments** | free text written by staff, may name people | removed automatically when their task is deleted (schema cascade) | nothing, but comments on an *unrelated* task that mention the client would not be found |
| **Form submissions** | the submitter's email and every answer, kept as raw text | **Deleting a task now blanks its submission** (answers emptied, submitter email cleared, empty row kept so the request count stays honest), by a database trigger so subtasks and any future delete path are covered; older orphaned rows were blanked by migration 0007 | finding a submission by email without its task (not needed now, since the task is the way in) |
| **Imported job projects** | client name, job number, notes, description from the Job Register import | same as projects: archive only | covered by the project delete above; the import file itself is never stored |
| **Audit trail** | who changed what. **Audit rows no longer carry titles, text, names or emails (Group A of the pre-data hardening); they hold ids and field names**, so what remains is ids, dates, statuses and the caller's network address | append-only by design: the database blocks edits and deletes. Free text is no longer written, so there is nothing to blank for new data. **Rows written before the redaction change still hold text; use a fresh database before real data** | decide whether ids and the caller's network address count as personal data for forget-me (not decided here) |
| **Backups** | every copy contains everything as it was that day | nothing removes data from a backup | the plan must state an expiry: data deleted today persists in up to 42 daily and monthly backups, so up to about 12 months at the monthly tier. Either accept and document that window, or shorten the monthly tier, or re-encrypt and purge on request. The owner and the Playbook must rule which |
| **Logs** | request ids and paths, no bodies, no query strings | already free of client content by test | nothing |
| **Zen's own copy** | Zen reads tasks live and keeps its own records | out of scope for Deskrail | Zen must be part of any forget-me process; **NOT STATED** how |

What a forget-me run would look like once the Playbook rules: confirm identity and scope (client slug, job numbers, email addresses), preview counts, take a
fresh backup first (so a mistake can be undone), delete in one transaction, write an audit event that records counts and the requester but not the
deleted content, then verify nothing remains by searching tasks, comments, submissions and projects. A restored backup must be re-run through the same
deletions, so keep a short list of forget-me requests (ids and dates only, no personal data) to replay after any restore.

Today the honest answer to "can you delete a client from Deskrail?" is: one task at a time (its comments, subtasks and form answers go with it), with ids and dates left in the audit trail, everything still present in backups until they expire, and no project delete.
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

## Playbook alignment: where this plan rests on something the Playbook does NOT state

| item | status in the Playbook | what this plan does about it |
| --- | --- | --- |
| Database for the task system | not set (ADL-062 is Zen's own database only) | SQLite chosen as a Deskrail decision, recorded here; revisit if the Playbook sets one |
| Hosting location | **NOT STATED** | separate GCP project proposed; the choice of project and cloud is the owner's. The plan does not assume `oie-zen-core` |
| Cloud provider itself | **NOT STATED** | GCP used for wording only, because the owner named it; nothing depends on it except bucket and identity wording |
| Backup frequency and retention | **NOT STATED** | daily, 30 daily plus 12 monthly plus the last 5 pre-migration is **this plan's proposal**, not a rule |
| Recovery point and time targets | **NOT STATED** | a day of possible loss is stated plainly, not hidden |
| Whether Zen can replay a lost day | **NOT STATED** | not assumed; idempotent ingest makes a replay safe but does not recover staff edits |
| Forget-me scope, audit retention, backup expiry for deleted data | **NOT STATED** (Blockers #7) | described, not decided |
| Domain name and DNS control | **NOT STATED** | left open |
| Network path from Zen (public HTTPS or private) | **NOT STATED** | public HTTPS with tokens is the default here; a private path is possible |
| Who holds the backup key and runs the restore test | **NOT STATED** | left open |
| Region and data location | **NOT STATED** | a preference for an Australian region is noted, not a compliance claim |
| Token rotation interval (90 days) and expiry policy | **NOT STATED** | proposal only |
| Staff access (anywhere or VPN) | **NOT STATED** | left open |

Anything in this document phrased as a number (90 days, 30 daily backups, USD cost) is a proposal for the owner to accept or change.
## Open decisions for the owner (do not guess)

1. Which GCP project (a new dedicated one is proposed) or, at minimum, a dedicated service account with no access to the Credential Service or the Reseller key.
2. Region.
3. The domain name and who controls its DNS.
4. Backup retention (the 30 + 12 + 5 proposal) and who holds the backup key and runs the monthly restore test.
5. Whether a day of possible data loss is acceptable, or hourly copies are wanted.
6. The forget-me ruling (Blockers #7), including audit-trail handling and how long deleted data may sit in backups.
7. Whether Zen reaches Deskrail over public HTTPS or a private path, and whether staff need a VPN.
## Postgres: not planned (reference only)

**Decision: no Postgres port now.** The Playbook sets no database for the task system, and SQLite on one VM covers the need. The list below is kept only so the cost is known if that changes.

Do it only if one of these becomes true: more than one app process is needed, writes start to queue, or a managed database with
point-in-time recovery is wanted. Sizes are rough token counts for my work (reading, editing, testing), not dollars.

| area | what changes | rough size |
| --- | --- | --- |
| Driver and calls | `node:sqlite` is synchronous; the 162 `prepare(` calls across 17 server files become async queries, so every handler, helper and the transaction wrapper in `audit.js` (`mutate`) need `await`. This is the bulk of the work | 70 to 100k |
| Schema and migrations | seven SQLite migrations rewritten for Postgres (types, booleans stored as 0 and 1, text timestamps, `insert or ignore`, partial unique indexes, `rowid` use if any), keeping 0001 equal to `schema.sql` and its guard test | 15 to 25k |
| Audit chain | the append-only triggers become plpgsql; the sequence number and the hash chain must be appended under an advisory lock so two writers cannot fork the chain; verify-chain retested | 15 to 20k |
| Race-safe writes | ingest idempotency and one-project-per-client rely on SQLite unique errors being raised inside a transaction; error codes and retry behaviour differ | 10 to 15k |
| Store layer | `store*.js` (154 lines) are the intended seam and move first; older routes still bypass it and need moving into it | 20 to 30k |
| Tests | `freshDb()` builds an in-memory SQLite per test; replace with a template database or schema-per-test, keep the 135 JS tests fast; the browser server and the seed change too | 25 to 35k |
| Operations | `pg_dump` and point-in-time recovery replace the backup command; connection settings and secrets; restore test redone | 10 to 15k |
| Docs and gates | architecture, security, parity, brief and this plan updated | 5 to 10k |
| **total** | | **about 180 to 250k tokens**, plus a data migration script (one-off export from SQLite, import, verify counts and the audit chain) of about 15 to 25k |

The hash chain is the delicate part: moving data must keep every row and hash byte for byte, then `verifyChain` must pass on the new
database before the old one is retired.
