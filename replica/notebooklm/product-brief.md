# Deskrail: product brief for NotebookLM

This document describes Deskrail, a small work-management web app built clean-room for a small IT support business: what it does, what data it holds, who can see what, how another system could talk to it, and what is not built. It is generated from the code, the database schema, the route table and the feature matrix, so it matches the software. It contains no real data. **Deskrail is not certified to any standard and makes no claim of compliance.**

Honest summary: this is a pilot-ready small work manager, not an enterprise platform. It runs locally (Node.js, a SQLite file, a web page), needs no paid service and no account, and sends no email. Nothing in it uses AI yet.

## 1. Features

### Built and tested

- **Workspaces, users, roles, password sign-in**: Sign-in with lockout, sessions, five roles enforced on the server, a tamper-evident audit trail written for every change, and fake seed data. Invites by link are built (see the pilot rows); custom password rules (an admin setting) are not built
- **Task fields: owner, assignee, due date, start date, status, description**: M2: create, edit, delete; assignee must be able to see the project; dates validated; every change audited (field names and ids only, never the text)
- **Comments on tasks**: M2: commenters and up; author and time set by the server
- **Subtasks**: M2: one level; listed with the parent in the list view and drawer
- **Projects with sections**: M2: create (default sections), rename, archive (read-only), visibility private or workspace; sections add and delete. Team-visible projects work in the API but there is no screen to create teams yet
- **List view**: M2: grouped by section with inline status, assignee and due date; read-only for view-only seats
- **Board view**: Built: one column per section; drag a card or use its Move to menu (keyboard); read-only for view-only seats; opens the same task drawer
- **Task dependencies**: M2: no loops; blocked tasks closable only by a project admin, and the audit says so
- **Milestones**: M2: a flag on a task, shown as a badge
- **Forms that create tasks**: PILOT item 3: project admins build a request form (short text, long text, pick one; one question becomes the task title); a public link anyone can fill in; rate limited per address and per form, honeypot, strict validation, audited; the public page and its answers reveal nothing internal; unknown, closed and archived forms give the identical 404. Branching and customisation are NOT built
- **Unlimited free guests**: M2: guests see only projects they are added to; never project admin; no seat limit
- **Per-project admin controls**: M2: project admins rename, archive, manage sections and who is on the project, nothing wider
- **Service accounts**: ZEN phase 1: service accounts (users of kind service, no password, no membership, never listed as people) with scoped tokens tasks:write and tasks:read; shown once, only a hash stored, revocable, optional expiry, last-used time; admin-only management in the browser, a token can never manage tokens; every token call audited under the account (actor_kind service); per-token rate limit; a token may call only routes that name its scope (today only /service/whoami)
- **View-only seats**: M1: view-only and guest can never write; proven by route walk on every route. No billing or licence counting (A4)
- **Audit log of admin and user actions**: ZEN phase 4a: owners and admins only. Screen with filters (who, action, from and to date), newest first, load-more paging; CSV export (fields only: seq, time, who, action, target, summary, names of changed fields, ip, request id; never before or after values, never secrets; formula-looking cells neutralised; capped at 50,000 rows). Each export is itself audited. SQL lives in store-audit.js. Verify-chain button, search box and a JSON or NDJSON feed for other systems are NOT built
- **Add a person (admin creates a teammate or guest; temporary password shown once)** (an extra, not on the original list): Built: the password hash is stored and the password is never written to the audit trail; no email is sent (the admin hands the temporary password over)
- **Change own password (needed because new people get a temporary one)** (an extra, not on the original list): ADDED in M2: needs the current password, enforces the 12-character rule, ends other sessions
- **Admin password reset by one-time link (24 hours, single use)** (an extra, not on the original list): PILOT item 1: reset links never stored in the clear; ends all of the person's sessions and clears any lock; refused for yourself, for owners (unless you are one) and for anyone in more than one workspace
- **Unlock a locked account (admin)** (an extra, not on the original list): PILOT item 1: clears the five-failure lock; audited
- **Invite by link (7 days, single use) with public join page** (an extra, not on the original list): PILOT item 1: admin sees the link once; no email is sent; the new person sets their own password under the 12-character rule; expired, used and invalid links look the same
- **Job Register CSV importer (admin only, preview then confirm, idempotent by job number)** (an extra, not on the original list): PILOT item 2: cleans #REF! and blanks, reads 01-Jul-24 dates, never reads dates inside comments, combines duration number and unit, maps team text to a person when the name matches, skips rows without a job number (row numbers and reasons only), 13 known statuses checked; counts-only audit event per import plus one per job created or changed; file is never stored or logged
- **Jobs view: search by job number or title, filters for status, client and team, Completed and Lost hidden by default** (an extra, not on the original list): PILOT item 2: respects project visibility (private imports are visible to owners and admins only unless chosen otherwise); checked at 390px and 1440px
- **Extra project fields: job number, client, status, owner name, start, due and closed dates, tags, latest note** (an extra, not on the original list): PILOT item 2: migration 0003; job number kept as raw text
- **Ingest endpoint for Zen: POST /api/v1/ingest/tasks (write token only)** (an extra, not on the original list): ZEN phase 2: strict validation; routes by ADL-066 (prospect to the one Sales project; client job to that client's project, created on first use by client_slug; internal job to Internal, or Sales when the subtype is business development); rejects unroutable input with a clear 422 and files nothing; idempotent on idempotency_key (a retry, even a simultaneous one, returns the original); assignee matched by email, full name, or a first name only one person has, else unassigned and the reason recorded; one audit entry per created task; returns a stable id and a canonical URL
- **Task fields for Zen: source_call_id, client_slug, job_number (raw text), promised_date, inferred, lane (free text), idempotency_key, source** (an extra, not on the original list): ZEN phase 2: migration 0005; lanes are free text, never an enum; job number is stored exactly as sent and never minted here; tasks made by hand are source manual and by a form are source form
- **Read API for Zen: GET /api/v1/read/tasks and /read/projects (read token only)** (an extra, not on the original list): ZEN phase 3: filters job_number, client_slug (all tasks in the client project, hand-made included), ids and updated_since; keyset paging (limit up to 500, cursor) with stable order; returns the agreed fields plus source, context and project kind, never the description; a read token sees only ingested projects (Sales, Internal, client), never imported or staff projects or the people directory; reads audited by route pattern only; no outgoing webhooks
- **Staff can set job number, promised date and lane on a task by hand (API only, no screen yet)** (an extra, not on the original list): ZEN phase 3: checked, audited by field names; client slug is inherited from a client project, not editable; migration 0006 stores the routing context and backfills slugs
- **"AI/service-created" badge on tasks** (an extra, not on the original list): ZEN phase 4a: tasks whose source is ingestion show a badge and their source call in the list, the board and the task drawer, plus an Inferred marker when the sending system guessed. Shown to anyone who can see the task
- **Lane and promised date in the task drawer** (an extra, not on the original list): ZEN phase 4a: two fields in the drawer, editable by editors and admins through the existing task update route (the server enforces it). Lane is free text, never a fixed list
- **Audit trail holds ids and field names only** (an extra, not on the original list): Pre-data hardening group A: no titles, descriptions, comment text, form answers, emails, names or project names in any audit write; deny-by-default in the single write path; scan test over every kind of change
- **Deleting a task blanks its form submission** (an extra, not on the original list): Pre-data hardening group B: answers and submitter email cleared by a database trigger (covers subtasks and cascades); migration 0007 also clears older orphaned rows; project delete and delete-by-client wait for the forget-me ruling
- **First-owner command (empty database only)** (an extra, not on the original list): Pre-hosting: npm run first-owner creates the workspace and first owner with a generated one-time password shown once in a terminal, stored only as a hash, never logged or audited; refuses if any owner exists or if the output is not a terminal
- **Encrypted online backup and checked restore (folder destination)** (an extra, not on the original list): Pre-hosting: npm run backup takes a no-downtime copy (VACUUM INTO), checks integrity and the audit chain, encrypts with AES-256-GCM using a key from the environment, and hands it to a destination interface (folder driver built, cloud driver not); restore decrypts, checks, then replaces, keeping the old file aside
- **Sign-in hardening: folded failure audit, async stronger hashing with upgrade, idle timeout and session clean-up, common-password rule** (an extra, not on the original list): Pre-hosting second pass: one audit row per account and address per window with a count; scrypt N=65536 off the main thread, capped, upgraded on sign-in; idle timeout 120 minutes; old sessions deleted; plain 404; Permissions-Policy; common-password check. Lockout redesign and __Host- cookie prefix deliberately skipped
- **Runbook for one VM (settings, first start, backups, restore drill, updates, routine)** (an extra, not on the original list): Pre-hosting: replica/runbook.md with the pinned Node version (.nvmrc), TRUST_PROXY and PUBLIC_URL, first-owner and backup steps; a test ties it to the code. Written, not yet used on any machine

### Partly built

- **Rules automation: trigger, condition, action**: PILOT item 3: ONE rule type only, "assign new requests from a form to a chosen person"; every run is recorded; if the person loses access the task is still created, unassigned, and the problem is shown to admins. No conditions, no other triggers or actions
- **Mobile-friendly web app**: M1 and M2: shell, sign-in, projects, list view and task drawer checked at 390px and 1440px in Chromium; later screens are checked as built
- **Reporting dashboards with custom charts**: Demo slice built: four number tiles, tasks by status, open tasks by person, progress by project, each chart with a numbers table, counting only projects the viewer can see. NOT built: choosing or building your own charts (custom chart builder is later)

### Not built (the "later list", about 116 effort points, nothing faked)

- Attachments on tasks
- Project templates (custom)
- Calendar view
- Timeline view (Gantt-style)
- Custom fields: text, number, date, single and multi select
- Form branching logic
- Form customisation
- Project status updates
- Time tracking: estimated vs actual
- Integrations plugin interface
- 2 or 3 sample connectors
- Portfolios: roll-up of projects with status and progress
- Goals linked to projects and portfolios
- Workload and resource management in a portfolio
- Organisation-wide resource and capacity planning
- Approvals
- Proofing: review and sign-off on a piece of work
- Universal reporting across projects and teams
- SAML single sign-on
- SCIM provisioning
- SCIM deprovisioning
- Admin console: teams
- Admin console: settings and access
- Control who can invite guests
- Trusted guest domains
- Approved workspaces
- Admin control over which apps connect
- Custom password requirements
- Custom onboarding
- Custom branding
- Workflow bundles
- Cross-region backup
- Audit API suited to SIEM export
- Data residency selection
- Enterprise key management
- DLP, archiving and eDiscovery integration points
- Dedicated workspace tier
- Priority and 24/7 support contact page
- Certifications documented as not certified
- AI teammates (agents)
- No-code AI builder for automations
- AI planning assistant
- MCP-style endpoint for outside AI apps
- Smart fields, summaries, status drafts, editing help

### Left out on purpose

- Catalogue of 100+ connectors: the owner's catalogue is not part of the product to rebuild
- Native mobile apps: out of scope per the list

There are **no stubs and no mocks**: anything not built is simply absent. AI features, single sign-on (SAML), user provisioning (SCIM), and connectors are all **not built**.

## 2. Screens a person can reach

| Screen | Who | What it is for |
| --- | --- | --- |
| Sign in; join from an invite link; reset password from a link | anyone with credentials or a link | Entering the app |
| My tasks | everyone | Open tasks assigned to me, soonest due first |
| Projects; a project as List or Board; task drawer | everyone, limited by project access | Planning and doing work: fields, subtasks, comments, dependencies, milestones |
| Project settings; Request forms | project admins | Sections, who is on the project, archive; building public request forms and the assignment rule |
| Jobs | everyone, limited by project access | Search and filter the imported Job Register; Completed and Lost hidden by default |
| Import jobs | owners and admins | Upload the register CSV, preview counts and warnings, confirm |
| Dashboard | everyone, limited by project access | Task counts, tasks by status, open tasks by person, progress by project (fixed widgets) |
| People | owners and admins | Roles, add a person, invite by link, reset a password by link, unlock an account |
| Account | everyone | Change my own password |
| Public request form (no sign-in) | anyone with the link | Send a request that becomes a task |

## 3. Who can do what

Workspace roles: owner, admin, member, view-only (a read-only seat), and guest (an outside collaborator who sees only the projects they are added to and cannot see the staff directory). Permissions are enforced on the server for every request, never only on the screen.

| Action (workspace level) | Changes data? | owner | admin | member | view_only | guest |
| --- | --- | --- | --- | --- | --- | --- |
| audit:export | yes | yes | yes | - | - | - |
| audit:read | no | yes | yes | - | - | - |
| invites:manage | yes | yes | yes | - | - | - |
| invites:read | no | yes | yes | - | - | - |
| jobs:import | yes | yes | yes | - | - | - |
| jobs:import_preview | no | yes | yes | - | - | - |
| jobs:list | no | yes | yes | yes | yes | yes |
| me:tasks | no | yes | yes | yes | yes | yes |
| members:create | yes | yes | yes | - | - | - |
| members:read | no | yes | yes | - | - | - |
| members:reset_password | yes | yes | yes | - | - | - |
| members:unlock | yes | yes | yes | - | - | - |
| members:update_role | yes | yes | yes | - | - | - |
| project:create | yes | yes | yes | yes | - | - |
| project:list | no | yes | yes | yes | yes | yes |
| projects:read_api | no | - | - | - | - | - |
| report:read | no | yes | yes | yes | yes | yes |
| service:whoami | no | - | - | - | - | - |
| service_accounts:manage | yes | yes | yes | - | - | - |
| service_accounts:read | no | yes | yes | - | - | - |
| session:password | no | yes | yes | yes | yes | yes |
| session:read | no | yes | yes | yes | yes | yes |
| session:signout | no | yes | yes | yes | yes | yes |
| tasks:ingest | yes | - | - | - | - | - |
| tasks:read_api | no | - | - | - | - | - |
| workspace:read | no | yes | yes | yes | yes | yes |
| workspace:update | yes | yes | yes | - | - | - |

Project roles are checked per project: **viewer** (read), **commenter** (read and comment), **editor** (change tasks), **admin** (manage the project, sections, members and forms). Owners and admins are project admins everywhere. A member of a workspace-visible project is an editor. A private project is visible only to people added to it and to owners and admins. A view-only seat is capped at viewer whatever a project says. A guest is capped at editor, and only where added, and is never a project admin. A project the person cannot see answers "not found", the same as one that does not exist.

## 4. Data held

Everything is in one SQLite database file. The tables below are grouped by purpose. "Used today" means the application code reads or writes the table; the others are defined for planned features and stay empty.

### People and access

Who exists, how they sign in, what they may do.

**workspaces** (used today)

- id
- name
- slug
- accent
- welcome_json
- created_at
- updated_at

**users** (used today)

- id
- email: personal data
- name: personal data
- kind
- password_hash: a one-way scrypt hash only; the password itself is never stored
- status
- external_id
- failed_logins
- locked_until
- created_at
- updated_at

**memberships** (used today)

- id
- workspace_id
- user_id
- role
- capacity_minutes
- created_at
- updated_at

**sessions** (used today)

- id: a hash of the session token; the token itself is never stored
- user_id
- workspace_id
- auth_method
- created_at
- expires_at
- revoked_at
- last_seen_at

**invites** (used today)

- id
- workspace_id
- email: personal data
- role
- token_hash: hash only; the link is shown once to the admin
- invited_by
- expires_at
- accepted_at
- created_at

**password_resets** (used today)

- id
- workspace_id
- user_id
- token_hash: hash only; the link is shown once to the admin
- created_by
- expires_at
- used_at
- created_at

**password_history** (defined for a planned feature; not used yet)

- id
- user_id
- hash
- created_at

**teams** (used today (read by the permission rules; nothing in the app creates teams yet))

- id
- workspace_id
- name
- view_only
- created_at
- updated_at

**team_members** (used today (read by the permission rules; nothing in the app creates teams yet))

- team_id
- user_id

### Work

Projects (which also hold the Job Register fields), sections, tasks and what hangs off a task.

**projects** (used today)

- id
- workspace_id
- name
- description: free text; for imported jobs it holds the duration and next-action date
- owner_id
- visibility
- team_id
- archived_at
- created_at
- updated_at
- job_number
- client: CLIENT DATA (Job Register)
- status
- owner_name: staff names as typed in the register
- start_date
- due_date
- closed_date
- tags
- latest_note: CLIENT DATA, free text from the register
- client_slug: identifier from Zen, only on client projects
- kind: client, sales or internal for projects made by ingestion; empty for ordinary and imported per-job projects

**project_members** (used today)

- id
- project_id
- user_id
- team_id
- role

**project_templates** (defined for a planned feature; not used yet)

- id
- workspace_id
- name
- description
- definition_json
- created_by
- created_at

**sections** (used today)

- id
- project_id
- name
- position

**tasks** (used today)

- id
- workspace_id
- project_id
- section_id
- parent_id
- title: staff, visitor or AI-extracted free text
- description: free text; tasks from the public form can include a visitor email address
- assignee_id
- owner_id
- status
- start_date
- due_date
- is_milestone
- estimate_minutes
- position
- completed_at
- created_at
- updated_at
- source_call_id: the call an action came from (an identifier from Zen)
- client_slug: identifier from Zen
- job_number: identifier from Zen, stored as raw text, never minted here
- promised_date
- inferred: true when the action was hedged on the call, not confirmed
- lane: free text, not a fixed list
- idempotency_key: lets Zen retry safely
- source: ingestion, manual or form
- context: prospect, client_job or internal_job for tasks made by ingestion; empty otherwise

**task_dependencies** (used today)

- task_id
- depends_on_id

**comments** (used today)

- id
- workspace_id
- task_id
- author_id
- body: staff free text
- created_at
- edited_at

**attachments** (defined for a planned feature; not used yet)

- id
- workspace_id
- task_id
- uploader_id
- filename
- mime
- size_bytes
- storage_key
- created_at

**time_entries** (defined for a planned feature; not used yet)

- id
- workspace_id
- task_id
- user_id
- minutes
- entry_date
- note
- created_at

**status_updates** (defined for a planned feature; not used yet)

- id
- workspace_id
- project_id
- author_id
- status
- body
- created_at

### Forms and automation

Public request forms, what visitors send, the assignment rule and its run log.

**forms** (used today)

- id
- workspace_id
- project_id
- name
- slug
- target_section_id
- is_open
- appearance_json
- created_by
- created_at
- updated_at

**form_questions** (used today)

- id
- form_id
- label
- kind
- options_json
- required
- position
- maps_to
- show_if_json

**form_submissions** (used today)

- id
- form_id
- task_id
- answers_json: free text typed by anonymous visitors
- submitter_email: personal data from visitors, optional
- created_at

**rules** (used today)

- id
- workspace_id
- project_id
- name
- trigger_json
- conditions_json
- actions_json
- enabled
- last_error
- created_by
- created_at
- updated_at

**rule_runs** (used today)

- id
- rule_id
- task_id
- status
- depth
- detail
- created_at

**custom_field_defs** (defined for a planned feature; not used yet)

- id
- workspace_id
- project_id
- name
- type
- options_json
- position

**custom_field_values** (defined for a planned feature; not used yet)

- task_id
- field_id
- value_json

**approvals** (defined for a planned feature; not used yet)

- id
- workspace_id
- task_id
- attachment_id
- requester_id
- approver_id
- status
- note
- decision_note
- created_at
- decided_at

### Reporting and goals

Planned: dashboards you build yourself, portfolios, goals.

**dashboards** (defined for a planned feature; not used yet)

- id
- workspace_id
- name
- owner_id
- scope
- created_at
- updated_at

**dashboard_widgets** (defined for a planned feature; not used yet)

- id
- dashboard_id
- kind
- config_json
- position

**portfolios** (defined for a planned feature; not used yet)

- id
- workspace_id
- name
- owner_id
- created_at
- updated_at

**portfolio_projects** (defined for a planned feature; not used yet)

- portfolio_id
- project_id
- position

**goals** (defined for a planned feature; not used yet)

- id
- workspace_id
- parent_id
- name
- owner_id
- progress_pct
- derive
- due_date
- status
- created_at
- updated_at

**goal_links** (defined for a planned feature; not used yet)

- goal_id
- link_type
- link_id

### Audit trail

The tamper-evident record of every change.

**audit_events** (used today)

- seq
- workspace_id
- ts
- actor_id
- actor_kind
- action
- target_type
- target_id
- summary
- before_json: field names, and only non-text values (ids, numbers, true or false, dates, fixed words such as a status), before a change; typed text is never recorded
- after_json: the same, after a change (the Job Register import records counts only)
- ip: network address of the caller
- request_id
- prev_hash
- hash

### Settings, integrations and machine access

Service accounts and tokens are built; the rest are planned enterprise and integration features.

**service_accounts** (used today)

- user_id
- workspace_id
- created_by
- created_at

**workspace_settings** (defined for a planned feature; not used yet)

- workspace_id
- key
- value_json
- updated_at

**feature_flags** (defined for a planned feature; not used yet)

- workspace_id
- flag
- enabled

**sso_configs** (defined for a planned feature; not used yet)

- workspace_id
- enabled
- enforce_sso
- idp_entity_id
- idp_sso_url
- idp_cert_pem
- sp_entity_id
- jit_provisioning
- updated_at

**scim_tokens** (defined for a planned feature; not used yet)

- id
- workspace_id
- token_hash
- label
- created_at
- last_used_at
- revoked_at

**api_tokens** (used today)

- id
- workspace_id
- user_id
- token_hash
- label
- scopes_json
- created_at
- last_used_at
- expires_at
- revoked_at

**trusted_domains** (defined for a planned feature; not used yet)

- workspace_id
- domain

**approved_apps** (defined for a planned feature; not used yet)

- workspace_id
- app_key
- allowed

**bundles** (defined for a planned feature; not used yet)

- id
- workspace_id
- name
- description
- definition_json
- created_by
- created_at

**backups** (defined for a planned feature; not used yet)

- id
- workspace_id
- status
- target_label
- path
- bytes
- sha256
- started_at
- finished_at
- error

**connectors** (defined for a planned feature; not used yet)

- id
- workspace_id
- kind
- name
- config_json
- enabled
- created_at
- updated_at

**webhooks** (defined for a planned feature; not used yet)

- id
- workspace_id
- connector_id
- url
- events_json
- signing_key
- enabled
- created_at

**webhook_deliveries** (defined for a planned feature; not used yet)

- id
- webhook_id
- event
- payload_json
- status
- attempts
- next_attempt_at
- last_error
- created_at

**outbox** (defined for a planned feature; not used yet)

- id
- workspace_id
- to_email
- subject
- body
- created_at

### Housekeeping



**schema_migrations** (used today)

- version
- applied_at

### What is deliberately never stored

- Passwords in plain text (only a one-way hash), session tokens, invite links, reset links (only hashes of them).
- The Job Register CSV file itself: it is read in the browser, parsed in memory on the server and discarded. Only the resulting jobs are kept.
- Secrets or values inside the audit trail: it records who did what and which fields changed. Passwords, hashes and tokens are removed before writing.
- Search words and file contents in server logs: logs record the path of a request, not its query string or body.

### Retention

There is **no automatic deletion or retention policy**. Data stays until someone deletes it, and the audit trail cannot be edited or deleted through the application (the database blocks it). There is no backup feature and the database file is not encrypted by the app. Seed and test data are invented people on the reserved example.test domain.

### Job Register fields

The importer reads a 13-column CSV exported from a Google Sheet: Job No, Job Title / Folder, Start Date, Estimated Completion (number), Estimated Completion (unit), Next Action Due, Client, Status, Team, Comment / Update / Action, Misc, Estimated Completion Date, Closed Date. Job number is kept exactly as written (for example J9075P) and no meaning is read into a suffix. Blank cells and spreadsheet errors such as #REF! are treated as empty. Dates like 01-Jul-24 are read; dates inside comments are never parsed. The duration number and unit are combined into text. Team text is matched to an existing user when the name matches, otherwise kept as plain text. Rows with no job number are skipped and reported by row number and reason only. Import is idempotent by job number. Assumption to confirm: the project due date comes from Estimated Completion Date, while Next Action Due and the duration are kept in the description. Imported jobs are visible to owners and admins only unless the importing admin chooses "everyone". The 13 known statuses: Lead, In discussion, Quoted, Create Folder, Lost, Content Creation, Work in Progress, Managed / Time Block, On Hold, Awaiting Feedback, To be Invoiced, Now in ClickUp, Completed.

## 5. The audit trail

Every change to data writes an audit entry in the same database transaction as the change: who (a person, the system, or an anonymous visitor), what happened, which record, and which fields changed (field names and ids only: titles, descriptions, comment text, form answers, email addresses, names and project names are never written to the trail). Entries are chained by hashes, so tampering is detectable, and the database refuses edits and deletes. Failed sign-ins are recorded. Reads are not recorded. Refused requests are not recorded because they change nothing. Owners and admins have an **Audit log screen** with filters (who, action, date range), newest first, and a **CSV export**. The screen and the CSV show field names only, never the values before or after a change, and anything shaped like a token or password hash is removed again on the way out. Each export is itself recorded. A service token can never read the audit log. There is **no JSON feed for other systems and no verify-chain button yet**.

## 6. The API (how another system could talk to this)

The web app is a thin page over a JSON API at /api/v1 (60 routes). **Today the API accepts browser session cookies from a person who signed in, and bearer tokens from service accounts. A token carries a scope (tasks:write or tasks:read) and may call only routes that name its scope. The write token can create tasks through POST /api/v1/ingest/tasks (idempotent, routed by the Zen rules) and both tokens can call /api/v1/service/whoami to check they work. The read token can read tasks and projects through GET /api/v1/read/tasks and /read/projects, but only those made by ingestion (Sales, Internal and client projects), never imported or staff projects and never the people directory. There are no outgoing webhooks and no MCP-style endpoint.** Public routes (no sign-in) exist only for invite links, reset links and the public request form, and they are rate limited.

| Method | Path | Who may call it | Changes data |
| --- | --- | --- | --- |
| GET | /api/v1/audit | owner, admin | no |
| POST | /api/v1/audit/export | owner, admin | yes |
| POST | /api/v1/auth/password | owner, admin, member, view_only, guest | yes |
| GET | /api/v1/auth/session | owner, admin, member, view_only, guest | no |
| POST | /api/v1/auth/signin | anyone (rate limited) | yes |
| POST | /api/v1/auth/signout | owner, admin, member, view_only, guest | yes |
| DELETE | /api/v1/forms/:id | project admin or higher | yes |
| PATCH | /api/v1/forms/:id | project admin or higher | yes |
| GET | /api/v1/health | anyone (rate limited) | no |
| POST | /api/v1/ingest/tasks |  | yes |
| GET | /api/v1/invites | owner, admin | no |
| POST | /api/v1/invites | owner, admin | yes |
| DELETE | /api/v1/invites/:id | owner, admin | yes |
| GET | /api/v1/invites/:token | anyone (rate limited) | no |
| POST | /api/v1/invites/:token/accept | anyone (rate limited) | yes |
| GET | /api/v1/jobs | owner, admin, member, view_only, guest | no |
| POST | /api/v1/jobs/import | owner, admin | yes |
| POST | /api/v1/jobs/import/preview | owner, admin | no |
| GET | /api/v1/me/tasks | owner, admin, member, view_only, guest | no |
| GET | /api/v1/members | owner, admin | no |
| POST | /api/v1/members | owner, admin | yes |
| POST | /api/v1/members/:userId/reset | owner, admin | yes |
| PATCH | /api/v1/members/:userId/role | owner, admin | yes |
| POST | /api/v1/members/:userId/unlock | owner, admin | yes |
| GET | /api/v1/projects | owner, admin, member, view_only, guest | no |
| POST | /api/v1/projects | owner, admin, member | yes |
| GET | /api/v1/projects/:id | project viewer or higher | no |
| PATCH | /api/v1/projects/:id | project admin or higher | yes |
| GET | /api/v1/projects/:id/forms | project admin or higher | no |
| POST | /api/v1/projects/:id/forms | project admin or higher | yes |
| GET | /api/v1/projects/:id/members | project admin or higher | no |
| PUT | /api/v1/projects/:id/members | project admin or higher | yes |
| DELETE | /api/v1/projects/:id/members/:userId | project admin or higher | yes |
| GET | /api/v1/projects/:id/people | project viewer or higher | no |
| POST | /api/v1/projects/:id/sections | project admin or higher | yes |
| GET | /api/v1/projects/:id/tasks | project viewer or higher | no |
| POST | /api/v1/projects/:id/tasks | project editor or higher | yes |
| GET | /api/v1/public/forms/:slug | anyone (rate limited) | no |
| POST | /api/v1/public/forms/:slug/submit | anyone (rate limited) | yes |
| GET | /api/v1/read/projects |  | no |
| GET | /api/v1/read/tasks |  | no |
| GET | /api/v1/reports/summary | owner, admin, member, view_only, guest | no |
| GET | /api/v1/resets/:token | anyone (rate limited) | no |
| POST | /api/v1/resets/:token/complete | anyone (rate limited) | yes |
| DELETE | /api/v1/sections/:id | project admin or higher | yes |
| PATCH | /api/v1/sections/:id | project admin or higher | yes |
| GET | /api/v1/service-accounts | owner, admin | no |
| POST | /api/v1/service-accounts | owner, admin | yes |
| DELETE | /api/v1/service-accounts/:id | owner, admin | yes |
| POST | /api/v1/service-accounts/:id/tokens | owner, admin | yes |
| DELETE | /api/v1/service-accounts/:id/tokens/:tokenId | owner, admin | yes |
| GET | /api/v1/service/whoami |  | no |
| DELETE | /api/v1/tasks/:id | project editor or higher | yes |
| GET | /api/v1/tasks/:id | project viewer or higher | no |
| PATCH | /api/v1/tasks/:id | project editor or higher | yes |
| POST | /api/v1/tasks/:id/comments | project commenter or higher | yes |
| POST | /api/v1/tasks/:id/dependencies | project editor or higher | yes |
| DELETE | /api/v1/tasks/:id/dependencies/:depId | project editor or higher | yes |
| GET | /api/v1/workspace | owner, admin, member, view_only, guest | no |
| PATCH | /api/v1/workspace | owner, admin | yes |

### What connecting an AI would need first (recommendation)

1. **Service accounts with scoped tokens** (built): an AI or another system gets its own identity, shown a token once, with every call audited under that identity. The ingest and read routes are built.
2. A short **allow-list of fields** an AI may read. Treat these as sensitive and exclude them by default: client names and notes from the Job Register, comments, task descriptions (which can contain visitor email addresses), form submissions, and people's email addresses.
3. **Decide read-only versus write**: creating tasks is safe to start with; changing status or assignment should be a later, separate decision.
4. NotebookLM is a Google service. Upload only this brief and the other documents in the replica folder, never exports of real client data such as the Job Register.

## 7. Security controls in place, and what is not covered

In place and tested: server-side permission checks on every route (checked against five roles, another workspace and signed-out callers); an audit entry for every change; password hashing; sign-in lockout after five failures that treats unknown emails the same; sign-in and public-form rate limits; single-use expiring links that are shown once and stored only as hashes; strict input validation; stored text rendered as plain text only; security headers and a refusal of cross-site writes; no secrets in the repository; client data files kept out of git.

Not covered: no penetration test, no manual screen-reader pass (an automated accessibility scan is clean on every screen), no database encryption at rest, no backup, rate limits live in memory, no email delivery (invite and reset links are passed on by hand), and no CAPTCHA on the public form (rate limits and a hidden trap field instead). Compliance certifications, data residency and key management are not built and not certified.

## 8. How it was built and where it stands

Built by the Replica skills in stages (frame, organize, run, gauge, evolve). The test suites cover the API, permissions, the importer, forms, the browser screens at phone and desktop width, and accessibility. Parity is measured with the pack's own tool against the public feature list the owner supplied: roughly 31 out of 100 against the full list and about 90 out of 100 against the demo and pilot scope. No S1, S2 or S3 bug is open.

Decisions still needing the owner: whether to send email (needs an email service account), whether to add time tracking with a push-only Toggl connector (needs a Toggl account and token), and the due-date assumption for the Job Register. Next improvements by value: edit jobs in the app, a JSON audit feed, attachments and project templates.

The accompanying documents in the repository's replica folder (parity.md, security.md, bugs.md, test-plan.md, summary.md, brand.md) give the detail behind these statements.
