# The Replica skill

Eleven Claude skills that clone any app. Free, MIT, no signup, no API key,
nothing to connect.

One reverse-engineers the app you want to clone. One rebuilds it. One tests it
for bugs. And one is the Entrepreneur: it reads what the app's users hate and
fixes it in yours, so you have an app you can sell.

In between, the others plan the stack and the database, rebuild the design
system, wire up auth and payments, score your clone against the original, give
it a name and a brand of its own, write the landing page and the store
listing, and put it live on your domain.

**It rebuilds what an app does, never what it owns.** Features and flows,
clean-room style. Not its code, its logo, its copy or its content. The
fine print is at the bottom, and the skills enforce it.

<!-- app:start -->
## Built with these skills: Deskrail, a small work manager (pilot version)

The skills were used end to end on one real build: a clean-room work-management app for a small IT support
team. It is a **pilot-ready small work manager**, not an enterprise platform. Scored against the full public
feature list it is **31.2 of 100** (10 of 22 must-haves). Scored against the demo and pilot scope it is **90.0
of 100**. There are **216 passing tests** and **no open S1, S2 or S3 bugs**. Not certified to any standard; it
makes no claim of compliance.

### Run it

```bash
npm install
npm run seed     # creates data/app.db with invented people; sign-ins are written to .local/demo-credentials.txt
                 # (it refuses if data/app.db already exists; `npm run seed -- --force` deletes it and starts again)
npm start        # http://127.0.0.1:3000
```

For a real instance (not the demo), use a new database file and create the first owner instead of seeding:
`npm run first-owner -- --workspace "Your Company" --name "Your Name" --email you@your-company.example`. It shows a one-time password
once in the terminal, stores only a hash, writes nothing secret to any log, and refuses to run if an owner already exists.

Backups: `npm run backup:keygen` once (keep a copy of the key somewhere other than the server), then with `BACKUP_KEY` and
`BACKUP_DEST=file:/path/to/another/disk` set, `npm run backup` takes an online encrypted copy while the app keeps running,
checks it, and stores it; `npm run restore -- --from <name> --to <path>` checks the backup before it puts anything in place and
keeps any existing file aside. Only a folder destination is built; a cloud store would need a small driver and an account, which
this build does not create. There is no automatic scheduling or clean-up of old backups in the app.

A person added by an admin gets a temporary password that must be replaced at their first sign-in (and stops working after 7 days if unused). Admins can deactivate a person on People: they are signed out at once. If the only owner is locked out or loses their password, someone with shell access to the server runs `npm run break-glass -- unlock --email ...` or `-- reset --email ...`.

Sessions end after 12 hours, or after 2 hours unused (`SESSION_IDLE_MINUTES`). Passwords must be 12 characters and not a common one.

The step-by-step for running it on a server (not yet done by anyone) is `replica/runbook.md`, and the files for it (systemd units, Caddy, backup timers and scripts, firewall, a restore drill) are in `replica/deploy/` with their own README. They have not been run on a real machine; the Node version used for testing is pinned in `.nvmrc`.

