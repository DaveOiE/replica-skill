# Architecture: a work-management app for small teams (working name TBD, see brand.md)

Constraint: runs with no paid service and no account. One web app, one
relational database, one local mock identity provider. `npm install && npm run
seed && npm start` is the whole setup.

## Stack

| layer | choice | why |
| --- | --- | --- |
| runtime | Node 22 (>= 22.13), plain JavaScript (ES modules) | Already installed, no build step to break. JSDoc types where they pay off. |
| web server | Fastify 5 | Small, fast, schema-first, has `inject()` for in-process API tests. |
| validation | zod 4 | One schema per route input, used for every route (security checklist). |
| database | SQLite through built-in `node:sqlite` (WAL, foreign keys on) | Real relational DB, zero setup, no native build to download. Trade-offs below. |
| migrations | numbered `.sql` files + a 30-line runner | `replica/schema.sql` becomes `0001_init.sql`. |
| auth | scrypt password hashes (`node:crypto`), random session tokens in http-only SameSite=Lax cookies, only the sha256 stored | No auth service, no keys. |
| SAML | `samlify` as the service provider in the app and as the identity provider in the mock | One library on both ends; signed assertions are verified against the IdP certificate. |
| mock identity provider | `tools/mock-idp/`, its own process on port 4001, fake directory of fake users, certificate generated locally with `openssl` into a gitignored `.local/` | Satisfies "local mock IdP for SAML and SCIM". |
| SCIM | SCIM 2.0 `/scim/v2/Users` and `/Groups` in the app; a script plays the IdP's provisioning client | Tested end to end without a vendor. |
| frontend | No-build ES-module single page app, hash router, small view helpers, native drag and drop, hand-written SVG charts | Fewer moving parts than a framework, fast to load, nothing to compile. |
| styling | CSS custom properties from `tokens.css` (no raw hex in components) | replica-design rule. |
| icons | Lucide (ISC licence), a vendored subset of SVGs with the licence file | Open icon set, no third-party assets. |
| files | Local disk under `data/uploads/` with random keys, size and type limits, served as downloads | No object store. |
| email | None sent. An `outbox` table and an admin page show what would be sent (invites, notices) | No SMTP key. |
| jobs | In-process timers: due-date triggers, webhook retries, backups | One process, one database. |
| tests | `node:test` for units and the API (in-process Fastify, temp database), Playwright with the preinstalled Chromium for the key flows, `@axe-core/playwright` for accessibility | Skill-pack Python tools (parity, contrast, sweep) run alongside. |

Dependencies, total: fastify, @fastify/cookie, @fastify/static, @fastify/multipart,
zod, samlify; dev: @playwright/test, @axe-core/playwright. No ORM: a thin
data layer of prepared statements, one file per area.

**SQLite trade-offs, stated plainly.** No row-level security, so every query
goes through one authorisation check and a second workspace is tested to get
nothing. One writer at a time, fine for small teams and a demo. `node:sqlite`
is flagged experimental in Node 22 (the API is small and we pin the Node
version). Moving to PostgreSQL is a mechanical change: the SQL avoids
SQLite-only features, and PostgreSQL 16 is installed here if you want it later.

## Schema outline (full SQL: `replica/schema.sql`, validated: 46 tables, 34 indexes)

| group | tables |
| --- | --- |
| tenancy and settings | workspaces, workspace_settings, feature_flags |
| people and access | users (human or service), password_history, memberships (owner, admin, member, view_only, guest), teams, team_members, sessions, invites |
| projects and tasks | projects, project_members, project_templates, sections, tasks (subtasks, milestone flag), task_dependencies, comments, attachments, time_entries, status_updates |
| custom fields, forms, automation | custom_field_defs, custom_field_values, forms, form_questions (branching), form_submissions, rules, rule_runs, approvals |
| reporting and goals | dashboards, dashboard_widgets, portfolios, portfolio_projects, goals, goal_links |
| audit | audit_events (append-only by trigger, hash-chained, integer cursor) |
| machine access | sso_configs, scim_tokens, api_tokens (service accounts) |
| admin and integrations | trusted_domains, approved_apps, bundles, backups, connectors, webhooks, webhook_deliveries, outbox |

Rules: every owned table has `workspace_id`; times are UTC text, dates are
`YYYY-MM-DD`; status fields are CHECK constraints; foreign keys have an
explicit delete rule; indexes on every foreign key and every filter or sort
column.

## Authorisation (the part that must not leak)

One module, `server/authz.js`, one function: `can(actor, action, resource)`.

