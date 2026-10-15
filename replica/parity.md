# Parity report (Gauge, after Zen phase 4a)

Two honest numbers, because the build was cut to a demo and then a pilot on purpose.

| scored against | feature score | must-haves done | what it means |
| --- | --- | --- | --- |
| **the full public feature list** (62 counted rows) | **35.0 / 100** | 11 of 22 | A small part of the list. Not shippable as an enterprise product. |
| **the demo and pilot scope** (18 counted rows) | **91.0 / 100** | 11 of 14 | Pilot-ready for a small team. The three partial must-haves are: dashboards (fixed widgets, no chart builder), automation (one rule type only) and the mobile checks on later screens. |

The layout score is **not measured**: this was a clean-room build and no reference screenshots of the original were captured.

Verdict by the pack's rule (shippable needs every must-have done and 80 or more): **not shippable** against the full list.
As a pilot for a small team: **pilot-ready**, with no open S1, S2 or S3 bug. The pilot items (reset, unlock, invites, the Job
Register importer and Jobs view, the request form) are extras the original list does not name, so they are not scored.

## Built, partial, stubbed, missing

- **Built and tested:** the Zen ingest endpoint, task fields and read API (phases 2 and 3; extras, so not scored); service accounts with scoped tokens (Zen phase 1); workspaces, roles and password sign-in; task fields, comments, subtasks, milestones, dependencies; projects and sections; list and board views; unlimited guests; per-project admin controls; view-only seats; **forms that create tasks** (no branching, no customisation). Extras: add a person, change own password, admin password reset and unlock, invites by link, Job Register import, Jobs view, public request form.
- **Partly built:** dashboards (fixed widgets only); rules automation (one rule type: assign new form requests to a chosen person); mobile-friendly web app (every screen built is checked at 390px and 1440px).
- **Stubs and mocks: none.** Nothing is faked. SAML, SCIM, connectors, hooks and AI features are **not built**.
- **Not built, later list (124 points):** the JSON and NDJSON audit feed for other systems (the audit log screen and its CSV export were built in Zen phase 4a); calendar and timeline views; custom fields; form branching and customisation; time tracking; status updates; portfolios; goals; workload and capacity; approvals and proofing; universal reporting; SAML and SCIM; the admin console and security settings; bundles; branding and onboarding; backup; integrations; DLP and archiving hooks; support page; compliance documents (all would be labelled not certified); AI features; attachments; project templates; the Toggl connector and time tracking (skipped by default).
- **Left out on purpose (not scored):** a catalogue of 100+ connectors; native mobile apps.

## The tool's own output, full list

features 32.7  (62 counted, must-haves 10 of 22 done)

Not shippable yet: 12 must-have features are not done.

## By area, weakest first
- custom fields                  0.0  (1 features)
- time                           0.0  (1 features)
- integrations                   0.0  (2 features)
- portfolios                     0.0  (2 features)
- goals                          0.0  (1 features)
- capacity                       0.0  (1 features)
- approvals                      0.0  (2 features)
- sso                            0.0  (1 features)
- provisioning                   0.0  (2 features)
- security                       0.0  (1 features)
- backup                         0.0  (1 features)
- audit                          see the recount below (1 of 2 built: the screen and CSV export; the JSON feed is later)
- compliance                     0.0  (5 features)
- support                        0.0  (1 features)
- ai                             0.0  (5 features)
- admin                         20.0  (9 features)
- reporting                     30.0  (2 features)
- projects                      42.9  (3 features)
- forms                         50.0  (3 features)
- automation                    50.0  (1 features)
- shell                         50.0  (1 features)
- views                         54.5  (4 features)
- access                        60.0  (4 features)
- tasks                         86.7  (6 features)
- foundation                   100.0  (1 features)

