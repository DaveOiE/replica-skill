# Phase 0a spike report: local-first, three deployment modes

Verdict: **the architecture works for what was tested, with eight real risks listed at the end.** It is not yet proven on a real tablet, on iOS/Safari, or at the scale of a busy shop.

What ran: code in `/app`; 16 Node tests passing plus 1 documented expected failure (the duplicate-SKU gap), against real PostgreSQL 16 and PGlite; 5 browser tests in real Chromium (Linux, headless), 3 scenario tests and 2 measurement probes; `tsc` clean. All numbers below come from those runs on this build sandbox, a server-class CPU, so tablet figures will be slower.

## What the spike asked, and the answer

| question | answer | evidence |
| --- | --- | --- |
| Can a full Postgres run on the device and persist? | **Yes.** PGlite (Postgres compiled to WebAssembly) on IndexedDB. Data survived a page reload. | `spike.spec.ts` test 1 |
| Can it live inside Next.js? | **Yes, as a static export with client-only screens.** It builds with Next 16 / Turbopack. Server components cannot touch the device database, so the POS and back office are client-rendered. The sync service is a separate small Node process, not Next route handlers. | `npm run build` |
| Can checkout work with no network? | **Yes**, including a *reload* with the network cut, because a service worker pre-caches the app shell and the 16 MB database engine. A sale made offline was stored and numbered. | test 1 |
| One schema on device and server? | **Yes.** One Drizzle schema, one set of SQL migrations, applied to PGlite and to PostgreSQL. A test compares every table and column on both and finds them identical. The same Drizzle table object queries both engines. | `sync.test.ts` "one schema" |
| Can a device that has traded standalone later join a server with no data loss? | **Yes.** Nothing is rewritten: every row has a client-generated UUID, and a local change log (kept from day one) is simply pushed. A second, fresh device then receives the catalogue, stock and all orders. | `sync.test.ts` "mode 1 -> 2/3", browser test 2 |
| Do two offline devices converge? | **Yes.** Stock (a ledger) converges to the same number everywhere; overselling is flagged, not blocked; order numbers never collide; concurrent price edits resolve to the same winner on both devices and the server; an older edit can never overwrite a newer one. | `sync.test.ts` "two devices", browser test 2 |
| Is sync safe to retry? | **Yes.** Replaying a whole push changes nothing. A dropped network leaves the pending count intact and sync resumes. 480-row histories page correctly both ways. | `sync.test.ts` "idempotent", "failure and scale" |
| Is mode 1 data safe? | **Partly proven.** A backup is encrypted (AES-256-GCM, PBKDF2 600k), restored into a scratch database and compared before it is called good, in Node and in the browser. Wrong passphrase and tampering are rejected. Restoring onto a second device gives it a new identity so order numbers cannot clash. Not proven: Drive, S3-compatible upload, scheduling, persistent-storage grant on a real device. | `backup.test.ts`, browser test 3 |

## Numbers (this sandbox, headless Chromium)

| measure | result |
| --- | --- |
| App download (static export) | 18 MB: 10 MB database engine, 6 MB engine data, 0.4 MB initdb, ~1.5 MB app code |
| Cold open to ready, first run | 4.8 to 5.2 s (compiles the engine, creates and migrates the database) |
| Checkout, 5,000-product catalogue | median 161 to 168 ms, p95 250 to 256 ms (2-line sale, includes stock movement and payment) |
| Product search with stock join, 5,000 products | 148 to 365 ms. No indexes have been added yet. |
| Full grid with stock, 5,000 products | about 175 ms |
| Bulk insert 5,000 products + opening stock | about 4.6 to 5.4 s |
| Database size after that plus 200 orders | 34 MB |
| Empty backup file | 4.6 MB (the Postgres data directory dominates) |

## Defects found and fixed during the spike

