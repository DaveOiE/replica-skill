# Parity report (Gauge, 2026-10-12)

Two honest numbers, because the build was cut to a demo on purpose.

| scored against | feature score | must-haves done | what it means |
| --- | --- | --- | --- |
| **the full public feature list** (62 counted rows) | **27.7 / 100** | 9 of 22 | The app is a small part of the list. Not shippable as a product. |
| **the demo scope** (14 counted rows) | **92.3 / 100** | 9 of 11 | Demo-ready. The two missing must-haves are partial: the custom chart builder, and the mobile checks on later screens. |

The layout score is **not measured**: this was a clean-room build and no reference screenshots of the
original were captured, so `imgdiff.py` had nothing to compare. Behaviour differences against the original
were not compared either.

Verdict by the pack's rule (shippable needs every must-have done and 80 or more): **not shippable** against
the full list. As a demo build: **demo-ready**, with no open S1 or S2 bug.

## What is built, stubbed, or missing (full list)

- **Built and tested (done):** workspaces, roles and password sign-in; task fields; comments; subtasks; projects and sections; list view; board view; dependencies; milestones; unlimited guests; per-project admin controls; view-only seats. Added beyond the list (not scored): add a person with a one-time password, change own password.
- **Partly built:** dashboards (fixed widgets only, no chart builder); mobile-friendly web app (checked on the screens built so far).
- **Stubs and mocks: none.** Nothing in the demo scope is a stub. SAML, SCIM and every connector, hook and AI feature are **not built**, not faked.
- **Not built, on the later list (129 points):** calendar and timeline views, custom fields, forms, rules, time tracking, status updates, portfolios, goals, workload and capacity, approvals and proofing, universal reporting, the audit log screen and SIEM API, service accounts, SAML, SCIM, the admin console and security settings, bundles, branding and onboarding, backup, integrations, DLP and archiving hooks, support page, compliance documents (all labelled not certified), AI features, attachments, project templates.
- **Left out on purpose (not scored):** a catalogue of 100+ connectors; native mobile apps.

## The tool's own output, full list

features 27.7  (62 counted, must-haves 9 of 22 done)

Not shippable yet: 13 must-have features are not done.

## By area, weakest first
- custom fields                  0.0  (1 features)
- forms                          0.0  (3 features)
- automation                     0.0  (1 features)
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
- audit                          0.0  (2 features)
- compliance                     0.0  (5 features)
- support                        0.0  (1 features)
- ai                             0.0  (5 features)
- admin                         10.0  (9 features)
- reporting                     30.0  (2 features)
- projects                      42.9  (3 features)
- shell                         50.0  (1 features)
- views                         54.5  (4 features)
- access                        60.0  (4 features)
- tasks                         86.7  (6 features)
- foundation                   100.0  (1 features)

## Missing, in build order
- [must] admin: Admin console: settings and access, no
- [must] admin: Admin console: teams, no
- [must] audit: Audit API suited to SIEM export, no  (JSON and NDJSON, cursor paging)
- [must] audit: Audit log of admin and user actions, no  (demo slice: admin screen with filters, before/after, verify chain; SIEM export API and service accounts are later (deferred 2026-10-12 to hold the 45% line with the Gauge and Evolve reserve; the audit trail itself is recorded and verifiable today, only the screen is later))
- [must] automation: Rules automation: trigger, condition, action, no  (A2 triggers and conditions)
- [must] custom fields: Custom fields: text, number, date, single and multi select, no  (A2)
- [must] forms: Forms that create tasks, no
- [must] provisioning: SCIM deprovisioning, no  (deactivation ends sessions)
- [must] provisioning: SCIM provisioning, no  (SCIM 2.0 against a local test client)
- [must] sso: SAML single sign-on, no  (local mock IdP only)
- [must] views: Calendar view, no
- [must] reporting: Reporting dashboards with custom charts, partial  (Demo slice built: four number tiles, tasks by status, open tasks by person, progress by project, each chart with a numbers table, counting only projects the viewer can see. NOT built: choosing or building your own charts (custom chart builder is later))
- [must] shell: Mobile-friendly web app, partial  (M1 and M2: shell, sign-in, projects, list view and task drawer checked at 390px and 1440px in Chromium; later screens are checked as built)
- [should] access: Control who can invite guests, no
- [should] access: Trusted guest domains, no
- [should] admin: Admin control over which apps connect, no
- [should] admin: Approved workspaces, no
- [should] admin: Custom branding, no
- [should] admin: Custom onboarding, no
- [should] admin: Service accounts, no
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

## The tool's own output, demo scope

features 92.3  (14 counted, must-haves 9 of 11 done)

Not shippable yet: 2 must-have features are not done.

## By area, weakest first
- shell                         50.0  (1 features)
- reporting                     50.0  (1 features)
- foundation                   100.0  (1 features)
- tasks                        100.0  (5 features)
- projects                     100.0  (1 features)
- views                        100.0  (2 features)
- access                       100.0  (2 features)
- admin                        100.0  (1 features)

## Missing, in build order
- [must] reporting: Reporting dashboards with custom charts, partial  (Demo slice built: four number tiles, tasks by status, open tasks by person, progress by project, each chart with a numbers table, counting only projects the viewer can see. NOT built: choosing or building your own charts (custom chart builder is later))
- [must] shell: Mobile-friendly web app, partial  (M1 and M2: shell, sign-in, projects, list view and task drawer checked at 390px and 1440px in Chromium; later screens are checked as built)

## Left out on purpose (not scored)
- Catalogue of 100+ connectors: the owner's catalogue is not part of the product to rebuild
- Native mobile apps: out of scope per the list

## Yours, not in the original (not scored)
- Add a person (admin creates a teammate or guest; temporary password shown once)
- Change own password (needed because new people get a temporary one)
