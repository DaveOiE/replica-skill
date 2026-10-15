# Test plan and results (Gauge, after Zen phase 4a)

Suites, all passing at the time of writing: **212 JavaScript** (API, permissions, data, importer, forms, web hygiene),
**69 Python** (the pack's tools and the brand sweep gate), **52 browser** (real Chromium at 390px and 1440px, including an
accessibility scan of the earlier screens plus the audit log screen and the badge views). Total 335. Run them: `npm test`, `python3 -m unittest discover -s tests`,
`npx playwright test`.

## Flows from the recon map

| flow | what | state | how it is tested |
| --- | --- | --- | --- |
| F01 sign in | password sign-in | **tested** | API: lockout, rate limit, cookie flags, sign-out, expiry; browser: wrong then right password, keyboard only, back button after sign-out, session ending mid-use. SSO part not built |
| F02 plan a project | create, sections, tasks, list view | **tested** | API per entity; browser: create task, change status, subtasks. Templates not built |
| F03 work a task | assign, comment, dependencies, close | **tested** | API incl. loop refusal and blocked-close rules; browser drawer. Time tracking not built |
| F04 intake by form | forms | **built** (no branching) | see F16 |
| F05 automate | rules | **one rule only** | see F16 |
| F06 see progress | dashboard | **partly tested** | hand-counted numbers, per-role visibility, browser tiles and charts. Status updates, portfolios and goals not built |
| F07 approve work | approvals | not built | later list |
| F08 SSO set up | SAML | not built | later list |
| F09 SCIM lifecycle | provisioning | not built | later list |
| F10 guest and view-only | restricted roles | **tested** | route walk across five roles, guest added to one project, view-only read-only in the browser; invites by link, admin reset and unlock tested end to end |
| F15 job register | import and Jobs view | **tested** | invented sample with #REF! cells, J1234P, duplicates and a combined client: counts, cleaning, idempotency, audit, privacy of responses, audit and logs; browser at 390px and 1440px |
| F16 public request form | form builder, public link, assignment rule | **tested** | public page reveals nothing internal, identical 404s, validation, rate limits, honeypot, audit, rule failing safely; browser from builder to the assigned person's task |
| form answers after task delete | form submissions | **tested** | `forget-submissions.test.js`: task delete blanks answers and email, other submissions untouched, subtasks, plain SQL delete and project cascade, migration backfill; sabotage-checked |
| hardening review | proxy address, cookie and HSTS, table growth, read dates, file modes | **tested** | `security-hardening.test.js` (5 tests); sabotage-checked by switching off the proxy setting and the sweep |
| first owner command | CLI | **tested** | `first-owner.test.js` (5 tests): creates the owner, password works and is stored only as a hash, never in the audit trail or on disk, shown once, refuses when an owner exists (including demo data) and a pipe; sabotage-checked by removing the owner check and by putting the password in the audit summary |
| backup and restore | CLI and library | **tested** | `backup.test.js` (7 tests): backup then restore to a new file with the same row counts in every table and a verified audit chain; app keeps writing during backups; encrypted file shows no plaintext; wrong key, changed byte, short or foreign file fail without touching the target; a copy with a broken chain is never uploaded; no silent overwrite and the old file kept aside; any destination object works; the CLI never prints the key. Sabotage-checked three ways. Not tested against a cloud store (none built) or at production size |
| second hardening pass | sign-in, hashing, sessions, headers, passwords | **tested** | `s4-hardening.test.js` (11 tests): folded failure rows with exact counts and no email text, summaries on window end and on shutdown; hashing does not block the event loop at the production cost; old hash upgraded after a correct sign-in only; hostile stored hashes refused; flood answered 503; idle timeout and 12 hour limit; cleanup removes only dead sessions; plain 404; Permissions-Policy; common passwords at change, invite and reset. Eight sabotage checks, all failed the suite as they should |
| runbook matches code | docs | **tested** | `runbook.test.js`: pinned Node version is exact, satisfies the engine minimum and appears in the runbook; every setting the runbook explains is read by the code; every command it shows exists in package.json; sabotage-checked by renaming a script and by changing the pinned version |
| deployment kit | files in replica/deploy | **tested against fakes** | `deploy-kit.test.js` (18 tests): inventory and step order; secret and address scan; settings files valid for systemd and the shell and tied to the app's loader and the Node pin; unit lint plus `systemd-analyze verify` and calendar checks; script lint; Caddyfile directives; firewall built and checked with `nft -c`, bad ranges refused; backup.sh, backup-check.sh, restore-drill.sh, check-node.sh and alert.sh run end to end against a fake rclone and a local alert receiver, with real encrypted backups, a real restore and a real throw-away app. Eleven sabotage checks all failed the suite. **Not tested:** anything on a real machine |
| independent review, batch 1 | A1 to A8, A10, A12 to A16, two S4 items | **tested** | `review-batch1.test.js` (23 tests) plus corrections in the older suites: anonymous attempts write nothing, the workspace comes from membership, bounded fold table with a drop counter, folded token reads, the index plan, no secrets in the log, restore keeps the write-ahead log, atomic lock-out under 30 parallel guesses, shared lock-out on password change, timing parity for locked accounts, sessions end on reset and deactivation, token ids in audit rows, generic assignee warning, millisecond `updated_since`, form cap counts accepted posts only, seed refuses without `--force`, break-glass unlock and reset, forced password change and expiry, https required in production, weak backup keys refused; browser test for Deactivate on People at 390px and 1440px. Each fix was broken on purpose and the suite failed (two gaps found that way and closed) |
| audit content | audit rows | **tested** | `audit-redaction.test.js`: every kind of write (projects, sections, tasks, comments, dependencies, forms and public submissions, people, invites, project members, service accounts and tokens, workspace, failed sign-ins, ingest, job import) made with marker text everywhere, every audit row scanned; a careless writer is still reduced to field names; sabotage-checked |
| F11 audit export | audit screen and CSV | **tested** (CSV for people only) | API: owners and admins only, tokens and other roles refused, filters, paging, other workspace, strict input, CSV quoting and formula neutralising, no before or after values, token and hash shaped text scrubbed (sabotage-checked), export audited; browser: filters, load more, download, at 390px and 1440px, axe clean. The JSON or NDJSON feed for systems is not built |
| F12 bundle share | workflow bundles | not built | later list |
| F13 backup | backup | not built | later list |
| F14 AI stub | AI features | not built | later list |

## Edge cases from the skill's list

| case | result |
| --- | --- |
| empty input | refused with plain field messages (API tests) |
| very long input (300-character title, 60 and more) | wraps, no horizontal scroll at 390px |
| emoji and accents | works (browser test) |
| double click on submit | **bug found and fixed** (B-004); the public form and the add forms use the same guard (tested) |
| back button | after sign-out the app is not shown |
| expired session | **bug found and fixed** (B-005) |
| second user's data | invisible: 404 for hidden projects and tasks, other workspace sees nothing |
| mobile width and keyboard only | 390px and 1440px checked on every screen built; keyboard sign-in and Escape tested |
| screen reader labels | axe (automated) clean on 10 screens; **no manual screen-reader pass was done** |
| two tabs at once, slow network, offline, time zones, daylight saving | **not tested** (dates are plain dates and UTC) |
