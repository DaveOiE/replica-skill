-- Admin-issued password reset links. Like invites, only a hash of the token is stored; links are single use and expire.
create table password_resets (
  id           text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id      text not null references users(id) on delete cascade,
  token_hash   text not null unique,
  created_by   text not null references users(id),
  expires_at   text not null,
  used_at      text,
  created_at   text not null
);
create index password_resets_user on password_resets(user_id);
