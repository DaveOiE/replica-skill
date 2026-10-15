-- Zen phase 2: fields a task needs to line up with Zen, and project kinds so ingestion can route.
alter table tasks add column source_call_id text;
alter table tasks add column client_slug text;
alter table tasks add column job_number text;                   -- raw text from Zen, never minted or interpreted here
alter table tasks add column promised_date text;                -- what was promised on the call; separate from due_date
alter table tasks add column inferred integer not null default 0 check (inferred in (0,1));   -- hedged on the call, not confirmed
alter table tasks add column lane text;                         -- free text, never an enum: the lane list is still being decided
alter table tasks add column idempotency_key text;
alter table tasks add column source text not null default 'manual' check (source in ('ingestion','manual','form'));
create unique index tasks_idempotency on tasks(workspace_id, idempotency_key) where idempotency_key is not null;
create index tasks_job on tasks(workspace_id, job_number) where job_number is not null;
create index tasks_client on tasks(workspace_id, client_slug) where client_slug is not null;
create index tasks_updated on tasks(workspace_id, updated_at, id);

alter table projects add column client_slug text;
alter table projects add column kind text check (kind in ('client','sales','internal'));   -- null for ordinary and imported per-job projects
create unique index projects_client_slug on projects(workspace_id, client_slug) where kind = 'client';
create unique index projects_one_per_kind on projects(workspace_id, kind) where kind in ('sales','internal');
