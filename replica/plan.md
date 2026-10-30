# Build plan: working title "Tillbox"

Status: **Phase 0b (foundation) is built and waiting for your review at its demo (`demo-phase-0b.md`). Phase 1 and later are not started.**
Inputs: `recon.md` (what to build), `features.csv` (the checklist), `spike-report.md` (Phase 0a: what was proven), `framework-decision.md` (Vite versus Next.js, with the trade-off; **nothing has been switched**), `perf/summary.md` (device-speed numbers), decisions in recon section 18.
Licence: GPL-3.0. Stack: Next.js (static export, for now) + PGlite on the device + PostgreSQL on the server + Drizzle (one schema).

> **Approved since the first plan:** Prisma is replaced by Drizzle (you approved this). Mode 1 stays the default, delivered as a browser PWA first, with a Tauri wrapper for shop PCs as a later phase. Google Drive is dropped from Phase 0b and comes back later with the `drive.file` scope only. Everything else you approved earlier (4b, the ten fixed items, held-cart re-pricing) still stands.
>
> **Phase 0b changes the design in one place worth knowing about:** browser storage turned out to be the slow part, not the database, so saving now works as "write to memory, then confirm only after the data is safely in browser storage" (section 2.11). Every sale is still on disk before the till says it is paid.

---

## 1. Assumptions I need you to confirm or change

| # | assumption | why it matters |
| --- | --- | --- |
| A1 | **One codebase, three deployment modes** (2.1). One store per install; no multi-tenant SaaS. The default is mode 1, fully standalone. | it shapes every layer below |
| A2 | **Initial seed values only**: AUD, en-AU, 10% GST inclusive, 5-cent cash rounding on. Every one is editable in Settings by a user holding the matching permission (section 4b). | rounding rules are the riskiest maths in the product |
| A3 | Rounding **seed**: half-up, applied **per line**; cash rounding to the nearest 5c on the final cash tender only, shown as its own line. Mode and cash rounding (on/off, increment) are settings; the per-line scope is fixed (section 4b). | the original's rule is unknown; this is the common retail rule and testable |
| A4 | Paid NexoPOS modules, multi-store, marketplace, telemetry, update check, AI/MCP server: out of scope. | recon section 16 |
| A5 | **Plugins are TypeScript packages compiled into the app at build time** (folder + manifest), not uploaded at runtime. | in mode 1 there is no server to load code on, and a web form that runs uploaded code is a security hole. This is a deliberate departure from the original |
| A6 | One repo, app in `/app`, own GPL-3.0 `LICENSE` (added). The Replica skill folders stay as they are. | keeps the MIT skill pack and the GPL app separate |
| A7 | Name "Tillbox" is a placeholder; no trademark checks yet. | `/replica-brand` does that later |
| A8 | The docs site stays unreachable, so behaviour is specified from the repo audit plus normal retail practice. | some behaviour will differ in detail; the demo scripts make that visible |
| A9 | **Cloud mode runs in an Australian region** (for example AWS Sydney, Azure Australia East or GCP Sydney), managed Postgres, TLS in transit, encryption at rest. I will not sign up to any provider without your approval. | data residency |
| A10 | **Confirmed by you:** in mode 1 permissions protect against mistakes and casual misuse, not against a hostile owner of the device (R10). **In modes 2 and 3 the server must enforce permissions itself** and must never trust what a device claims. Phase 0b does *not* do this yet: the server only checks the device token and schema version. The design and the phase it lands in are in 2.12. | mode 1 has no server to be the authority |
| A11 | **Held carts are re-priced on resume**, with a visible notice that lists every line whose price changed (old and new). Covered by a test in Phase 0b. | your decision |
| A12 | **Confirmed, with your condition:** every device is a **full replica** of its store's data, so every device must have a **PIN or passphrase lock** and every backup is **encrypted**. Both are built (PIN 6 to 12 digits or a passphrase of 10+ characters; backups cannot be saved unencrypted). One limit to state plainly: the lock stops casual access, but the browser database itself is **not encrypted at rest** (R14). | simplest and safest for offline use; large shops need archiving later (R7) |

---

## 2. Architecture

### 2.1 Three deployment modes, one codebase

| | mode 1: standalone (**default**) | mode 2: local server | mode 3: cloud |
| --- | --- | --- | --- |
| Where the data lives | on the device (PGlite) | on every device **and** a mini PC (Postgres in Docker) | on every device **and** managed Postgres in an Australian region |
| Needs | the device | shop network | internet (works offline; syncs when back) |
| Sync | none | devices <-> mini PC over the LAN | devices <-> cloud over HTTPS |
| Server-only features | none | webhooks, email, scheduled jobs that must run while no till is open, API tokens, scheduled server backups | the same |
| Switch later | to 2 or 3 with no data loss; between 2 and 3 by changing the server address | | |

A device behaves the same in all three modes. It always reads and writes its own database; sync is a background step that is simply switched off in mode 1. That is what makes switching safe: the till never waits for a server.

### 2.2 Shape

