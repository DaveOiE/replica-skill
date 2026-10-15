-- Idle timeout: the time a session was last used. Null means "not used since it was made".
alter table sessions add column last_seen_at text;
create index sessions_expires on sessions(expires_at);
