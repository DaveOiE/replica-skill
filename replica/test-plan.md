# Test plan and results (Gauge, 2026-10-12)

Suites, all passing at the time of writing: **78 JavaScript** (API, permissions, data, web hygiene),
**69 Python** (the pack's tools and the brand sweep gate), **27 browser** (real Chromium at 390px and
1440px, including an accessibility scan of 10 screens). Total 174. Run them: `npm test`,
`python3 -m unittest discover -s tests`, `npx playwright test`.

## Flows from the recon map

| flow | what | state | how it is tested |
| --- | --- | --- | --- |
| F01 sign in | password sign-in | **tested** | API: lockout, rate limit, cookie flags, sign-out, expiry; browser: wrong then right password, keyboard only, back button after sign-out, session ending mid-use. SSO part not built |
| F02 plan a project | create, sections, tasks, list view | **tested** | API per entity; browser: create task, change status, subtasks. Templates not built |
| F03 work a task | assign, comment, dependencies, close | **tested** | API incl. loop refusal and blocked-close rules; browser drawer. Time tracking not built |
| F04 intake by form | forms | not built | later list |
| F05 automate | rules | not built | later list |
| F06 see progress | dashboard | **partly tested** | hand-counted numbers, per-role visibility, browser tiles and charts. Status updates, portfolios and goals not built |
| F07 approve work | approvals | not built | later list |
| F08 SSO set up | SAML | not built | later list |
| F09 SCIM lifecycle | provisioning | not built | later list |
| F10 guest and view-only | restricted roles | **tested** | route walk across five roles, guest added to one project, view-only read-only in the browser. Invites replaced by add-a-person |
| F11 SIEM export | audit export | not built | the trail is recorded and its chain verified by tests; no export screen or API |
| F12 bundle share | workflow bundles | not built | later list |
| F13 backup | backup | not built | later list |
| F14 AI stub | AI features | not built | later list |

## Edge cases from the skill's list

| case | result |
| --- | --- |
| empty input | refused with plain field messages (API tests) |
| very long input (300-character title, 60 and more) | wraps, no horizontal scroll at 390px |
| emoji and accents | works (browser test) |
| double click on submit | **bug found and fixed** (B-004) |
| back button | after sign-out the app is not shown |
| expired session | **bug found and fixed** (B-005) |
| second user's data | invisible: 404 for hidden projects and tasks, other workspace sees nothing |
| mobile width and keyboard only | 390px and 1440px checked on every screen built; keyboard sign-in and Escape tested |
| screen reader labels | axe (automated) clean on 10 screens; **no manual screen-reader pass was done** |
| two tabs at once, slow network, offline, time zones, daylight saving | **not tested** (dates are plain dates and UTC) |
