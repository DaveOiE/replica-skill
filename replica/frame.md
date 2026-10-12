# FORGE phase F: Frame

Date: 2026-10-12
Branch: `claude/dreamy-mendel-jczq11`
Source of truth: `replica/screens/feature-list.md` (owner-written, public information only)
Status: all five FORGE phases complete for the demo scope; see summary.md for what to do next

## Goal

A clean-room, original work-management app for small teams, with enterprise
administration features. The [C] and [E] features in the feature list run end
to end in a seeded demo workspace. Tests pass. A parity report says what is
built, stubbed or missing. A smaller working app beats a big unfinished one.

## Rules (binding on every phase)

1. **Clean room.** Rebuild what the product does, never what it owns. No
   third-party names, logos, wording, icons or code. The app gets its own
   name and brand (replica-brand, phase O). Open icon set only.
2. **No web access.** This session cannot browse, and I will not try. The
   feature list is the only source. Anything it does not answer becomes an
   open question below plus a labelled assumption, and work continues.
3. **No compliance claims.** Certifications, data residency and key
   management appear only as settings and documents, each labelled
   "not certified" (or "setting only, no real regions / no real key
   custody"). No wording like compliant, certified or ready.
4. **Secrets.** Never type or request real passwords, keys or card numbers.
   Secrets are env vars, `.env*` is gitignored, `.env.example` has names
   only, seed data is fake. Ask before anything needing an account, key or
   payment (so: no real LLM, no real Salesforce-style link, no payments).
5. **Small steps.** One feature per commit, on this branch. Each feature's
   test runs and passes before the next. `STATUS.md` tracks every feature as
   done, stubbed or not started.

## Status vocabulary (used in STATUS.md, README, `features.csv`)

| label | meaning | `parity.py` value |
| --- | --- | --- |
| **done** | Works locally and is tested | `yes` |
| **mock** | Real protocol and logic against a local stand-in (own SAML IdP, SCIM test client) | `yes`, note "local mock" |
| **stub** | UI and API contract exist, no real system behind it | `partial` |
| **setting only** | Labelled setting and document, nothing enforced | `partial`, note "setting only" |
| **not started / not built** | Absent | `no` |
| **skip** | Cannot or should not be built, with reason | `skip` |

## Scope from the feature list

| area | tag | ceiling |
| --- | --- | --- |
| 1 Core work management (tasks, subtasks, projects, sections, project templates, list/board/calendar/timeline, custom fields, dependencies, milestones, forms with branching, automation rules, status updates, time tracking, guests, responsive web) | C | done |
| 1 Integrations | C | plugin interface done, 2 or 3 sample connectors that need no account (outbound webhook, CSV import/export, calendar-file feed); no catalogue of 100+ |
| 2 Dashboards, portfolios, goals, workload, capacity planning, approvals, universal reporting | C | done (capacity and "universal" reporting kept simple) |
| 3 SAML SSO, SCIM, admin console, service accounts, view-only seats, guest controls and trusted domains, approved workspaces and app control, password rules, onboarding and branding, workflow bundles | E | done / mock (SAML and SCIM against the local mock IdP) |
| 3 Cross-region backup | E | done as a local backup to a second directory; labelled a simulation, no real region |
| 4 Audit log and SIEM-suited API | E | done (JSON and NDJSON, cursor paging, time and actor filters) |
| 4 Data residency, key management, dedicated tier, certifications | S | setting only, "not certified" |
| 4 DLP, archiving, eDiscovery hooks, 24/7 support page | S | stub (hooks and export endpoints; page uses placeholder contact details) |
| 5 AI teammates, AI builder, planning assistant, MCP-style endpoint, smart fields | S | stub, behind a feature flag, built last, no model calls |

## Labelled assumptions (continue-with, to confirm)

- **A1.** DLP, archiving and eDiscovery tier is unclear in the source: built
  as [S] stubs only.
- **A2.** Field types: text, number, date, single select, multi select.
  Views, automation triggers (task created, field changed, due date reached,
  moved to section) and conditions (field equals or is empty) come from the
  list's headings and general knowledge; unconfirmed against help pages.
- **A3.** "Universal resource management" is one organisation-wide view of
  assigned hours versus capacity per person per week, using task estimates.
- **A4.** "View-only seats" is a role with no write access, enforced on the
  server. No billing or licence counting (no payments).
- **A5.** Guests are an unlimited external role, limited to projects they are
  added to, and invitable only from trusted guest domains when that setting
  is on.
- **A6.** "MCP-style" means a small local tool endpoint that lists, reads and
  creates tasks, authenticated by a service account. Labelled stub.
- **A7.** Smart fields and summaries [?] are rule-based text, not generated
  by a model.

## Decisions log (2026-10-12)

- **Q1 answered:** the name is **Deskrail** (owner chose it; owner runs trademark and domain checks).
- **Q2 answered:** the support page uses placeholder contact details only, never real ones.
- **Q3 answered:** A1 to A7 accepted as written; the owner may paste help pages later to confirm them.
- **Plan:** the full ten-milestone plan stands (the smaller cut was not requested; the cut line is kept).

## Open questions for you (all answered, kept for the record)

- **Q1.** Business name or colour preferences for the brand, or my pick from
  five candidates? (Trademark and domain checks stay "to run", I cannot run
  them without web access.)
- **Q2.** Real contact details for the 24/7 support page? Placeholder until
  given.
- **Q3.** OK to confirm views, field types and automation conditions (A2)
  against the help-centre pages later, by you pasting them, or accept A2?

## Success criteria

1. Every [C] and [E] row in the list runs in the seeded demo workspace, or
   is labelled with why not.
2. `parity.py` feature score >= 80 and no must-have missing.
3. All tests pass. No open S1 or S2 bug in `replica/bugs.md`.
4. Tests prove: roles enforced on the server (view-only user, guest and a
   second workspace are rejected), an audit entry for every state change,
   no secrets in the repo, seed data is fake.
5. `sweep.py` clean against the avoid list. README labels every stub.

## Environment (checked)

Python 3.13 (with `cryptography`), Node 22 and npm registry reachable,
PostgreSQL 16 and SQLite 3.45 available locally, skill-pack tests 57/57
pass. No web access to the original product, by design.

## Effort by phase (relative to this session; not meterable exactly)

| phase | work | share | commits |
| --- | --- | --- | --- |
| F Frame | this doc | ~3% | 1 |
| O Organize | recon map, architecture and schema, tokens, brand | ~15% | 4 to 5 |
| R Run | the build, in the listed order | ~55% | 15 to 25 |
| G Gauge | test, parity, security pass, fixes | ~17% | 4 to 6 |
| E Evolve | README, summary, next three | ~10% | 1 to 2 |

Cut line if budget tightens: AI stubs first, then sample connectors beyond
one, then the backup simulation, then capacity planning. [C] and [E]
must-haves are protected.