Needs Node 22.13 or newer (Python 3.8 or newer for the pack's tools). No account, key or paid service.
Seed passwords are random each time and live only in the gitignored file. Tests:
`npm test`, `python3 -m unittest discover -s tests`, `npx playwright test`. No email is sent by the app: invite
and reset links are shown once to the admin, who passes them on.

### What works (built and tested)

| area | what you can do |
| --- | --- |
| People and roles | password sign-in with lockout; roles owner, admin, member, view-only and guest, enforced on the server; admins add a person, invite by link, reset a password by link, and unlock an account; change your own password |
| Projects and tasks | create, sections, archive, private or workspace-wide, per-project admins, guests only where added; task fields, subtasks, comments, milestones, dependencies (no loops) |
| Views | list with inline editing, board with drag or a Move to menu, My tasks |
| Job Register | admins import a CSV from a spreadsheet (preview, then confirm; safe to repeat); everyone with access searches and filters the Jobs screen |
| Request forms | project admins build a form; anyone with the public link sends a request that becomes a task, optionally assigned to a chosen person |
| Dashboard | task counts, tasks by status, open tasks by person, progress by project (fixed widgets) |
| Machine access | admins create service accounts and scoped tokens (shown once, revocable) for other systems such as Zen; a token can do only what its scope allows. A write token can create tasks through the ingest endpoint (idempotent, routed to the Sales, Internal or client project by fixed rules, and rejected if the job or client cannot be identified). A read token can read tasks and projects made by ingestion (never staff or imported projects, never the people directory), with filters and stable paging |
| Accountability | every change is recorded in a tamper-evident audit trail; permissions and the trail are tested on every route |

### Partly built

- **Dashboard:** fixed widgets only. You cannot build your own charts.
- **Automation:** one rule only, "assign new form requests to a chosen person". No other triggers, conditions or actions.
- **Forms:** short text, long text and pick-one questions. No branching or styling options.
- **Mobile-friendly web app:** every screen built is checked at phone and desktop width.
- The audit trail has a screen (owners and admins only) with filters and a CSV export. The CSV holds field names, never values or secrets. There is **no JSON feed for other systems and no verify-chain button yet**.

### Job Register import

Admins can import a Job Register CSV exported from a spreadsheet, then everyone with access can search it on the
Jobs screen. **Run the real import only on your own computer, never in a cloud session.** Real client data must
never be committed: `*.csv` files and the `import/` folder are ignored by git, and a test checks that. The file is
read in your browser, parsed in memory on the server, and never stored or logged; only the resulting jobs are
kept, and the audit trail records counts and field names, never values. Re-importing updates jobs by job number
and never duplicates them. Job numbers are kept exactly as written (for example `J9075P`); no meaning is read into
a suffix. The project due date comes from "Estimated Completion Date"; "Next Action Due" and the duration are kept
in the description. All test data is invented.

### Not built (nothing is faked)

There are **no stubs and no mocks** in this build. These are simply not built: SAML sign-in, SCIM provisioning,
the admin console and security settings, the audit log screen and its JSON or NDJSON export,
calendar and timeline views, custom fields, form branching, time tracking and any Toggl connector, status
updates, portfolios, goals, capacity, approvals, workflow bundles, branding and onboarding, backup,
integrations, DLP and archiving hooks, a support page, compliance documents (they would be labelled not
certified) and all AI features. Attachments and project templates are not built either. Native mobile apps and a
catalogue of 100+ connectors are out of scope on purpose.

### Not certified

Data residency, key management, HIPAA, SOC 2 and similar are **not built and not certified**. If they are
added they will appear only as labelled settings and documents. A test fails the build if those words appear
without "not certified" beside them.

### Where things are

`STATUS.md` (live progress), `replica/run-plan.md` (scope and budget), `replica/parity.md`,
`replica/test-plan.md`, `replica/bugs.md`, `replica/security.md`, `replica/summary.md` (what worked, what to cut,
next three), `replica/brand.md` (name, logo brief, voice).
<!-- app:end -->

## Install

Paste this into Claude:

```
https://github.com/Jakeschincariol/replica-skill

install skill
```

Or as a plugin, in Claude Code:

```
/plugin marketplace add Jakeschincariol/replica-skill
/plugin install replica-skill@replica-skill
```

Claude Code namespaces plugin skills, so installed as a plugin they show up as
`/replica-skill:replica-recon` and so on. Copy the folders instead if you want
plain `/replica-recon`:

```bash
git clone https://github.com/Jakeschincariol/replica-skill.git
cp -r replica-skill/replica-* ~/.claude/skills/
```

Project-local instead of global: copy the same folders into your repo's
`.claude/skills/`. No Claude Code at all? Paste any single `SKILL.md` at the
top of a chat and it runs as a mode. You lose the Python tools, but the
method works.

The tools need Python 3.8 or newer. Nothing to pip install.

## The eleven

| command | what it does |
| --- | --- |
| `/replica-recon` | Reverse-engineers any app: screens, flows, components, data model. From public pages, screenshots, store listings and your own account. |
| `/replica-architect` | Plans the stack, database schema and API for your clone. |
| `/replica-design` | Rebuilds the design system: colours, type, spacing, components. As tokens, with your own assets. |
| `/replica-build` | Rebuilds the app screen by screen from the recon map. |
| `/replica-backend` | Auth, database, payments and integrations. |
| `/replica-test` | Clicks through every flow and tests it for bugs. |
| `/replica-diff` | Compares your clone against the original. A parity score and what is missing. |
| `/replica-entrepreneur` | Reads what the app's users hate in real reviews and turns it into fixes and a positioning angle. |
| `/replica-brand` | Names and rebrands your version so it is yours. |
| `/replica-launch` | Landing page, pricing and App Store listing. |
| `/replica-deploy` | Ships it live on your own domain. |

## How to use it

Run them in order. Each one reads what the last one wrote, in a `replica/`
folder in your project.

```
recon -> architect -> design -> build -> backend -> test -> diff -> entrepreneur -> brand -> launch -> deploy
```

An example: cloning a scheduling app, the kind where you share a link and
people book a time with you.

1. **`/replica-recon`** with the app's URL. It reads the help center, the
   pricing page, the store listing and public walkthroughs, and you click
   through your own account with it. Out comes `replica/recon.md`: 18
   screens, 7 flows (guest books a meeting, host sets availability, guest
   reschedules...), the components, an inferred data model (users, event
   types, availability, bookings) and `features.csv`. The partner
   marketplace is marked out of scope: that is their network, not a feature.
2. **`/replica-architect`** picks Next.js, Postgres, Stripe and Resend, writes
   the schema (with a constraint so two guests can never book the same slot)
   and orders the build: the booking flow end to end first.
3. **`/replica-design`** measures the screenshots into tokens: colour roles,
   type scale, 8px spacing, the date picker and slot button specs. Open
   icons, an open font, your own words.
4. **`/replica-build`** builds the shell, then the booking flow, then every
   screen with all its states, ticking off `features.csv` as it goes.
5. **`/replica-backend`** adds sign up, Google Calendar through Google's own
   API with your keys, Stripe for paid bookings, reminder emails.
6. **`/replica-test`** writes a test plan from the 7 flows, Playwright specs
   for the happy paths and edge cases (time zones, a slot taken mid-booking,
   double submit), and logs bugs by severity until no S1 or S2 is open.
7. **`/replica-diff`** scores it. Features 86, all must-haves done, booking
   page layout 91. Missing: round-robin for teams, the website embed.
8. **`/replica-entrepreneur`** reads 140 real reviews across the App Store,
   G2, Capterra and Reddit. Top complaints: per-seat price jumps, no text
   reminders, guests confused by time zones. Each with counts and linked
   quotes. Fix plan: flat pricing, SMS reminders, a time zone confirm step.
   Angle: booking links for small teams that hate per-seat pricing.
9. **`/replica-brand`** names it (with the trademark and domain checks to
   run), gives it a new palette, a logo brief and a voice, then sweeps the
   codebase until nothing of the original is left.
10. **`/replica-launch`** writes the landing page around the angle, sets
    pricing against the original's public page, and lints the store listing.
11. **`/replica-deploy`** runs the preflight (tests, parity, sweep, listing),
    sets up production, gives you the DNS records for your domain, and ships
    it when you say go.

You can also run any one on its own. `/replica-entrepreneur` on an app you
are only thinking about cloning is a good way to find out if you should.

## The tools

Six of them, all standard-library Python. None touch the network.

```bash
python3 replica-diff/imgdiff.py original.png clone.png --out diff.png   # layout diff, ignores colour
python3 replica-diff/parity.py replica/features.csv                     # parity score + missing list
python3 replica-entrepreneur/reviews.py replica/reviews.csv             # what users hate, ranked, linked
python3 replica-design/contrast.py replica/design/tokens.json           # WCAG contrast on your tokens
python3 replica-brand/sweep.py . --avoid "Original App"                 # anything of the original left?
python3 replica-launch/listing.py replica/launch/listing.json           # store limits + copycat checks
```

**`imgdiff.py`** reads PNGs with no libraries, turns both screenshots into
edge maps and compares where things are, so your new colours do not count
against you. It tells you which regions differ, in the original's pixels.

**`parity.py`** weights must, should and could, counts partial as half, and
never scores what you left out on purpose or what you added. Missing
must-haves means not shippable, and it says so.

**`reviews.py`** drops every review without a link. Every quote it prints is
copied from a row you gave it, with that row's URL. Themes with under three
reviews or one source are marked thin.

**`sweep.py`** finds the original's name, domain and colours anywhere in your
code, including inside identifiers like `OriginalAppEmbed`, and blocks the
deploy until it is clean.

**`listing.py`** checks App Store and Google Play limits, ranking claims in
the title, wasted keyword characters, and the original's name anywhere in
your listing.

```bash
python3 -m unittest discover -s tests -v
```

## Fine print

**It rebuilds functionality and UX patterns, clean-room style.** It studies
what the app does and how people move through it, then writes everything
fresh. It never copies the target's source code, proprietary assets, logos,
trademarks, copy or private APIs.

**It only reads what you are allowed to read.** Public pages and your own
account. It never scrapes behind a login or against a site's terms, never
logs into anyone else's account, and never gets past a paywall. If your
account's terms forbid using it to build a competitor, it says so and sticks
to public sources.

**It always rebrands before launch.** New name, new palette, new logo, new
words. `/replica-deploy` will not ship until the sweep is clean.

**"Clone any app" means the features and the flow.** Not the content, the
network or the licences an app owns. You can rebuild a music app's player,
playlists and sharing. You cannot clone its catalogue.

**No guarantee of a "perfect" clone.** Results depend on how complex the app
is. A booking tool is weeks. A spreadsheet engine is not. `/replica-recon`
sizes it honestly before you start, and `/replica-diff` gives you a real
number, not a vibe.

**The Entrepreneur never makes things up.** No invented reviews, quotes or
numbers. Every claim has a link, and the sample size is stated.

**Check before you sell.** Run the trademark checks `/replica-brand` lists,
read the terms of anything you used, and talk to a lawyer before launch if
there is money on the line. This is not legal advice.

## Files

```
replica-recon/         SKILL.md, recon-map.md, features.csv (the matrix template)
replica-architect/     SKILL.md, architecture.md
replica-design/        SKILL.md, tokens.json, contrast.py
replica-build/         SKILL.md
replica-backend/       SKILL.md
replica-test/          SKILL.md, test-plan.md, bug-report.md, e2e.example.spec.ts
replica-diff/          SKILL.md, imgdiff.py, parity.py
replica-entrepreneur/  SKILL.md, reviews.py, themes.json
replica-brand/         SKILL.md, sweep.py
replica-launch/        SKILL.md, listing.py, listing.example.json
replica-deploy/        SKILL.md, preflight.md
tests/                 the tests for every tool
```

Your own files live in `replica/` in your project. The skills read each
other's.

## Credit

Made by Jake Schincariol, [opusjake.ai](https://opusjake.ai). Siblings:
[Arena](https://github.com/Jakeschincariol/arena-skill),
[X](https://github.com/Jakeschincariol/x-agent-skill),
[LinkedIn](https://github.com/Jakeschincariol/linkedin-agent-skill),
[Instagram](https://github.com/Jakeschincariol/instagram-agent-skill).

## License

MIT. Take it, change it, ship it.
