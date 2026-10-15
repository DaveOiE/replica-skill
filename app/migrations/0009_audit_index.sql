-- Appending to the audit chain looks up the newest row of a workspace. Without this index SQLite sorted every row of the workspace for each write.
create index audit_workspace_seq on audit_events(workspace_id, seq);
