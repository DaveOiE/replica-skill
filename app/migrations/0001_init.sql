-- Schema for the work-management app. SQLite (node:sqlite), written to stay
-- close to portable SQL so a Postgres move is a mechanical change.
--
-- Conventions
--   ids        text, uuid v4 made by the app (crypto.randomUUID()); audit_events uses an integer sequence
--   times      text, ISO-8601 UTC ("2026-10-12T07:55:00.000Z"); date-only fields are "YYYY-MM-DD"
--   tenancy    every owned table carries workspace_id; every query filters on it
--   access     no row-level security in SQLite: one authorisation function (server/authz.js)
--              is called by every route, and tests prove a second workspace gets nothing
--   deletes    cascade for children that mean nothing alone; restrict for people and audit
--   secrets    only hashes of tokens and passwords are stored; webhook signing secrets are
--              generated at runtime and live only in the database, never in the repo

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- tenancy, people, roles

create table workspaces (
  id          text primary key,
  name        text not null,
  slug        text not null unique,
  accent      text not null default '#0f766e',
  welcome_json text not null default '[]',          -- custom onboarding steps
  created_at  text not null,
  updated_at  text not null
);

create table workspace_settings (                    -- password rules, guest policy, residency label, ...
  workspace_id text not null references workspaces(id) on delete cascade,
  key          text not null,
  value_json   text not null,
  updated_at   text not null,
  primary key (workspace_id, key)
);

create table feature_flags (                         -- AI stubs sit behind these, default off
  workspace_id text not null references workspaces(id) on delete cascade,
  flag         text not null,
  enabled      integer not null default 0 check (enabled in (0,1)),
  primary key (workspace_id, flag)
);

create table users (
  id            text primary key,
  email         text not null unique,               -- stored lower-case
  name          text not null,
  kind          text not null default 'human' check (kind in ('human','service')),
  password_hash text,                               -- scrypt; null for SSO-only and service users
  status        text not null default 'active' check (status in ('active','deactivated')),
  external_id   text,                               -- SCIM externalId
  failed_logins integer not null default 0,
  locked_until  text,
  created_at    text not null,
  updated_at    text not null
);
create index users_external_id on users(external_id);

create table password_history (                      -- for the "no reuse" password rule
  id         text primary key,
  user_id    text not null references users(id) on delete cascade,
  hash       text not null,
  created_at text not null
);
create index password_history_user on password_history(user_id, created_at);

create table memberships (
  id               text primary key,
  workspace_id     text not null references workspaces(id) on delete cascade,
  user_id          text not null references users(id) on delete restrict,
  role             text not null check (role in ('owner','admin','member','view_only','guest')),
  capacity_minutes integer not null default 2400 check (capacity_minutes >= 0),  -- per week, for capacity planning
  created_at       text not null,
  updated_at       text not null,
  unique (workspace_id, user_id)
);
create index memberships_user on memberships(user_id);

create table teams (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name         text not null,
  view_only    integer not null default 0 check (view_only in (0,1)),  -- members get read-only access to team projects
  created_at   text not null,
  updated_at   text not null,
  unique (workspace_id, name)
);

