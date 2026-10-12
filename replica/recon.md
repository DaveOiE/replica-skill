# Recon map: enterprise work-management platform (web)

Scope: the [C] and [E] features in the feature list, plus [S] items as labelled stubs.
For: a small IT support business (small teams, with enterprise administration).
Date: 2026-10-12

## Sources

| # | source | notes |
| --- | --- | --- |
| 1 | `replica/screens/feature-list.md` | The only source. Owner-written from public pages, no web access in this session. |

Consequence: the list names **features**, not screens or flows. The screen
inventory and flows below are **my own design** derived from the features, not
observed from the original. Confidence for every screen, flow and entity is
therefore "design" (inferred), never "seen". Gaps are listed in the feature
list under "Known gaps" and in `frame.md` as assumptions A1 to A7.

## Core loop

A team plans work as projects of tasks, moves tasks through views and rules to
done, and sees progress roll up into portfolios, goals and dashboards, while an
admin controls who gets in and can prove what changed.

## Screens (own design; IDs are stable)

| ID | screen | route | purpose | key components | states |
| --- | --- | --- | --- | --- | --- |
| S01 | Sign in | `/signin` | password or SSO sign in | form, SSO button | empty, error, locked, sso-disabled |
| S02 | Accept invite | `/invite/:token` | set password under the password rules | form, rule checklist | valid, expired, rule-fail |
| S03 | My tasks / home | `/` | what is mine, due soon, approvals waiting | task list, filters | empty, filled, loading |
| S04 | Project: list | `/p/:id/list` | tasks grouped by section | table, inline edit | empty, filled, view-only, long names |
| S05 | Project: board | `/p/:id/board` | tasks as cards in columns | board, card, drag | empty column, filled, view-only |
| S06 | Project: calendar | `/p/:id/calendar` | tasks by due date | month grid | empty month, filled |
| S07 | Project: timeline | `/p/:id/timeline` | start to due bars, dependencies, milestones | bars, lines, markers | no dates, filled |
| S08 | Task detail | drawer over S04 to S07 | every task field, subtasks, comments, files, dependencies, time, approval | drawer, tabs | view-only, guest, error |
| S09 | Project settings | `/p/:id/settings` | sections, custom fields, members, templates, save as template | forms, lists | admin only |
| S10 | Form builder | `/p/:id/forms/:fid` | questions, branching, appearance, target section | builder, preview | empty, invalid branch |
| S11 | Public form | `/f/:slug` | submit a request, creates a task | form | success, closed, error |
| S12 | Rules | `/p/:id/rules` | trigger, condition, action rules and their run log | rule builder, log | empty, disabled, failing |
| S13 | Project overview | `/p/:id/overview` | status updates and progress | update list, composer | empty, filled |
| S14 | Dashboards | `/reports` | custom charts across projects and teams | chart widgets, picker | empty, filled |
| S15 | Portfolios | `/portfolios`, `/portfolios/:id` | roll-up of projects, status, progress, workload | table, bars | empty, filled |
| S16 | Goals | `/goals` | goals linked to projects or portfolios, progress | goal tree, meter | empty, filled |
| S17 | Capacity | `/capacity` | hours assigned vs capacity per person per week | heat table | empty, over-capacity |
| S18 | Approvals | `/approvals` | requests to me and by me, decide | list, decision form | empty, decided |
| S19 | Time | `/time` | my entries, estimated vs actual | table, timer | empty, filled |
| S20 | Admin: members | `/admin/members` | members, roles, seats, invites | table, invite dialog | blocked-domain, seat-limit shown |
| S21 | Admin: teams | `/admin/teams` | teams and membership, view-only teams | table | empty |
| S22 | Admin: SSO | `/admin/sso` | SAML settings, test sign-in | form, metadata | not configured, configured, failing |
| S23 | Admin: provisioning | `/admin/scim` | SCIM token, recent events | token panel, log | no token, active |
| S24 | Admin: security | `/admin/security` | password rules, guest controls, trusted domains, approved workspaces, app control | forms, lists | defaults, customised |
| S25 | Admin: service accounts | `/admin/service-accounts` | non-human users and scoped tokens | table, token reveal-once | empty, token shown once |
| S26 | Admin: branding and onboarding | `/admin/branding` | workspace name, accent, welcome steps | form, preview | default, customised |
| S27 | Admin: bundles | `/admin/bundles` | export and import template and rule packages | list, upload | empty, import-error |
| S28 | Admin: audit log | `/admin/audit` | filter, search, export, verify chain | table, filters | empty, filled, chain-broken |
| S29 | Admin: data and backup | `/admin/data` | residency choice, key management, dedicated tier, backups, certifications panel | forms, status | every control labelled setting only or not certified |
| S30 | Integrations | `/admin/integrations` | connector plugins, sample connectors, DLP and archiving hooks | cards, config | disabled, enabled |
| S31 | Support | `/support` | priority and 24/7 contact page | contact block | placeholder details |
| S32 | AI (flagged) | `/ai` | assistant, teammates, builder, smart fields, all stubs | chat-like panel | flag off, flag on |
| S33 | Documents | `/docs/compliance` | "not certified" document pages | prose | static |
| S34 | Mock IdP (separate app) | `localhost:4001` | local SAML identity provider and fake directory | login, user list | dev only |

