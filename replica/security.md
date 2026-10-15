# Security basics (Gauge, after the independent review, batch 1, 2026-10-15)

Each line is something checked by a test that is in the suite, not a statement of intent. This is a
build that has **not been penetration tested** and is **not certified** to any standard. It makes no compliance claim.
Two reviews are recorded at the end of this file: the author's own self-review, and an independent review (two separate reviewers, one for the app and one for the deployment kit) whose findings are listed one by one with their status. **Where the independent review disproved something this file used to say, the line has been corrected below and listed under "Disproved by the independent review".**

| check | result | evidence |
| --- | --- | --- |
| Roles are enforced on the server | **pass** | The route walk calls every API route as signed-out, owner, admin, member, view-only, guest and a user from another workspace, and compares with the permission rules (404 hidden, 403 refused, 2xx allowed). Sabotage-checked: removing the permission check, and uncapping view-only seats, both fail the tests. |
| View-only and guests cannot change what they should not | **pass** | Dedicated walk: view-only never gets a successful write; guests write only tasks and comments in projects they were added to; guests are never project admins. |
| Another workspace sees nothing | **pass** | Tenancy test: lists, projects, tasks, people and reports from the other workspace never include this workspace's data; hidden items answer 404. |
| An audit entry for every change | **pass** | The walk requires an audit row for every successful write on every route; the change and the row commit in one transaction (a failing change leaves no row); the chain is hash-linked, edits and deletes are blocked by the database, and verification finds tampering. |
| Audit trail holds no secrets | **pass** | Test greps the whole trail after running every route: no password, hash, token or temporary password. Redaction by key name as a second layer; the random id of a token is recorded on purpose (it names a token without being one). |
| No secrets in the repo | **pass** | Hygiene tests scan every tracked file for private keys, key and token shapes, JWTs and stored hashes; check that env files, keys, databases and local data are not tracked; `.env.example` has names and harmless defaults only. |
| Seed data is fake | **pass** | Test: every address is on the reserved `example.test` domain; names are invented; passwords are random on each seed and written only to a gitignored file. |
| Dependencies | **pass** | `npm audit`: 0 vulnerabilities across 77 packages. |
| Input validated on the server | **pass** | Every route with a body uses a strict schema; unknown fields are refused. |
| Stored text cannot run | **pass** | No `innerHTML` anywhere (test); markup typed as a title is shown as text (browser test). |
| Sessions, sign-in abuse | **pass, after fixes** | HTTP-only same-site cookie; sessions stored as hashes; sign-out, password change and (since A6) issuing a reset or deactivating a person end sessions on the server; lock-out after 5 wrong passwords decided from an atomic counter (A4: concurrent guesses can no longer get around it), shared with the password-change route (A5), with the lock re-checked after hashing; a locked real account and an unknown email take about the same time to answer (A8); sign-in rate limit per address; cross-site writes refused. Not verified at production hashing cost or against a botnet. |
| Links and tokens (invites, resets) | **pass, after A2** | Only a hash is stored; shown once; single use; expire; invalid, expired and used links give the identical answer; public routes are rate limited; the audit trail never holds a token (tests). **Until A2 the application log did hold the secret in the request path (reset and invite links, form addresses); it now logs the route pattern only (tested, sabotage-checked).** Resets are refused for yourself, for owners (unless you are one) and for anyone in more than one workspace; since A6 issuing a reset ends the person's sessions. |
| Public request form | **pass** | The public page and its answers reveal only the form's name and questions; unknown, closed and archived forms give the identical 404; strict validation; per-address and per-form rate limits; honeypot; audited without the answers; tested, and sabotage-checked by making it leak a project id. |
| Client data in the Job Register import | **pass** | `*.csv` and `import/` are git-ignored and tested; all test data is invented; previews, results, the audit trail and the server logs contain counts, row numbers and field names, never values (tests). A log-privacy test found and fixed typed search terms reaching logs through the URL (B-007). |
| Machine access (service accounts and tokens) | **pass** | Tokens are `dsk_` plus 43 random characters, shown once, only a SHA-256 hash stored, revocable, optional expiry, last-used time recorded; admin-only management in the browser, a token can never manage tokens; a token may call only routes that name its scope (two independent guards, sabotage-checked by breaking both); a service account has no password, no membership, never appears in the people directory and cannot sign in; every token call is audited under the account (reads as api.call, refusals as api.denied, writes through their own event; rate-limited refusals are not audited so a flood cannot fill the trail); per-token and per-address (bad guesses) rate limits; bad, revoked, expired and deactivated tokens look identical and never fall back to a cookie; token secrets appear in no log or audit row (tests); the token's id does appear in audit rows so an incident can say which token acted (A7). |
| Ingest endpoint | **pass** | Only a write-scoped token can call it (people, read tokens and signed-out callers cannot); strict validation with no way to name a project, an owner or an "unsorted" place; unroutable requests are rejected, create nothing and are audited as refusals; idempotent on the key, including simultaneous calls (the database enforces one project per kind and per client slug and one task per key); titles, descriptions, assignee text and tokens never appear in the audit trail or logs; tokens from one workspace only write to that workspace. |
| Deployment kit | **written, not run on a real machine; independent review found serious problems, batch 2 is fixing them** | The reviewer found that the settings and credential model contradicts itself (root-only files cannot be read by the service users, so an operator would loosen them), that the backup key and the upload credential share a user with the exploited-app risk, that the daily and monthly backups can be skipped silently, that the Caddy admin endpoint is open to the app user, and more (D1 to D16 below). **Until batch 2 is done, do not rely on the claim that a break-in cannot read or erase backup history.** Not tested: real systemd, Caddy, rclone or gcloud, cloud permissions, the firewall in force. |
| Sign-in hardening (second pass) | **pass, with corrections** | Hashing off the main thread, capped, with stored cost and upgrade on sign-in; idle timeout and session clean-up; plain 404; Permissions-Policy; common-password rule; repeated failures folded in the audit (revised by A1, below). The independent review found the lock-out race, the locked-account timing gap and the change-password bypass that this pass had missed; they are fixed in batch 1. |
| Form answers outlive tasks | **pass** | Deleting a task blanks its form submission (answers and submitter email) through a database trigger, including subtasks removed by cascade and any future delete path; tested, sabotage-checked. Backups keep older copies until they expire. |
| Audit trail content | **pass** | Audit rows hold ids, field names and non-text values only: no titles, descriptions, comment text, form answers, submitter emails, person names, project, section or form names, token labels or sign-in email addresses. Enforced in the one write path (`fieldsOnly` in `audit.js`: deny by default) and by a test that makes every kind of change with marker text in every free-text field and scans the rows (sabotage-checked two ways). Rows written before this change are not rewritten (the chain would break); use a fresh database before real data. The network address of the caller is still recorded. |
| Audit log screen and CSV | **pass** | Owners and admins only (a token, a member, a view-only seat and a guest are all refused, and each refusal is tested); only the caller's own workspace; its SQL lives in `store-audit.js`; the hash chain fields are never returned; anything shaped like a token, a password hash or a bearer header is removed again on the way out even if it was written into the log (sabotage-checked); the CSV carries names of changed fields, never before or after values; cells that start like a formula are neutralised; export is capped at 50,000 rows and is itself audited. Not penetration tested. |
| Read API for Zen | **pass** | Only a read-scoped token can call it; it sees only projects made by ingestion (Sales, Internal, client), proven against imported private projects, staff projects and private projects by id, job number and client slug (sabotage-checked two ways); never the people directory; the description is never returned; reads are audited under the service account by route pattern only, so no filter value, id or token reaches the audit trail or logs (tested); bad paging input is rejected; 1,200-task paging verified with no repeats or gaps. |
| Compliance wording | **pass** | Test: certification and residency words appear only next to "not certified" in the app and the README section. One screen title that broke the rule was fixed. |

