# What worked, what to cut, what next (Evolve, pilot version)

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

## What the pilot round added and taught

- **Eight points of reset, unlock and invites, fifteen of the Job Register, eight of the request form.** The cost per
  point fell from 0.56 to 0.43 to 0.31 percent of session as the guardrails got reused, so the third item was the
  cheapest even though it had the most security surface.
- **Privacy tests earned their keep.** A test that checks the server logs for the invented client names found that
  typed search terms reached the logs through the request URL. That would not have shown up in any screen or any
  functional test, and it is now fixed and guarded.
- **Two budget gates did their job.** The audit screen, export and service accounts did not fit under the 52 percent
  gate and moved to the later list instead of being squeezed in. Nothing needing an account, key or payment was added.
- **Testing mistakes cost more than product bugs.** Shared cookie jars, a shared rate limit and re-render races in
  the browser tests cost many tokens. Isolated request contexts and waiting for the page to settle are now habits.

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

## Next three improvements, by value to this small team (none needs an account, key or payment)

1. **Edit jobs in the app.** Let people change a job's status, next action, due date and note on the Jobs screen, so the
   register can be kept in the app and the spreadsheet can retire. This is what makes the import a one-off instead of
   a weekly chore. About 5 points, roughly 1.6% of a session at the current rate.
2. **Audit log screen with filters and verify-chain, then JSON and NDJSON export and service accounts.** The trail is
   already recorded and tamper-evident. About 11 points, roughly 3.5%.
3. **Attachments on tasks and project templates** (so a repeatable job, like onboarding a client, starts from a
   template with its files). About 6 points, roughly 2%.

Needs your decision first, because each needs an account or a key: **sending email** (invites, resets and new-request
alerts would stop being copy-and-paste; needs an email service), and **time tracking with a push-only Toggl
connector** (needs a Toggl account and token, stored encrypted; I would estimate points and wait for your go, and
test against a mock first). After those: calendar and timeline views, SAML and SCIM against a local mock provider.

## Direction change: Deskrail inside Zen (after the pilot)

Deskrail's role is now fixed by the owner's architecture: the task-and-action system of record behind Zen, with Zen as its only
connection. The rules are kept in `zen-integration.md`. Phase 1 (machine access) is built: service accounts and scoped tokens,
every token call audited, a token able to call only routes that name its scope. Phase 2 (ingest endpoint and task fields) and phase 3 (the read API for Zen) are built too. Next: phase 4 (UI polish), after the owner's approval, and the hosting decision. The Job Register importer and Jobs view are untouched and transitional.
