# What worked, what to cut, what next (Evolve, 2026-10-12)

## What worked

- **Guardrails that fail loudly.** Every API route is declared in one table; one test calls each route as
  every kind of user and demands an audit row for every write. Sabotaging the code (removing a permission
  check, uncapping view-only seats, dropping an audit write) made tests fail, so the tests are trustworthy.
- **Real-browser tests found what unit tests could not:** a typo that blanked the whole app, a layout that
  collapsed only at desktop width, focus lost after every save, two usability bugs in Gauge.
- **Honest scope accounting.** Deferred features stayed "not built" (never "skipped"), so the score against the
  full list is 27.7 and not an inflated number. `STATUS.md` is generated from the matrix and cannot drift.
- **Measuring the rate after each milestone and re-planning on evidence** (0.70, then 0.34, then 0.37 percent of
  session per point) instead of trusting the first estimate.
- **Clean-room discipline cost almost nothing:** one name constant with a guard test, a sweep gate in the suite,
  a voice guide, invented seed people on a reserved domain.

## What to cut or do differently

- **Up-front point estimates were about twice too high** for later milestones and too low for the first.
  Estimate one milestone, measure, then size the rest.
- **The session percentage is a proxy.** There was no usage meter to read. Next time, ask for a real reading at
  each phase boundary.
- **Planning outran building.** A 34-screen map, a 46-table schema and a 110-route outline were written before
  any feature existed; about two thirds of the tables belong to features on the later list. Next time, write the
  schema one milestone at a time.
- **The brief's centre (Enterprise administration) is entirely unbuilt.** SAML, SCIM, the admin console and the
  audit screen all landed on the later list. That was the right call for a demo to a small business owner, but
  it means this is a small work manager, not an enterprise platform. Say so in any demo.
- **Cut from the product:** nothing built should be cut. If budget is tight again, the cheapest things to drop
  are the custom chart builder and the second and third sample connectors.

## Next three improvements, by value to a small IT support business

1. **Request intake: a public form that creates a task, plus one simple rule** (for example, when a task is
   moved to Done, notify and close). Support work arrives as requests; this is the feature that makes the app
   useful on day one. About 7 points, roughly 2.5% of a session at the current rate.
2. **Audit log screen with filters and verify-chain, then the SIEM export and service accounts.** The trail is
   already recorded and tamper-evident; only the screen and the export are missing, so this is the cheapest way
   to show the enterprise story honestly. About 8 points, roughly 3%.
3. **Admin password reset and unlock, then invites by link** (closes bug B-006 and removes the need to hand over
   temporary passwords). About 5 points, roughly 2%.

Only after those: SAML and SCIM against a local mock identity provider (about 15 points, the biggest single
item), then calendar and timeline views.