## Not covered (be honest about these)

- No penetration test. One self-review (below) by the assistant that wrote the code, then an independent review by two other reviewers (below), which found real problems the self-review missed. Neither is a penetration test. About 45 hostile inputs were sent to the ingest and read routes by hand; that is a spot check, not fuzzing.
- No manual screen-reader pass; accessibility was checked with an automated scanner on 10 screens.
- The rate limiter, the open-window table for folded audit events and the unknown-email lockout counter are in memory (one server process).
- The session cookie is Secure automatically when `PUBLIC_URL` is https (and the app refuses to start if both are set against each other); on plain http it is not Secure. The proxy and TLS setup are not built or tested.
- No encryption of the database file at rest, no backup. Invite and reset links are passed on by the admin by hand: no email is sent, so how they are shared is outside the app.
- The public form has no CAPTCHA; the controls are rate limits and a honeypot. A determined spammer can still send up to the per-form hourly limit.
- SAML, SCIM, a machine-readable audit feed and key management are not built. Nothing here is certified to any standard.

## Self-review (2026-10-15, first pass, by the author)

> Some statements in this section were disproved by the independent review that follows it; see "Disproved by the independent review". The tables are kept as they were, with corrections marked.

Scope: sign-in and lockout, session cookies, token handling and rate limits, cross-site writes, input validation on the ingest and read
routes, headers, error messages, the public form, invite and reset links, and dependencies. Method: reading the code, running the
existing suites, about 45 hand-made hostile requests, and a package audit. Severity uses `bugs.md` (S1 security hole, data loss or core
flow blocked; S3 broken with a workaround; S4 cosmetic or hardening). **This is a self-review, not a penetration test, and nothing here is
certified.**