```
 DEVICE (tablet / PC browser, installed as an app)                       SERVER (modes 2 and 3 only)
 ┌────────────────────────────────────────────────────┐                  ┌───────────────────────────────┐
 │ Next.js static export (React, client-only screens) │                  │ Sync service (Node)           │
 │   POS, back office, reports                        │                  │   /sync/register|push|pull    │
 │            │                                       │                  │   token auth, TLS             │
 │ Application layer (services)                       │   HTTPS / LAN    │            │                  │
 │   permission check -> use case -> domain -> SQL    │◄────────────────►│ same schema + same apply code │
 │   -> audit row -> event                            │   push / pull    │            │                  │
 │            │                                       │                  │ PostgreSQL (change feed =     │
 │ Domain (pure TS): money, tax, discount, rounding,  │                  │   outbox, ordered)            │
 │   pricing, units, coupons, stock rules             │                  │ Job runner (pg-boss):         │
 │            │                                       │                  │   webhooks, email, backups,   │
 │ Sync engine: change log (outbox), push/pull,       │                  │   recurring posts             │
 │   status, backups                                  │                  └───────────────────────────────┘
 │            │                                       │
 │ PGlite (Postgres in WebAssembly) on IndexedDB      │   Service worker: app shell + engine cached for offline start
 └────────────────────────────────────────────────────┘
```

Rules that keep it honest (unchanged in spirit):

1. **Domain code is pure** and takes configuration as arguments (4b).
2. **One write path.** Every mutation goes through a service that checks permission, runs in one transaction, writes the audit row and emits an event.
3. **Ledgers are append-only,** and the database enforces it with triggers on both engines (proven in the spike).
4. **Side effects use events** recorded in the same transaction.

### 2.3 On-device data layer: PGlite, and Drizzle instead of Prisma

| option | verdict |
| --- | --- |
| **PGlite** (Postgres compiled to WebAssembly) | **Chosen.** It is real Postgres, so the device and the server share one schema, one set of SQL migrations, triggers, constraints and `numeric`. Proven in the spike. Cost: 16 MB download, young project (0.x), single connection. |
| SQLite-wasm | Rejected. Different SQL dialect from the server Postgres, so two schemas or a lowest-common-denominator one, and every ledger trigger and constraint written twice. |
| Tauri or Electron wrapper | **Decided (yours): browser PWA first, Tauri wrapper for shop PCs as a later phase.** It gives reliable file storage and truly scheduled backups (R2, R13). It wraps the same static app, so nothing built now is thrown away. It moves earlier only if real devices show storage eviction is a real risk; the spike could not show that (headless Chromium, no real device). Placed as Phase 9b in section 5. |

**How it fits Next.js.** The app is a static export: plain files, no Next server. Every screen is a client component that talks to the on-device database through the service layer. Next.js server components and route handlers are not used, because they cannot reach the device's database. The sync service (modes 2 and 3) is a separate small Node process. You asked me to revisit Vite versus Next.js using what the spike showed; the comparison, the trade-off and my recommendation are in `framework-decision.md`. **I have not switched.**

**What replaces Prisma.** Drizzle ORM (approved by you). Drizzle has first-party drivers for both PGlite and node-postgres, and the same table definition ran against both. It generates the SQL migrations, which are applied byte-for-byte on device and server. The shared engine talks to a thin `Db` interface (query, exec, transaction, optional `durable()`), so it does not depend on either ORM.

### 2.4 Sync design

**Principles**

- Every row has a **client-generated UUID**, so a device can create data offline and join a server later with no renumbering. (UUIDv7 in the real build, for index locality.)
- Every synced table converges by exactly one of three rules:

| class | tables (examples) | rule |
| --- | --- | --- |
| **Append-only ledger / event** | orders and lines, payments, stock movements, register entries, customer-account entries, journal lines, audit log, refunds, status-change events | insert if absent, never updated. The database blocks updates and deletes. Corrections are new reversing rows. Union of all devices' rows = the truth. |
| **Versioned last-write-wins** | catalogue (products, categories, prices, taxes), customers, settings, roles | each row carries a version counter plus update time and device id. The higher `(version, time, device)` wins everywhere; an older edit can never overwrite a newer one. Concurrent edits to one row keep one winner and lose the other, **visibly** in the activity log. |
| **Single-owner** | the device's own record, its register session, its held carts | only the owning device writes it; sent as current state |

- Anything mutable that is not catalogue-like (for example "order status") becomes append-only events with a derived state, so no row ever has two writers.
- **Change capture is inside the database:** a trigger on each synced table writes to a local `outbox`. Because it is a trigger, no code path can forget it, and the same trigger on the server produces the ordered feed that other devices pull.
- **Push** sends outbox rows after the saved cursor; **pull** fetches server rows after its cursor, excluding the device's own. Both are batched, cursor-based and **idempotent**: replaying a batch changes nothing (tested).
- The server serialises writes so sequence numbers become visible in order; a puller can never skip one (bug found and fixed in the spike).
- **Order numbers:** `<device prefix>-<per-device sequence>`, for example `K7QM-000042`. The prefix is four characters from an alphabet without look-alikes and is reserved at registration; if it clashes, the newcomer changes it for **future orders only**. Residual risk: a clash that already issued the same number on two receipts is surfaced as an exception, not silently merged.
- **Schema version handshake** (to build): every push carries the schema version; the server refuses incompatible versions and the device shows "update required". Offline devices on old code keep trading locally.

