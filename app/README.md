# Tillbox (working title): Phase 0b foundation

Local-first point of sale. GPL-3.0 (see `LICENSE`). One codebase, three modes: standalone on the device (default), a local server, or a cloud server. This folder holds the foundation only: database and schema, pricing engine, sync, backups, device lock and the app shell. There is no real till screen yet (Phase 3).

Plan and reports: `../replica/plan.md`, `../replica/spike-report.md`, `../replica/framework-decision.md`, `../replica/perf/summary.md`, `../replica/progress.md`. Walk-through: `../replica/demo-phase-0b.md`.

## Run it

Needs Node 22 and a PostgreSQL 16 server (the tests create and drop their own databases).

```bash
npm ci
export TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres   # any superuser URL
npm test                          # unit and integration tests (engine held to 100% coverage with test:coverage)
npm run lint && npm run typecheck
npm run build                     # static export to out/ plus the offline pre-cache list
npm run test:e2e                  # real Chromium: set PW_CHROMIUM to a Chromium binary if it is not on the default path
```

To use the app by hand: `node e2e/static-server.mjs` (http://127.0.0.1:3100) and, for the sync part, `npx tsx e2e/start-sync.ts` (http://127.0.0.1:4100). Set `STATIC_DIR` (and `SPA=1`) to serve a different build with the same server.

## Layout

```
src/schema      one Drizzle schema; generated SQL migrations used on device and server
src/db          Db interface, PGlite and pg adapters, migrations, write-behind durability
src/domain      engine/ (pure money, tax, discount, rounding, refunds, held-cart re-pricing), store, ids, format
src/services    the one write path: permission check, one transaction, audit row, events
src/settings    settings registry (zod), per-key permission; defaults are seed data only
src/seed        initial values; imported only by src/installer (enforced by lint and tests)
src/auth        permissions in code; roles and grants are data
src/security    device lock (PIN or passphrase), inactivity lock
src/sync        change capture, apply (convergence rules), client, reconcile
src/backup      encrypted backups, verified restore, file and S3-compatible destinations
src/client      session, local database, auto backup, device speed benchmark
src/ui, views   shell, gates, theme, home, data safety, sync, device speed
src/i18n        English and Arabic (ICU plurals), right-to-left support
server          Node sync service (pairing codes, per-device tokens, push, pull)
public/sw.js    offline app shell
deploy          local-server Docker files (written, never run)
tests, e2e      Vitest and Playwright
```

## Things to know

- The browser database is **not encrypted at rest**; the device lock stops casual access and every backup is encrypted. See plan risk R14.
- The server checks only that a device is paired and on a compatible schema. Server-side permission checks for modes 2 and 3 are designed (plan 2.12) and not built.
- Defaults (tax, currency, rounding, roles and so on) live in `src/seed` only and are editable in Settings; `tests/defaults.test.ts` fails if a default literal appears elsewhere.
