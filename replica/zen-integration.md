# Deskrail in the Zen v6 architecture (rules from the owner, kept here for later sessions)

Deskrail is the **Task and Action System of Record**: ONLY the tasks-and-actions layer. It replaces the old project tool (ADL-061).
Zen owns clients, jobs, contacts and job numbers. QuickBooks owns money, Toggl owns time, Google Drive owns files, the Credential Service owns subscriptions and keys.
Zen's Ingestion Pipeline writes AI-extracted actions from calls into Deskrail with no human approval queue (ADL-068). Zen reads task status back live and copies nothing (ADL-061, ADL-070).
Staff: Anthony, Dave and Christel. A fourth user is unconfirmed.

## Connection rule
Deskrail connects to **Zen only**. It holds no credentials for and has no connection to Toggl, QuickBooks, Drive, Gmail, Calendar, the Reseller Console or TPP, and copies nothing from them.
Other systems line up through two identifiers on every task: `job_number` and `client_slug`. Machine interfaces: the token API only (Zen's write, then Zen's read). No outgoing webhooks.

## Routing rules (ADL-066)
- Prospect-stage client actions go to the one Sales project.
- Client job actions go to that client's project (upserted by client_slug on first ingest).
- Internal job actions go to the Internal project, except internal jobs with subtype "business development", which go to Sales.
- Job number is a tag on the task, never a project, stored as raw text, never minted here.
- Unidentifiable job or client: REJECT with a clear error; never an "unsorted" project (ADL-024).

## THE CONTRACT: what Zen's ingestion and reads must follow

Authentication: `Authorization: Bearer dsk_...` on every call (a token made by an owner or admin under People, service accounts). Nothing else is accepted from Zen: no cookie, no query-string token. Use HTTPS once hosted. Tokens have a scope: `tasks:write` may only ingest; `tasks:read` may only read. A token with the wrong scope gets 403, a bad, revoked or expired one gets an identical 401, and each token is rate limited (429 with `Retry-After: 60`; slow down and retry).

### Write: `POST /api/v1/ingest/tasks` (write scope)

JSON body, snake_case, unknown fields are rejected (400):

| field | required | rules |
| --- | --- | --- |
| `idempotency_key` | yes | 8 to 200 characters, no control characters. Unique per workspace. The same key again returns the original task (200, `created: false`), never a second one |
| `context` | yes | `prospect`, `client_job` or `internal_job`. Which case this action is. **This is what the routing needs; it is the one field not on the original list** |
| `title` | yes | 1 to 300 characters |
| `description` | no | up to 20000 characters |
| `assignee` | no | an email, a full name (any case), or a first name only one person has. Anything else leaves the task unassigned; the reason comes back in `warnings` |
| `promised_date`, `due_date` | no | `YYYY-MM-DD`, a real date. Kept separate |
| `estimate_minutes` | no | whole number, 0 to 100000 |
| `inferred` | no | boolean, default false: hedged on the call, not confirmed |
| `source_call_id` | no | up to 200 characters, stored as sent |
| `client_slug` | see below | lower-case letters, digits and hyphens, up to 63 characters |
| `job_number` | see below | stored exactly as sent, up to 60 characters, no control characters, no leading or trailing spaces. Never minted or interpreted here |
| `lane` | no | free text up to 80 characters. Not a fixed list |
| `subtype` | no | up to 80 characters. Only `business development` (any case and spacing) changes routing |

**Required identification (otherwise the request is rejected, never filed in an "unsorted" place):**

| `context` | needs | files the task in |
| --- | --- | --- |
| `prospect` | `client_slug` | the one **Sales** project |
| `client_job` | `client_slug` and `job_number` | that client's project, created on first use from `client_slug` |
| `internal_job` | `job_number` | the **Internal** project, or **Sales** when `subtype` is business development |

Answers: `201` created `{ id, url, created: true, project: { id, name, kind }, job_number, client_slug, assigned, warnings }`; `200` for a replay (same shape, `created: false`, no `warnings`); `400` for a malformed body (with `details`); `422 { error: "unroutable", code, message }` when identification is missing (codes `client_slug_required`, `job_number_required`) and **nothing is created**, so Zen decides whether to retry with more detail; `401`, `403`, `429` as above. `id` is a stable task id and `url` is the canonical pointer (built from the `PUBLIC_URL` setting).

### Read: `GET /api/v1/read/tasks` and `GET /api/v1/read/projects` (read scope)

A read token sees **only projects made by ingestion** (Sales, Internal and client projects). It never sees imported per-job projects, ordinary staff projects, private projects or the people directory, even by id.

