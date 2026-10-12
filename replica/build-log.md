# Build log

| screen | date | state | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S01 Sign in | 2026-10-12 | done | workspace picker is a text box, not a list (the list would leak workspace names before sign-in) | lockout had to treat unknown emails like real ones or it reveals which accounts exist |
| S03 My tasks | 2026-10-12 | partial | empty state only; tasks arrive in M2 | none |
| app shell (nav, header, banners) | 2026-10-12 | done | members and admin links arrive with S20 in M7 | Playwright cannot import the server, so the browser tests run the app as a separate process |

Screens S02, S04 to S34 are not started.

## M2 (2026-10-12)

| screen | state | missing | harder than expected |
| --- | --- | --- | --- |
| S03 My tasks | done | none | none |
| S35 Projects (list, create) | done | team visibility has no UI until M7 | none |
| S04 Project list view | done | board, calendar and timeline are other views (board is next, the rest later) | the row grid collapsed inside the 480px drawer at desktop width; only a 1440px browser run showed it |
| S08 Task drawer | done | attachments (deferred) | Escape stopped working after any save because each save re-renders; fixed with a page-level handler and focus only on first open |
| S09 Project settings | done | project templates (deferred) | none |
| S20 People | partial | add person, change roles and the one-time password are in; teams, invites, seat views are M7 | none |
| S36 Account | done | none | none |

A typo (a double comma in `strings.js`) blanked the whole app in the browser while every unit test
stayed green. Fixed, and a test now syntax-checks every web module.
