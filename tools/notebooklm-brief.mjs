// Writes replica/notebooklm/product-brief.md: one plain-language source document for NotebookLM, generated from the code,
// the schema, the route table and the feature matrix so it cannot drift from what was built. No dates, no commit ids, no data.
//   node tools/notebooklm-brief.mjs          writes the file
//   node tools/notebooklm-brief.mjs --check  exits 1 if the committed file is out of date
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../app/server/db.js';
import { buildApp } from '../app/server/app.js';
import { ACTIONS, ROLES } from '../app/server/authz.js';
import { parseCsv } from '../app/server/csv.js';
import { PRODUCT_NAME } from '../app/shared/brand.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = join(root, 'replica', 'notebooklm', 'product-brief.md');

// Every table must be placed in one group (a test fails when a new table is not listed here).
export const GROUPS = [
  ['People and access', 'Who exists, how they sign in, what they may do.', ['workspaces', 'users', 'memberships', 'sessions', 'invites', 'password_resets', 'password_history', 'teams', 'team_members']],
  ['Work', 'Projects (which also hold the Job Register fields), sections, tasks and what hangs off a task.', ['projects', 'project_members', 'project_templates', 'sections', 'tasks', 'task_dependencies', 'comments', 'attachments', 'time_entries', 'status_updates']],
  ['Forms and automation', 'Public request forms, what visitors send, the assignment rule and its run log.', ['forms', 'form_questions', 'form_submissions', 'rules', 'rule_runs', 'custom_field_defs', 'custom_field_values', 'approvals']],
  ['Reporting and goals', 'Planned: dashboards you build yourself, portfolios, goals.', ['dashboards', 'dashboard_widgets', 'portfolios', 'portfolio_projects', 'goals', 'goal_links']],
  ['Audit trail', 'The tamper-evident record of every change.', ['audit_events']],
  ['Settings, integrations and machine access', 'Service accounts and tokens are built; the rest are planned enterprise and integration features.', ['service_accounts', 'workspace_settings', 'feature_flags', 'sso_configs', 'scim_tokens', 'api_tokens', 'trusted_domains', 'approved_apps', 'bundles', 'backups', 'connectors', 'webhooks', 'webhook_deliveries', 'outbox']],
  ['Housekeeping', '', ['schema_migrations']],
];
const NOTES = {
  'users.email': 'personal data', 'users.name': 'personal data', 'users.password_hash': 'a one-way scrypt hash only; the password itself is never stored',
  'sessions.id': 'a hash of the session token; the token itself is never stored', 'invites.token_hash': 'hash only; the link is shown once to the admin', 'invites.email': 'personal data',
  'password_resets.token_hash': 'hash only; the link is shown once to the admin',
  'projects.client': 'CLIENT DATA (Job Register)', 'projects.owner_name': 'staff names as typed in the register', 'projects.latest_note': 'CLIENT DATA, free text from the register', 'projects.description': 'free text; for imported jobs it holds the duration and next-action date',
  'tasks.title': 'staff, visitor or AI-extracted free text', 'tasks.job_number': 'identifier from Zen, stored as raw text, never minted here', 'tasks.client_slug': 'identifier from Zen', 'tasks.source_call_id': 'the call an action came from (an identifier from Zen)', 'tasks.inferred': 'true when the action was hedged on the call, not confirmed', 'tasks.lane': 'free text, not a fixed list', 'tasks.idempotency_key': 'lets Zen retry safely', 'tasks.source': 'ingestion, manual or form', 'tasks.context': 'prospect, client_job or internal_job for tasks made by ingestion; empty otherwise', 'projects.kind': 'client, sales or internal for projects made by ingestion; empty for ordinary and imported per-job projects', 'projects.client_slug': 'identifier from Zen, only on client projects', 'tasks.description': 'free text; tasks from the public form can include a visitor email address', 'comments.body': 'staff free text',
  'form_submissions.answers_json': 'free text typed by anonymous visitors', 'form_submissions.submitter_email': 'personal data from visitors, optional',
  'audit_events.before_json': 'values before a change, secrets removed', 'audit_events.after_json': 'values after a change, secrets removed (the Job Register import records counts and field names only)', 'audit_events.ip': 'network address of the caller',
};
const TABLE_NOTES = { teams: 'read by the permission rules; nothing in the app creates teams yet', team_members: 'read by the permission rules; nothing in the app creates teams yet' };

