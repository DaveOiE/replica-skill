import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../server/csv.js';
import { parseDate } from '../server/jobs-import.js';
import { verifyChain } from '../server/audit.js';
import { freshApp } from './helpers.js';

// INVENTED sample data only: made-up clients and job numbers, same columns as the real register export.
const HEADER = ['Job No', 'Job Title / Folder', 'Start Date', 'Estimated Completion', 'Estimated Completion', 'Next Action Due', 'Client', 'Status', 'Team', 'Comment / Update / Action', 'Misc', 'Estimated Completion Date', 'Closed Date'];
const q = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const toCsv = (rows) => [HEADER, ...rows].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
const ROWS = [
  ['J1234P', 'Website rebuild', '01-Jul-24', '2', 'Week(s)', '15-Jul-24', 'Brightwater Cafe Pty', 'Work in Progress', 'Sam Okafor', 'Chased on 03-Aug-24, waiting on the logo', 'web, urgent', '31-Aug-24', ''],
  ['J2001A', 'Email migration', '05-Aug-24', '1', 'Month(s)', '#REF!', 'Nimbus Dental', 'Quoted', 'Priya', '', '', '#REF!', ''],
  ['J3002B', 'Printer fix', '', '', '', '', 'Harbourview Plumbing / Corner Bakery', 'Completed', 'Dana Whitlock', 'All done', '', '10-Sep-24', '12-Sep-24'],
  ['', 'Orphan row with no job number', '01-Jan-24', '', '', '', 'Ghost Client', 'Lead', '', '', '', '', ''],
  ['J2001A', 'Email migration v2', '05-Aug-24', '1', 'Month(s)', '', 'Nimbus Dental', 'On Hold', 'Priya', 'Paused', '', '30-Sep-24', ''],
  ['J4004C', 'Old lead', '', '', '', '', 'Lost Cause Ltd', 'Lost', '', '', '', '', ''],
  ['J5005D', '', '32-Jan-24', 'x', 'Week(s)', '', 'Odd Status Co', 'Nonsense', 'Sam Okafor & Priya Nair', 'Needs a look', 'a;b;a', '', ''],
  ['', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['J6006E', 'Network audit', '', '', '', '', '#REF!', '#REF!', '', '', '', '', ''],
];
const CSV = toCsv(ROWS);
const NAMES = ['Brightwater', 'Nimbus', 'Harbourview', 'Corner Bakery', 'Lost Cause', 'Odd Status', 'Dana Whitlock', 'J1234P', 'J3002B', 'Website rebuild', 'Printer fix'];

const preview = (call, who, csv = CSV) => call(who, 'POST', '/api/v1/jobs/import/preview', { csv });
const doImport = (call, who, csv = CSV, visibility) => call(who, 'POST', '/api/v1/jobs/import', { csv, visibility });

test('csv reader: quotes, commas and newlines inside quotes, CRLF, BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,1","c ""q""\nline2"\r\nx,,z'), [['a', 'b,1', 'c "q"\nline2'], ['x', '', 'z']]);
  assert.deepEqual(parseCsv('a,b\n\n'), [['a', 'b']]);
});

test('dates: 01-Jul-24 style, ISO and day-first read; invalid or odd values are flagged, never guessed', () => {
  assert.deepEqual(parseDate('01-Jul-24'), { value: '2024-07-01', bad: false });
  assert.deepEqual(parseDate('1-Jul-2024'), { value: '2024-07-01', bad: false });
  assert.deepEqual(parseDate('2024-07-01'), { value: '2024-07-01', bad: false });
  assert.deepEqual(parseDate('1/7/2024'), { value: '2024-07-01', bad: false });
  assert.deepEqual(parseDate('#REF!'), { value: '', bad: false });
  assert.deepEqual(parseDate('  '), { value: '', bad: false });
  for (const bad of ['32-Jan-24', '31-Feb-24', 'next week', '01-Foo-24', '2024-13-01']) assert.deepEqual(parseDate(bad), { value: '', bad: true }, bad);
});

