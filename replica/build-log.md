# Build log

| screen | date | state | missing | harder than expected |
| --- | --- | --- | --- | --- |
| S01 Sign in | 2026-10-12 | done | workspace picker is a text box, not a list (the list would leak workspace names before sign-in) | lockout had to treat unknown emails like real ones or it reveals which accounts exist |
| S03 My tasks | 2026-10-12 | partial | empty state only; tasks arrive in M2 | none |
| app shell (nav, header, banners) | 2026-10-12 | done | members and admin links arrive with S20 in M7 | Playwright cannot import the server, so the browser tests run the app as a separate process |

Screens S02, S04 to S34 are not started.