- **Actor** = user + workspace role from `memberships`, or a service account with scopes.
- **Workspace roles:** owner and admin manage the workspace; member works in projects they can see; **view_only** can read what they can see and write nothing, ever; **guest** sees only projects they are explicitly added to, cannot see the member directory.
- **Project roles:** admin, editor, commenter, viewer, granted to a user or a team. A view-only team caps its members at viewer on that team's projects.
- **Every route** calls `can()` before touching data; the data layer takes `workspaceId` from the session, never from the request body.
- **Test that guards it:** a route table lists every route with its required action. One test walks the table and calls each route as view-only, guest, other-workspace and signed-out actors, expecting 401 or 403 or an empty result. A new route without an entry fails the test.

## Audit (an entry for every change)

All writes go through `mutate(ctx, action, fn)`, which runs the change and
writes the `audit_events` row **in the same transaction**, with before and
after JSON, actor, request id and a hash chained to the previous row. There is
no other write path. A test walks the route table and asserts that every
non-GET route produced an audit row. The admin API can verify the chain and
report the first broken link. Audit infrastructure is built in milestone M1,
so every later feature is audited from its first commit; the admin screen and
SIEM export arrive in M6.

## API (about 110 routes; grouped, `/api/v1`, JSON, cookie or bearer token)

| area | routes | who |
| --- | --- | --- |
| auth | `POST /auth/signin`, `/auth/signout`, `GET /auth/session`, `POST /invites/:token/accept`, SAML: `GET /sso/login`, `POST /sso/acs`, `GET /sso/metadata` | anyone, rate limited |
| workspace and admin | `GET/PATCH /workspace`, `/members` (list, role, deactivate), `/invites`, `/teams` (+ members), `/settings/security`, `/settings/guests`, `/trusted-domains`, `/approved-apps`, `/branding`, `/onboarding`, `/feature-flags` | admin; reads vary |
| projects | `/projects` (CRUD, archive), `/projects/:id/members`, `/sections`, `/templates`, `POST /projects/from-template`, `/status-updates` | by project role |
| tasks | `/tasks` (CRUD, move, reorder), `/tasks/:id/subtasks`, `/dependencies`, `/comments`, `/attachments`, `/time-entries`, `/approvals`, `/custom-fields`, `/tasks/:id/fields` | by project role |
| views | `GET /projects/:id/view/{list,board,calendar,timeline}` | viewer and up |
| forms | `/forms` (CRUD, questions), public `GET/POST /public/forms/:slug` | admin; public rate limited |
| automation | `/rules` (CRUD, enable), `/rules/:id/runs` | project admin |
| reporting | `/dashboards`, `/widgets`, `/reports/query`, `/portfolios` (+ projects, workload), `/goals` (+ links), `/capacity` | by scope |
| audit | `GET /audit` (filters, cursor, `format=json|ndjson`), `GET /audit/verify` | admin or `audit:read` token |
| machine access | `/service-accounts`, `/service-accounts/:id/tokens`, SCIM `GET/POST/PUT/PATCH/DELETE /scim/v2/Users`, `/Groups`, `/ServiceProviderConfig` | admin; SCIM bearer |
| bundles, backup | `/bundles` (export, import), `/backups` (run, list, verify) | admin |
| integrations | `/connectors`, `/webhooks`, `/export/{tasks.csv,calendar.ics}`, `/hooks/dlp`, `/hooks/archive` | admin |
| AI (flagged) | `/ai/assistant`, `/ai/agents`, `/ai/builder`, `/ai/tool` (MCP-style) | flag on, member+ |
| compliance | `GET/PATCH /compliance/settings` (residency label, key-management label, tier), static `/docs/compliance` | admin |

Webhooks in: SCIM and SAML only, from the local mock IdP. Webhooks out:
signed (HMAC-SHA256), table-backed queue with retry and backoff.
Jobs: due-date trigger scan (every minute), webhook retry (every 30 s), backup (on demand, optional daily).

## The parts that bite

- **Authorisation on every route:** route table plus the walking test above.
- **Automation loops:** a rule's action can fire another rule. Depth counter on `rule_runs`, hard stop at depth 5, a rule cannot re-trigger itself on its own change.
- **Dependencies:** reject cycles on write; a task with unfinished dependencies cannot be set to done unless the actor is project admin (logged).
- **Dates and time zones:** all instants UTC; task dates are plain dates with no zone; due-date triggers use the workspace's daily boundary in UTC (labelled, A2).
- **SAML:** accept only signed assertions from the configured IdP certificate, check audience, destination and `NotOnOrAfter`, reject replay by assertion id for 10 minutes. Unknown user is refused unless JIT provisioning is on.
- **SCIM:** idempotent create (same `externalId` returns the existing user), deactivate ends all sessions at once, filters `userName eq` supported.
- **Uploads:** size and type limits, random storage key, served with `Content-Disposition: attachment` and `nosniff`.
- **Secrets:** tokens shown once, only hashes stored; `.env*` and `.local/` in `.gitignore`; `.env.example` lists names only; a test greps the repo for key-shaped strings.
- **Guests and view-only:** the same rule in every query, not just in the UI; tested in the walking test.
- **Public form and sign-in abuse:** per-IP and per-account rate limits, account lockout with a timed unlock.
- **Compliance wording:** a test fails the build if the UI or docs say certified, compliant or HIPAA-ready without "not certified" nearby.

