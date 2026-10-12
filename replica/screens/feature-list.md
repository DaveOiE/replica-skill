# Feature list: enterprise work-management platform (recon input)

Written in my own words from public plan and security pages (asana.com/pricing, asana.com/product, trustcenter.asana.com) and a screenshot of the public plan comparison table, retrieved 12 Oct 2026. Public information only. No logins, no copied text, no assets. Use as input to replica-recon, then replica-architect.

How to read the tags: [C] core, build first. [E] enterprise admin, build second. [S] build only as a labelled stub or mock. [?] tier placement unclear on the public page, so treat as a nice-to-have.

## 1. Core work management [C]

* Tasks with owner, assignee, due date, start date, status, description, comments, attachments, subtasks.
* Projects with sections and templates (custom templates).
* Views over the same data: list, board, calendar, timeline (Gantt-style).
* Custom fields (text, number, date, single and multi select).
* Task dependencies and milestones.
* Forms that create tasks, with branching logic and customisation.
* Rules-based automation (trigger, condition, action), unlimited.
* Status updates on a project.
* Time tracking: estimated versus actual.
* Unlimited free guests (external collaborators).
* Mobile-friendly web app (native apps are out of scope).
* Integrations: a catalogue of connectors (100+ listed). Build a plugin interface, plus 2 or 3 sample connectors.

## 2. Planning, reporting and goals [C]

* Reporting dashboards with custom charts.
* Portfolios: a roll-up of many projects with status and progress.
* Goals linked to projects and portfolios, with progress.
* Workload and resource management inside a portfolio.
* Universal resource management and capacity planning across the organisation (the Enterprise level).
* Approvals and proofing (review and sign-off on a piece of work).
* Universal reporting across projects and teams.

## 3. Enterprise administration [E]

* Single sign-on via SAML.
* User provisioning and deprovisioning via SCIM.
* Admin console: teams, settings, access, and per-project admin controls.
* Service accounts for integrations (non-human users).
* View-only seats (a cheaper licence type).
* Controls over who can invite guests, and trusted guest domains.
* Approved workspaces and admin control over which apps connect.
* Custom password requirements.
* Custom onboarding and branding for the workspace.
* Workflow bundles (a packaged set of templates and rules for sharing).
* Cross-region backup.

## 4. Audit, security and compliance integration

* Audit log of admin and user actions, with an API suited to SIEM export. [E]
* Data residency selection (US, Europe, Australia, Japan). [S] settings only, no real regions.
* Enterprise key management (customer-held keys). [S]
* Integration points for DLP, archiving and eDiscovery tools. [S] webhooks or export hooks only.
* Dedicated workspace tier. [S]
* Support: priority and 24/7 support contact page. [S]
* Certifications the vendor lists (SOC 2, ISO 27001 family, HIPAA, GDPR and others). [S] never claim these for the clone. Document them as "not certified".

## 5. AI features [S, build last]

* Prebuilt AI teammates (agents) that do routine work on tasks.
* A no-code AI builder for custom automations, with monthly usage credits.
* An AI assistant for planning (called Dash on the source page).
* AI connectors and an open protocol (MCP) so outside AI apps can read and create tasks.
* Smart fields, summaries, status drafts and editing help. [?]

## Suggested build order

1. Data model: workspaces, teams, users, roles, projects, tasks, custom fields.
2. Views and forms, then automation rules.
3. Reporting, portfolios and goals.
4. Audit log, then SAML and SCIM against a local mock identity provider.
5. Integrations interface with sample connectors.
6. AI features as stubs behind a feature flag.

## Not claimable

Compliance, data residency, encryption-key management and uptime guarantees cannot be copied by building software. Show them as settings and documents only, and never as certified features.

## Known gaps in this list

* The plan comparison table could not be read in full. Some items (eDiscovery, DLP and archiving) are described as add-ons, and their exact tier is unclear.
* Detail on views, field types and automation conditions comes from general product knowledge and the table headings. Confirm against the public help centre pages during recon.
