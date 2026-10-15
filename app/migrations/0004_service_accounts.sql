-- A service account is a users row with kind 'service' (no password, no membership, never listed as a person).
-- This table ties it to exactly one workspace. Tokens live in api_tokens (hashes only).
create table service_accounts (
  user_id      text primary key references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  created_by   text not null references users(id),
  created_at   text not null
);
create index service_accounts_workspace on service_accounts(workspace_id);
