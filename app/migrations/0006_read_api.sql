-- Zen phase 3: keep the routing context on the task so it can be read back, and give hand-made tasks in a client's project that client's slug.
alter table tasks add column context text check (context in ('prospect','client_job','internal_job'));
update tasks set client_slug = (select p.client_slug from projects p where p.id = tasks.project_id)
  where client_slug is null and project_id in (select id from projects where kind = 'client');
