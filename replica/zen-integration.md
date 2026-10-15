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

## What phase 2 added (decisions to confirm)
- **`context` is the one field added to the ingest body** (`prospect`, `client_job` or `internal_job`). The routing rules cannot be applied without it, and guessing it from other fields would break ADL-024. Confirm the name and values with Zen.
- Required identification: prospect needs `client_slug`; client_job needs `client_slug` and `job_number`; internal_job needs `job_number`. Otherwise 422 `unroutable` with a code and a message, and nothing is filed. Zen retries.
- Field names on the Zen-facing API are snake_case as specified (`promised_date`, `source_call_id`, `idempotency_key`), unlike the older people-facing API.
- A client project is named after its `client_slug` because Zen owns client names. Deskrail never copies them.
- A replay returns the first task unchanged and does not compare payloads. Warnings (such as an unmatched assignee) are returned on creation only and recorded in the audit trail.
- The canonical task URL is built from the `PUBLIC_URL` setting (default http://127.0.0.1:3000). Set it when hosting is decided.

## Where the project models collide (open question 2, flagged)
1. The Jobs screen lists only projects that have a `job_number`. Ingested tasks carry the job number on the task, in the client's project, so they never appear there, and an imported per-job project (for example J9075P) will not contain the tasks Zen files under that same job number.
2. A client can therefore have two homes: its ingestion project (by `client_slug`) and any imported per-job projects (by `job_number`). Nothing links them. They share only the text of the identifiers.
3. The dashboard, My tasks and the project list show both models together.
4. Projects made by ingestion are visible to the whole workspace and owned by the service account. Imported projects are private to owners and admins by default.
5. The importer and Jobs view are untouched, as instructed. When they retire (ADL-071) the per-job projects can be archived and nothing else changes.

## Phases
1. Machine access: service accounts and scoped tokens (**built**, see security.md).
2. Ingest endpoint and task fields (migration; idempotent on idempotency_key; routing above; strict validation).
3. Read API for Zen (read scope): by job_number, client_slug, ids, updated_since; stable pagination.
4. Only after approval: UI polish (AI-created badge, lane field, audit log screen with export, optional read-only link-outs built only from job_number and client_slug).

## Do not build
Time tracking or Toggl, any connector to QuickBooks, Drive, Gmail, Calendar, Reseller or TPP, attachments, job-number minting, approvals and proofing, SAML, SCIM, data residency, key management, a client portal, lane permissions, outgoing webhooks, an Asana importer. The Job Register importer and Jobs view stay untouched and are transitional (ADL-071).

## Open (do not guess)
1. Hosting and database (SQLite for now; new data access goes through `app/server/store.js` so a Postgres move is possible; older routes still call SQLite directly).
2. One project per client versus per job (client project per ADL-066 for ingest; existing imported per-job projects stay; flag collisions).
3. Lane vocabulary: nine lanes proposed, to be stored as editable text or a small settings list, never a hardcoded enum.
4. Who creates a client's project first: upsert by client_slug on first ingest.
5. The fourth user.