Filters on `/read/tasks` (at least one required; they combine with AND): `job_number` (exact, case-sensitive), `client_slug` (every task in that client's project, including ones staff made by hand, plus tasks carrying that slug elsewhere such as prospect actions in Sales), `ids` (comma list, up to 200; unknown or hidden ids are simply absent), `updated_since` (UTC time like `2026-10-31T09:00:00Z`; returns tasks updated **at or after** it, so the boundary task repeats). Paging: `limit` 1 to 500 (default 100) and `cursor`; ordered by `updated_at` then `id`; `next_cursor` is null on the last page. A task edited between pages reappears later rather than being skipped.

Each task: `id, url, title, status, assignee ({ name, email } or null), promised_date, due_date, estimate_minutes, completed_at, job_number, client_slug, lane, inferred, source_call_id, source (ingestion, manual or form), context (null for tasks not made by ingestion), project ({ id, name, kind }), updated_at`. The description and comments are deliberately not returned. `client_slug` is the task's own, or the client project's when the task has none.
`/read/projects` lists `{ id, name, kind, client_slug, archived, url }`, optionally filtered with `?kind=client|sales|internal`.

No outgoing webhooks exist or will be built: Zen reads live.

## What phase 2 added (decisions to confirm)
- **`context` is the one field added to the ingest body** (`prospect`, `client_job` or `internal_job`). The routing rules cannot be applied without it, and guessing it from other fields would break ADL-024. Confirm the name and values with Zen.
- Required identification: prospect needs `client_slug`; client_job needs `client_slug` and `job_number`; internal_job needs `job_number`. Otherwise 422 `unroutable` with a code and a message, and nothing is filed. Zen retries.
- Field names on the Zen-facing API are snake_case as specified (`promised_date`, `source_call_id`, `idempotency_key`), unlike the older people-facing API.
- A client project is named after its `client_slug` because Zen owns client names. Deskrail never copies them.
- A replay returns the first task unchanged and does not compare payloads. Warnings (such as an unmatched assignee) are returned on creation only and recorded in the audit trail.
- The canonical task URL is built from the `PUBLIC_URL` setting (default http://127.0.0.1:3000). Set it when hosting is decided.

## What phase 3 added
- `tasks.context` is now stored (migration 0006) so reads can return it; tasks made by staff or forms have `context` null.
- A task made in a client's project carries that client's slug from the start (staff and form tasks included); a migration backfilled older rows, and reads fall back to the project's slug anyway.
- Staff can set `jobNumber`, `promisedDate` and `lane` on a task they made by hand (PATCH `/api/v1/tasks/:id`) so it can be linked. The client slug cannot be edited there. There is no screen for this yet.
- A bug fixed on the way: staff date fields accepted impossible dates such as 2026-02-31 (they rolled over into March); they are now rejected like the ingest endpoint rejects them.

## Where the project models collide (open question 2, flagged)
1. The Jobs screen lists only projects that have a `job_number`. Ingested tasks carry the job number on the task, in the client's project, so they never appear there, and an imported per-job project (for example J9075P) will not contain the tasks Zen files under that same job number.
2. A client can therefore have two homes: its ingestion project (by `client_slug`) and any imported per-job projects (by `job_number`). Nothing links them. They share only the text of the identifiers.
3. The dashboard, My tasks and the project list show both models together.
4. Projects made by ingestion are visible to the whole workspace and owned by the service account. Imported projects are private to owners and admins by default.
5. The importer and Jobs view are untouched, as instructed. When they retire (ADL-071) the per-job projects can be archived and nothing else changes.

## Phases
1. Machine access: service accounts and scoped tokens (**built**, see security.md).
2. Ingest endpoint and task fields (**built**, see the contract above).
3. Read API for Zen (**built**, see the contract above).
4. Only after approval: UI polish (AI-created badge, lane field, audit log screen with export, optional read-only link-outs built only from job_number and client_slug).

## Do not build
Time tracking or Toggl, any connector to QuickBooks, Drive, Gmail, Calendar, Reseller or TPP, attachments, job-number minting, approvals and proofing, SAML, SCIM, data residency, key management, a client portal, lane permissions, outgoing webhooks, an Asana importer. The Job Register importer and Jobs view stay untouched and are transitional (ADL-071).

## Open (do not guess)
1. Hosting and database (SQLite for now; new data access goes through `app/server/store.js` so a Postgres move is possible; older routes still call SQLite directly).
2. One project per client versus per job (client project per ADL-066 for ingest; existing imported per-job projects stay; flag collisions).
3. Lane vocabulary: nine lanes proposed, to be stored as editable text or a small settings list, never a hardcoded enum.
4. Who creates a client's project first: upsert by client_slug on first ingest.
5. The fourth user.