### Fixed in this pass (each has a test; the tests were sabotage-checked)

| id | sev | finding | fix |
| --- | --- | --- | --- |
| R-1 | **S1 once hosted** (not live while only run locally) | Behind a reverse proxy every request would appear to come from the proxy's address, so the per-address sign-in, bad-token and public-form limits would share one bucket: one visitor could lock everyone out of sign-in or the form, and audit rows would record the proxy's address | `TRUST_PROXY=true` makes the app trust a local proxy only (loopback) and take the right-most non-local forwarded address; a client cannot choose the counted address by sending its own header; off by default, where the header is ignored |
| R-2 | S3 | The session cookie's Secure flag defaulted to off with nothing tying it to https, so a forgotten setting would send the cookie over http | Secure is on automatically when `PUBLIC_URL` is https; https plus `COOKIE_SECURE=false` refuses to start; `Strict-Transport-Security` is sent when the cookie is Secure |
| R-3 | S3 | The rate-limit tables and the unknown-email lock table never forgot an entry, so a long-running process could grow without bound | finished windows are swept once a table passes 5,000 entries; live locks are kept |
| R-4 | S3 | `updated_since` on the read API accepted impossible times such as month 13 (no crash, but silently wrong) | validated as a real date and time, otherwise 400 |
| R-5 | S3 | The database folder and file were created with the default permissions, readable by other users on a shared machine | folder 0700 and file 0600 when the app creates them (SQLite's log files copy the file's mode); an existing folder is not changed, so the service should also run with a private umask |

### Proposed, not applied (your say-so needed)

