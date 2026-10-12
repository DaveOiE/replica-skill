# Tillbox (working title): Phase 0a spike

Local-first point of sale. GPL-3.0. This folder currently holds the architecture spike only; see `../replica/spike-report.md` and `../replica/plan.md`.

## Run the spike

Needs Node 22 and a PostgreSQL 16 server for the tests (the tests create and drop their own databases).

```bash
npm install
export TEST_PG_URL=postgres://postgres@127.0.0.1:5499/postgres   # any superuser URL; default shown
npm run gen:migrations
npm test                 # 16 pass + 1 expected failure (documented gap)
npm run build            # static export to out/ and the offline pre-cache list
npm run test:e2e         # real Chromium: offline, persistence, sync, backup, probes
```

## Demo script (about 5 minutes)

1. `npm run build`, then in two terminals: `node e2e/static-server.mjs` and `npx tsx e2e/start-sync.ts` (needs `TEST_PG_URL`).
2. Open http://127.0.0.1:3100. Click **Start a new store with demo products**. Status reads `standalone`.
3. Add two Flat whites, **Pay cash (exact)**. Reload: the sale and stock persist.
4. In browser dev tools tick **Offline**, reload: the app still opens. Sell a Croissant. The order gets the next number.
5. Back online. Enter `http://127.0.0.1:4100` and token `e2e-token`, **Connect & sync**. Status goes `pending (n)` then `synced`: the standalone history moved to the server.
6. Open a second browser profile at the same address, **Connect & sync**: it receives the catalogue, stock and orders.
7. Put both profiles offline, sell the same item on each until stock is oversold, go online: both show the same negative stock and an `Oversold: FW` flag.
8. Enter a passphrase and **Create verified backup**: it reports bytes and the order count after restoring into a scratch database.

## Layout

```
src/schema      one Drizzle schema + generated SQL migrations (device and server)
src/db          Db interface, PGlite and pg adapters, migration runner
src/domain      store functions: devices, products, checkout, stock
src/sync        apply (convergence rules) and client (register, push, pull, status)
src/backup      encrypted backup, verified restore
server          Node sync service (register, push, pull)
src/app         Next.js static-export UI (spike screen only)
public/sw.js    offline app shell
deploy          local-server Docker files (never run)
tests, e2e      Vitest and Playwright
```