## Flows

```
F01 Sign in            S01 -> S03    (SSO: S01 -> S34 -> S03)   clicks 3 (password)
F02 Plan a project     S04 -> S09 -> S04 -> S08       edge: template, 60-char name
F03 Work a task        S04|S05 -> S08 -> time -> done  edge: dependency blocks, view-only
F04 Intake by form     S11 -> task in S04     edge: branching hides a question, closed form
F05 Automate           S12 -> trigger fires -> task changed   edge: loop guard, disabled rule
F06 See progress       S13 -> S14 -> S15 -> S16     edge: empty project, no dates
F07 Approve work       S08 request -> S18 decide -> task updated   edge: approver removed
F08 SSO set up         S22 -> test -> S01 SSO sign in   edge: bad signature, unknown user
F09 SCIM lifecycle     S23 token -> client creates -> updates -> deactivates user
F10 Guest and view-only S20 invite -> S02 -> restricted views   edge: untrusted domain
F11 SIEM export        service account S25 -> audit API -> NDJSON    edge: cursor, bad scope
F12 Bundle share       S27 export -> import in another workspace
F13 Backup             S29 run backup -> second directory -> verify
F14 AI stub            S32 flag on -> rule-based reply, labelled stub
```

## Components

Button, text and select inputs, multi-select, date input, modal and drawer,
table with inline edit, board column and card, calendar grid, timeline bar,
chart (bar, line, donut, number) in SVG, progress meter, tabs, toast,
empty-state block, "stub" and "not certified" badges, role badge, token
reveal-once panel. Specs in `replica/design/components.md`.

## Inferred data model (confidence: design for all; no source shows fields)

```
Workspace      name, branding, settings (password rules, guest domains, flags)
User           email, name, password hash, status (active|deactivated), external id (SCIM)
Membership     workspace, user, role (owner|admin|member|view_only|guest), capacity hours
Team           name, members, view_only flag
Project        name, owner, visibility, template origin, archived
ProjectMember  project, user or team, role (admin|editor|commenter|viewer)
Section        project, name, position
Task           project, section, parent, title, description, assignee, owner, status,
               start, due, milestone flag, estimate minutes, position
Dependency     task, depends-on task
Comment, Attachment, TimeEntry, StatusUpdate
CustomFieldDef, CustomFieldValue
Form, FormQuestion (with branching), FormSubmission
Rule, RuleRun
Approval       task, requester, approver, decision, note
Dashboard, Widget
Portfolio, PortfolioProject, Goal, GoalLink
AuditEvent     actor, action, target, before/after, hash chain
SsoConfig, ScimToken, ServiceAccount, ApiToken
Invite, Bundle, Backup, Connector, Webhook, FeatureFlag, Setting
```

## Feature matrix

`replica/features.csv`: every list item as a row with tag, priority and ceiling.

## Out of scope (skip)

- A catalogue of 100+ connectors: only the plugin interface and a few sample connectors that need no account.
- Native mobile apps (list says out of scope).
- Real certifications, real data-residency regions, real customer-held key custody, uptime guarantees: settings and documents only, labelled not certified.
- Real model calls for AI features (need a key; ask first).

## Size

Screens 34, flows 14, entities about 45. Hard parts: authorisation that holds
on every route, automation without loops, the timeline and calendar views,
SAML signature handling against a local IdP, SCIM semantics. Size: **L**
(a quarter of normal human effort), held to a small working app by the cut
line in `frame.md`.