create table team_members (
  team_id text not null references teams(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  primary key (team_id, user_id)
);
create index team_members_user on team_members(user_id);

create table sessions (                              -- cookie holds a random token; only its sha256 is stored
  id           text primary key,
  user_id      text not null references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  auth_method  text not null check (auth_method in ('password','saml')),
  created_at   text not null,
  expires_at   text not null,
  revoked_at   text
);
create index sessions_user on sessions(user_id);

create table invites (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  email        text not null,
  role         text not null check (role in ('admin','member','view_only','guest')),
  token_hash   text not null unique,
  invited_by   text not null references users(id),
  expires_at   text not null,
  accepted_at  text,
  created_at   text not null
);
create index invites_workspace on invites(workspace_id, email);

-- ---------------------------------------------------------------- projects and tasks

create table projects (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name         text not null,
  description  text not null default '',
  owner_id     text not null references users(id),
  visibility   text not null default 'workspace' check (visibility in ('private','team','workspace')),
  team_id      text references teams(id) on delete set null,
  archived_at  text,
  created_at   text not null,
  updated_at   text not null
);
create index projects_workspace on projects(workspace_id, archived_at);

create table project_members (                       -- exactly one of user_id or team_id
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  user_id    text references users(id) on delete cascade,
  team_id    text references teams(id) on delete cascade,
  role       text not null check (role in ('admin','editor','commenter','viewer')),
  check ((user_id is null) <> (team_id is null)),
  unique (project_id, user_id),
  unique (project_id, team_id)
);

create table project_templates (
  id              text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  definition_json text not null,                     -- sections, fields, forms, rules, starter tasks
  created_by      text not null references users(id),
  created_at      text not null
);
create index project_templates_workspace on project_templates(workspace_id);

create table sections (
  id         text primary key,
  project_id text not null references projects(id) on delete cascade,
  name       text not null,
  position   real not null default 0
);
create index sections_project on sections(project_id, position);

create table tasks (
  id               text primary key,
  workspace_id     text not null references workspaces(id) on delete cascade,
  project_id       text not null references projects(id) on delete cascade,
  section_id       text references sections(id) on delete set null,
  parent_id        text references tasks(id) on delete cascade,        -- subtasks
  title            text not null check (length(title) between 1 and 300),
  description      text not null default '',
  assignee_id      text references users(id) on delete set null,
  owner_id         text not null references users(id),
  status           text not null default 'todo' check (status in ('todo','in_progress','blocked','done')),
  start_date       text,
  due_date         text,
  is_milestone     integer not null default 0 check (is_milestone in (0,1)),
  estimate_minutes integer check (estimate_minutes is null or estimate_minutes >= 0),
  position         real not null default 0,
  completed_at     text,
  created_at       text not null,
  updated_at       text not null,
  check (start_date is null or due_date is null or start_date <= due_date)
);
create index tasks_project    on tasks(project_id, section_id, position);
create index tasks_assignee   on tasks(workspace_id, assignee_id, status);
create index tasks_due        on tasks(workspace_id, due_date);
create index tasks_parent     on tasks(parent_id);

create table task_dependencies (                     -- cycles are rejected by the app, not the database
  task_id       text not null references tasks(id) on delete cascade,
  depends_on_id text not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);
create index task_dependencies_rev on task_dependencies(depends_on_id);

create table comments (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  task_id      text not null references tasks(id) on delete cascade,
  author_id    text not null references users(id),
  body         text not null check (length(body) between 1 and 10000),
  created_at   text not null,
  edited_at    text
);
create index comments_task on comments(task_id, created_at);

create table attachments (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  task_id      text not null references tasks(id) on delete cascade,
  uploader_id  text not null references users(id),
  filename     text not null,
  mime         text not null,
  size_bytes   integer not null check (size_bytes >= 0),
  storage_key  text not null unique,                 -- random name on local disk, never the user's filename
  created_at   text not null
);
create index attachments_task on attachments(task_id);

create table time_entries (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  task_id      text not null references tasks(id) on delete cascade,
  user_id      text not null references users(id),
  minutes      integer not null check (minutes > 0 and minutes <= 1440),
  entry_date   text not null,
  note         text not null default '',
  created_at   text not null
);
create index time_entries_task on time_entries(task_id);
create index time_entries_user on time_entries(workspace_id, user_id, entry_date);

create table status_updates (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  project_id   text not null references projects(id) on delete cascade,
  author_id    text not null references users(id),
  status       text not null check (status in ('on_track','at_risk','off_track','complete')),
  body         text not null default '',
  created_at   text not null
);
create index status_updates_project on status_updates(project_id, created_at);

-- ---------------------------------------------------------------- custom fields, forms, rules, approvals

create table custom_field_defs (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  project_id   text not null references projects(id) on delete cascade,
  name         text not null,
  type         text not null check (type in ('text','number','date','single_select','multi_select')),
  options_json text not null default '[]',           -- for the two select types
  position     real not null default 0,
  unique (project_id, name)
);

create table custom_field_values (
  task_id    text not null references tasks(id) on delete cascade,
  field_id   text not null references custom_field_defs(id) on delete cascade,
  value_json text not null,
  primary key (task_id, field_id)
);
create index custom_field_values_field on custom_field_values(field_id);

create table forms (
  id                text primary key,
  workspace_id      text not null references workspaces(id) on delete cascade,
  project_id        text not null references projects(id) on delete cascade,
  name              text not null,
  slug              text not null unique,            -- random, unguessable public path
  target_section_id text references sections(id) on delete set null,
  is_open           integer not null default 1 check (is_open in (0,1)),
  appearance_json   text not null default '{}',
  created_by        text not null references users(id),
  created_at        text not null,
  updated_at        text not null
);
create index forms_project on forms(project_id);

create table form_questions (
  id           text primary key,
  form_id      text not null references forms(id) on delete cascade,
  label        text not null,
  kind         text not null check (kind in ('text','long_text','number','date','single_select','multi_select')),
  options_json text not null default '[]',
  required     integer not null default 0 check (required in (0,1)),
  position     real not null default 0,
  maps_to      text not null default 'description',  -- 'title' | 'description' | 'field:<field id>'
  show_if_json text                                  -- branching: {"question":"<id>","equals":"..."} or null
);
create index form_questions_form on form_questions(form_id, position);

create table form_submissions (
  id              text primary key,
  form_id         text not null references forms(id) on delete cascade,
  task_id         text references tasks(id) on delete set null,
  answers_json    text not null,
  submitter_email text,
  created_at      text not null
);
create index form_submissions_form on form_submissions(form_id, created_at);

create table rules (
  id              text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  project_id      text not null references projects(id) on delete cascade,
  name            text not null,
  trigger_json    text not null,                     -- task_created | field_changed | due_reached | moved_to_section
  conditions_json text not null default '[]',        -- field equals, field empty
  actions_json    text not null,                     -- set_assignee | set_status | move_to_section | set_field | add_comment | request_approval | notify_webhook
  enabled         integer not null default 1 check (enabled in (0,1)),
  last_error      text,
  created_by      text not null references users(id),
  created_at      text not null,
  updated_at      text not null
);
create index rules_project on rules(project_id, enabled);

create table rule_runs (
  id         text primary key,
  rule_id    text not null references rules(id) on delete cascade,
  task_id    text references tasks(id) on delete set null,
  status     text not null check (status in ('ok','skipped','error')),
  depth      integer not null default 0,             -- loop guard: runs caused by runs
  detail     text not null default '',
  created_at text not null
);
create index rule_runs_rule on rule_runs(rule_id, created_at);

create table approvals (
  id            text primary key,
  workspace_id  text not null references workspaces(id) on delete cascade,
  task_id       text not null references tasks(id) on delete cascade,
  attachment_id text references attachments(id) on delete set null,  -- proofing: review a specific file
  requester_id  text not null references users(id),
  approver_id   text not null references users(id),
  status        text not null default 'pending' check (status in ('pending','approved','changes_requested','cancelled')),
  note          text not null default '',
  decision_note text not null default '',
  created_at    text not null,
  decided_at    text
);
create index approvals_approver on approvals(workspace_id, approver_id, status);
create index approvals_task on approvals(task_id);

-- ---------------------------------------------------------------- reporting, portfolios, goals

create table dashboards (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name         text not null,
  owner_id     text not null references users(id),
  scope        text not null default 'private' check (scope in ('private','workspace')),
  created_at   text not null,
  updated_at   text not null
);

create table dashboard_widgets (
  id           text primary key,
  dashboard_id text not null references dashboards(id) on delete cascade,
  kind         text not null check (kind in ('number','bar','line','donut')),
  config_json  text not null,                        -- measure, group by, filters (project, team, assignee)
  position     real not null default 0
);
create index dashboard_widgets_dashboard on dashboard_widgets(dashboard_id, position);

create table portfolios (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name         text not null,
  owner_id     text not null references users(id),
  created_at   text not null,
  updated_at   text not null
);

create table portfolio_projects (
  portfolio_id text not null references portfolios(id) on delete cascade,
  project_id   text not null references projects(id) on delete cascade,
  position     real not null default 0,
  primary key (portfolio_id, project_id)
);

create table goals (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  parent_id    text references goals(id) on delete set null,
  name         text not null,
  owner_id     text not null references users(id),
  progress_pct integer not null default 0 check (progress_pct between 0 and 100),  -- manual, or derived from links
  derive       integer not null default 0 check (derive in (0,1)),                 -- 1 = progress comes from linked projects and portfolios
  due_date     text,
  status       text not null default 'on_track' check (status in ('on_track','at_risk','off_track','achieved','dropped')),
  created_at   text not null,
  updated_at   text not null
);
create index goals_workspace on goals(workspace_id);

create table goal_links (
  goal_id   text not null references goals(id) on delete cascade,
  link_type text not null check (link_type in ('project','portfolio')),
  link_id   text not null,
  primary key (goal_id, link_type, link_id)
);

-- ---------------------------------------------------------------- audit (append only, hash chained)

create table audit_events (
  seq          integer primary key autoincrement,    -- stable cursor for the SIEM API
  workspace_id text not null,                        -- no FK: the trail outlives anything it describes
  ts           text not null,
  actor_id     text,
  actor_kind   text not null check (actor_kind in ('user','service','scim','system','anonymous')),
  action       text not null,                        -- e.g. task.update, member.role_change, sso.config_update
  target_type  text,
  target_id    text,
  summary      text not null,
  before_json  text,
  after_json   text,
  ip           text,
  request_id   text,
  prev_hash    text not null,
  hash         text not null                         -- sha256 over prev_hash + the fields above
);
create index audit_workspace_ts on audit_events(workspace_id, ts);
create index audit_actor on audit_events(workspace_id, actor_id);
create index audit_action on audit_events(workspace_id, action);

create trigger audit_no_update before update on audit_events
begin select raise(abort, 'audit_events is append-only'); end;
create trigger audit_no_delete before delete on audit_events
begin select raise(abort, 'audit_events is append-only'); end;

-- ---------------------------------------------------------------- identity and access for machines

create table sso_configs (
  workspace_id      text primary key references workspaces(id) on delete cascade,
  enabled           integer not null default 0 check (enabled in (0,1)),
  enforce_sso       integer not null default 0 check (enforce_sso in (0,1)),   -- password sign-in blocked for members when 1
  idp_entity_id     text,
  idp_sso_url       text,
  idp_cert_pem      text,                            -- a public certificate, not a secret
  sp_entity_id      text,
  jit_provisioning  integer not null default 0 check (jit_provisioning in (0,1)),
  updated_at        text not null
);

create table scim_tokens (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  token_hash   text not null unique,
  label        text not null,
  created_at   text not null,
  last_used_at text,
  revoked_at   text
);

create table api_tokens (                            -- service accounts, shown once at creation
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      text not null references users(id) on delete cascade,   -- a users row with kind = 'service'
  token_hash   text not null unique,
  label        text not null,
  scopes_json  text not null,                        -- e.g. ["audit:read","tasks:write"]
  created_at   text not null,
  last_used_at text,
  expires_at   text,
  revoked_at   text
);

-- ---------------------------------------------------------------- admin controls, bundles, backup, integrations

create table trusted_domains (
  workspace_id text not null references workspaces(id) on delete cascade,
  domain       text not null,
  primary key (workspace_id, domain)
);

create table approved_apps (                         -- admin allow list for connectors
  workspace_id text not null references workspaces(id) on delete cascade,
  app_key      text not null,
  allowed      integer not null default 0 check (allowed in (0,1)),
  primary key (workspace_id, app_key)
);

create table bundles (
  id              text primary key,
  workspace_id    text not null references workspaces(id) on delete cascade,
  name            text not null,
  description     text not null default '',
  definition_json text not null,                     -- templates, rules, forms, fields; no people, no secrets
  created_by      text not null references users(id),
  created_at      text not null
);

create table backups (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  status       text not null check (status in ('running','ok','failed')),
  target_label text not null,                        -- "local copy B", shown as a simulation
  path         text,
  bytes        integer,
  sha256       text,
  started_at   text not null,
  finished_at  text,
  error        text
);

create table connectors (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  kind         text not null,                        -- plugin key: webhook_out | csv | ics | dlp_hook | archive_hook
  name         text not null,
  config_json  text not null default '{}',
  enabled      integer not null default 0 check (enabled in (0,1)),
  created_at   text not null,
  updated_at   text not null
);

create table webhooks (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  connector_id text references connectors(id) on delete cascade,
  url          text not null,
  events_json  text not null,
  signing_key  text not null,                        -- generated at runtime, HMAC-SHA256 over the body
  enabled      integer not null default 1 check (enabled in (0,1)),
  created_at   text not null
);

create table webhook_deliveries (
  id              text primary key,
  webhook_id      text not null references webhooks(id) on delete cascade,
  event           text not null,
  payload_json    text not null,
  status          text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts        integer not null default 0,
  next_attempt_at text,
  last_error      text,
  created_at      text not null
);
create index webhook_deliveries_due on webhook_deliveries(status, next_attempt_at);

create table outbox (                                -- fake email: invites and notices land here, nothing is sent
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  to_email     text not null,
  subject      text not null,
  body         text not null,
  created_at   text not null
);
create index outbox_workspace on outbox(workspace_id, created_at);
