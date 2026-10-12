# Build plan: working title "Tillbox"

Status: **proposal, awaiting your approval. Nothing is built.**
Inputs: `recon.md` (what to build), `features.csv` (the checklist), decisions in recon section 18.
Licence: GPL-3.0. Stack: Next.js + Postgres + Prisma.

---

## 1. Assumptions I need you to confirm or change

| # | assumption | why it matters |
| --- | --- | --- |
| A1 | Single store per install, self-hosted (Docker compose: app + worker + Postgres). No multi-tenant SaaS. | multi-tenant would put a `store_id` on every table |
| A2 | Defaults: AUD, en-AU, 10% GST **inclusive**, 5-cent cash rounding on cash payments only. All configurable. | rounding rules are the riskiest maths in the product |
| A3 | Rounding method: half-up (away from zero on .5), **per line**, tax extracted per line, order totals are the sum of rounded lines. Cash rounding applies to the final cash tender only and is shown as its own line. | the original's rule is unknown; this is the common retail rule and testable |
| A4 | Paid NexoPOS modules, multi-store, marketplace, telemetry, update check, AI/MCP server: out of scope. | recon section 16 |
| A5 | Plugins are TypeScript packages installed by the admin on the server (folder + manifest, loaded at boot). No in-browser zip upload that runs code. | uploading executable code through a web form is a security hole; flagged as a deliberate departure |
| A6 | One repo, app in `/app`, own `LICENSE` (GPL-3.0). The Replica skill folders stay as they are. | keeps the MIT skill pack and the GPL app separate |
| A7 | Name "Tillbox" is a placeholder; I have not run trademark checks. | `/replica-brand` does that later |
| A8 | The docs site stays unreachable, so behaviour is specified from the repo audit plus normal retail practice. | some behaviour will differ in detail; the demo scripts make that visible |

---

## 2. Architecture

```
 Browser (PWA, tablet-first)                         Worker process (same codebase)
 ┌──────────────────────────────┐                    ┌──────────────────────────────┐
 │ Next.js App Router (React)   │                    │ pg-boss consumers + cron     │
 │  - POS (client-heavy, Zustand│                    │  - recurring expenses        │
 │    cart, offline-tolerant)   │                    │  - low-stock scan            │
 │  - Back office (server comps)│                    │  - held-order expiry         │
 └──────────────┬───────────────┘                    │  - report roll-ups           │
                │ server actions / route handlers    │  - webhook delivery + retry  │
 ┌──────────────▼───────────────┐                    │  - backups, emails           │
 │ Application layer (services) │◄──── jobs ────────►└──────────────┬───────────────┘
 │  permission check → use case │                                   │
 │  → domain → repo → audit log │                                   │
 │  → emit domain event         │                                   │
 └───────┬───────────┬──────────┘                                   │
         │           │ events                                       │
 ┌───────▼─────┐  ┌──▼────────────────────┐   ┌─────────────────────▼───┐
 │ Domain (pure│  │ Event bus + hook      │   │ PostgreSQL              │
 │ TS, no I/O) │  │ registry (plugins,    │   │  - Prisma models        │
 │ money, tax, │  │ webhooks, accounting, │   │  - pg-boss queue tables │
 │ pricing,    │  │ rewards, audit)       │   │  - append-only ledgers  │
 │ stock rules │  └───────────────────────┘   └─────────────────────────┘
 └─────────────┘
```

Rules that keep it honest:

1. **Domain code is pure.** `money`, `tax`, `discount`, `pricing engine`, `unit conversion`, `rounding`, `coupon eligibility` take plain values and return plain values. No database, no clock. That is where the unit tests concentrate.
2. **One write path.** Every mutation goes through a service function that checks permission, runs in a transaction, writes the audit row, and emits an event. The REST API, server actions and plugins all call the same services, so there is no second set of rules.
3. **Ledgers are append-only.** Stock, register cash, customer account and accounting journal are never edited, only reversed by a new row. Cached balances are columns updated in the same transaction and re-derivable.
4. **Side effects use events**, delivered by an outbox table so a crash never loses one: accounting postings, reward points, webhooks, notifications.

### Tech choices