test('preview: exact counts, row numbers and reasons, and no row contents anywhere in the answer', async () => {
  const { call } = await freshApp();
  const r = await preview(call, 'admin');
  assert.equal(r.statusCode, 200);
  const b = r.json();
  assert.deepEqual(b.counts, { rowsInFile: 9, blankRows: 1, jobsFound: 6, toCreate: 6, toUpdate: 0, unchanged: 0, skipped: 1, duplicateJobNumbers: 1, teamMatchedToAPerson: 3, teamKeptAsText: 1 });
  assert.deepEqual(b.skipped, [{ row: 5, reason: 'no job number' }]);
  assert.deepEqual(b.duplicates, [{ rows: [3, 6], used: 'the later row' }]);
  const w = Object.fromEntries(b.warnings.map((x) => [x.kind, x.rows]));
  assert.deepEqual(w['unreadable start date'], [8]);
  assert.deepEqual(w['estimated completion number is not a number'], [8]);
  assert.deepEqual(w['status is not one of the 13 known statuses'], [8]);
  assert.deepEqual(w['no title, the job number is used instead'], [8]);
  const text = JSON.stringify(b);
  for (const n of NAMES) assert.ok(!text.includes(n), `preview leaked ${n}`);
});

test('import cleans the data: raw job numbers, empty means empty, dates read, comments never parsed, combined client kept, team mapped', async () => {
  const { call, db, creds } = await freshApp();
  assert.equal((await doImport(call, 'admin')).statusCode, 200);
  const get = (job) => db.prepare('select * from projects where job_number = ? and workspace_id = ?').get(job, creds.workspaces.demo);
  const a = get('J1234P');
  assert.deepEqual([a.name, a.client, a.status, a.owner_name, a.start_date, a.due_date, a.closed_date, a.owner_id], ['Website rebuild', 'Brightwater Cafe Pty', 'Work in Progress', 'Sam Okafor', '2024-07-01', '2024-08-31', null, creds.member.userId]);
  assert.equal(a.description, 'Estimated completion: 2 Week(s)\nNext action due: 2024-07-15');
  assert.equal(a.latest_note, 'Chased on 03-Aug-24, waiting on the logo', 'the date in the comment is text, not a date');
  assert.deepEqual(JSON.parse(a.tags), ['web', 'urgent']);
  const dup = get('J2001A');
  assert.deepEqual([dup.name, dup.status, dup.due_date, dup.owner_id], ['Email migration v2', 'On Hold', '2024-09-30', creds.member2.userId], 'later duplicate row wins; "Priya" matches the one Priya');
  const done = get('J3002B');
  assert.deepEqual([done.client, done.owner_name, done.owner_id === creds.admin.userId, done.closed_date, done.status], ['Harbourview Plumbing / Corner Bakery', 'Dana Whitlock', true, '2024-09-12', 'Completed'], 'unmatched team stays text; the importing admin owns it');
  const odd = get('J5005D');
  assert.deepEqual([odd.name, odd.start_date, odd.status, odd.owner_id, JSON.parse(odd.tags)], ['J5005D', null, 'Nonsense', creds.member.userId, ['a', 'b']], 'no title uses the job number; bad date empty; first matching name wins; tags de-duplicated');
  const empty = get('J6006E');
  assert.deepEqual([empty.client, empty.status], [null, null], '#REF! is empty');
  assert.equal(db.prepare("select count(*) n from projects where job_number is not null").get().n, 6);
  assert.deepEqual(db.prepare('select name from sections where project_id = ? order by position').all(a.id).map((s) => s.name), ['To do', 'In progress', 'Done']);
  assert.equal(a.visibility, 'private', 'imported client data starts private');
});

