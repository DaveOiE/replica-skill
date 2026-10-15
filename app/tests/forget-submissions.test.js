import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freshApp } from './helpers.js';
import { openDb, migrate, MIGRATIONS_DIR } from '../server/db.js';

// Invented answers and addresses only.
const MARK = 'zqxform';
const submit = async (app, creds, title, email) => {
  const qs = (await app.inject(`/api/v1/public/forms/${creds.forms.slug}`)).json().questions;
  const byLabel = Object.fromEntries(qs.map((q) => [q.label, q]));
  const r = await app.inject({ method: 'POST', url: `/api/v1/public/forms/${creds.forms.slug}/submit`,
    payload: { answers: { [byLabel['What do you need help with?'].id]: title, [byLabel['Tell us more'].id]: `${MARK} detail for ${title}` }, email } });
  assert.equal(r.statusCode, 200);
  return app;
};
const taskBy = (db, title) => db.prepare('select * from tasks where title = ?').get(title);
const subOf = (db, taskId) => db.prepare('select * from form_submissions where task_id = ?').get(taskId);

test('deleting a task blanks its form submission (answers and submitter email); other submissions are untouched', async () => {
  const { app, db, call, creds } = await freshApp();
  await submit(app, creds, `Printer ${MARK} one`, `${MARK}.one@example.test`);
  await submit(app, creds, `Printer ${MARK} two`, `${MARK}.two@example.test`);
  const one = taskBy(db, `Printer ${MARK} one`), two = taskBy(db, `Printer ${MARK} two`);
  assert.match(subOf(db, one.id).answers_json, new RegExp(MARK));
  const countBefore = db.prepare('select count(*) n from form_submissions').get().n;

  assert.equal((await call('admin', 'DELETE', `/api/v1/tasks/${one.id}`)).statusCode, 200);

  const row = db.prepare('select * from form_submissions where answers_json = ? and task_id is null').all('{}');
  assert.equal(row.length, 1, 'one row blanked and detached');
  assert.deepEqual([row[0].answers_json, row[0].submitter_email], ['{}', null]);
  assert.equal(db.prepare('select count(*) n from form_submissions').get().n, countBefore, 'the row stays so the request count is honest');
  assert.match(subOf(db, two.id).answers_json, new RegExp(MARK), 'the other submission is untouched');
  assert.equal(subOf(db, two.id).submitter_email, `${MARK}.two@example.test`);
  // nothing from the deleted request is left anywhere in the database's form data
  const dump = JSON.stringify(db.prepare('select * from form_submissions').all()) + JSON.stringify(db.prepare('select title, description from tasks').all());
  assert.doesNotMatch(dump, new RegExp(`Printer ${MARK} one|${MARK}\\.one@`));
  const ev = db.prepare("select * from audit_events where action = 'task.delete' order by seq desc").get();
  assert.deepEqual(JSON.parse(ev.after_json), { submissionsBlanked: 1 });
  assert.doesNotMatch(`${ev.summary}${ev.before_json}${ev.after_json}`, new RegExp(MARK, 'i'));
});

test('subtasks: deleting the form task blanks it even with subtasks; deleting only a subtask leaves the submission alone', async () => {
  const { app, db, call, creds } = await freshApp();
  await submit(app, creds, `Laptop ${MARK} request`, `${MARK}.lap@example.test`);
  const parent = taskBy(db, `Laptop ${MARK} request`);
  const sub = (await call('admin', 'POST', `/api/v1/projects/${parent.project_id}/tasks`, { title: 'Order the laptop', parentId: parent.id })).json();
  await call('admin', 'DELETE', `/api/v1/tasks/${sub.id}`);
  assert.match(subOf(db, parent.id).answers_json, new RegExp(MARK), 'deleting a subtask does not touch the parent request');
  const sub2 = (await call('admin', 'POST', `/api/v1/projects/${parent.project_id}/tasks`, { title: 'Second step', parentId: parent.id })).json();
  assert.equal((await call('admin', 'DELETE', `/api/v1/tasks/${parent.id}`)).statusCode, 200);
  assert.equal(db.prepare('select count(*) n from tasks where id in (?, ?)').get(parent.id, sub2.id).n, 0, 'subtask went with it');
  assert.equal(db.prepare("select count(*) n from form_submissions where answers_json like ? or submitter_email like ?").get(`%${MARK}%`, `%${MARK}%`).n, 0);
});

test('the blanking is in the database, so any delete path does it: a plain SQL delete and a cascade from a project', async () => {
  const { app, db, creds } = await freshApp();
  await submit(app, creds, `Router ${MARK} fault`, `${MARK}.net@example.test`);
  const t = taskBy(db, `Router ${MARK} fault`);
  db.prepare('delete from tasks where id = ?').run(t.id);
  assert.equal(db.prepare("select count(*) n from form_submissions where answers_json like ? or submitter_email like ?").get(`%${MARK}%`, `%${MARK}%`).n, 0);
  await submit(app, creds, `Switch ${MARK} fault`, `${MARK}.sw@example.test`);
  const t2 = taskBy(db, `Switch ${MARK} fault`);
  db.prepare('delete from projects where id = ?').run(t2.project_id); // not exposed by any route; checks the cascade path only
  assert.equal(db.prepare("select count(*) n from form_submissions where answers_json like ? or submitter_email like ?").get(`%${MARK}%`, `%${MARK}%`).n, 0);
});

test('migration 0007 also blanks submissions already orphaned by earlier task deletions', () => {
  const dir = join(MIGRATIONS_DIR, '..', '..', '.local', 'mig-0006');
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  try {
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '0007')) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const db = openDb(':memory:');
    migrate(db, dir);
    db.exec("insert into workspaces(id,name,slug,created_at,updated_at) values ('w','W','w','t','t'); insert into users(id,email,name,kind,status,created_at,updated_at) values ('u','u@example.test','U','human','active','t','t');");
    db.exec("insert into projects(id,workspace_id,name,owner_id,visibility,created_at,updated_at) values ('p','w','P','u','workspace','t','t'); insert into forms(id,workspace_id,project_id,name,slug,created_by,created_at,updated_at) values ('f','w','p','F','s','u','t','t');");
    db.exec(`insert into form_submissions(id,form_id,task_id,answers_json,submitter_email,created_at) values ('s1','f',null,'{"a":"${MARK} old answer"}','${MARK}@example.test','t')`);
    assert.ok(migrate(db).includes('0007_forget_submissions.sql'));
    const r = db.prepare("select answers_json a, submitter_email e from form_submissions where id = 's1'").get();
    assert.deepEqual([r.a, r.e], ['{}', null]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
