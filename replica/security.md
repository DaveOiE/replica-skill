# Security basics (Gauge, after the pre-hosting review, 2026-10-15)

Each line is something checked by a test that is in the suite, not a statement of intent. This is a
build that has **not been penetration tested** and is **not certified** to any standard. It makes no compliance claim.
The pre-hosting review is at the end of this file.

| check | result | evidence |
| --- | --- | --- |
| Roles are enforced on the server | **pass** | The route walk calls every API route as signed-out, owner, admin, member, view-only, guest and a user from another workspace, and compares with the permission rules (404 hidden, 403 refused, 2xx allowed). Sabotage-checked: removing the permission check, and uncapping view-only seats, both fail the tests. |
| View-only and guests cannot change what they should not | **pass** | Dedicated walk: view-only never gets a successful write; guests write only tasks and comments in projects they were added to; guests are never project admins. |
| Another workspace sees nothing | **pass** | Tenancy test: lists, projects, tasks, people and reports from the other workspace never include this workspace's data; hidden items answer 404. |
| An audit entry for every change | **pass** | The walk requires an audit row for every successful write on every route; the change and the row commit in one transaction (a failing change leaves no row); the chain is hash-linked, edits and deletes are blocked by the database, and verification finds tampering. |
| Audit trail holds no secrets | **pass** | Test greps the whole trail after running every route: no password, hash or temporary password. Redaction by key name as a second layer. |
| No secrets in the repo | **pass** | Hygiene tests scan every tracked file for private keys, key and token shapes, JWTs and stored hashes; check that env files, keys, databases and local data are not tracked; `.env.example` has names and harmless defaults only. |
| Seed data is fake | **pass** | Test: every address is on the reserved `example.test` domain; names are invented; passwords are random on each seed and written only to a gitignored file. |
| Dependencies | **pass** | `npm audit`: 0 vulnerabilities across 77 packages. |
| Input validated on the server | **pass** | Every route with a body uses a strict schema; unknown fields are refused. |
| Stored text cannot run | **pass** | No `innerHTML` anywhere (test); markup typed as a title is shown as text (browser test). |
| Sessions, sign-in abuse | **pass** | HTTP-only same-site cookie; sessions stored as hashes; sign-out and password change end sessions on the server; lockout after 5 failures that treats unknown emails the same; sign-in rate limit; cross-site writes refused. |
| Links and tokens (invites, resets) | **pass** | Only a hash is stored; shown once; single use; expire; invalid, expired and used links give the identical answer; public routes are rate limited; the audit trail never holds a token (tests). Resets are refused for yourself, for owners (unless you are one) and for anyone in more than one workspace (sabotage-checked). |
| Public request form | **pass** | The public page and its answers reveal only the form's name and questions; unknown, closed and archived forms give the identical 404; strict validation; per-address and per-form rate limits; honeypot; audited without the answers; tested, and sabotage-checked by making it leak a project id. |
| Client data in the Job Register import | **pass** | `*.csv` and `import/` are git-ignored and tested; all test data is invented; previews, results, the audit trail and the server logs contain counts, row numbers and field names, never values (tests). A log-privacy test found and fixed typed search terms reaching logs through the URL (B-007). |
| Machine access (service accounts and tokens) | **pass** | Tokens are `dsk_` plus 43 random characters, shown once, only a SHA-256 hash stored, revocable, optional expiry, last-used time recorded; admin-only management in the browser, a token can never manage tokens; a token may call only routes that name its scope (two independent guards, sabotage-checked by breaking both); a service account has no password, no membership, never appears in the people directory and cannot sign in; every token call is audited under the account (reads as api.call, refusals as api.denied, writes through their own event; rate-limited refusals are not audited so a flood cannot fill the trail); per-token and per-address (bad guesses) rate limits; bad, revoked, expired and deactivated tokens look identical and never fall back to a cookie; tokens appear in no log or audit row (tests). |
| Ingest endpoint | **pass** | Only a write-scoped token can call it (people, read tokens and signed-out callers cannot); strict validation with no way to name a project, an owner or an "unsorted" place; unroutable requests are rejected, create nothing and are audited as refusals; idempotent on the key, including simultaneous calls (the database enforces one project per kind and per client slug and one task per key); titles, descriptions, assignee text and tokens never appear in the audit trail or logs; tokens from one workspace only write to that workspace. |
| Deployment kit | **written, not run on a real machine** | Unit files run the app as an unprivileged user with a read-only system, one writable folder, no capabilities and a system-call filter (checked structurally and with `systemd-analyze verify`); Caddy sets the caller's address itself and passes the app's headers through (structural check only, Caddy is not installed here); the firewall opens only 80, 443 and one SSH range (checked with `nft -c`); the scripts are run against a fake upload tool: create-only upload, checks before and after, alerts, restore drill that cannot touch the live database. No secret or real address in any file (scanned). **Not tested:** real systemd, Caddy, rclone or gsutil, cloud permissions, the firewall in force. A create-only credential is only as write-only as the permissions you give it: prove it (README step 11) |
| Sign-in hardening (second pass) | **pass** | Repeated failures folded in the audit with a count; hashing off the main thread, capped, with stored cost and upgrade on sign-in; idle timeout and session clean-up; plain 404; Permissions-Policy; common-password rule. `s4-hardening.test.js` (11 tests); each item sabotage-checked. Still a self-review, not a penetration test. |
| Form answers outlive tasks | **pass** | Deleting a task blanks its form submission (answers and submitter email) through a database trigger, including subtasks removed by cascade and any future delete path; tested, sabotage-checked. Backups keep older copies until they expire. |
| Audit trail content | **pass** | Audit rows hold ids, field names and non-text values only: no titles, descriptions, comment text, form answers, submitter emails, person names, project, section or form names, token labels or sign-in email addresses. Enforced in the one write path (`fieldsOnly` in `audit.js`: deny by default) and by a test that makes every kind of change with marker text in every free-text field and scans the rows (sabotage-checked two ways). Rows written before this change are not rewritten (the chain would break); use a fresh database before real data. The network address of the caller is still recorded. |
| Audit log screen and CSV | **pass** | Owners and admins only (a token, a member, a view-only seat and a guest are all refused, and each refusal is tested); only the caller's own workspace; its SQL lives in `store-audit.js`; the hash chain fields are never returned; anything shaped like a token, a password hash or a bearer header is removed again on the way out even if it was written into the log (sabotage-checked); the CSV carries names of changed fields, never before or after values; cells that start like a formula are neutralised; export is capped at 50,000 rows and is itself audited. Not penetration tested. |
| Read API for Zen | **pass** | Only a read-scoped token can call it; it sees only projects made by ingestion (Sales, Internal, client), proven against imported private projects, staff projects and private projects by id, job number and client slug (sabotage-checked two ways); never the people directory; the description is never returned; reads are audited under the service account by route pattern only, so no filter value, id or token reaches the audit trail or logs (tested); bad paging input is rejected; 1,200-task paging verified with no repeats or gaps. |
| Compliance wording | **pass** | Test: certification and residency words appear only next to "not certified" in the app and the README section. One screen title that broke the rule was fixed. |

