# Phase 0b demo (about 15 minutes)

What you will see: a point-of-sale foundation that runs on one device with no server, keeps its data safe, and later joins a shop server without losing anything. There is no real till screen yet (that is Phase 3). "Ring up a sample sale" runs a real sale through the pricing engine and the database.

## Set up once

You need Node 22 and a PostgreSQL 16 server for the sync part.

```bash
cd app
npm ci
export TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres   # any superuser URL
npm run build                                                    # static app into app/out
node e2e/static-server.mjs &                                     # the app on http://127.0.0.1:3100
npx tsx e2e/start-sync.ts &                                      # a sync server on http://127.0.0.1:4100 (admin token: e2e-admin-token-0123456789abcdef)
```

Use Chrome or Edge. Open http://127.0.0.1:3100.

## Walk-through

**1. A device with no server (mode 1).** Choose *Start a new store*. You are asked for a PIN before anything else: try `123456` (refused, it is a run of digits), then `482916`. The header shows **Standalone** and a red **No verified backup yet** warning. The data is on this device only.

**2. A real sale.** Press *Ring up a sample sale* twice. Orders goes to 2; each gets a number like `K7QM-000001` (this device's own prefix, so tablets never clash). The sale is confirmed only after it is safely stored.

**3. Dark mode and Arabic.** Change *Theme* to Dark, *Language* to العربية. The whole layout mirrors, the sync badge reads *مستقل*, and the choice survives a reload.

**4. Lock.** Press *Lock*. Reload. Type a wrong PIN five times: you are made to wait, and reloading does not reset the wait. Unlock with the right PIN.

**5. No network.** Open dev tools, tick *Offline*, reload. The app still opens, the PIN still works, and *Ring up a sample sale* still works.

**6. Back up.** Data safety → type a passphrase of 12 or more characters → *Save to this device*. You get an encrypted `.tbx` file; the warning turns green: "Backed up today". The backup was restored into a scratch database and compared before it was called good.

**7. Replacement tablet.** Open a private window (a brand new device). Choose *Restore from a backup file*, pick the `.tbx`, type a wrong passphrase first (nothing is touched), then the right one. Enter the original PIN. Your orders are back and this device has a **different** order prefix.

**8. Join a server later, no data loss (mode 1 to 2/3).** Make a one-time code:

```bash
curl -s -X POST http://127.0.0.1:4100/admin/pairing-codes \
  -H "Authorization: Bearer e2e-admin-token-0123456789abcdef" -d '{}'
```

On the first device: *Server & sync* → address `http://127.0.0.1:4100`, the code → *Connect*. Orders are unchanged; the badge goes to **Synced**.

**9. A second device joins.** In another private window choose *Join an existing store* with a fresh code. It receives the catalogue, settings and orders without ever creating its own.

**10. Both tills lose the network.** Tick *Offline* on both and sell on each. The badge says **Offline** and counts changes waiting. Untick, press *Sync now* on each: both show identical orders, and numbers never collided.

**11. S3-compatible backup.** Data safety → fill in any S3-compatible bucket (the test suite uses a built-in fake) → *Back up to S3-compatible storage*. The object in the bucket is ciphertext.

**12. How fast is this device?** *Device speed* → *Run the test*. On the real tablet, send me the copied results (`replica/perf/README.md` explains every number).

## What proves it works

```bash
cd app
npx vitest run --coverage     # 257 tests; the pricing engine must be 100% covered
npm run lint && npm run typecheck
PW_CHROMIUM=/path/to/chromium npx playwright test     # real browser: offline, two devices, backups, kill -9
```

CI (`.github/workflows/ci.yml`) runs all of it on every push, plus a check that generated files are up to date and `npm audit` on what ships.

## Not in this demo, on purpose

The real POS screen, products and categories screens, users and roles screens, reports, and any server-side permission checking beyond "this device is paired". Those are Phases 1 to 9.