test('import is idempotent by job number: again changes nothing, a changed row updates and never duplicates', async () => {
  const { call, db } = await freshApp();
  await doImport(call, 'admin');
  const again = (await doImport(call, 'admin')).json();
  assert.deepEqual([again.counts.toCreate, again.counts.toUpdate, again.counts.unchanged], [0, 0, 6]);
  const edited = toCsv(ROWS.map((r) => (r[0] === 'J4004C' ? [...r.slice(0, 7), 'Quoted', ...r.slice(8)] : r)));
  const p = (await preview(call, 'admin', edited)).json();
  assert.deepEqual([p.counts.toCreate, p.counts.toUpdate, p.counts.unchanged], [0, 1, 5]);
  await doImport(call, 'admin', edited);
  assert.equal(db.prepare('select count(*) n from projects where job_number is not null').get().n, 6);
  assert.equal(db.prepare("select status from projects where job_number = 'J4004C'").get().status, 'Quoted');
});

test('audit: one event per import (counts only), one per project created or changed (field names only), none for unchanged', async () => {
  const { call, db, creds } = await freshApp();
  const n = (action) => db.prepare('select count(*) n from audit_events where action = ?').get(action).n;
  await doImport(call, 'admin');
  assert.deepEqual([n('jobs.import'), n('job.import_create'), n('job.import_update')], [1, 6, 0]);
  await doImport(call, 'admin');
  assert.deepEqual([n('jobs.import'), n('job.import_create'), n('job.import_update')], [2, 6, 0], 'second import: one import event, no project events');
  await doImport(call, 'admin', toCsv(ROWS.map((r) => (r[0] === 'J4004C' ? [...r.slice(0, 7), 'Quoted', ...r.slice(8)] : r))));
  const up = db.prepare("select * from audit_events where action = 'job.import_update'").get();
  assert.deepEqual(JSON.parse(up.after_json), { fields: ['status'] });
  assert.equal(JSON.parse(db.prepare("select after_json from audit_events where action = 'jobs.import' order by seq desc limit 1").get().after_json).toUpdate, 1);
  const dump = JSON.stringify(db.prepare('select * from audit_events').all());
  for (const name of NAMES.concat(['Quoted'])) assert.ok(!dump.includes(name), `audit leaked ${name}`);
  assert.equal(verifyChain(db, creds.workspaces.demo).ok, true);
});

test('permissions and tenancy: only admins import; another workspace gets its own separate jobs', async () => {
  const { call, db, creds } = await freshApp();
  for (const who of ['member', 'viewonly', 'guest']) {
    assert.equal((await preview(call, who)).statusCode, 403, `${who} preview`);
    assert.equal((await doImport(call, who)).statusCode, 403, `${who} import`);
  }
  assert.equal((await call(null, 'POST', '/api/v1/jobs/import', { csv: CSV })).statusCode, 401);
  await doImport(call, 'admin');
  const before = db.prepare('select count(*) n from projects where job_number is not null').get().n;
  const o = (await doImport(call, 'outsider')).json();
  assert.equal(o.counts.toCreate, 6, 'the same job numbers in another workspace are new there');
  assert.equal(db.prepare('select count(*) n from projects where job_number is not null').get().n, before + 6);
  assert.equal(db.prepare("select count(*) n from projects where job_number = 'J1234P' and workspace_id = ?").get(creds.workspaces.demo).n, 1);
});

