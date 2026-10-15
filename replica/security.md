# Security basics (Gauge, pilot version)

Each line is something checked by a test that is in the suite, not a statement of intent. This is a
demo build. It is **not certified** to any standard and makes no compliance claim.

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
| Compliance wording | **pass** | Test: certification and residency words appear only next to "not certified" in the app and the README section. One screen title that broke the rule was fixed. |

## Not covered (be honest about these)

- No penetration test, no manual security review, no fuzzing.
- No manual screen-reader pass; accessibility was checked with an automated scanner on 10 screens.
- The rate limiter and the unknown-email lockout counter are in memory (one server process).
- Sessions use a cookie without the Secure flag unless `COOKIE_SECURE=true` (needed behind HTTPS).
- No encryption of the database file at rest, no backup. Invite and reset links are passed on by the admin by hand: no email is sent, so how they are shared is outside the app.
- The public form has no CAPTCHA; the controls are rate limits and a honeypot. A determined spammer can still send up to the per-form hourly limit.
- SAML, SCIM, audit export and key management are not built. Nothing here is certified to any standard.
