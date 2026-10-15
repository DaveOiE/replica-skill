-- Deleting a task also blanks its form submission (the answers and the submitter's email), so nothing typed into a public form
-- outlives the task it created. The row stays, empty, so the form's "requests received" count is honest.
-- A trigger rather than route code: it also fires for the subtasks removed by cascade and for any delete path added later.
create trigger tasks_blank_submissions before delete on tasks
begin
  update form_submissions set answers_json = '{}', submitter_email = null where task_id = old.id;
end;
-- Rows left behind by task deletions made before this migration (their link to the task was already cleared).
update form_submissions set answers_json = '{}', submitter_email = null where task_id is null;
