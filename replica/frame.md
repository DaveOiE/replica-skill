# FORGE phase F: Frame

Date: 2026-10-12
Branch: `claude/dreamy-mendel-jczq11`
Status: framed, waiting on one blocker (public-source access, see Blockers)

## Goal

A working web app with the capabilities of an enterprise work-management
platform, built for a small IT support business. It runs end to end in a demo
workspace with seed data, has passing tests, and gets a parity score against
the public feature list.

## Rules (binding on every later phase)

1. **Clean room.** Rebuild what the product does, never what it owns. No
   original name, logo, copy, icons, screenshots, or code. The app gets its own
   name and brand (replica-brand, phase O). Screenshots, if any, stay in
   `replica/screens/` as reference and are never shipped.
2. **Public sources only.** Pricing pages, feature pages, public help docs,
   public API docs, store listings. No sign-in to any account, ours or anyone
   else's. No scraping loops, no reading JS bundles or private endpoints.
3. **No compliance claims.** HIPAA, SOC 2, data residency and key management
   are shown only as clearly labelled configurable settings plus documentation.
   Nothing in the UI, README or marketing text says "compliant", "certified" or
   "HIPAA-ready".
4. **Ask first** before anything needing an account, a key, or a payment.
   Never type or request real passwords, keys or card numbers. All secrets are
   env vars; `.env*` is gitignored; `.env.example` lists names only.
5. **Small steps.** One commit per step, on this branch only. Each phase ends
   with a stop and a report.

## What "runs end to end" means (status vocabulary)

Every capability gets exactly one of these labels, in the UI, the README and
`features.csv`. This is how we avoid overclaiming.

| label | meaning | parity.py `clone` value |
| --- | --- | --- |
| **real** | Fully working locally, tested | `yes` |
| **mock** | Real protocol and logic against a local stand-in (e.g. our own SAML IdP) | `yes`, note says "local mock" |
| **stub** | UI and API contract exist, no real external system behind it | `partial` |
| **setting only** | A labelled configuration field and documentation, no enforcement | `partial`, note says "setting only" |
| **not implemented** | Absent | `no` |
| **skip** | Cannot or should not be cloned, with a reason | `skip` |

## Scope and honest ceiling

Priorities are my first guess. replica-recon re-derives them from the public
sources in phase O and may change them.

### Core

| capability | proposed priority | ceiling |
| --- | --- | --- |
| Tasks (subtasks, assignees, due dates, comments, dependencies) | must | real |
| Projects and sections | must | real |
| List, board, calendar and timeline views | must | real |
| Custom fields | must | real |
| Forms (intake to task) | should | real |
| Approvals | should | real |
| Goals | should | real |
| Portfolios | should | real |
| Reporting dashboards | must | real |
| Time tracking | should | real |
| Automations (trigger, condition, action rules) | should | real |

### Enterprise

| capability | proposed priority | ceiling |
| --- | --- | --- |
| SAML single sign-on | must | **mock**: SAML 2.0 against a local mock IdP, no real IdP |
| SCIM user provisioning | must | **mock**: SCIM 2.0 endpoints, tested by a local client |
| Audit log + SIEM-suited API | must | real (JSON and NDJSON, cursor pagination, time filters) |
| Cross-region backup | could | **setting only** plus a local simulation (backup to a second directory); no real second region |
| View-only teams | must | real (server-enforced role) |
| Salesforce, Tableau, Power BI connectors | could | **stub**: connector UI, config and a real export feed (CSV/JSON) those tools could read. No live link |
| Custom onboarding and branding | should | real |
| Workflow bundles (export/import of rules, forms, fields) | should | real |
| Service accounts | should | real (hashed tokens, scoped, rotatable) |
| 24/7 support contact page | could | real page; uses contact details the owner supplies; no staffing claim |

### Enterprise+

| capability | proposed priority | ceiling |
| --- | --- | --- |
| AI assist (summaries, suggestions) | could | **stub**: local rule-based, no model call |
| AI builder for workflows (text to workflow bundle) | could | **stub**: keyword and template matching |
| DLP and archiving integration points | could | **stub**: outbound hook and export endpoints only |
| Approved workspaces | should | real (allow-list enforced) |
| Trusted guest domains | should | real (enforced on invite) |
| Admin app management (allow/deny integrations) | should | real |
| Custom password rules | should | real (enforced server-side) |
| Data residency | could | **setting only** |
| HIPAA mode, SOC 2 evidence, key management | could | **setting only** plus documentation |

### Out of scope (skip, with reason)

- Real Salesforce, Tableau, Power BI links: need the owner's accounts and keys.
- Any compliance certification: not something code can grant.
- Original's marketplace, templates library, brand, and content: owned by them.
- Real LLM calls: need an API key. Only on request, and I will ask first.
- Native mobile apps and email-to-task inbound: out of this build.

## Success criteria (measurable)

1. Every Enterprise-list capability above has a label and either runs in the
   demo workspace or is a clearly labelled stub or setting.
2. `python3 replica-diff/parity.py replica/features.csv` reports feature
   score >= 80, all must-haves done, none missing.
3. All automated tests pass; no open S1 or S2 bugs in `replica/bugs.md`.
4. Security basics verified by test: roles enforced on the server (a
   view-only user and a second tenant are rejected), an audit entry for every
   state-changing request, no secrets in the repo (scanned).
5. `sweep.py` finds nothing of the original left in the code.
6. README lists every feature with its label; stubs and gaps are never hidden.

## Environment findings (checked 2026-10-12)

| item | result |
| --- | --- |
| Python | 3.13.16; `cryptography` 50.0.1 present; no Flask, no signxml |
| Node / npm | 22.22.0 / 10.9.4; npm registry reachable |
| Database | PostgreSQL 16 client and server binaries present; SQLite 3.45.1 also available |
| Baseline tests | 57/57 pass (the skill pack's own tool tests) |
| Branch | `claude/dreamy-mendel-jczq11`, clean, branched from `main` |
| Public sources | **BLOCKED**: `asana.com`, `help.asana.com` and `developers.asana.com` all return 403 on CONNECT from the sandbox egress policy (confirmed in the proxy log) |

## Blockers

**Public sources are unreachable from this sandbox.** Recon (phase O, step 1)
needs the pricing page, plan comparison and public help docs. I will not
route around the policy, and I will not fill the gap from memory and call it
recon.

Fix, in the environment's network settings: either a broader access level, or
add `asana.com`, `help.asana.com` and `developers.asana.com` under Allowed
domains (leave "Allow package managers" ticked). Steps:
https://code.claude.com/docs/en/cloud-environments#network-access

If you would rather not open the network, the alternative is that you paste the
plan comparison and the relevant help pages into the chat, and I recon from
that.

## Phase budget (relative to this session; I cannot meter it exactly)

| phase | work | share | commits |
| --- | --- | --- | --- |
| F Frame | this doc, feasibility checks | ~3% | 1 |
| O Organize | recon map and matrix, architecture and schema, tokens, brand, backend plan | ~15% | 5 to 6 |
| R Run | core, roles, audit, SSO, SCIM, reporting, stubs, AI | ~55% | 15 to 25 |
| G Gauge | replica-test, parity, security pass, fixes | ~17% | 4 to 6 |
| E Evolve | summary, README, next three improvements | ~10% | 1 to 2 |

Run is the risk. If budget runs short, the cut order is: AI features, then
connector stubs, then cross-region backup simulation, then portfolios and goals
depth. The must-haves are protected.