## Missing, in build order
- [must] admin: Admin console: settings and access, no
- [must] admin: Admin console: teams, no
- [must] audit: Audit API suited to SIEM export, no  (CSV for people is built; the JSON or NDJSON feed for systems is later)
- [must] custom fields: Custom fields: text, number, date, single and multi select, no  (A2)
- [must] provisioning: SCIM deprovisioning, no  (deactivation ends sessions)
- [must] provisioning: SCIM provisioning, no  (SCIM 2.0 against a local test client)
- [must] sso: SAML single sign-on, no  (local mock IdP only)
- [must] views: Calendar view, no
- [must] automation: Rules automation: trigger, condition, action, partial  (PILOT item 3: ONE rule type only, "assign new requests from a form to a chosen person"; every run is recorded; if the person loses access the task is still created, unassigned, and the problem is shown to admins. No conditions, no other triggers or actions)
- [must] reporting: Reporting dashboards with custom charts, partial  (Demo slice built: four number tiles, tasks by status, open tasks by person, progress by project, each chart with a numbers table, counting only projects the viewer can see. NOT built: choosing or building your own charts (custom chart builder is later))
- [must] shell: Mobile-friendly web app, partial  (M1 and M2: shell, sign-in, projects, list view and task drawer checked at 390px and 1440px in Chromium; later screens are checked as built)
- [should] access: Control who can invite guests, no
- [should] access: Trusted guest domains, no
- [should] admin: Admin control over which apps connect, no
- [should] admin: Approved workspaces, no
- [should] admin: Custom branding, no
- [should] admin: Custom onboarding, no
- [should] admin: Workflow bundles, no
- [should] approvals: Approvals, no
- [should] forms: Form branching logic, no
- [should] goals: Goals linked to projects and portfolios, no  ((deferred 2026-10-12 to hold the 45% line))
- [should] integrations: Integrations plugin interface, no
- [should] portfolios: Portfolios: roll-up of projects with status and progress, no
- [should] portfolios: Workload and resource management in a portfolio, no
- [should] projects: Project status updates, no
- [should] projects: Project templates (custom), no
- [should] reporting: Universal reporting across projects and teams, no  (kept simple)
- [should] security: Custom password requirements, no
- [should] tasks: Attachments on tasks, no  (local disk, size and type limits)
- [should] time: Time tracking: estimated vs actual, no
- [should] views: Timeline view (Gantt-style), no
- [could] ai: AI planning assistant, no  (feature flag, rule-based)
- [could] ai: AI teammates (agents), no  (feature flag, rule-based)
- [could] ai: MCP-style endpoint for outside AI apps, no  (A6; service account token, local only)
- [could] ai: No-code AI builder for automations, no  (keyword and template matching, usage credits shown as a number only)
- [could] ai: Smart fields, summaries, status drafts, editing help, no  (A7; rule-based text)
- [could] approvals: Proofing: review and sign-off on a piece of work, no  (comment and decision on an attachment)
- [could] backup: Cross-region backup, no  (local backup to a second directory; simulation, no real region)
- [could] capacity: Organisation-wide resource and capacity planning, no  (A3, kept simple)
- [could] compliance: Certifications documented as not certified, no  (documents say not certified)
- [could] compliance: DLP, archiving and eDiscovery integration points, no  (A1; hooks and export endpoints only)
- [could] compliance: Data residency selection, no  (not certified, no real regions)
- [could] compliance: Dedicated workspace tier, no  (not certified)
- [could] compliance: Enterprise key management, no  (not certified, no real key custody)
- [could] forms: Form customisation, no
- [could] integrations: 2 or 3 sample connectors, no  (outbound webhook, CSV import/export, calendar-file feed; no account needed)
- [could] support: Priority and 24/7 support contact page, no  (placeholder contact details, no staffing claim)

## Left out on purpose (not scored)
- Catalogue of 100+ connectors: the owner's catalogue is not part of the product to rebuild
- Native mobile apps: out of scope per the list

## Yours, not in the original (not scored)
- Add a person (admin creates a teammate or guest; temporary password shown once)
- Change own password (needed because new people get a temporary one)
- Admin password reset by one-time link (24 hours, single use)
- Unlock a locked account (admin)
- Invite by link (7 days, single use) with public join page
- Job Register CSV importer (admin only, preview then confirm, idempotent by job number)
- Jobs view: search by job number or title, filters for status, client and team, Completed and Lost hidden by default
- Extra project fields: job number, client, status, owner name, start, due and closed dates, tags, latest note

## The tool's own output, demo and pilot scope

features 90.4  (17 counted, must-haves 10 of 13 done)

Not shippable yet: 3 must-have features are not done.

## By area, weakest first
- automation                    50.0  (1 features)
- shell                         50.0  (1 features)
- reporting                     50.0  (1 features)
- foundation                   100.0  (1 features)
- tasks                        100.0  (5 features)
- projects                     100.0  (1 features)
- views                        100.0  (2 features)
- forms                        100.0  (1 features)
- access                       100.0  (2 features)
- admin                        100.0  (2 features)

## Missing, in build order
- [must] automation: Rules automation: trigger, condition, action, partial  (PILOT item 3: ONE rule type only, "assign new requests from a form to a chosen person"; every run is recorded; if the person loses access the task is still created, unassigned, and the problem is shown to admins. No conditions, no other triggers or actions)
- [must] reporting: Reporting dashboards with custom charts, partial  (Demo slice built: four number tiles, tasks by status, open tasks by person, progress by project, each chart with a numbers table, counting only projects the viewer can see. NOT built: choosing or building your own charts (custom chart builder is later))
- [must] shell: Mobile-friendly web app, partial  (M1 and M2: shell, sign-in, projects, list view and task drawer checked at 390px and 1440px in Chromium; later screens are checked as built)

## Left out on purpose (not scored)
- Catalogue of 100+ connectors: the owner's catalogue is not part of the product to rebuild
- Native mobile apps: out of scope per the list

## Yours, not in the original (not scored)
- Add a person (admin creates a teammate or guest; temporary password shown once)
- Change own password (needed because new people get a temporary one)
- Admin password reset by one-time link (24 hours, single use)
- Unlock a locked account (admin)
- Invite by link (7 days, single use) with public join page
- Job Register CSV importer (admin only, preview then confirm, idempotent by job number)
- Jobs view: search by job number or title, filters for status, client and team, Completed and Lost hidden by default
- Extra project fields: job number, client, status, owner name, start, due and closed dates, tags, latest note