## Repository layout

```
app/
  server/        index.js, db.js, migrate.js, authz.js, audit.js, routes/*, jobs/*, ai/*
  web/           index.html, app.js, views/*, components/*, styles/tokens.css
  migrations/    0001_init.sql ...
  seed/          fake demo workspace (no real people, `example.test` addresses)
  tests/         api, unit, e2e
tools/
  mock-idp/      local SAML identity provider and SCIM test client
  status.py      renders STATUS.md from features.csv and milestones.csv
replica/         planning docs (this folder), features.csv, schema.sql, design, brand
STATUS.md
```

The product name lives in one constant and one tokens file, so the name you
pick changes in one place.

## Build order, effort, and tests (milestones for Run)

Effort is in points: one point is a small tested feature (a few routes, one screen state, its
tests). The scale is 1, 2, 3, 5 or 8 per feature; 183 points in all across 62 features (2 are
skipped). Per-feature points are in `replica/features.csv` and shown in `STATUS.md`, with each
milestone's share of Run (Run is about 55% of the session). The points are my estimate, not a
meter: after M1 I will report estimated against actual so you can resize the rest.
Each milestone ends with its tests green before the next starts.

| M | scope | size | commits | points | test that gates it |
| --- | --- | --- | --- | --- | --- |
| M1 | Data model and roles: migrations, workspaces, users, memberships, password sign-in and sessions, `can()`, `mutate()` and audit chain, seed, app shell | L | 4 | 13 | walking authz test, audit-per-write test, sign-in and lockout tests |
| M2 | Tasks and projects: projects, sections, tasks, subtasks, comments, attachments, dependencies, milestones, templates, guests and view-only, list view and task drawer | L | 5 | 28 | API tests per entity, view-only and guest rejections |
| M3 | Views and forms: board, calendar, timeline, custom fields, forms with branching, public form | L | 4 | 26 | view-data tests, branching tests, Playwright: create project, move a card |
| M4 | Automation: rules engine, due-date scheduler, status updates, time tracking | M | 3 | 13 | rule tests incl. loop guard, scheduler test with a fake clock |
| M5 | Reporting and goals: dashboards, portfolios, goals, workload, capacity, approvals, cross-project reports | L | 4 | 30 | roll-up math tests, approval flow test |
| M6 | Audit log screen and SIEM API, service accounts and scoped tokens, chain verify | M | 2 | 11 | cursor paging, NDJSON, bad-scope tests, tamper test |
| M7 | Admin console, security settings, SAML SSO with the mock IdP, SCIM | L | 4 | 32 | SAML bad-signature and replay tests, SCIM lifecycle test |
| M8 | Workflow bundles, branding and onboarding, backup simulation | M | 2 | 9 | bundle round trip, backup checksum test |
| M9 | Integrations as stubs (plugin interface, 3 sample connectors, DLP and archive hooks), compliance settings and documents, support page | M | 2 | 13 | plugin interface test, wording test |
| M10 | AI as flagged stubs (assistant, agents, builder, smart fields, MCP-style endpoint) | S | 1 | 8 | flag-off returns 404, flag-on returns labelled stub |

Total about 31 commits. That is more than the 15 to 25 in the frame: the
list is wide and I would rather commit small. **If you want a smaller app**,
the cut line is: M10, then M9's extra connectors, then M8's backup, then
capacity planning in M5. Cutting all four leaves about 24 commits and still
satisfies every [C] and [E] must-have.

The order follows yours: data model and roles, tasks and projects, views and forms, automation,
reporting and goals, audit log, SSO and provisioning, integrations as stubs, AI last. Two
placements to know about: the audit machinery (`mutate()` and the hash chain) is built inside M1 so
every later change is audited from its first commit, with its screen and SIEM API in M6; and
bundles, branding and backup (M8) sit between SSO and integrations because bundles reuse rules and
forms from M3 and M4.

Run rules: after each feature run its test and fix before moving on;
`STATUS.md` is regenerated on every commit by `python3 tools/status.py`.