const csvRows = (f) => { const [h, ...b] = parseCsv(readFileSync(join(root, f), 'utf8')); return b.map((r) => Object.fromEntries(h.map((k, i) => [k.trim().toLowerCase(), (r[i] || '').trim()]))); };
const esc = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const serverSource = () => readdirSync(join(root, 'app', 'server')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(root, 'app', 'server', f), 'utf8')).join('\n');

export async function buildBrief() {
  const db = openDb(':memory:'); migrate(db);
  const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all().map((r) => r.name);
  const listed = GROUPS.flatMap((g) => g[2]);
  const missing = tables.filter((t) => !listed.includes(t)), gone = listed.filter((t) => !tables.includes(t));
  if (missing.length || gone.length) throw new Error(`GROUPS is out of step with the schema. Unlisted: ${missing.join(', ') || 'none'}. No longer exist: ${gone.join(', ') || 'none'}.`);
  const src = serverSource();
  const used = (t) => new RegExp(`\\b(from|into|update|join)\\s+${t}\\b`, 'i').test(src);
  const app = await buildApp({ db });
  const feats = csvRows('replica/features.csv');
  const by = (f) => feats.filter(f);
  const line = (f) => `- **${f.feature}**${f.original === 'no' ? ' (an extra, not on the original list)' : ''}${f.notes ? `: ${f.notes}` : ''}`;
  const pts = (list) => list.reduce((a, f) => a + (Number(f.effort) || 0), 0);
  const later = by((f) => f.scope === 'later' && f.clone === 'no');
  const o = [];

  o.push(`# ${PRODUCT_NAME}: product brief for NotebookLM

This document describes ${PRODUCT_NAME}, a small work-management web app built clean-room for a small IT support business: what it does, what data it holds, who can see what, how another system could talk to it, and what is not built. It is generated from the code, the database schema, the route table and the feature matrix, so it matches the software. It contains no real data. **${PRODUCT_NAME} is not certified to any standard and makes no claim of compliance.**

Honest summary: this is a pilot-ready small work manager, not an enterprise platform. It runs locally (Node.js, a SQLite file, a web page), needs no paid service and no account, and sends no email. Nothing in it uses AI yet.
`);

  o.push('## 1. Features\n');
  o.push(`### Built and tested\n\n${by((f) => f.clone === 'yes').map(line).join('\n')}\n`);
  o.push(`### Partly built\n\n${by((f) => f.clone === 'partial').map(line).join('\n')}\n`);
  o.push(`### Not built (the "later list", about ${pts(later)} effort points, nothing faked)\n\n${later.map((f) => `- ${f.feature}`).join('\n')}\n`);
  o.push(`### Left out on purpose\n\n${by((f) => f.clone === 'skip').map((f) => `- ${f.feature}: ${f.notes}`).join('\n')}\n`);
  o.push(`There are **no stubs and no mocks**: anything not built is simply absent. AI features, single sign-on (SAML), user provisioning (SCIM), and connectors are all **not built**.\n`);

  o.push('## 2. Screens a person can reach\n');
  o.push(table(['Screen', 'Who', 'What it is for'], [
    ['Sign in; join from an invite link; reset password from a link', 'anyone with credentials or a link', 'Entering the app'],
    ['My tasks', 'everyone', 'Open tasks assigned to me, soonest due first'],
    ['Projects; a project as List or Board; task drawer', 'everyone, limited by project access', 'Planning and doing work: fields, subtasks, comments, dependencies, milestones'],
    ['Project settings; Request forms', 'project admins', 'Sections, who is on the project, archive; building public request forms and the assignment rule'],
    ['Jobs', 'everyone, limited by project access', 'Search and filter the imported Job Register; Completed and Lost hidden by default'],
    ['Import jobs', 'owners and admins', 'Upload the register CSV, preview counts and warnings, confirm'],
    ['Dashboard', 'everyone, limited by project access', 'Task counts, tasks by status, open tasks by person, progress by project (fixed widgets)'],
    ['People', 'owners and admins', 'Roles, add a person, invite by link, reset a password by link, unlock an account'],
    ['Account', 'everyone', 'Change my own password'],
    ['Public request form (no sign-in)', 'anyone with the link', 'Send a request that becomes a task'],
  ]) + '\n');

  o.push('## 3. Who can do what\n');
  o.push('Workspace roles: owner, admin, member, view-only (a read-only seat), and guest (an outside collaborator who sees only the projects they are added to and cannot see the staff directory). Permissions are enforced on the server for every request, never only on the screen.\n');
  o.push(table(['Action (workspace level)', 'Changes data?', ...ROLES], Object.entries(ACTIONS).filter(([, r]) => !r.project).sort().map(([a, r]) => [a, r.write ? 'yes' : 'no', ...ROLES.map((x) => (r.roles.includes(x) && !(r.write && ['view_only', 'guest'].includes(x)) ? 'yes' : '-'))])) + '\n');
  o.push(`Project roles are checked per project: **viewer** (read), **commenter** (read and comment), **editor** (change tasks), **admin** (manage the project, sections, members and forms). Owners and admins are project admins everywhere. A member of a workspace-visible project is an editor. A private project is visible only to people added to it and to owners and admins. A view-only seat is capped at viewer whatever a project says. A guest is capped at editor, and only where added, and is never a project admin. A project the person cannot see answers "not found", the same as one that does not exist.\n`);

  o.push('## 4. Data held\n');
  o.push('Everything is in one SQLite database file. The tables below are grouped by purpose. "Used today" means the application code reads or writes the table; the others are defined for planned features and stay empty.\n');
  for (const [name, blurb, list] of GROUPS) {
    o.push(`### ${name}\n\n${blurb}\n`);
    for (const t of list) {
      const cols = db.prepare(`pragma table_info(${t})`).all();
      const state = used(t) ? (TABLE_NOTES[t] ? `used today (${TABLE_NOTES[t]})` : 'used today') : 'defined for a planned feature; not used yet';
      o.push(`**${t}** (${state})\n\n${cols.map((c) => `- ${c.name}${NOTES[`${t}.${c.name}`] ? `: ${NOTES[`${t}.${c.name}`]}` : ''}`).join('\n')}\n`);
    }
  }
  o.push(`### What is deliberately never stored

- Passwords in plain text (only a one-way hash), session tokens, invite links, reset links (only hashes of them).
- The Job Register CSV file itself: it is read in the browser, parsed in memory on the server and discarded. Only the resulting jobs are kept.
- Secrets or values inside the audit trail: it records who did what and which fields changed. Passwords, hashes and tokens are removed before writing.
- Search words and file contents in server logs: logs record the path of a request, not its query string or body.

### Retention

There is **no automatic deletion or retention policy**. Data stays until someone deletes it, and the audit trail cannot be edited or deleted through the application (the database blocks it). There is no backup feature and the database file is not encrypted by the app. Seed and test data are invented people on the reserved example.test domain.

### Job Register fields

The importer reads a 13-column CSV exported from a Google Sheet: Job No, Job Title / Folder, Start Date, Estimated Completion (number), Estimated Completion (unit), Next Action Due, Client, Status, Team, Comment / Update / Action, Misc, Estimated Completion Date, Closed Date. Job number is kept exactly as written (for example J9075P) and no meaning is read into a suffix. Blank cells and spreadsheet errors such as #REF! are treated as empty. Dates like 01-Jul-24 are read; dates inside comments are never parsed. The duration number and unit are combined into text. Team text is matched to an existing user when the name matches, otherwise kept as plain text. Rows with no job number are skipped and reported by row number and reason only. Import is idempotent by job number. Assumption to confirm: the project due date comes from Estimated Completion Date, while Next Action Due and the duration are kept in the description. Imported jobs are visible to owners and admins only unless the importing admin chooses "everyone". The 13 known statuses: Lead, In discussion, Quoted, Create Folder, Lost, Content Creation, Work in Progress, Managed / Time Block, On Hold, Awaiting Feedback, To be Invoiced, Now in ClickUp, Completed.
`);

  o.push('## 5. The audit trail\n');
  o.push('Every change to data writes an audit entry in the same database transaction as the change: who (a person, the system, or an anonymous visitor), what happened, which record, and which fields changed. Entries are chained by hashes, so tampering is detectable, and the database refuses edits and deletes. Failed sign-ins are recorded. Reads are not recorded. Refused requests are not recorded because they change nothing. Owners and admins have an **Audit log screen** with filters (who, action, date range), newest first, and a **CSV export**. The screen and the CSV show field names only, never the values before or after a change, and anything shaped like a token or password hash is removed again on the way out. Each export is itself recorded. A service token can never read the audit log. There is **no JSON feed for other systems and no verify-chain button yet**.\n');

  o.push('## 6. The API (how another system could talk to this)\n');
  o.push(`The web app is a thin page over a JSON API at /api/v1 (${app.routeTable.length} routes). **Today the API accepts browser session cookies from a person who signed in, and bearer tokens from service accounts. A token carries a scope (tasks:write or tasks:read) and may call only routes that name its scope. The write token can create tasks through POST /api/v1/ingest/tasks (idempotent, routed by the Zen rules) and both tokens can call /api/v1/service/whoami to check they work. The read token can read tasks and projects through GET /api/v1/read/tasks and /read/projects, but only those made by ingestion (Sales, Internal and client projects), never imported or staff projects and never the people directory. There are no outgoing webhooks and no MCP-style endpoint.** Public routes (no sign-in) exist only for invite links, reset links and the public request form, and they are rate limited.\n`);
  const who = (r) => (r.public ? 'anyone (rate limited)' : ACTIONS[r.action]?.project ? `project ${ACTIONS[r.action].project} or higher` : ACTIONS[r.action].roles.join(', '));
  o.push(table(['Method', 'Path', 'Who may call it', 'Changes data'], [...app.routeTable].sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method)).map((r) => [r.method, r.url, who(r), r.write ? 'yes' : 'no'])) + '\n');
  o.push(`### What connecting an AI would need first (recommendation)

1. **Service accounts with scoped tokens** (built): an AI or another system gets its own identity, shown a token once, with every call audited under that identity. The ingest and read routes are built.
2. A short **allow-list of fields** an AI may read. Treat these as sensitive and exclude them by default: client names and notes from the Job Register, comments, task descriptions (which can contain visitor email addresses), form submissions, and people's email addresses.
3. **Decide read-only versus write**: creating tasks is safe to start with; changing status or assignment should be a later, separate decision.
4. NotebookLM is a Google service. Upload only this brief and the other documents in the replica folder, never exports of real client data such as the Job Register.
`);

  o.push(`## 7. Security controls in place, and what is not covered

In place and tested: server-side permission checks on every route (checked against five roles, another workspace and signed-out callers); an audit entry for every change; password hashing; sign-in lockout after five failures that treats unknown emails the same; sign-in and public-form rate limits; single-use expiring links that are shown once and stored only as hashes; strict input validation; stored text rendered as plain text only; security headers and a refusal of cross-site writes; no secrets in the repository; client data files kept out of git.

Not covered: no penetration test, no manual screen-reader pass (an automated accessibility scan is clean on every screen), no database encryption at rest, no backup, rate limits live in memory, no email delivery (invite and reset links are passed on by hand), and no CAPTCHA on the public form (rate limits and a hidden trap field instead). Compliance certifications, data residency and key management are not built and not certified.
`);

  o.push(`## 8. How it was built and where it stands

Built by the Replica skills in stages (frame, organize, run, gauge, evolve). The test suites cover the API, permissions, the importer, forms, the browser screens at phone and desktop width, and accessibility. Parity is measured with the pack's own tool against the public feature list the owner supplied: roughly 31 out of 100 against the full list and about 90 out of 100 against the demo and pilot scope. No S1, S2 or S3 bug is open.

Decisions still needing the owner: whether to send email (needs an email service account), whether to add time tracking with a push-only Toggl connector (needs a Toggl account and token), and the due-date assumption for the Job Register. Next improvements by value: edit jobs in the app, a JSON audit feed, attachments and project templates.

The accompanying documents in the repository's replica folder (parity.md, security.md, bugs.md, test-plan.md, summary.md, brand.md) give the detail behind these statements.
`);
  return o.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('notebooklm-brief.mjs')) {
  const text = await buildBrief();
  if (process.argv.includes('--check')) {
    const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (old !== text) { console.error('replica/notebooklm/product-brief.md is out of date: run npm run brief'); process.exit(1); }
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, text); console.log(`Wrote ${OUT} (${text.split('\n').length} lines)`); }
}