| id | sev | finding | proposal |
| --- | --- | --- | --- |
| P-1 | S4 (design trade-off) | Five wrong passwords lock a known account for 15 minutes, so anyone who knows an email can keep a person locked out. An admin can unlock; unknown emails behave identically on purpose | **Not changed, as you decided** (no lockout redesign) |
| P-2 | S4 | **Superseded by A1.** The first version folded repeated failed sign-ins per account and address but still wrote a row for every unknown email, into a workspace chosen by the request, so anyone could fill any tenant's trail | see A1 below |
| P-3 | S4 | **DONE.** Password hashing ran on the main thread, at a cost below current recommendations | Hashing and checking use worker threads, at most two at a time, with a queue of 100 and then a 503 with Retry-After; cost raised from N=16384 to N=65536 (64 MB, about a quarter of a second); the cost is stored in each hash, and a correct sign-in replaces a weaker hash with a current one; stored hashes with absurd costs are refused unread. **Limit:** until each existing person signs in once after the upgrade, their check is cheaper than the stand-in check for an unknown email, so timing could reveal that such an account exists; new accounts and the first owner are hashed at the current cost from the start |
| P-4 | S4 | **DONE.** The framework's 404 echoed the requested path | Every unknown address gets `{"error":"We could not find that."}` |
| P-5 | S4 | **Partly done.** `Permissions-Policy` added; sessions now end after 2 hours unused (`SESSION_IDLE_MINUTES`, default 120) as well as after 12 hours, and expired, revoked or long-idle sessions are deleted at start and every six hours (one `session.cleanup` audit row with a count). **Not done, as you decided:** the `__Host-` cookie prefix | skipped by decision |
| P-6 | S4 | **Partly done.** The rule is now 12 characters and not one of a short list of the most common passwords (and simple variations such as a common word plus digits, or keyboard and alphabet runs), at every place a password is set; generated passwords are never refused. It is a floor, not a breached-password check. Custom admin rules are still not built | a larger list or a breached-password service would need a decision |
| P-7 | blocker, not a finding | Two code items from the hosting plan: a first-owner command (**built**, `npm run first-owner`) and a backup command (**built**, `npm run backup` and `npm run restore`; AES-256-GCM, key from the environment, checks before upload and before replacing) | built and tested |
| P-8 | note | `node:sqlite` is marked experimental by Node, and the proxy must overwrite the forwarded address header (the app copes with an appended one but not with a proxy that passes a client's header through untouched from a non-local source) | pin the Node version, watch release notes; put the proxy settings in the runbook |

### Checked and found sound

- **Roles and tenancy:** route walk with seven callers plus tokens (unchanged, passing). Cross-project and cross-workspace ids in request bodies (parent task, dependency, section, assignee, project member) are refused.
- **SQL:** every statement is prepared; the few built from fragments use fixed column lists chosen by validated field names, never typed text.
- **Cross-site writes:** a write with a foreign Origin is refused; cookies are HttpOnly and SameSite=Lax; no route that changes data answers GET; a form-encoded or text body is refused.
- **Tokens:** `dsk_` plus 43 random characters, only a hash stored, shown once, never accepted in a URL, removed from logs and the audit trail; no fallback to a cookie when a bearer is sent; bad tokens look identical.
- **Ingest and read validation:** 45 hostile inputs (bad and impossible dates, wrong types, control characters, oversize bodies, array and object values, extra fields, prototype keys, bad cursors and limits) all gave 400, 413 or 415; none gave a 500.
- **Errors:** server faults say only "Something went wrong on our side"; hidden and missing projects both answer 404; bad credentials give one message; no stack traces or SQL text leave the server.
- **Public form and links:** per-address and per-form limits, honeypot, uniform answers for unknown, closed and archived forms; invite and reset links are 32 random bytes, hash-stored, single use, expiring, throttled and give one message for every bad case.
- **Dependencies:** `npm audit` reports 0 known vulnerabilities (fastify 5.12.5, @fastify/cookie 11.1.3, @fastify/static 10.1.6, zod 4.6.6). That only covers advisories published so far.

### Not verified

No penetration test or independent review; no timing measurements of sign-in; no load or denial-of-service testing; the reverse proxy, TLS and
the VM are not built, so none of that is tested; the browser code is guarded by tests that ban unsafe DOM writes, but was not reviewed line by
line for script injection; backups, restore and forget-me are plan only.

## Independent review (2026-10-15): two reviewers, one for the app and one for the deployment kit, at commit f555ab0

Both were told to read the code as a hostile outsider and not to read this file first. Every finding below was re-checked by the author before being accepted
(reproduced by running it, or confirmed by reading the exact lines). The reviewers did **not** find a way to read or write across workspaces, a privilege
escalation to owner, SQL injection, or script injection in the web pages. They did find the problems below. **This is still not a penetration test, and nothing here is certified.**

Status words: **fixed** (code changed, a test added, and the fix broken on purpose to prove the test fails), **open** (batch 2, not done yet), **documented** (a decision, written down),
**skipped, known and accepted** (a decision of the owner, not a fix).

### Application

| id | sev | finding | status |
| --- | --- | --- | --- |
| A1 | S2 | An anonymous caller could write rows into any tenant's append-only audit log (the workspace came from the request body); a read-token poller could do the same at 600 a minute; writes slowed as the log grew | **fixed (batch 1).** The workspace is taken from the person's own memberships, never from the request. Attempts for accounts that do not exist write nothing; they are counted and the count goes to the application log once a minute. Token reads are folded per token, route and status in 5-minute windows with a count and the token id. The table of open windows is bounded: when full, events are dropped and counted, and one `audit.rows_dropped` row says how many. Index `audit_events(workspace_id, seq)` added (the query plan no longer sorts). **Still true:** someone who knows a real person's email can add folded failure rows to that person's own workspace, at most one per window per address |
| A2 | S2 | Reset links, invite links and public form addresses were written to the application log (the request path) | **fixed.** The log carries the route pattern (`/api/v1/resets/:token`), never the address. Unknown addresses log as the catch-all route |
| A3 | S2 | `restore --replace` deleted the old database's write-ahead log, so the "kept" copy lost the newest committed rows after a crash | **fixed.** The log moves aside with its file; the restored file never inherits it. Tested with a process killed mid-write |
| A4 | S3 | Concurrent wrong guesses did not move the failure counter (read, wait for hashing, add one), so the lock-out could be bypassed | **fixed.** One atomic `UPDATE ... RETURNING`, the lock decided from the number that comes back, and the lock state re-read after hashing. This **disproves the earlier claim** that the counter "still counts every failure" |
| A5 | S3 | The change-password route let a stolen session guess the current password without limit | **fixed.** It uses the same counter and lock-out as sign-in, and a successful change resets the count |
| A6 | S3 | A reset did not end the person's sessions, and there was no way to offboard a person | **fixed.** Issuing a reset ends their sessions; `POST /members/:id/deactivate` (owners and admins; not yourself; an admin cannot deactivate an owner; refused for someone in two workspaces) ends every session, blocks sign-in, and takes them out of assignee lists. A button on People. Their tasks and history stay |
| A7 | S3 | Audit rows for service tokens said `[not recorded]` where the token id should be, so the log could not say which token acted | **fixed.** The id is recorded (it names a token without being one); tokens and hashes still never are |
| A8 | S3 | A locked real account answered faster than an unknown email: a timing oracle for which emails are accounts | **fixed.** The locked path does the same work; tested by timing at a moderate cost. Not measured at production cost |
| A9 | S3 | An admin could probe whether any email is a user anywhere (409 on create and invite) | **skipped, known and accepted** (owner's decision). It needs an admin's session. A cross-tenant existence probe is possible for admins |
| A10 | S3 | A create-tasks-only token could map the staff directory through the assignee warnings | **fixed in part.** The caller now gets one generic `unresolved` warning; the reason stays in the audit trail. **Not removed:** the response (and the task, if read back) still tells the token holder whether its assignee text matched someone, which is the information Zen needs to do its job |
| A11 | S3 | The read API ignores a project's visibility setting | **documented, no code change (owner's decision).** The read token reads every project that ingestion created (Sales, Internal, client projects), whatever the project's visibility says in the screens, and includes human-written tasks in those projects. The control is the token: **revoking it ends that access at once**. Treat a read token as able to read all ingested work and its assignee names and emails |
| A12 | S3 | `updated_since` given to the second missed rows updated within that second | **fixed.** Compared at millisecond precision |
| A13 | S3 | Rejected posts used up a public form's hourly cap, so one person with the link could shut the form for an hour | **fixed.** Only accepted submissions count toward the hourly cap; the per-address limit still applies to everything |
| A14 | S3 | `npm run seed` deleted whatever database it was pointed at without asking | **fixed.** It refuses if the file exists unless `--force` is given. The credentials file location can be set with `DEMO_CREDENTIALS_FILE` so tests never touch yours |
| A15 | S3 | A single owner could be kept locked out indefinitely | **fixed.** `npm run break-glass -- unlock --email ...` and `-- reset --email ...` (a one-time link, shown once, terminal only; ends their sessions). Needs shell access to the machine; every use is audited as a system action, ids only. Lock-out itself is unchanged, as decided |
| A16 | S3 | A temporary password never expired and never had to be changed | **fixed.** A password an admin (or the first-owner command) chose must be replaced at the first sign-in: until then every route except session, change-password and sign-out answers 403 with `mustChangePassword`, and the web app shows only the Account page. A temporary password unused for 7 days stops working |
| A17 | S3 | A modest botnet could saturate the hashing queue (503 for everyone) | **skipped, known and accepted** (owner's decision) |

Small items from the reviewer's S4 list: **fixed** (1) an https `PUBLIC_URL` is required when `NODE_ENV=production` (the service unit sets it), and (2) an all-zero or patterned backup key is refused.
**Skipped, known and accepted:** the Fastify bad-URL error still echoes a path; no rollback protection in the restore (batch 2 adds authenticated names); no decompression size cap; bidi characters accepted in names; admin can reset another admin's password (by design); no password Unicode normalisation; unlimited ingestion project creation; `BACKUP_KEY` in the app's environment is addressed in batch 2.

### Deployment kit (replica/deploy/)

All of these were reproduced or confirmed by reading the files. **None is fixed yet; batch 2 is the plan.**

| id | sev | finding | status |
| --- | --- | --- | --- |
| D1 | S1 | The settings and credential model contradicts itself: the files are "root-owned 0600, readable by the service through systemd", but systemd only loads variables, so the upload tool and the drill cannot open the credential files as the service user. An operator will loosen them, and then an exploited app can read the upload credential, the drill credential and `BACKUP_KEY`. The "a break-in cannot read or erase the history" claim does not hold | **open (batch 2)** |
| D2 | S2 | The app, the backup, check, drill and first-owner scripts all run as one user; a same-user process can read the backup run's environment, and an exploited app can plant `.npmrc` in the home folder the hand-run drill uses | **open (batch 2)** |
| D3 | S2 | `BACKUP_KEY` is in the app's environment; backup names and times are not authenticated, so a forged "newest" name defeats the freshness check, and an old ciphertext can be renamed newer and restored | **open (batch 2)** |
| D4 | S2 | Daily and monthly backups are silently skipped (exit 0) when another run holds the lock, and all timers fire together after downtime | **open (batch 2)** |
| D5 | S2 | The Caddy admin endpoint is unauthenticated and reachable by the app user | **open (batch 2)** |
| D6 | S2 | `gsutil` ignores `GOOGLE_APPLICATION_CREDENTIALS`, so the create-only key may never be used | **open (batch 2)** |
| D7 | S2 | The create-only upload recipe will probably not work as written, and "keep the last N" cannot be a provider rule | **open (batch 2: documentation, tested scripts where possible)** |
| D8 | S2 | `/var/log/caddy` is created root-owned but Caddy runs as `caddy` (not verified, Caddy not installed here) | **open (batch 2)** |
| D9 | S3 | IPv6 "whole internet" ranges pass the SSH range check | **open (batch 2)** |
| D10 | S3 | The freshness check's unit does not load `BACKUP_DEST`, so its stuck-copies alert never fires | **open (batch 2)** |
| D11 | S3 | A hostile object name breaks the check and the drill (`basename -x`) | **open (batch 2)** |
| D12 | S3 | The drill can print PASS without proving anything | **open (batch 2)** |
| D13 | S3 | The drill's `rm -rf` guard is only "the path contains drill"; the scratch folder is predictable | **open (batch 2)** |
| D14 | S3 | The settings example claims the app refuses to start on a placeholder; it does not | **open (batch 2)** |
| D15 | S3 | The Caddy placeholder guard does nothing when run as the caddy user against a root-only file | **open (batch 2)** |
| D16 | S3 | One global rate bucket on the SSH rule lets spoofed packets lock the owner out | **open (batch 2: documentation and a per-source meter)** |

### Disproved by the independent review (corrections made above)

- "The lock counter still counts every failure" (the old P-2 row): false under concurrent guesses (A4).
- "Failed sign-ins are recorded once per account and address per window": true for known accounts only; unknown emails each wrote a row, into a workspace the request chose (A1).
- "Tokens are removed from logs": true for tokens, false for reset and invite links and form addresses in the request path (A2).
- "Audit rows say which token acted": they said `[not recorded]` (A7).
- "Restore keeps the old database": it kept the file and discarded its write-ahead log (A3).
- "A break-in cannot read or erase backup history" (deployment kit): not true as the kit is written (D1 to D3).
- "The app refuses to start while a placeholder is in place" (settings example): not true (D14).

### Not reviewed by either reviewer, and not verified

Caddy itself (not installed here); real rclone, `gcloud` or `gsutil`; real cloud permissions; a running systemd (so the syscall filter against Node is untested); the firewall in force; SQLite's behaviour when restoring a crafted database file;
production-cost timing; real browsers; the end-to-end browser tests (run by the author, not by the reviewers); SSH daemon settings; fail2ban or ufw interaction; the provider's network firewall. `npm audit` reported 0 vulnerabilities, but the reviewer had no advisory database reachable, so that is also not independently verified.
