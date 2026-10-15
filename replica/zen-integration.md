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