test('jobs list: search, filters, Completed and Lost hidden unless asked, and only what the viewer can see', async () => {
  const { call } = await freshApp();
  await doImport(call, 'admin', CSV, 'workspace');
  const list = async (who, qs = '') => (await call(who, 'GET', `/api/v1/jobs${qs}`)).json();
  const numbers = (r) => r.jobs.map((j) => j.jobNumber);
  assert.deepEqual(numbers(await list('member')), ['J1234P', 'J2001A', 'J5005D', 'J6006E'], 'Completed and Lost are hidden by default');
  assert.deepEqual(numbers(await list('member', '?showClosed=true')), ['J1234P', 'J2001A', 'J3002B', 'J4004C', 'J5005D', 'J6006E']);
  assert.deepEqual(numbers(await list('member', '?q=j12')), ['J1234P'], 'search by job number, case-insensitive');
  assert.deepEqual(numbers(await list('member', '?q=migration')), ['J2001A'], 'search by title');
  assert.deepEqual(numbers(await list('member', '?status=On%20Hold')), ['J2001A']);
  assert.deepEqual(numbers(await list('member', '?client=Nimbus%20Dental')), ['J2001A']);
  assert.deepEqual(numbers(await list('member', '?team=sam')), ['J1234P', 'J5005D']);
  const all = await list('member', '?showClosed=true');
  assert.deepEqual(all.filters.statuses, ['Completed', 'Lost', 'Nonsense', 'On Hold', 'Work in Progress']);
  assert.equal(all.filters.clients.includes('Harbourview Plumbing / Corner Bakery'), true);
  assert.equal((await call('member', 'GET', '/api/v1/jobs?limit=0')).statusCode, 400);
  assert.equal((await call('member', 'GET', '/api/v1/jobs?bogus=1')).statusCode, 400);
  assert.equal((await list('outsider')).total, 0, 'another workspace sees none');
});

test('private import: members see no jobs, admins see all; the guest and view-only follow the same project rules', async () => {
  const { call } = await freshApp();
  await doImport(call, 'admin'); // default visibility is private
  assert.equal((await (await call('member', 'GET', '/api/v1/jobs')).json()).total, 0);
  assert.equal((await (await call('viewonly', 'GET', '/api/v1/jobs')).json()).total, 0);
  assert.equal((await (await call('guest', 'GET', '/api/v1/jobs')).json()).total, 0);
  assert.equal((await (await call('admin', 'GET', '/api/v1/jobs')).json()).total, 4);
  assert.equal((await (await call('owner', 'GET', '/api/v1/jobs?showClosed=true')).json()).total, 6);
});

test('bad files are refused with plain reasons that never quote the file', async () => {
  const { call } = await freshApp();
  const bad = async (csv) => { const r = await doImport(call, 'admin', csv); return [r.statusCode, r.json().error]; };
  assert.deepEqual(await bad(''), [400, 'The file is empty.']);
  assert.equal((await bad('a,b,c\n1,2,3'))[0], 400);
  assert.match((await bad('a,b,c\n1,2,3'))[1], /header row has 3 columns/);
  const swapped = [...HEADER]; [swapped[6], swapped[7]] = [swapped[7], swapped[6]];
  assert.match((await bad(swapped.map(q).join(',') + '\nJ1,x')) [1], /Column 7 should be "Client"/);
  const many = toCsv(Array.from({ length: 5001 }, (_, i) => [`J${i}`, 't', '', '', '', '', '', '', '', '', '', '', '']));
  assert.match((await bad(many))[1], /more than 5000 rows/);
  assert.equal((await call('admin', 'POST', '/api/v1/jobs/import', { csv: CSV, extra: 1 })).statusCode, 400);
  assert.equal((await call('admin', 'POST', '/api/v1/jobs/import', { csv: 'x'.repeat(3_100_000) })).statusCode, 400, 'over the size limit');
  assert.equal((await call('admin', 'POST', '/api/v1/jobs/import', { csv: 'x'.repeat(3_400_000) })).statusCode, 413, 'over the body limit');
});

test('server logs never contain the file or its contents', async () => {
  const lines = [];
  const { call } = await freshApp({ logger: { level: 'trace', stream: { write: (l) => lines.push(l) } } });
  await preview(call, 'admin'); await doImport(call, 'admin'); await call('admin', 'GET', '/api/v1/jobs?q=Brightwater&client=Nimbus%20Dental'); // search terms are typed client names: they must not reach the logs through the URL
  await doImport(call, 'admin', 'not,a,register');
  const log = lines.join('');
  assert.ok(log.length > 0, 'logging was actually on');
  for (const n of NAMES.concat(['not,a,register', 'Orphan row'])) assert.ok(!log.includes(n), `a log line contained ${n}`);
});