**Visible sync status** (spike has the first version): a badge on every screen with one of `standalone`, `synced`, `pending (n)`, `offline`, `error: reason`, plus last-synced time, a "Sync now" action, and a detail panel listing unsynced item counts and any conflicts or stock exceptions. In mode 1 the badge reads "standalone: backed up N days ago", which ties sync status to backup status.

### 2.5 Stock across offline devices

- Stock is a **ledger of movements**; the level is `SUM(qty)`. Two devices selling the same item offline each append a movement; after sync every device and the server show the same number (tested: 10 on hand, one till sells 7 and another 6, all three converge to -3).
- **Default policy: allow and flag.** The goods have physically left, so the till must not refuse the sale. A negative level appears in a "stock exceptions" list and as a badge.
- Options, chosen per product or globally in Settings: (a) allow and flag (default); (b) **warn at a low-water mark** based on the device's own last-known level; (c) **block when below zero only while connected** to a server; (d) later, per-device allocation of fast-moving items.
- In mode 2 the LAN sync interval is short (seconds), which makes overselling rare. In mode 3 and mode 1 it is whatever connectivity allows.
- Stocktake and adjustments are ordinary movements, so they reconcile the books; nothing is overwritten.

### 2.6 Switching modes with no data loss

1. **Mode 1 -> 2 or 3.** Admin enters the server address and a pairing token. The device registers (reserving its prefix), pushes its whole change log from the start, then pulls. Nothing local is renumbered or rewritten. Tested with a device that had already traded.
2. **A second device joins** by connecting *first*, then pulling. It never seeds its own demo data (that would duplicate the catalogue; fixed in the spike).
3. **2 <-> 3.** Change the server address. The new server is empty, so the first device to connect pushes its full replica. Because every device is a full replica, any complete device can rebuild a server. Guard to build: the server has a `store_id`; a device remembers it and refuses, without explicit confirmation, to push into a server with a different one (stops two shops being merged by accident).
4. **Back to mode 1.** Disconnect. The device keeps its full local copy and carries on standalone.
5. Because the change log is kept from day one, mode 1 stores roughly twice the data for synced tables (R7). On connect we can instead snapshot current rows and compact the log.

### 2.7 Mode 1 data safety

The device is the only copy, so this is a product feature, not an afterthought.