| concern | choice | reason |
| --- | --- | --- |
| Framework | Next.js (App Router), TypeScript strict | one language end to end |
| DB / ORM | PostgreSQL, Prisma | transactions, `numeric`, row locks, constraints |
| Money | integer minor units (`bigint` in DB, `number` safe-integer in code, wrapped in a `Money` type); quantities and rates as `Decimal` (decimal.js) | brief: integer cents or decimal; no floats anywhere near money |
| Auth | session cookies (Auth.js credentials provider, argon2 hashes) for UI; hashed opaque bearer tokens for API | simple, no third-party signup |
| Permissions | role → permission set, checked in services; same string list as the permission matrix screen | |
| Validation | zod schemas shared by client and server | |
| UI | Tailwind + Radix primitives; own design tokens (from `/replica-design`); logical CSS properties for RTL; dark mode by CSS variables | |
| Client state | TanStack Query (server data), Zustand (POS cart) | |
| i18n | next-intl, ICU messages, English + one RTL language (Arabic) at launch | our own strings |
| Jobs / queue | pg-boss on the same Postgres (no Redis), cron schedules in the worker | one fewer service to run |
| Realtime | Server-Sent Events for notifications | no websocket server needed |
| PDF / XLSX / CSV | Playwright-rendered print views to PDF, exceljs, csv-stringify | |
| Barcodes | bwip-js (EAN-13, UPC-A, Code 128, Code 39, Codabar) | |
| Email | nodemailer over SMTP configured in Settings | no external signup |
| Backups | scheduled `pg_dump` to a local or S3-compatible path, restore guarded by confirmation + permission | |
| Tests | Vitest (unit, integration against a real Postgres in Docker), Playwright (end-to-end, tablet viewport) | |
| CI | GitHub Actions: typecheck, lint, unit, integration, e2e | |

---

## 3. Data model (our own design)

Groups and relations. Full column design happens in Phase 0 as `prisma/schema.prisma`; it will **not** mirror NexoPOS table names.

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
              HeldOrder (payload snapshot + expiry)  OrderType: takeaway | delivery | dine_in(table_label)

REGISTERS     Register ─< RegisterSession (opened_by, float, counted, difference)
              RegisterEntry (append-only: opening, closing, cash_in, cash_out, sale, change, refund, account_pay)

ACCOUNTING    Account (chart, parent) ─< JournalLine >─ JournalEntry (source_type/source_id, posted_at)
              Expense ─ ExpenseSchedule (recurrence rule)   PostingRule ─< PostingRuleLine (event → debit/credit)
              DayBalance, MonthBalance (cached roll-ups)

SYSTEM        Setting (key/value + type + scope)   Media   Notification   Plugin (manifest, enabled)
              WebhookEndpoint ─< WebhookDelivery   OutboxEvent   BackupRun   ImportRun   JobRun (via pg-boss)
