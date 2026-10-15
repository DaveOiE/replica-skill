# Test plan and results (Gauge, after Zen phase 4a)

Suites, all passing at the time of writing: **138 JavaScript** (API, permissions, data, importer, forms, web hygiene),
**69 Python** (the pack's tools and the brand sweep gate), **52 browser** (real Chromium at 390px and 1440px, including an
accessibility scan of the earlier screens plus the audit log screen and the badge views). Total 259. Run them: `npm test`, `python3 -m unittest discover -s tests`,
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
