-- Minimum extra fields for the Job Register. job_number is the raw text from the sheet (for example "J9075P"); nothing is read into it.
alter table projects add column job_number text;
alter table projects add column client text;
alter table projects add column status text;          -- job status text from the register; the 13 known values are checked on import, others are kept and flagged
alter table projects add column owner_name text;      -- the Team text as written; owner_id is set only when it matches a user
alter table projects add column start_date text;      -- YYYY-MM-DD
alter table projects add column due_date text;        -- from Estimated Completion Date
alter table projects add column closed_date text;
alter table projects add column tags text not null default '[]';   -- JSON array of short strings (from Misc)
alter table projects add column latest_note text;
create unique index projects_job_number on projects(workspace_id, job_number) where job_number is not null;
create index projects_status on projects(workspace_id, status) where job_number is not null;