```

Design decisions that differ from the original, on purpose:

- **Stock is a movement ledger** with a cached level, not mutable counters with side tables. Reports read from movements.
- **Accounting is double-entry** (`JournalEntry` balanced by `JournalLine`), driven by posting rules. The original's rules engine is the model for behaviour, not for tables.
- **Order lines are snapshots**, so later price, tax or name changes never alter history.
- **Customers are their own table**, not users with a role. A staff user can optionally link to one.
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
- Property-based tests: sum of parts equals the total for any cart; refund of everything returns exactly what was charged; inclusive then exclusive conversion round-trips within one minor unit.

---

## 5. Build order

Each phase ends with: the code runs; unit + integration + e2e tests pass in CI; seed data loads; a demo script (`docs/demo/phase-N.md`) walks through it; `features.csv` is updated and the parity score reported with `replica-diff/parity.py`.

| phase | scope | rows in features.csv (approx.) | demo ends with |
| --- | --- | --- | --- |
| **0 Foundation** | repo layout, Docker compose, CI, Prisma schema v1, `Money`/tax/discount/rounding engine with its tests, design tokens, app shell, i18n + RTL + dark mode scaffolding, settings store, audit-log wrapper, event bus + hook registry skeleton | 10 | a green CI and a page that renders in LTR/RTL, light/dark |
| **1 Auth and roles** | installer wizard, sign-in/out, users, roles, permission matrix, locked roles, API tokens, activity log (first version), profile | 20 | fresh install, create a cashier role, sign in as the cashier, API call with a token |
| **2 Catalogue** | taxes and groups, units and groups, categories, products (simple, dematerialised, grouped, variable), SKU and barcode generation, media library, stock levels, adjustments, product history, CSV import and export, labels | 40 | import 200 products from CSV, adjust stock, print a label sheet |
| **3 POS checkout (the vertical slice)** | POS screen: grid, search, scan, cart, units, price override, line and cart discounts, taxes, coupon entry, customer pick, order types incl. dine-in label, hold/resume/void, cash + card payment, change due, receipt print, shortcuts, touch layout | 45 | ring up a sale end to end on a tablet viewport and print a receipt |
| **4 Orders and payments** | orders list/filters/detail, multi-payment, partial, unpaid, instalments, payment types, refunds and returns with restock option, registers (open, close, cash in/out, Z-report, session balancing), invoices | 35 | a day on the till: open, 10 sales, a refund, close with a counted difference |
| **5 Customers** | customers, addresses, groups, account ledger, credit limit, pay-by-account, rewards, coupons (all rules), customer import | 20 | loyalty points issue a coupon that a later sale redeems |
| **6 Procurement** | providers, procurements, receive stock, payment status, purchase-price history, low-stock suggestions, auto-stocking job, low-stock alerts | 15 | low-stock alert → suggested PO → receive → stock rises, cost updated |
| **7 Accounting** | chart of accounts, expenses (direct, recurring, scheduled), transaction/account history, posting rules and journals, day/month roll-ups, payment-type accounts | 15 | recurring rent expense fires; a sale and a refund post balanced journals |
| **8 Reports** | all reports in recon section 10 plus sales-by-customer; date ranges; print, CSV, PDF, XLSX; dashboard cards | 22 | run every report for a seeded quarter; totals reconcile to the ledger |
| **9 Settings, extensibility, ops** | every settings page incl. email/notifications, plugin system with events and hooks, webhooks (signed, retried), backups and restore, notifications (stored + SSE), dashboard widgets and layouts, language packs, themes, API docs, scheduled-job health page | 30 | install a sample plugin; a webhook fires on sale; backup then restore |
| **10 Hardening and parity report** | accessibility pass, performance budget on POS, security review, load test, translation review, final parity report | | parity report listing anything not replicated and why |

Order follows your brief (Auth → Products → POS → Orders → Customers → Procurement → Accounting → Reports → Settings/Modules), with foundation first and registers folded into phase 4 because a till session needs orders to exist.

Rough effort: phases 0 to 4 are the product's spine and about half the work. Each phase is several working sessions. I will stop at the end of every phase for your review.

---

## 6. Quality gates

- **Coverage.** Domain code (money, tax, discount, pricing, rounding, coupons, units, stock rules): 100% branch coverage, plus property tests. Services: integration tests against real Postgres. UI: Playwright for the main flows of each phase.
- **No float for money**, enforced by a lint rule and a test that scans the schema.
- **Permissions.** A test walks every API route and asserts it names a permission (the original has the same kind of test).
- **Concurrency.** Tests for two cashiers selling the last unit, two sessions opening one register, double-submitted payments (idempotency key on order create and payment).
- **Accessibility and touch.** Minimum 44px targets on POS, keyboard operable, axe checks in e2e.
- **Clean room by construction.** The code is written from our specs; no NexoPOS text enters the repo. `replica-brand/sweep.py` runs in CI against the strings "NexoPOS", "Nexo" and the original's palette values.

## 7. Tracking

`replica/features.csv` is the source of truth (`clone` column: `yes` / `partial` / `no`). After each phase I run:

```
python3 replica-diff/parity.py replica/features.csv
```

and paste the score, the must-have gaps and the by-area table into `replica/progress.md`. Baseline today: 0 of 134 must-haves.

## 8. Risks

| risk | mitigation |
| --- | --- |
| Rounding and tax rules differ from what you or your accountant expect | A2/A3 are explicit; Phase 0 tests are reviewable by a non-developer; jurisdiction presets are configuration |
| POS performance on cheap tablets | client-side cart engine, product list cached locally, performance budget in Phase 3 |
| Offline use | not in the original's core either; Phase 3 keeps the cart resilient to a dropped connection, true offline sync is out of scope unless you add it |
| Scope creep from the extras | each extra sits in a named phase; none starts before its phase |
| No access to NexoPOS docs | behaviour questions are collected in each phase demo for you to rule on |

## 9. What I need from you to start

1. **Approve** the plan, or say what to change.
2. Confirm or change **A1 to A8** (especially A2/A3 rounding and A5 plugin loading).
3. Say whether to **keep the working title** or give me a name.

On approval I will start **Phase 0**, and stop at its demo for review.