## Not covered (be honest about these)

- No penetration test. One self-review pass (below) by the same assistant that wrote the code, which is not independent. About 45 hostile inputs were sent to the ingest and read routes by hand; that is a spot check, not fuzzing.
- No manual screen-reader pass; accessibility was checked with an automated scanner on 10 screens.
- The rate limiter and the unknown-email lockout counter are in memory (one server process).
- The session cookie is Secure automatically when `PUBLIC_URL` is https (and the app refuses to start if both are set against each other); on plain http it is not Secure. The proxy and TLS setup are not built or tested.
- No encryption of the database file at rest, no backup. Invite and reset links are passed on by the admin by hand: no email is sent, so how they are shared is outside the app.
- The public form has no CAPTCHA; the controls are rate limits and a honeypot. A determined spammer can still send up to the per-form hourly limit.
- SAML, SCIM, a machine-readable audit feed and key management are not built. Nothing here is certified to any standard.

## Pre-hosting review (2026-10-15)

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
| P-2 | S4 | **DONE.** Failed sign-ins were each an audit row, and the trail is append-only | Repeated failures are written once per account and address in each 5-minute window, then summarised with a count when the window ends or the app stops (`auth.signin_repeated`); lock-outs and successful sign-ins are always written in full; the lock counter still counts every failure. The first row of each window is still written, so a flood from many addresses still adds rows; the disk alert remains the backstop |
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