- **Persistent storage.** On first run the app asks the browser for persistent storage and shows the result in Settings > Data safety. If it is refused, a standing banner explains the risk. Prompt the user to install the app to the home screen or desktop, which makes browsers far more likely to grant it. (Not testable in headless; real devices pending.)
- **Backup prompts.** Setup ends with "Set up backups". A banner shows "last verified backup: N days ago" and escalates after 3 and 7 days. The cash-register close screen offers a backup. The backup status is part of the sync badge in mode 1.
- **One-tap export, destinations (file and S3-compatible now, Drive later):**
  - **Google Drive: deferred (your decision).** Not in Phase 0b. It comes back in Phase 9 using only the `drive.file` scope. It needs an OAuth client in a Google Cloud project, an external signup I will not do without you. Drive stays for backup files only; the live database is never synced through it.
  - **S3-compatible** (including Australian providers or a NAS running MinIO): **built in Phase 0b.** Upload with a signed request (SigV4, checked against AWS's published examples and an independent verifying fake S3), then read back and compare a SHA-256 before the backup is called good. The key is stored on the device inside the encrypted vault. The bucket needs CORS enabled. In modes 2 and 3 the server can upload with its own key instead, so no key needs to live on tablets.
  - **File:** **built.** Save picker where the browser has one, share sheet or download otherwise.
- **Scheduled encrypted backups.** Browsers cannot run code when the app is closed. So "scheduled" means: when the app is open and a backup is due (daily by default), and at register close. A Tauri/Electron wrapper can schedule properly and write to a chosen folder. In modes 2 and 3 the server does real scheduled `pg_dump` backups.
- **Encryption.** AES-256-GCM, key from the shop owner's passphrase (PBKDF2, 600,000 iterations), authenticated (tampering is detected; the file header is covered too). There is **no unencrypted option** and the passphrase must be 12 or more characters. Lose the passphrase and the backup is unreadable by design. (A printed recovery code was proposed and is **not built**; it is a Phase 9 item.)
- **Tested restore.** Every backup is restored into a scratch database and compared with the live one (row counts and stock total) **before** it is reported as good. A "restore drill" prompt runs this monthly against the stored file. A restore screen checks version compatibility and offers two choices: **restore in place** (disaster recovery, same identity) or **restore as a new device** (new identity and order prefix, so receipts can never clash; tested).
- **Drive is for backup files only.** The live database is never synced through Drive, a shared folder or any file-sync tool. Backups are written once under a timestamped name and never opened as a live database. The UI has no "open from Drive" path, only "restore from this file", which first verifies it.
- **Portable export.** Besides the physical snapshot there will be a logical export (NDJSON of the same change records used for sync) so a backup survives engine upgrades (R5, R11).

### 2.8 Local server (mode 2) and cloud (mode 3)

- **Mode 2:** `deploy/docker-compose.local-server.yml` runs Postgres 16 plus the sync service on a mini PC. **Written but never executed** (no Docker daemon in this sandbox); first real test is on your hardware. Needs a fixed LAN address, a token, and a backup volume. Plain HTTP on a closed LAN is acceptable; HTTPS via a local certificate is recommended and is a Phase 9 task.
- **Mode 3:** the same sync service container, deployed to an Australian region with managed Postgres. No provider chosen and nothing signed up.
- Auth in both: **built in Phase 0b.** An admin issues a single-use pairing code (valid 15 minutes, rate-limited); the device exchanges it for its own bearer token, which the server stores only as a hash. A device can be revoked without touching the others. The shared spike token now only guards the admin endpoints.

### 2.9 What the new architecture changes in the rest of the plan

| area | change |
| --- | --- |
| Auth and roles | Mode 1 uses on-device accounts (PIN or password, hashed with a slow hash). Modes 2/3 add server-side validation. Roles and permissions replicate like any LWW data. |
| Jobs | The original's scheduled tasks (held-order expiry, low-stock scan, recurring expenses, roll-ups) run **inside the app whenever it is open** and catch up on start in mode 1; in modes 2/3 the server job runner also runs them. They must be idempotent so two runners never double-post (recurring expenses use a deterministic id per schedule and date). |
| Email, webhooks, API tokens | Need a server. In mode 1 they are disabled and the screens say why. |
| Reports and PDFs | Run as SQL on the device. PDF/XLSX/CSV are generated in the browser. |
| Settings | Replicated and versioned. 4b still holds. The "currency lock after first order" is enforced per device and on the server; two offline devices changing currency before their first order could disagree, so that setting is only editable while connected or before any device has traded. |
| Installer | Becomes a first-run wizard on the device: start a new store, or join an existing one. |
| Plugins | Build-time, see A5. |
| Registers | A register session belongs to one device; it is single-owner data. |
| Held carts | Local to the device by default; they are a cart snapshot, not an order. |

### 2.10 Tech choices (updated)

| concern | choice | reason |
| --- | --- | --- |
| Framework | Next.js static export, React, TypeScript strict | approved; spike builds and runs |
| On-device DB | PGlite (Postgres in WebAssembly), IndexedDB now; the newer file-system storage later | one schema with the server |
| Server DB | PostgreSQL 16 | |
| ORM / migrations | Drizzle + drizzle-kit; shared `Db` interface | works with both engines |
| Sync | triggers + outbox, HTTP push/pull, own code (about 250 lines, tested) | full control of the three convergence classes |
| Money | integer minor units; quantities and rates as Decimal | unchanged |
| Auth | on-device accounts; server tokens in modes 2/3 | |
| UI | Tailwind + Radix, own tokens; logical CSS properties for RTL; dark mode by CSS variables | unchanged |
| Client state | Zustand for the POS cart; the database is the source of truth otherwise | |
| i18n | next-intl or equivalent client-side, ICU messages, English + Arabic | |
| Jobs | in-app scheduler on device; pg-boss on the server | |
| Offline shell | service worker pre-cache (proven) | |
| PDF / XLSX / CSV | browser print view to PDF, exceljs, csv-stringify | |
| Barcodes | bwip-js | |
| Backups | encrypted PGlite snapshot + logical export; Drive/S3/file destinations; `pg_dump` on the server | |
| Tests | Vitest (unit + integration on real Postgres and PGlite), Playwright (Chromium, tablet viewport, offline and two-device scenarios) | |
| CI | GitHub Actions with a Postgres service container | |

### 2.11 Durability: what Phase 0b found and how saving works now

**Finding.** With PGlite on IndexedDB, the cost is not the database. It is writing to browser storage: about 120 ms for every statement that touches it, and about 1.1 s per write when the processor is slowed 4x, because the storage layer rescans every database file each time. A sale is several statements, so the first spike's 160 ms checkout would have been far slower on a weak tablet.

**What I tried, and what failed.**
1. *Let the engine skip flushing between statements (its "relaxed durability" setting).* Fast, but a hard kill (`kill -9`) lost a sale the till had already confirmed, and it raced with closing the database. **Rejected**, because a confirmed sale that disappears is the one failure a till cannot have.
2. *Flush after every statement.* Safe, but a durable sale took 570 to 670 ms at normal speed. Too slow.

**What is built.** An explicit write-behind layer (`src/db/writebehind.ts`):
- Work happens in memory. A commit becomes durable when the layer has written it to IndexedDB under an exclusive lock.
- Every service action (`runService`) waits for that write before it returns, so **"paid" on screen means the sale is on disk.** Locking, identity changes, the installer, migrations, pairing and backup import do the same.
- Sync flushes before it pushes (so a crash cannot reuse an order number that already went to the server), and so do backup, lock and page-hide.
- Background flushes are debounced (750 ms) so read-only work does not pay for storage.
- Proven by a Playwright test that kills the browser process with `kill -9` straight after a confirmed sale and finds the sale on restart.

**Result** (1x CPU, 2,000 products, headless Chromium; the full table and the throttled runs are in `perf/summary.md`): a sale is visible to the cashier in about 23 ms and durable in about 163 ms median, against about 680 ms for flush-every-statement. These are sandbox numbers. **No real tablet has been measured yet**; the app has a built-in Device speed screen (`/bench/`) and `perf/README.md` explains how to run it.

**Next lever, not tried:** PGlite's file-system storage on OPFS inside a Web Worker. It may avoid the full-file rescans. It is a Phase 1 spike item once a real tablet gives us a baseline, because it also changes the single-window rule.

### 2.12 Server-side permission enforcement (modes 2 and 3)

You confirmed A10 on the condition that the server enforces permissions in modes 2 and 3. **Phase 0b does not do this.** Today the server checks only that a device is paired and its schema version matches; it accepts any valid row from a paired device. That is fine for the foundation and **not acceptable for modes 2 and 3 in production.** Design, to land in **Phase 1 (Auth and roles)**, before any server mode is offered to a shop:

1. Every synced row carries the id of the user who made it (`actor_id`), written by the service layer on the device.
2. The server holds its own copy of users, roles and grants (they sync like any versioned data, but the server decides which version is authoritative).
3. On push, for each row the server maps (table, operation) to the permission the service layer would have required, looks up the actor's grants **as the server knows them**, and rejects the row if the permission is missing. Rejected rows come back to the device as visible exceptions, not silent drops.
4. Rows that would break a rule the device was supposed to enforce (a price below a floor, a refund above a limit) are checked by the same pure domain code, run on the server.
5. A device can never grant itself permissions: role and user rows are accepted only from a device whose actor holds `users.manage`.
6. Offline caveat: a till that was offline when an admin removed a permission can still push work done under the old grants. The server accepts rows by the actor's grants **at the row's timestamp**, so a revocation never rewrites history, and it flags the case for review.
7. A test walks the table-to-permission map and fails if any synced table has no entry (the same idea as the planned route-permission test).

---

## 3. Data model (our own design)

Groups and relations. Full column design happens in Phase 0b as the Drizzle schema in `app/src/schema`; it will **not** mirror NexoPOS table names. The spike already proved the pattern on seven tables.

```
IDENTITY      User ─< UserRole >─ Role ─< RolePermission >─ Permission
              User ─< ApiToken        User ─< Session        AuditLog >─ User

CATALOGUE     Category (self-parent) ─< Product
              Product ─< ProductVariant (for 'variable')     Product ─< BundleItem >─ Product ('grouped')
              Product ─< ProductUnit >─ Unit >─ UnitGroup     (ProductUnit = price tiers, barcode, SKU, threshold)
              Product >─ TaxGroup ─< TaxGroupTax >─ Tax       Product ─< ProductImage >─ Media
              ScaleRange (PLU ranges)

STOCK         StockLevel (product_unit × location-less) = cached balance
              StockMovement (append-only: kind, qty, unit_cost, ref_type/ref_id, reason)
              StockAdjustment ─< StockAdjustmentLine       (draft → executed)

PURCHASING    Provider ─< Procurement ─< ProcurementLine >─ ProductUnit
              ProcurementPayment                             PurchasePriceHistory

CUSTOMERS     Customer ─< Address (billing|shipping)   Customer >─ CustomerGroup >─ RewardProgram ─< RewardRule
              CustomerAccountEntry (append-only ledger)  CustomerReward (points)  
              Coupon ─< CouponScope (product|category|customer|group)  CustomerCoupon ─< CouponUse

SALES         Order ─< OrderLine (snapshot of name, unit, price, tax, cost)
              Order ─< OrderPayment >─ PaymentType         Order ─< OrderInstalment
              Order ─< OrderTax        Order ─< OrderCoupon   Order >─ Customer, Register, Cashier
              Order ─< Refund ─< RefundLine (condition good|damaged, restock flag) ─< RefundPayment
              OrderStatus: payment, process, delivery (three fields)
              HeldOrder (payload snapshot + expiry)  OrderType (table, admin-editable; flags: needs_address, needs_table_label, allows_shipping, default_process_status)

REGISTERS     Register ─< RegisterSession (opened_by, float, counted, difference)
              RegisterEntry (append-only: opening, closing, cash_in, cash_out, sale, change, refund, account_pay)

ACCOUNTING    Account (chart, parent) ─< JournalLine >─ JournalEntry (source_type/source_id, posted_at)
              Expense ─ ExpenseSchedule (recurrence rule)   PostingRule ─< PostingRuleLine (event → debit/credit)
              DayBalance, MonthBalance (cached roll-ups)

SYSTEM        Setting (key/value + type + scope)   Media   Notification   Plugin (manifest, enabled)
              Device (id, name, order prefix)   Outbox (change feed)   SyncState   BackupRun   ImportRun
              WebhookEndpoint ─< WebhookDelivery (server modes only)
```

Design decisions that differ from the original, on purpose:

- **Stock is a movement ledger** with a cached level, not mutable counters with side tables. Reports read from movements.
- **Accounting is double-entry** (`JournalEntry` balanced by `JournalLine`), driven by posting rules. The original's rules engine is the model for behaviour, not for tables.
- **Order lines are snapshots**, so later price, tax or name changes never alter history.
- **Customers are their own table**, not users with a role. A staff user can optionally link to one.
- **Every ledger row carries the id of the device that wrote it**; every mutable row carries `version`, `updated_at`, `updated_by_device`.
- **Keys are UUIDs generated on the client**, never database sequences; per-device sequences exist only for human-readable order numbers.
- **Partial indexes and CHECK constraints** enforce invariants in the database: one open session per register, balanced journal entries, non-negative stock unless allowed, a payment never exceeds its limit.

---


## 4. Money, tax, discount, rounding (specified before coding)

These rules become executable tests in Phase 0, before any screen exists.

- Amounts are integer minor units. Display formatting only at the edge.
- **Price → line total.** `net or gross unit price × quantity` (Decimal) → round half-up to a minor unit **once, per line**.
- **Inclusive tax.** `tax = round(gross − gross / (1 + rate))`; **exclusive** `tax = round(net × rate)`. Several taxes in a group are computed on the same base (parallel), not compounded; compound groups are a later option.
- **Discount order.** line discount → line tax → cart discount apportioned across lines by value, largest remainder method so the parts sum exactly → coupons → shipping → totals.
- **Percentage discounts** are computed on the pre-discount base; flat discounts are capped at the base.
- **Refund** reverses the original line's recorded amounts proportionally with the same largest-remainder rule; refunded tax never exceeds collected tax.
- **Cash rounding** is applied once to the final cash tender (nearest 5c by default) and recorded as its own register entry.
- Rounding mode, cash rounding and tax rates are inputs to these functions, never constants (section 4b).
- Property-based tests: sum of parts equals the total for any cart; refund of everything returns exactly what was charged; inclusive then exclusive conversion round-trips within one minor unit.

---

## 4b. Configuration, not constants

**Principle.** Domain functions never import a default. They receive the configuration as an argument (`priceCart(cart, config)`). Defaults live in one `seed/` module that only the installer imports. A lint rule forbids importing `seed/` from anywhere else. Seeds run once at install, are marked as applied, and later upgrades never overwrite a value an admin changed.

**Editable by an admin, each behind its own permission** (finer than the original's single "manage options"): `settings.tax`, `settings.rounding`, `settings.currency`, `settings.locale`, `settings.pos` (order types), `settings.payments`, `settings.documents` (templates), `roles.manage`, `catalogue.manage`, `customers.manage`. Every change writes an audit row with before and after values. A change affects new orders only; stored orders keep their snapshot.

| item | seed | editable | guard rails |
| --- | --- | --- | --- |
| Tax rates, tax groups, inclusive/exclusive | 10% GST in one group, inclusive | rate, name, group membership, default mode, per-product override | a tax used by an order is deactivated, never deleted; changing a rate never touches past orders |
| Rounding | half-up, cash rounding 5c on | mode (half-up, half-even, half-down), cash rounding on/off, increment (5c, 10c, 1.00, other) | the rule is applied everywhere through one function; tests run every mode |
| Currency and format | AUD, symbol before, 2 decimals | code, symbol, position, thousand and decimal separators, date format, time format, timezone, language | see "must stay fixed" for storage precision and timezone |
| Order types | takeaway, delivery, dine-in | add, rename, disable, reorder, set flags (needs address, needs table label, shipping allowed) | at least one enabled; one marked default |
| Payment types | cash, card, bank, customer account | add, rename, disable, reorder, link to an accounting account | each has a fixed **kind** (see below) |
| Receipt and invoice templates | one of each | full edit, preview, restore the shipped version | placeholder list is fixed; templates are sanitised and cannot run code |
| Roles and permissions | Administrator, Manager, Cashier, plus a customer-facing role | create, rename, clone, change permission sets | see "must stay fixed" |
| Categories, units, unit groups, customer groups | a few examples | everything, including deleting | deletion is blocked while referenced (archive instead); the default customer group, default walk-in customer and each unit group's base unit must always exist |

**Must stay fixed, and why**

1. **The permission list.** Permissions are defined in code (and registered by plugins) because each one is enforced at a specific point in a service. Admins assign them; they cannot invent them, since an invented one would guard nothing.
2. **The last administrator.** You cannot delete or demote the last user holding `roles.manage` and `users.manage`, and the Administrator role keeps every permission. Otherwise an admin can lock everyone out.
3. **Storage precision of money.** Amounts are stored as integer minor units at the currency's decimal places. Symbol, position and separators change freely. Changing the currency code or decimal places is locked once the first order exists, because every stored amount would be read at a different scale. Before then it is editable. After, it needs a deliberate, backed-up migration that I would build only if you ask.
4. **Timezone changes recompute history views.** Timestamps are stored in UTC, so the timezone is editable, but day boundaries move. Saving a new timezone queues a roll-up recompute and warns that daily reports will shift.
5. **Status vocabularies and kinds.** Payment, process and delivery statuses, stock-movement kinds, register-entry kinds, journal event types, and **payment-type kinds** (cash, card or bank, customer account) are code. Behaviour hangs off them: only a cash-kind type triggers change due, cash rounding and drawer entries; a customer-account kind debits the ledger. Admins create payment types freely but choose one of these kinds. Labels are translatable and editable.
6. **Order-type behaviour flags.** The set of flags is code; which types use which flags is data.
7. **The calculation algorithm.** Order of operations (line discount, tax, cart discount apportioned, coupons, shipping), parallel tax groups, per-line rounding scope, largest-remainder apportionment. Making these switchable would multiply the tested combinations and let two stores produce different totals from the same cart, so they stay fixed and covered by property tests. Rounding mode and cash rounding are the parameters.
8. **Ledger integrity.** Stock, register, customer-account and journal rows are append-only; entries must balance; audit rows cannot be edited or deleted through the app. Corrections are new reversing rows.
9. **Template placeholder vocabulary and engine.** Admins edit layout and wording; the available tokens and the safe substitution engine are code, so a template can never execute anything.
10. **Settings keys and schema.** The set of settings is defined in code with types and validation; values are data.

**Verification (added to the quality gates).** For each editable item above, a test changes the setting through the service and asserts that behaviour changes (15% tax changes a cart total, half-even changes a .5 case, cash rounding off removes the rounding line, a new order type appears at the POS, a new payment type of cash kind gives change). A schema test fails if a default literal appears outside `seed/`.

**Held carts (decided).** A cart held before a tax, price or rounding change is re-priced when resumed. The cashier sees a notice that names every line whose unit price changed, with the old and the new price, and any change in the cart total. A line whose price did not change is not listed. If nothing changed, no notice is shown. The re-pricing is a pure function (`repriceHeldCart(held, currentConfig, currentCatalogue)` returning the new cart and a list of `{line, oldPrice, newPrice}`), and it has tests in Phase 0b for: unchanged cart (empty notice), one price changed, a tax-rate change moving a tax-inclusive price, a rounding-mode change, a product that became inactive or was removed (flagged, not silently dropped). There is no quantity-break pricing in the model, so there is no tier case; if it is added later it gets its own test.

## 5. Build order

Each phase ends with: the code runs; unit + integration + e2e tests pass in CI; seed data loads; a demo script (`docs/demo/phase-N.md`) walks through it; `features.csv` is updated and the parity score reported with `replica-diff/parity.py`. **From Phase 1 on, every e2e flow is run in mode 1 and again with two devices in mode 2.**

| phase | scope | demo ends with |
| --- | --- | --- |
| **0a Spike (done)** | on-device DB, offline checkout, sync to a server, backup/restore; see `spike-report.md` | the report |
| **0b Foundation (built, awaiting your review)** | repo layout and CI (Postgres service), Drizzle schema v1 for the whole model, money/tax/discount/rounding engine with property tests (rounding mode and cash rounding as inputs), held-cart re-pricing with the changed-line notice and its test, settings store (versioned) and the `seed/` import rule, audit-log wrapper, event bus, sync hardening (schema-version handshake, store-id guard, SKU/barcode merge rule, per-device tokens), device lock (PIN or passphrase), encrypted backups (file and S3-compatible) with verified restore, write-behind durability, device speed screen, design tokens, app shell with i18n (English, Arabic), RTL, dark mode. **Not done, deliberately:** a measurement on a real tablet or mini PC (needs your hardware), server-side permission enforcement (2.12, Phase 1), Docker run on real hardware | green CI; engine tests; a shell that renders LTR/RTL, light/dark, with the sync badge, a sample sale, backup and restore, two-device sync |
| **1 Auth and roles** | first-run wizard (new store / join), on-device accounts, users, roles, permission matrix, last-admin guard, device pairing, activity log v1, profile, **server-side permission enforcement for modes 2 and 3 (2.12)**, **OPFS storage spike once a real tablet baseline exists (2.11)** | fresh install, create a cashier, sign in as the cashier, pair a second device; a forged push from a cashier's device is rejected by the server |
| **2 Catalogue** | taxes, units, categories, products (simple, dematerialised, grouped, variable), SKU and barcode generation, media, stock ledger, adjustments, product history, CSV import and export, labels, indexes for the grid and search | import 200 products, adjust stock, print labels; both devices see it |
| **3 POS checkout (vertical slice)** | grid, search, scan, cart, units, price override, discounts, taxes, coupon entry, customer pick, order types incl. dine-in label, hold/resume/void, cash + card, change due, receipt print, shortcuts, touch layout | ring up a sale on a tablet **with the network off**, then sync |
| **4 Orders and payments** | orders list/detail, multi-payment, partial, unpaid, instalments, payment types, refunds and returns with restock option, registers (device-bound sessions, Z-report), invoices | a day on the till |
| **5 Customers** | customers, groups, account ledger, credit limit, rewards, coupons, import | loyalty coupon redeemed on the second device |
| **6 Procurement** | providers, procurements, receive stock, price history, low-stock suggestions, alerts | low-stock to PO to stock |
| **7 Accounting** | chart, expenses incl. recurring (idempotent runners), journals, roll-ups | recurring expense posts once even with two runners |
| **8 Reports** | all reports, print, CSV, PDF, XLSX | totals reconcile to the ledger |
| **9 Settings, extensibility, ops** | all settings pages, build-time plugins with events/hooks, webhooks and email (server modes), **backups to file, Drive and S3-compatible, scheduled backups, restore drill, restore-as-new-device UI**, local-server Docker tested on real hardware, cloud deployment recipe, notifications, dashboard widgets, language packs, themes, API docs | backup, wipe, restore; switch mode 1 to 2 to 3 on real devices |
| **9b Desktop wrapper (Tauri)** | package the same static app for shop PCs: reliable file storage, real scheduled backups to a chosen folder, no browser eviction. Pulled earlier if real devices show eviction | install on a shop PC, schedule a backup with the app closed, restore it |
| **10 Hardening and parity report** | accessibility, performance budget, security review, load test with several tills, translation review, final parity report | the report |

Order follows your brief, with foundation first and registers in phase 4.


## 6. Quality gates

- **Coverage.** Domain code (money, tax, discount, pricing, rounding, coupons, units, stock rules): 100% branch coverage, plus property tests. Services: integration tests against real Postgres. UI: Playwright for the main flows of each phase.
- **No float for money**, enforced by a lint rule and a test that scans the schema.
- **Permissions.** A test walks every API route and asserts it names a permission (the original has the same kind of test).
- **Concurrency.** Tests for two cashiers selling the last unit, two sessions opening one register, double-submitted payments (idempotency key on order create and payment).
- **Accessibility and touch.** Minimum 44px targets on POS, keyboard operable, axe checks in e2e.
- **Clean room by construction.** The code is written from our specs; no NexoPOS text enters the repo. `replica-brand/sweep.py` runs in CI against the strings "NexoPOS", "Nexo" and the original's palette values.
- **Offline and sync gates.** Every phase's main flow is tested (a) standalone, (b) with the network cut mid-flow, (c) with two devices diverging and converging. Convergence is asserted by comparing the full data of both devices and the server, not just totals.
- **Replay safety.** Every sync and job path has a test that runs it twice.
- **Device performance budget** set from the cheapest target tablet in Phase 0b (checkout under an agreed time with a realistic catalogue); regressions fail CI.
- **Backup gate.** A backup is only "good" after a verified scratch restore; CI restores one every run.


## 7. Tracking

`replica/features.csv` is the source of truth (`clone` column: `yes` / `partial` / `no`). After each phase I run:

```
python3 replica-diff/parity.py replica/features.csv
```

and paste the score, the must-have gaps and the by-area table into `replica/progress.md`. Baseline today: 0 of 134 must-haves.


## 8. Risks

The full list with severities is in `spike-report.md` (R1 to R13). The ones that decide the plan:

| risk | mitigation |
| --- | --- |
| **R2 browser storage can be evicted** (largest mode-1 data-loss risk; Safari clears unused site data after about 7 days unless installed) | persistent-storage request, install prompt, escalating verified-backup prompts, wrapper for PCs, advise mode 2/3 for shops that cannot accept it |
| **R4 speed on low-end tablets is unmeasured** | only sandbox numbers exist (`perf/summary.md`); they find storage, not the database, is the cost (2.11). A real reading on the 3 to 4 GB Android tablet is the next most valuable test, and it can still change the stack decision |
| **R14 the browser database is not encrypted at rest** | the device lock stops casual access and backups are always encrypted, but someone with browser developer tools on an unlocked profile can read the data. Said plainly in the UI; the Tauri wrapper can encrypt the file |
| R5 PGlite is young | pin the version, portable logical export |
| R6 duplicate SKUs across offline devices | merge rule in Phase 0b, exceptions inbox |
| R9 devices on different versions | version handshake |
| R10 device-side permissions are advisory | stated plainly; server modes enforce |
| Rounding and tax rules differ from what you or your accountant expect | A2/A3 explicit; engine tests reviewable by a non-developer |
| Scope creep from the extras | each extra sits in a named phase |
| No access to NexoPOS docs | behaviour questions collected in each phase demo |

## 9. What I need from you

1. **Review the Phase 0b demo** (`demo-phase-0b.md`, about 15 minutes) and `perf/summary.md`.
2. **Vite or Next.js.** Read `framework-decision.md`. I recommend switching to Vite now, as the first change of Phase 1. Say A (switch), B (stay) or C (later).
3. **Run the Device speed screen on the real tablet** (and the N100 mini PC if you have one) and send me the copied results. The sandbox numbers say the sale itself is fine on a fast CPU and marginal on a slow one, and that memory may be too high for a 3 GB tablet. Only the real device settles it. If it is bad, I would spike OPFS storage before Phase 1 rather than after.
4. **Agree the speed and memory budget** (`perf/README.md` has my provisional figures) once the tablet reading exists.
5. **Server-side permission checks** (2.12) are designed but not built; confirm that Phase 1 is the right place, since no server mode should be offered to a shop before then.

On your go-ahead I start **Phase 1** and stop at its demo.
