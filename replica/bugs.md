# Bugs (Gauge, pilot version)

Severity: S1 data loss, security hole or core flow blocked. S2 a feature broken, no workaround.
S3 broken with a workaround, or visibly wrong. S4 cosmetic. Only reproduced bugs are listed as bugs.

**Open S1: 0. Open S2: 0. Open S3: 0. Open S4: 0.** Seven bugs found and fixed so far (B-001 to B-007). The pilot Gauge pass (accessibility scan of every new screen, exploratory tests of the new public surfaces) found nothing new.

## Found and fixed

| id | sev | what | found by | fixed in | guard |
| --- | --- | --- | --- | --- | --- |
| B-001 | S1 (while building) | A double comma in `strings.js` blanked the whole web app. Every unit test stayed green. | browser tests | M2 `fd9d005` | a test syntax-checks every web module |
| B-002 | S3 | Escape stopped closing the task drawer after any save, because each save re-renders and focus was lost. | browser test | M2 `fd9d005` | m2 browser spec |
| B-003 | S3 | At desktop width the drawer's rows collapsed to zero width, so subtasks were invisible. Phone width looked fine. | 1440px browser run | M2 `fd9d005` | m2 browser spec at 1440px |
| B-004 | S3 | A fast double click on Add task created two tasks. | GAUGE-2 | Gauge commit | GAUGE-2 (forms ignore a second submit while one runs) |
| B-008 | S3 | Revoking a token that does not exist (or twice) failed inside the audit step and would have answered with a server error instead of a plain not-found. | Zen phase 1 tests | Zen phase 1 | the handler checks first and answers 404; tested both ways. |
| B-007 | S2 (privacy) | Typed search terms reached the server logs through the request URL: Fastify logs the full URL including the query string, and the Jobs search holds client names. | log-privacy test on the importer | pilot item 2 | the logger now records the path only; `jobs.test.js` checks the logs after search, preview and import. |
| B-006 | S3 | The sign-in and lockout messages told people to ask an admin to reset or unlock, but neither existed. | exploratory pass | pilot item 1 | `access.test.js` end-to-end reset and unlock tests, and a browser test of the same flow. The wording now stays because it is true. |
| B-005 | S3 | When a session ended mid-use, an action showed an error toast on a stale page and never sent the person back to sign in. | GAUGE-1 | Gauge commit | GAUGE-1 (returns to sign-in with the plain message) |

Test bugs, not product bugs, fixed on the way: a migration test that passed falsely because its
assertions ran after it finished (M1); route-walk ordering; five or six selector and timing mistakes in
browser tests, one of which (waiting for the board to render) mirrors how a real person behaves.

## Open

None.

## To check, not reproduced or by design (not counted as bugs)

- The public request form and the Job Register import have no server-side duplicate protection either: a double click is stopped in the screen, but two tabs or a replayed call can still send twice (an import is idempotent by job number, so only the form can duplicate).
- Task creation has no server-side duplicate protection. B-004 is fixed in the screen only. Two tabs or a replayed API call can still duplicate.
- The lockout counter for unknown emails, the sign-in, link and public-form rate limits live in memory and reset when the server restarts.
- The session cookie's Secure flag is off by default for localhost (`COOKIE_SECURE=true` behind HTTPS).
- Reads are not audited, and refused calls (403 or 404) are not audited because they change nothing. Failed sign-ins are.
- Team-visible projects work in the API but there is no UI to create a team.