1. **Pull-cursor race.** Reading the high-water mark in a separate query could skip a change that committed in between. Fixed: single-statement snapshot, and server writes are serialised so sequence numbers become visible in order.
2. **Stale history overwrote current state.** A device's own record pushed as history could reintroduce an old order prefix. Fixed: single-owner rows are always sent as their current state.
3. **Browser-only: detached `fetch`.** Works in Node, throws in browsers. Fixed.
4. **Second tab hung silently** on the shared database. Fixed with a Web Locks guard: a second window now shows "already open in another window". Verified, and verified the lock frees when the owner closes.
5. **Auto-seeding a demo catalogue on every device** would duplicate the catalogue when a second device joins. Fixed: seeding is an explicit "start a new store" action; a joining device pulls instead.
6. **Restoring a backup onto another device cloned its identity** (same order numbers). Added `restoreAsNewDevice` and a test.

## Known gaps, not solved

- **Same SKU created on two offline devices gives two products.** Documented as an expected-failure test. Needs a merge-by-SKU rule.
- **Persistent storage was *not* granted** in the headless test (`false`). That is normal for a fresh headless profile; real behaviour on tablets depends on browser, install state and engagement, and is untested.
- **Docker setup is written but never run:** this sandbox has the Docker client but no daemon.
- **Sync authentication is a single shared token.** Production needs per-device tokens issued by pairing.
- **Schema version negotiation between devices and server does not exist yet.**

## Not tested at all

Real tablets; iOS/Safari; Firefox; Android Chrome; Windows/macOS PC browsers; a Tauri or Electron wrapper; multi-minute sync under packet loss; more than two devices; a catalogue above 5,000 products; memory use of the database engine on a low-end device; Google Drive and S3 upload; the cloud region; real-time LAN sync.

## Risks

| # | risk | severity | mitigation |
| --- | --- | --- | --- |
| R1 | First install needs 18 MB and a place to download it from. "No server needed" is true after install, not before. | medium | host the static app anywhere (a free static host or the local server); for PCs, a wrapper bundles it |
| R2 | Browser storage can be evicted or, on Safari, cleared after about 7 days unused unless installed to the home screen (known WebKit policy; not tested here). This is the largest data-loss risk in mode 1. | **high** | request persistence, install-as-app prompt, nagging verified backups, a wrapper for PCs, recommend mode 2/3 for multi-device shops |
| R3 | One window per database. A cashier opening two tabs is blocked, not corrupted. | low | done; tell the user why |
| R4 | Speed on low-end tablets is unmeasured; engine is large and runs in WebAssembly. | **high until measured** | measure on the cheapest target tablet before Phase 3; add indexes; keep the product grid on a cached, in-memory list |
| R5 | PGlite is a young (0.x) project; its on-disk format and API may change. | medium | pin the version; keep a portable logical export so data never depends on the physical format |
| R6 | Duplicate SKUs/barcodes across offline devices | medium | merge-by-SKU/barcode rule with an exceptions inbox |
| R7 | Mode 1 keeps a change log forever so it can sync later; storage grows about 2x for synced tables. | medium | on connect, generate the log from current tables (snapshot) and compact the log in mode 1 |
| R8 | Overselling across offline devices | accepted | flag, never block; see plan section 2.5 |
| R9 | Devices on different app versions pushing different schemas | medium | version handshake; server rejects incompatible pushes; devices must update before syncing |
| R10 | Permissions on the device are enforced by code the user controls. A determined user with browser tools can bypass them in mode 1. | medium | state it honestly: roles protect against mistakes and casual misuse, not a hostile owner of the device; mode 2/3 re-validates on the server |
| R11 | Physical backups restore only into a compatible engine version | medium | also write the portable logical export |
| R12 | Drive upload needs a Google Cloud OAuth client (an external signup); S3 upload from a browser needs bucket CORS and keys on the device. | medium | your decision; plan offers a safer path (below) |
| R13 | Browsers cannot run scheduled work when the app is closed. | medium | "scheduled" backups run when the app is open and due, and at register close; a wrapper can truly schedule |
