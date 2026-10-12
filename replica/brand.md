# Brand: Deskrail

Chosen by the owner on 2026-10-12. Trademark, domain, store and handle checks are the owner's to
run; **none has been run by me** (no web access). Screening only, not legal clearance.

The name lives in one constant, `app/shared/brand.js` (`PRODUCT_NAME`). Page titles are built from
it in `app/shared/titles.js` as "Detail · Screen · Deskrail". A test fails if the name is written
out anywhere else in `app/` or `tools/`. `replica/brand.json` keeps the original product's name
and domain on the sweep's block list, and `tests/test_brand_gate.py` runs the sweep on every test
run and proves it blocks a planted name.

## Candidates considered

Crewlane, **Deskrail**, Harborline, Mileway, Oakdesk. Deskrail: a support desk plus rails, guided
steps for tickets and projects; suits an IT support business.

## Checks for the owner (all "to run")

| check | where | Deskrail |
| --- | --- | --- |
| US trademark, classes 9 and 42 | tmsearch.uspto.gov | to run |
| Australian trademark | search.ipaustralia.gov.au | to run |
| EU trademark | euipo.europa.eu eSearch, TMview | to run |
| WIPO global brands | branddb.wipo.int | to run |
| domain (.com, .com.au, .app) | any registrar search | to run |
| app stores | search the exact name | to run |
| handles | X, Instagram, GitHub, LinkedIn | to run |
| the web | search "Deskrail" + "software" | to run |

## Palette

Already in `replica/design/tokens.json`: deep teal accent `#0f766e` on white and pale grey, 23
colour pairs checked, 0 AA failures. Change a value, re-run
`python3 replica-design/contrast.py replica/design/tokens.json`, then
`python3 tools/tokens_css.py`.

## Logo brief (a brief, not artwork)

- **The idea, one line:** work moving along a rail, one clear step at a time, past a steady desk.
- **Mark type:** symbol plus wordmark. The symbol is a rounded square holding one long horizontal
  rail with a small block resting on it (a task card on its rail). The wordmark is lowercase
  "deskrail" in an open geometric sans (Inter, Manrope or similar, open licence).
- **Colour:** deep teal `#0f766e` and white. One colour version, one reversed version (white on
  teal), one black version.
- **Must work at 16px:** the symbol alone, no text, no fine detail. If the block and rail blur at
  16px, thicken them.
- **Deliverables:** SVG of the symbol and the lockup; app icon 1024x1024 with a solid background
  and no transparency; favicon set (SVG plus 16, 32, 48 px PNG and an ICO); social image
  1200x630.
- **Must not resemble the original's mark.** I cannot see it from here, so the owner puts the
  original logo next to every draft and checks. As a precaution, avoid any cluster of circles or
  dots, avoid warm coral or salmon hues, and avoid triangle or three-dot arrangements, which are
  common marks in this category.
- **Placeholder:** `app/web/favicon.svg` is a stand-in that follows this brief so the app has an
  icon. Replace it with the final artwork; do not ship the placeholder as the brand.

## Voice

Three words, each with what it does not mean:

- **Calm, not sleepy.** No exclamation marks, no alarm in errors. Things still get done.
- **Plain, not curt.** Short sentences, everyday words, and every message says what to do next.
- **Practical, not dry.** Say what happened and the next step; a little warmth is fine.

| do | don't |
| --- | --- |
| "Saved." | "Success!!" |
| "That password is too short. Use at least 12 characters." | "Invalid password." |
| "Only admins can change this. Ask an admin in your workspace." | "Access denied." |
| "This project has no tasks yet. Add the first one." | "No data found." |
| "Stub: this connects to nothing yet." | "Coming soon!" |

## The ten most-seen strings, rewritten

| where | string |
| --- | --- |
| sign-in heading and button | "Welcome back" / "Sign in" |
| wrong email or password (never says which) | "That email and password don't match. Try again, or ask an admin to reset it." |
| empty My tasks | "Nothing assigned to you. Pick something up from a project." |
| empty project | "This project has no tasks yet. Add the first one." |
| main create button | "Add task" |
| saved toast | "Saved." |
| no permission | "You can look but not change this. Ask a project admin for edit access." |
| view-only banner | "View-only seat: you can read what you can see, but not change it." |
| session ended | "You were signed out. Sign in to carry on where you left off." |
| demo banner | "Demo workspace. Everything here is fake." |

Required wording for compliance screens (never softened): "Not certified. This is a setting and a
document, not an audit or a guarantee."

## Rules from here on

- `python3 replica-brand/sweep.py . --config replica/brand.json` stays clean on every commit
  (it runs inside the Python test suite).
- The sweep's `colors` list is empty because the feature list does not record the original's
  colours. If the owner knows them, add them to `brand.json`.
