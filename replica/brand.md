# Brand: candidates (name not chosen yet)

Status: five candidates, **no check has been run**. The owner runs the trademark and domain
checks. Screening only, not legal clearance.

## Filters applied

- Not close in sound, look or meaning to the original product's name, nor to any work-management
  or task tool I know of (boards, trackers, planners, docs-and-wikis tools).
- Short, spellable after hearing it once, no awkward meaning in a major language.
- Fits a small IT support business: calm, practical, not startup-flashy.
- I can only avoid names I know. I cannot see the web from here, so "I don't know a clash" is
  not "there is no clash".

## The five

| # | name | style | why |
| --- | --- | --- | --- |
| 1 | **Crewlane** | compound | A crew moving work along lanes: matches the board view and a small team. |
| 2 | **Deskrail** | compound | A support desk plus rails: guided steps for tickets and projects. Suits IT support. |
| 3 | **Harborline** | metaphor | Work arrives, gets docked and ships; a calm image for busy support teams. |
| 4 | **Mileway** | compound | Milestones on a path: leans on timelines, portfolios and goals. |
| 5 | **Oakdesk** | compound | A sturdy, friendly desk; short, easy to say, reads as dependable. |

My lean: **Crewlane** (the most distinctive of the five and easy to say) or **Deskrail**
(the most on-brand for IT support). Say if you want five more.

## Checks for the owner (all "to run")

| check | where | Crewlane | Deskrail | Harborline | Mileway | Oakdesk |
| --- | --- | --- | --- | --- | --- | --- |
| US trademark, classes 9 and 42 | tmsearch.uspto.gov | to run | to run | to run | to run | to run |
| Australian trademark (the business is Australian) | search.ipaustralia.gov.au | to run | to run | to run | to run | to run |
| EU trademark | euipo.europa.eu eSearch, TMview | to run | to run | to run | to run | to run |
| WIPO global brands | branddb.wipo.int | to run | to run | to run | to run | to run |
| domain (.com, .com.au, .app) | any registrar search | to run | to run | to run | to run | to run |
| app stores | search the exact name | to run | to run | to run | to run | to run |
| handles | X, Instagram, GitHub, LinkedIn | to run | to run | to run | to run | to run |
| the web | search "name" + "software" | to run | to run | to run | to run | to run |

## What happens after you pick

1. Name goes into one constant and the page titles; `brand.json` already blocks the original's
   name and domain (below).
2. Palette: already in `design/tokens.json` (teal accent, contrast checked, 0 AA failures). A
   different accent is a one-value change, re-checked with `contrast.py`.
3. Logo brief and voice guide written to this file (the logo is a brief, not artwork).
4. Fresh strings for the ten most-seen messages (sign in, empty states, main buttons, errors).
5. `sweep.py` runs on every phase from here on; any hit blocks the commit.
