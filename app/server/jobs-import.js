import { parseCsv } from './csv.js';

export const STATUSES = ['Lead', 'In discussion', 'Quoted', 'Create Folder', 'Lost', 'Content Creation', 'Work in Progress', 'Managed / Time Block', 'On Hold', 'Awaiting Feedback', 'To be Invoiced', 'Now in ClickUp', 'Completed'];
export const HIDDEN_BY_DEFAULT = ['completed', 'lost'];
export const MAX_ROWS = 5000;
const EXPECTED = ['Job No', 'Job Title / Folder', 'Start Date', 'Estimated Completion (number)', 'Estimated Completion (unit)', 'Next Action Due', 'Client', 'Status', 'Team', 'Comment / Update / Action', 'Misc', 'Estimated Completion Date', 'Closed Date'];
const ERROR_CELL = /^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|NULL!|NUM!|ERROR!)/i;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Blank cells and spreadsheet error markers (#REF!, #N/A ...) are empty. */
const cell = (v) => { const t = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim(); return t === '' || ERROR_CELL.test(t) ? '' : t; };

/** Returns { value: 'YYYY-MM-DD' | '', bad: boolean }. Reads 01-Jul-24, 01-Jul-2024, 2024-07-01 and day-first 1/7/2024. Never looks inside comments. */
export function parseDate(raw) {
  const t = cell(raw);
  if (!t) return { value: '', bad: false };
  let y, m, d, x;
  if ((x = t.match(/^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{2}|\d{4})$/))) { d = +x[1]; m = MONTHS[x[2].toLowerCase()]; y = x[3].length === 2 ? (+x[3] < 70 ? 2000 : 1900) + +x[3] : +x[3]; }
  else if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) { d = +x[1]; m = +x[2]; y = x[3].length === 2 ? 2000 + +x[3] : +x[3]; }
  else return { value: '', bad: true };
  const dt = new Date(Date.UTC(y || 0, (m || 0) - 1, d || 0));
  if (!m || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { value: '', bad: true };
  return { value: dt.toISOString().slice(0, 10), bad: false };
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) : s);

/**
 * Turn CSV text into cleaned rows plus counts. Everything reported back is counts, row numbers and reasons: never the contents of a row.
 * users: [{ id, name }] in the workspace, to match the Team text to a person.
 */
export function readRegister(text, users) {
  const fail = (error) => ({ ok: false, error });
  const records = parseCsv(text);
  if (!records.length) return fail('The file is empty.');
  const header = records[0];
  if (header.length < EXPECTED.length) return fail(`The header row has ${header.length} columns; the Job Register export has ${EXPECTED.length}.`);
  const must = [[0, 'job'], [6, 'client'], [7, 'status'], [8, 'team'], [12, 'closed']];
  for (const [i, word] of must) if (!norm(header[i]).includes(word)) return fail(`Column ${i + 1} should be "${EXPECTED[i]}". Check that the columns are in the expected order.`);
  const body = records.slice(1);
  if (body.length > MAX_ROWS) return fail(`The file has more than ${MAX_ROWS} rows. Split it and import in parts.`);

  const byName = new Map(users.map((u) => [norm(u.name), u.id]));
  const firstNames = new Map();
  for (const u of users) { const f = norm(u.name).split(' ')[0]; firstNames.set(f, firstNames.has(f) ? null : u.id); }
  const matchUser = (team) => {
    for (const tok of team.split(/\s*(?:,|;|&|\/|\+|\band\b)\s*/i).map(norm).filter(Boolean)) {
      if (byName.has(tok)) return byName.get(tok);
      if (!tok.includes(' ') && firstNames.get(tok)) return firstNames.get(tok);
    }
    return null;
  };

  const skipped = [], warnings = {}, jobs = new Map(), dupes = [];
  const warn = (kind, row) => { (warnings[kind] ||= []).push(row); };
  let blankRows = 0;
  body.forEach((r, idx) => {
    const rowNo = idx + 2; // the line number in the file, header is line 1
    if (r.every((c) => !cell(c))) { blankRows++; return; }
    const job = cut(cell(r[0]), 60);
    if (!job) { skipped.push({ row: rowNo, reason: 'no job number' }); return; }
    const start = parseDate(r[2]), nextAction = parseDate(r[5]), est = parseDate(r[11]), closed = parseDate(r[12]);
    for (const [d, label] of [[start, 'start date'], [nextAction, 'next action date'], [est, 'estimated completion date'], [closed, 'closed date']]) if (d.bad) warn(`unreadable ${label}`, rowNo);
    const num = cell(r[3]), unit = cell(r[4]);
    let duration = '';
    if (num && !/^\d+(\.\d+)?$/.test(num)) warn('estimated completion number is not a number', rowNo);
    else if (num) duration = unit ? `${num} ${unit}` : num;
    else if (unit) warn('estimated completion has a unit but no number', rowNo);
    const status = cut(cell(r[7]), 60);
    if (status && !STATUSES.some((s) => norm(s) === norm(status))) warn('status is not one of the 13 known statuses', rowNo);
    const title = cut(cell(r[1]), 300);
    if (!title) warn('no title, the job number is used instead', rowNo);
    const team = cut(cell(r[8]), 200);
    const details = [duration && `Estimated completion: ${duration}`, nextAction.value && `Next action due: ${nextAction.value}`].filter(Boolean).join('\n');
    const tags = [...new Set(cell(r[10]).split(/[,;]/).map((t) => cut(t.trim(), 40)).filter(Boolean))].slice(0, 10);
    const rec = { row: rowNo, job, name: title || job, client: cut(cell(r[6]), 200), status, ownerName: team, ownerId: team ? matchUser(team) : null,
      startDate: start.value, dueDate: est.value, closedDate: closed.value, tags: JSON.stringify(tags), latestNote: cut(cell(r[9]), 2000), description: details };
    if (jobs.has(job)) dupes.push({ first: jobs.get(job).row, later: rowNo });
    jobs.set(job, rec); // the later row wins
  });
  return { ok: true, rows: [...jobs.values()], total: body.length, blankRows, skipped, duplicates: dupes, warnings,
    teamMatched: [...jobs.values()].filter((j) => j.ownerId).length, teamText: [...jobs.values()].filter((j) => j.ownerName && !j.ownerId).length };
}
