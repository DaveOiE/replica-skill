# Run plan, rescoped for a demo (2026-10-12)

Audience: a small business owner. Goal: a short, believable demo of tasks, projects, a board, a
simple dashboard, goals and an audit log, not an enterprise build. `STATUS.md` is the live view and
is generated from `features.csv`, `milestones.csv` and `budget.json`.

## Build order (the owner's order)

1. **M2 trimmed** (24 pts): projects and sections, task fields, list view, subtasks, comments,
   milestones, dependencies, guests, per-project admin, and one addition (below). Attachments and
   project templates are deferred.
2. **Board view** from M3 (3 pts).
3. **Simple dashboard** (4 pts, fixed widgets) and **goals** (3 pts) from M5.
4. **Audit log screen** from M6 (5 pts: filters, verify chain).

One addition for the owner's OK: **Add a person** (2 pts). Without invites (deferred) there is no
way to add a teammate or guest beyond the seed. An admin creates the person and sees a one-time
temporary password. Drop it if you prefer to demo with the seeded people only.

## Later list (not built, not scheduled: 129 points)

- **M7:** SAML single sign-on, SCIM provisioning and deprovisioning, admin console, teams, security
  settings (password rules, guest controls, trusted domains, approved workspaces, app control), invites.
- **M8:** workflow bundles, custom branding and onboarding, cross-region backup.
- **M9:** integrations plugin interface and sample connectors, DLP and archiving hooks, compliance
  settings and "not certified" documents, support page.
- **M10:** all AI features (flagged stubs).
- **Not named in your list, so also later (my reading, say if you want any back):** attachments,
  project templates; calendar and timeline views, custom fields, forms and branching, form
  customisation; rules automation, status updates, time tracking; portfolios, workload, capacity,
  approvals, proofing, universal reporting, the custom chart builder; the SIEM export API and
  service accounts.

Deferred rows stay as "not built" in the matrix (never `skip`), so the parity score against the full
public list stays honest. The Gauge report will give two numbers: against the full list, and
against this demo scope.

## The numbers

| | |
| --- | --- |
| Built so far (M1) | 10 points |
| Demo scope still to build | **39 points** (24 + 3 + 7 + 5) |
| Demo scope total | 52 points (10 built, 3 partial, 39 to build) |
| Later pool | 129 points |
| M1 rate | **0.70% of session per point** (7.0% for 10 points; measured, not planned) |
| Used so far, proxy | **27.1%** (Frame and Organize 18%, M1 7.0%, this re-plan 2.1%) |
| Stop line | 45%, so **17.9%** of headroom, which is **25.6 points** at the M1 rate |

## What fits inside 45%

| step | pts | cost at 0.70 | session % when done | fits |
| --- | --- | --- | --- | --- |
| M2 trimmed | 24 | 16.8% | 43.9% | yes |
| Board view | 3 | 2.1% | 46.0% | **no, by 1.0%** |
| Dashboard and goals | 7 | 4.9% | 50.9% | no |
| Audit log screen | 5 | 3.5% | 54.4% | no |

At the measured rate only M2 trimmed fits, and the whole demo scope would end at about 54%. M1
included one-time work (audit chain, permission checks, test harness, seed), so later points
should cost less. If they cost 0.45% each, the full 39 points cost 17.6% and everything lands at
44.7%, with no room to spare. I would not promise that. I would measure it.

## Options for the stop line

- **A. Your order, with a checkpoint (recommended).** Build M2 trimmed, then report the real rate
  against 0.70. Decide on the board, dashboard, goals and audit screen from measured numbers. The
  45% line is a hard stop: I do not pass it without your "go".
- **B. Trim M2 now so more of the list fits.** Dropping dependencies, guests, per-project admin and
  add-a-person (10 pts) leaves 29 points to build, which ends at 47.4%. Still over, so B alone
  does not fit everything either. Fitting all four items at 0.70 would need a further 4 points cut.
- **C. Raise the stop line** to about 55% to cover the whole demo scope at the measured rate.

## Not in the 45%: Gauge and Evolve

The test report, parity score, security pass, README and next-steps are extra. For a demo-sized app
I estimate 6 to 9% of session. If the 45% must include them, the build budget drops to about 12%,
or about 17 points.

## Checkpoints

After each milestone I report: points built, tokens used, the measured rate, session % used, and
what changed. STATUS.md, the sweep and every test suite stay green at every commit.

## Pilot round (after the first Gauge and Evolve pass)

Built in order: admin reset, unlock and invites (8 points); Job Register importer and Jobs view (15); public request form plus one assignment rule (8). The audit screen with export and service accounts was moved to the later list (percent above the 52 gate) and time tracking with a Toggl connector was skipped (default, and above the 50 gate). See `STATUS.md`, `parity.md` and `summary.md`.
