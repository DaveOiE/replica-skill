# Backend checklist (updated after M1)

| item | state | evidence |
| --- | --- | --- |
| secrets only in env vars, `.env*` ignored, nothing in client bundles | done | `.env.example` has names only; seed passwords are random per run and written to a gitignored file; no innerHTML or inline script (web test) |
| input validated on the server on every route | done for M1 routes | zod `.strict()` bodies; bad input gets 400 with field messages (api-behaviour test) |
| authorisation checked on every read and write, tested with a second user | done for M1 routes | route walk: signed-out, five roles, and another workspace; sabotage-checked |
| audit entry for every change | done for M1 routes | walk requires an audit row for every successful write; write and audit commit together |
| rate limits on auth | done | sign-in per address, plus lockout after five failures including unknown emails |
| sessions: http-only cookie, sign out ends it on the server | done | cookie flags test; old cookie is dead after sign-out |
| cross-site writes refused | done | Origin check on non-GET |
| uploads limits | n/a | attachments are deferred, so there are no uploads |
| dependencies audited | done | `npm audit`: 0 vulnerabilities at install (re-run before release) |
| webhooks verify signatures | n/a yet | M9 |
| no user data in URLs or logs | partial | logger redacts cookie and authorization; request bodies are not logged |
| Secure cookie flag | setting | `COOKIE_SECURE=true` behind HTTPS; off on localhost by design |

M2 additions: project-level permissions are resolved per request (`access.js`), hidden projects and tasks
answer 404 like missing ones, assignees must be able to see the project, temporary passwords are shown
once and never stored or audited, changing a password ends other sessions, task text is stored and
rendered as plain text (a test stores markup and the UI has no innerHTML).

Known trade-offs: the unknown-email lockout counter lives in memory (one process). Not a compliance
claim of any kind.
