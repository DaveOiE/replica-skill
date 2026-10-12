# Recon map: NexoPOS 6.2.4 (web POS, self-hosted)

Scope: the whole product that ships in the open-source core repository, measured against the feature list in the brief (Step 2).
For: the owner's own new POS product, built under a new name and UI.
Date: 2026-10-12
Status: **Step 1 (audit) complete. No application code written. Nothing in Step 3 or 4 is started.**

Companion files:

- `features.csv`: the feature matrix (the checklist Step 4 is tracked against)
- `appendix-a-routes.md`: all 114 screens and 238 API endpoints, with required permission
- `appendix-b-schema.md`: all 72 tables and their columns

---

## 0. The five things you need to know before anything else

1. **Licence.** The repo's `LICENSE` file and its README both say **GPL-3.0**. `composer.json` says "MIT". The licence file and README win; the composer field looks like stale metadata. Details and consequences in section 2.
2. **Several things in your brief are not in the NexoPOS core.** Dine-in, product CSV import, webhooks, backups, an activity log, and email/notification settings are missing or only partial in the open-source repo. Dine-in and others are sold as separate marketplace modules. Section 14 lists each one. These are your calls (section 15).
3. **Your stack line is still a placeholder.** Step 3 says `[YOUR STACK, e.g. ...]`. I have not picked one.
4. **I could not read the NexoPOS documentation site.** `my.nexopos.com` is blocked by this sandbox's network policy (proxy returns 403). I did not try to get around it. Everything below comes from reading the repository only, so user-facing wording, screenshots and any behaviour that exists only in the docs are unverified. If you want the docs used, allow that host in the environment's network settings.
5. **I have not run NexoPOS.** No screenshots, no click-through. Behaviour is inferred from code, tests and settings text. Where I inferred, I say so.

---

## 1. Sources

| # | source | what I used | notes |
| --- | --- | --- | --- |
| 1 | Repo `Blair2004/NexoPOS`, commit `4274cac`, version 6.2.4 (config), dated 2026-10-08 | routes, migrations, models, services, jobs, events, listeners, settings pages, permission seeds, Vue page and popup names, scheduler, console commands, tests, `composer.json`, `package.json` | read-only shallow clone, held outside the project folder |
| 2 | Repo README | module list, positioning | confirms which features are separate paid modules |
| 3 | `my.nexopos.com/en/documentation` | **not reachable** | blocked by sandbox network policy |
| 4 | Running instance, screenshots, videos | **none** | not available |

What I did not do: copy any source or translation text into the project, install NexoPOS, or write code.

---

## 2. Licence and clean-room position

**Finding.** `LICENSE` is the full GNU GPL v3 text and the README says "licensed under the GNU General Public License v3.0". `composer.json` declares `"license": "MIT"`. The two conflict. I treat GPL-3.0 as authoritative until the author says otherwise.

**What GPL-3.0 means for us, in plain terms (not legal advice):**

- If we copy NexoPOS code, templates, SQL or translation strings into our app, our app becomes a GPL-3.0 work and must ship its source under the same licence. You said not to copy, and I will not.
- If we build independently from behaviour, GPL attaches to nothing of ours, and there is no attribution *requirement*. A credit line is still good manners and I recommend one ("inspired by the behaviour of NexoPOS, no code shared").
- The name and logos "NexoPOS" are the author's. We use none of them. The brief already says so.

**The honest caveat.** I read this source to write the audit. A strict clean-room process uses two people: one reads the code and writes a behavioural spec, a different one builds from the spec and never sees the code. In this session I am doing both. To limit the risk I have:

- written the inventory in my own words, in terms of behaviour
- listed table and column names only as a map of *what is stored* (functional facts). Our schema will be designed fresh in Step 3 and need not match
- not recorded any UI label, email text or translation string
- left the Vue component and PHP class names out of anything that will be built from

If you plan to sell this under a closed licence, the residual risk is a derivative-work argument. Your options are in section 15, question 1.

**Where the repo's own licence-adjacent facts matter:**

- Third-party libraries NexoPOS depends on have their own licences. We choose our own dependencies in Step 3, so this does not carry over.
- The Replica skill pack in this repo is MIT. That covers the skills and tools, not what they produce.

---

## 3. Core loop

A cashier signs in, opens a register, rings up a sale on the POS (pick products, adjust the cart, attach a customer, take one or more payments), and the system records the order, moves stock, books the money into the register and the accounts, and feeds the reports. Stock comes in through procurements from providers.

## 4. Size at a glance

| thing | count | where |
| --- | --- | --- |
| Screens (web routes) | 114 | appendix A |
| API endpoints | 238 (+ 10 generic CRUD routes that serve ~40 resources) | appendix A |
| Tables | 72 | appendix B |
| Eloquent models | 77 | |
| CRUD resources (list + form + export + bulk actions) | 40 | section 5.12 |
| Permissions seeded | 94 (+ a few added by migrations) | section 8 |
| Events dispatched | 169 | section 12 |
| Filter/action hooks | 78 distinct | section 12 |
| Background jobs | 47 | section 12 |
| Scheduled tasks | 13 fixed + one per recurring transaction | section 12 |
| Console commands | about 40 (some are base classes) | section 12 |
| Dashboard widgets | 9 | section 5.2 |
| Vue pages / popups / shared components | ~190 `.vue` files | section 13 |
| Languages | 14 translation files, 13 listed as supported in config (English, German, French, Spanish, Italian, Indonesian, Arabic, Portuguese, Turkish, Khmer, Vietnamese, Albanian, Korean; a Dutch file also exists). About 3,400 UI strings. Arabic is the only RTL language | |
| Themes | 3 (dark, light, and a third named variant) | |
| Automated tests in the repo | 119 PHP test files, 5 browser specs | useful as a behaviour oracle |
| Open-source dependencies of note | Laravel 12, Vue 3, Sanctum (API tokens), Reverb/Pusher (websockets), BigDecimal maths library, spreadsheet writer (CSV), PDF renderer, barcode and QR generators, an event-hook library | |

---

## 5. Screens

IDs are stable. `features.csv` and the later phases refer to them. Route detail is in appendix A.

### 5.1 Entry, setup, authentication

| ID | screen | purpose | states seen |
| --- | --- | --- | --- |
| S01 | Setup wizard: welcome | start install | not-installed only |
| S02 | Setup wizard: database | enter and test DB credentials | testing, ok, failed |
| S03 | Setup wizard: configuration | store name, admin account | validation errors |
| S04 | Sign in | username/email + password | error, locked-out message, "registration disabled" |
| S05 | Sign up | optional self-registration | disabled by setting |
| S06 | Account activation | link from email | expired token |
| S07 | Password lost | request recovery email | disabled by setting |
| S08 | New password | set from emailed link | expired token |
| S09 | Database update | runs pending migrations after an upgrade | pending, running, done |

### 5.2 Dashboard

| ID | screen | purpose |
| --- | --- | --- |
| S10 | Admin dashboard | per-user layout of widgets in columns, drag to rearrange, pick layout (1 to 4 columns) |
| S11 | Cashier dashboard | personal sales summary for a cashier role |

Widgets: day sales card, incomplete-sales card, expense/transaction card, orders summary, orders chart (weekly), best customers, best cashiers, profile, marketplace promo (not copied). The data comes from pre-computed per-day and per-month report rows refreshed when orders change.

### 5.3 POS terminal (`/pos`)

| ID | screen / panel | purpose |
| --- | --- | --- |
| S20 | POS shell | header buttons, product grid, cart; fullscreen; permission gate (a cashier without the POS permission is redirected) |
| S21 | Product grid | category breadcrumb, product tiles, search, barcode scan input, pinned products, custom ordering, "hide out-of-stock", "hide empty categories" |
| S22 | Cart | lines with qty, unit, price; line-level controls; subtotal, discount, shipping, taxes, total; per-line remove |
| S23 | Cart header buttons | note/comment, coupons, quick product, order settings, cart taxes |
| S24 | Cart footer buttons | pay, hold, discount, void |
| S25 | POS header buttons | customer, order type, pending (held) orders, registers, back to dashboard, reset cart |
| S26 | Quantity popup | numpad quantity; decimals only if allowed |
| S27 | Price popup | override the unit price (permission-gated) |
| S28 | Unit popup | choose among a product's units (each has its own price and stock) |
| S29 | Discount popup | line or cart discount, percentage or flat |
| S30 | Shipping popup | shipping amount, flat or percentage |
| S31 | Tax popup | choose tax group and inclusive/exclusive for the cart |
| S32 | Customer select / quick create | search, pick, create inline with addresses |
| S33 | Order type popup | takeaway, delivery (core). Others via modules |
| S34 | Coupon popup | enter code, validate, apply; list a customer's coupons |
| S35 | Note popup | order note, with visibility (private vs shown on receipt) |
| S36 | Order settings popup | extra per-order fields, extensible |
| S37 | Quick product popup | add an ad-hoc product not in the catalogue (name, price, qty) |
| S38 | Hold / pending orders | list held orders, resume, delete; held orders expire after a configurable period |
| S39 | Layaway / instalments popup | split the balance into dated instalments |
| S40 | Payment popup | multiple payment lines; payment types: cash, bank, card, customer account, plus custom types; amount tendered, change due, partial payment, "pay later" |
| S41 | Cash register popup | open (opening float), close (counted amount), cash in, cash out, view history |
| S42 | Permission/approval popup | for restricted actions, ask a privileged user to approve (time-boxed grant) |
| S43 | Wireless barcode link | pair a phone as a scanner over a websocket |

### 5.4 Orders

| ID | screen | purpose |
| --- | --- | --- |
| S50 | Orders list | filter popup (exact fields not verified), export, bulk actions; statuses shown for payment, process and delivery |
| S51 | Order details | lines, payments, taxes, coupons, refunds, status changes, print |
| S52 | Order payment popup | add a payment to an unpaid or partial order |
| S53 | Refund popup | refund whole order or chosen lines; each returned line is marked good or damaged; refund payment type |
| S54 | Instalments list and pay | pay a due instalment; list overdue |
| S55 | Invoice | printable invoice (A4) |
| S56 | Receipt | printable receipt; also refund receipt and per-payment receipt |
| S57 | Payment types | CRUD |
| S58 | Unpaid / partially paid / held order lists | generic list screens (resources exist; dedicated routes not verified) |

### 5.5 Catalogue and inventory

| ID | screen | purpose |
| --- | --- | --- |
| S60 | Products list | search, filters, export CSV, bulk actions, per-product history and units |
| S61 | Product create/edit | tabs: identification, taxes, units & prices, stock, expiration, images, grouped sub-items or variations |
| S62 | Product units (per product) | list unit quantities, stock per unit |
| S63 | Product history | every stock movement for a product |
| S64 | Stock adjustment | multi-line adjustment (add, remove, damaged, lost, set), draft then execute |
| S65 | Adjustment history | past adjustments |
| S66 | Stock-flow records | global movement log |
| S67 | Print labels | choose products and label layout, print barcodes |
| S68 | Categories | tree with parent, image, "show on POS", order, product count; recompute counts |
| S69 | Units and unit groups | unit has a ratio to the group's base unit |
| S70 | Taxes and tax groups | tax with rate, grouped |
| S71 | Scale-barcode ranges | PLU ranges for weighed goods |
| S72 | Product conversion popup | convert stock from one unit to another |

### 5.6 Purchasing

| ID | screen | purpose |
| --- | --- | --- |
| S80 | Providers | list, create, edit; per-provider procurements and products |
| S81 | Procurements list | status and payment filters |
| S82 | Procurement create/edit | provider, delivery date, invoice ref, lines (product, unit, qty, purchase price, tax, expiry), auto-approval option |
| S83 | Procurement invoice | printable |
| S84 | Procurement products | list of received lines; edit |
| S85 | Low-stock suggestions | prefill a procurement from low-stock products |

### 5.7 Customers

| ID | screen | purpose |
| --- | --- | --- |
| S90 | Customers list/create/edit | profile, billing and shipping addresses, group, credit limit |
| S91 | Customer groups | discount-free grouping, links to reward programme |
| S92 | Customer orders | per customer |
| S93 | Customer account history | credit and debit ledger, manual deposit/withdraw/refund |
| S94 | Customer rewards | points earned per programme |
| S95 | Customer coupons and coupon history | coupons held and how they were used |
| S96 | Rewards programmes | rules by spend range to points; target points to coupon |
| S97 | Coupons | percentage or flat; validity window, hours, min/max cart, usage limit, restrict to products/categories/customers/groups |
| S98 | Generated coupons | coupons issued to customers |

### 5.8 Accounting

| ID | screen | purpose |
| --- | --- | --- |
| S100 | Transactions (expenses/incomes) | direct, recurring, scheduled, entity |
| S101 | Transaction history | debit/credit lines |
| S102 | Accounts | chart of accounts with sub-accounts |
| S103 | Account history | per account |
| S104 | Accounting rules | map business events to journal lines |
| S105 | Registers | list, create, edit |
| S106 | Register history | every cash movement |
| S107 | Z-report | end-of-session summary |

### 5.9 Reports (all with date range)

| ID | screen |
| --- | --- |
| S110 | Sales report (by period; grouped by product or category; filter by cashier) |
| S111 | Sales progress (daily/weekly progress and compare periods) |
| S112 | Sold stock report |
| S113 | Profit report |
| S114 | Stock (inventory) report |
| S115 | Low-stock report |
| S116 | Stock history (combined daily opening/sold/procured/defective/closing) |
| S117 | Cash flow / account summary |
| S118 | Annual report (per month) |
| S119 | Payment types report |
| S120 | Customer statement |
| S121 | Best products report |

### 5.10 Administration

| ID | screen | purpose |
| --- | --- | --- |
| S130 | Users list/create/edit | roles, active flag, attributes |
| S131 | Profile | name, avatar, language, theme; API tokens; guided tours |
| S132 | Roles list/create/edit/clone | name, namespace, locked flag, permissions, reward link |
| S133 | Permission manager | role x permission matrix |
| S134 | Settings (8 pages) | general, POS, orders, customers, invoice/receipts, workers, reports, accounting, plus reset and about; section 9 |
| S135 | Media library | upload, grid or list, rename, delete, bulk delete, pick from any image field |
| S136 | Notifications | list and clear |
| S137 | Modules list / upload / marketplace | enable, disable, delete, migrate |
| S138 | Reset | wipe data, optionally reseed demo |

### 5.11 Receipts and print

Receipt and invoice are HTML views rendered server-side and sent to the browser print dialog. A template with `{placeholder}` tokens (store, customer, shipping, billing, order) is editable in settings. A PDF renderer is also present. Gateway selection exists for external print servers (module territory).

### 5.12 Generic list screens (the "CRUD" pattern)

40 resources share one list component (search, column sort, filters, pagination, row actions, bulk actions, CSV export) and one form component (tabs, fields, validation). Resources: coupons, coupon-order history, customer accounts, customer coupons and history, customers, customer groups, customer orders, customer rewards, global product history, hold orders, orders, instalments, partially paid, unpaid, payment types, permission access, procurements, procurement products, product adjustments, categories, product history, unit quantities, providers, provider procurements and products, registers, register history, reward systems, roles, scale ranges, taxes, tax groups, transaction accounts, transactions, transaction history, units, unit groups, users.

---

## 6. User flows

```
F01 Sign in and start a shift
    S04 -> S10/S11 -> S20 (POS) -> S41 open register (opening float)
    edge: no register free, register already in use by another cashier, register disabled

F02 Ring up a cash sale
    S21 find/scan product -> S22 cart -> S40 pay cash -> receipt (S56)
    happy path clicks: tap product (1), Pay (2), exact/tender amount (3), confirm (4)
    edge: out of stock, expired product (blocked or allowed per product), decimal quantity when disallowed, price override without permission

F03 Change a line
    S22 tap line -> S26 quantity / S28 unit / S27 price / S29 discount / remove
    edge: unit switch changes price and stock source; wholesale price mode

F04 Discounts and coupons
    line or cart discount (percent or flat) -> validated so it never exceeds the amount
    coupon code -> S34 -> eligibility checks (validity, hours, min/max cart, usage limit, customer/group/product/category rules)

F05 Taxes
    product tax (inclusive or exclusive, from tax group) and/or cart-level tax (S31) per POS VAT setting
    edge: mixed inclusive/exclusive lines; tax on refund

F06 Hold, resume, void
    S24 Hold -> S38 later resume (inferred: a held order skips the payment-time side effects; verify stock behaviour in a running instance)
    S24 Void -> confirm -> order cancelled, stock and register effects reversed, reason stored
    edge: expiry of held orders (daily job)

F07 Split / multiple payments, partial, instalments, change
    S40 add several payment lines -> sum vs total -> change due or remaining
    partial allowed only if setting on; unpaid allowed only if setting on; pay-with-account requires customer credit
    S39 instalments: dated parts, "strict" mode forces pay-by-instalment orders
    edge: tendered more than total on non-cash type, customer over credit limit

F08 Customer attach / quick-create
    S32 search by name/phone/email -> pick, or create with billing and shipping addresses
    default walk-in customer and default group from settings; valid email / unique phone can be enforced

F09 Order types
    takeaway, delivery (delivery adds shipping address, shipping amount, driver, delivery status)
    other types appear only when a module adds them

F10 Receipt / invoice print; notes
    after payment -> print dialog (auto if enabled) ; private vs public notes; reprint from S51

F11 Register session
    open (S41) -> sales and payments accumulate -> cash in / cash out with reason -> close with counted cash -> difference stored -> S107 Z-report
    edge: closing with orders held, negative balance

F12 Refund / return
    S51 -> S53 pick lines and qty -> per line condition good/damaged -> refund payment type
    good returns restock (stock history 'returned'); damaged ones go to defective (not restocked)
    edge: refund more than paid, refund of partially paid, coupon/discount apportioning

F13 Pay an unpaid / partial order later
    S50 -> S52 add payment; or S54 pay an instalment

F14 Create product
    S61: identity, tax, units & prices (sale, wholesale, custom), stock rules, expiry, images; barcode and SKU auto-generate if blank
    types: materialized, dematerialized (service), grouped (bundle), variable (parent + variations)

F15 Receive stock
    S82 procurement (pending / delivered / stocked / draft) -> mark delivered -> stock rises and purchase-price history is recorded -> payment status paid/unpaid -> optional daily auto-stocking

F16 Adjust stock
    S64 draft lines (add, remove, damaged, lost, set) -> execute -> history rows -> stock moves
    S72 convert one unit to another

F17 Customer account
    S93 deposit (add), deduct, refund, payment; balance, owed amount and credit limit maintained
    paying an order "by account" debits the account

F18 Rewards
    each paid order accrues points per the customer's group programme; reaching the target issues a coupon

F19 Expenses
    S100 create expense (direct, recurring, scheduled, entity-linked) -> posts to accounts; recurring ones are fired by a scheduler on a pattern (month start/mid/end, specific day, every x days/hours/minutes)

F20 Reports
    pick report -> date range (+ filters) -> compute -> view -> print or export

F21 Users, roles, permissions
    create role -> tick permissions -> assign users; roles marked locked cannot be removed

F22 Module install
    upload zip -> validate -> extract -> enable -> run its migrations; disable/delete reverts

F23 Install and upgrade
    S01..S03 install; after upgrade S09 runs migrations

F24 Approval for restricted POS actions
    cashier hits a protected feature -> S42 -> a privileged user approves the request (an access-request record links requester and granter) -> grant lasts N minutes, with a cooldown list for some features (exact approval UX inferred)
```

---

## 7. Domain rules observed (behavioural)

These are the rules the tests and services enforce. Step 3 turns them into specs and unit tests.

**Order lifecycle.** Three independent status fields:
- payment status: paid, partially paid, unpaid, hold, void, refunded, partially refunded, due, partially due
- process status: pending, ongoing, ready, error
- delivery status: pending, ongoing, delivered, error

**Order code.** Three schemes selectable in settings: date + sequence, random, plain sequence.

**Order amounts stored.** gross, net, tax, products tax, discount (value, type, percentage), shipping (value, rate, type), coupons, cost of goods, total, tendered, change, instalment count, final payment date.

**Line amounts stored.** unit price, gross/net price, tax value (sale and wholesale), discount (value, type, percentage), quantity, totals, purchase cost, unit and unit-quantity, tax group and type, status/condition when returned.

**Tax.** Two modes per product or cart: inclusive (price already contains tax, tax extracted) and exclusive (tax added). A tax group can contain several taxes. A POS setting chooses whether VAT is applied per product or on the cart, and with which group and mode. Unit prices exist in three tiers: sale, wholesale, custom, each with edit/gross/net/tax parts.

**Discount.** Percentage or flat, on a line or the cart. Validity is checked (cannot exceed the base). Needs the discount permissions.

**Money maths.** The original uses an arbitrary-precision decimal library and stores 5 decimal places, with display precision from settings. Our rule from the brief: integer minor units or a decimal type, with unit tests for tax, discount and rounding. The exact rounding rule of the original (when it rounds, per line or per order) is **not yet established**; see question 6.

**Stock.** Each product has one or more *unit quantities* (one per unit it is sold in), each with its own stock, low-stock threshold, alert flag, barcode and three prices. A unit group defines units as multiples of a base unit; conversion moves quantity between units. Every stock change writes a history row with an action: procured, sold, returned, defective, lost, added, removed, set, converted in/out, adjustment sale/return, void-return, deleted, plus transfer actions reserved for multi-store. Stock-reducing and stock-increasing actions are two fixed groups. Products may have stock management off. Products may expire and expiry can block sales. A daily combined history (opening, sold, procured, defective, closing per product per unit per day) feeds the stock-history report.

**Grouped products.** A bundle of sub-items (product, unit, qty, price); selling it consumes the sub-items' stock. **Variable products.** A parent with variations, each a sellable product.

**Procurement.** Status: draft, pending, delivered, stocked. Payment: paid, unpaid. Lines carry purchase price (gross and net), tax, expiry, barcode. On delivery or stocking the product's unit-quantity stock rises and the cost basis is updated. A product can remember a default purchase unit and a scheduled reorder quantity (feeds low-stock suggestions).

**Customers.** Stored as users with a customer role. Balances: total purchases, amount owed, credit limit, account (wallet) balance, order count. Two address types (billing, shipping). Group membership. Account history ledger with operations add, deduct, refund, payment. A customer can be forced to have a valid email and a unique phone.

**Rewards.** A programme has a target and rules ("spending between A and B earns R points"). A group links to a programme. Points accumulate per customer per programme; hitting the target issues the programme's coupon.

**Coupons.** Percentage or flat; valid-until date; valid hours; min and max cart; usage limit overall and per customer; restricted to products, categories, customers or groups. Applied to an order they are tracked and counted.

**Register.** Status: closed, opened, in-use, disabled. Each opened register belongs to one cashier at a time. History actions: opening, closing, cash-in, cash-out, delete, order payment, order change, voucher, refund, account pay, account change. A balance before and after is stored on every row.

**Accounting.** Transactions have a type (direct, recurring, scheduled, entity, indirect), value, account, recurrence rule. History rows are debit or credit with status. Daily and monthly balance rows are pre-computed. An **event catalogue** (order finalized, order payment, order refund, order void, good return, damaged return, procurement receipt, procurement payment, negative and positive stock adjustment, wallet addition, wallet deduction) drives configurable **rules**: each rule is a set of lines saying "debit or credit this account (or a role such as the payment method's account) with this amount source (total, net sale, tax, COGS...)". Journals record each posting. Default accounts are chosen in settings.

**Dashboard numbers** are pre-aggregated per day and per month by background jobs, not computed on read.

**Notifications.** Stored per user, pushed over websockets when enabled; system ones warn about missing cron, disabled workers, scheduled transactions, broken storage links.

**Options.** Everything configurable is a key/value row (`ns_*` keys), with optional expiry. 256 distinct `ns_` keys are read in the code base.

---

## 8. Roles and permissions

**Roles seeded (all "locked"):** Administrator, Store Administrator, Store Cashier, Store Customer, User. A role has a name, a machine name, description, optional rewards programme, and a minimum credit payment.

**Permissions by area** (verb.resource pattern; each resource normally has create / read / update / delete):

| area | permissions |
| --- | --- |
| Orders | create, read, update, delete, void, refund, make-payment; instalments create/read/update/delete |
| POS | cart-discount, products-discount, delete-order-product, edit-purchase-price, edit-settings; use registers |
| Products | create/read/update/delete; products-units CRUD; convert units; products-labels create; products-history read; make adjustments |
| Categories | create/read/update/delete |
| Taxes | create/read/update/delete |
| Procurements | create/read/update/delete; providers create/read/update/delete |
| Customers | create/read/update/delete; customers-groups CRUD; manage account history; import customers (permission only; no UI found) |
| Coupons, Rewards | create/read/update/delete each |
| Registers | create/read/update/delete; registers-history read; use |
| Accounting | transactions CRUD; transactions-account CRUD; transactions-history read/delete; cash-flow-history |
| Payment types | manage |
| Media | see, upload, update, delete |
| Reports | sales, best sales, customers, customers-statement, inventory, low-stock, payment-types, products-report, stock-history, transactions, yearly |
| System | read.dashboard, manage.options (settings), manage.modules, manage.profile, update.core, read/create/update/delete users and roles |
| Widgets | one permission per dashboard widget |

Enforcement is by route (each API route names its permission) and again inside services. Some admin-only actions go through the approval flow (F24). I found one permission, `import.customers`, with no matching screen or endpoint.

---

## 9. Settings (observed option keys, grouped as in the product)

| page / tab | settings |
| --- | --- |
| **General: Identification** | store name, address, city, phone, email, PO box, fax, free text, square logo, rectangular logo, language, theme |
| **General: Currency** | symbol, ISO code, position (before/after), preferred form (symbol vs ISO), thousand separator, decimal separator, precision |
| **General: Date** | date format, date-time format, timezone |
| **General: Registration** | allow sign-up, default role for new users, require validation, allow password recovery |
| **POS: Features** | show quantity, merge identical items, allow wholesale price, allow decimal quantities, quick product on/off and default unit, editable unit price, preferred price tier, enabled order types, numpad, force autofocus, default barcode type, hide exhausted products, hide empty categories, protected-action approvals on/off, enable reordering, enable pinned products, show pinned preview, max pinned, barcode reader type, scale barcodes on/off |
| **POS: Layout** | layout choice, sounds on sale complete and on new item |
| **POS: VAT** | VAT mode, tax group, inclusive/exclusive |
| **POS: Registers** | registers on/off, disbursement, default payment type for change |
| **POS: Printing** | document (receipt/invoice), auto-print for, gateway |
| **POS: Shortcuts** | keys for cancel order, hold order, create customer, payment, shipping, note, order type, fullscreen, quick search, toggle merge; preset amount buttons |
| **POS: Scale barcode** | prefix, type, product-code length, value length |
| **POS: Action permissions** | grant duration, restricted features, cooldown features |
| **Orders** | code scheme, allow unpaid, allow partial, strict instalments, quotation (hold) expiry, allow incomplete |
| **Customers** | rewards on/off, force valid email, force unique phone, default customer, default group, credit on/off |
| **Invoice / receipts** | template, logo, merge similar products, show tax breakdown, show product unit, show subtotal, show payment rows, show change due, footer text, header columns A and B |
| **Accounting** | default expense accounts, default paid-expense offset account, order revenue / cash / unpaid / COGS accounts |
| **Reports** | email address for reports |
| **Workers** | enable background workers (verified by a test job) |
| **Media** | library layout |
| **Reset** | wipe all, or wipe and reseed demo |
| **About** | version and system info |
| **Registration emails** | title and body for user-registered, activation, administrator notices are stored as options; **I found no settings screen for them in the core**. SMTP is configured in the environment file only |

---

## 10. Reports

| report | inputs | content |
| --- | --- | --- |
| Sales | range; type (by products, by categories, or summary); optional cashier and categories | totals of sales, discounts, taxes, shipping, per group |
| Sales progress | range | day/week comparison |
| Sold stock | range, categories, units | quantity and value sold per product |
| Profit | range, categories | revenue minus cost of goods |
| Stock (inventory) | categories, units | current quantity and value |
| Low stock | categories, units | products at or below threshold |
| Stock history (combined) | date, categories, units | opening, sold, procured, defective, closing |
| Cash flow / account summary | range | per account debit/credit |
| Annual | year | month-by-month income, expense, taxes, etc. |
| Payment types | range | sales split by payment type |
| Customer statement | customer, range | orders, payments, account movements |
| Best products | range | ranking |
| Cashier ("my") report | current user | personal sales |

Export is CSV from list screens; reports print via the browser. **Gap against your brief:** I found no dedicated *sales by customer* report (a "customers" report permission exists but no matching route), and no *PDF/XLSX* export.

---

## 11. API

238 endpoints, token auth (bearer token created by the user in their profile), JSON. Groups: categories, customers and groups, dashboard cards, generic CRUD (list, columns, form-config, create, update, delete, export, bulk), fields and forms (server-driven form definitions), medias, modules, notifications, orders (create, update, void, refund, payments, instalments, processing and delivery status, print), permissions, procurements, products (search, units, history, adjustments, variations, conversion, reorder), providers, registers and cash-register actions, reports, reward systems, settings, taxes, transactions and accounts, units, users, roles, tokens, guides. Full list: appendix A.

Notes:
- No public API documentation was readable (docs site blocked). One short doc in the repo covers a driver order-update endpoint.
- The server drives its own forms: the frontend asks the API for a form definition and renders it. That is an architecture choice, not a requirement for us.
- A built-in MCP (AI tool) server exposes 20 tools and 5 resources. Not in your brief.
- No webhook system exists.

---

## 12. Events, hooks, jobs, integrations

**Events (169).** Before/after pairs for: login, sign-up, orders (created, updated, deleted, voided, paid, refunded, printed, status changes, per-product events), payments, coupons, taxes, procurements (and each line), products (created, updated, deleted, stock adjusted), categories, customers, customer account history, rewards, registers, transactions, balance days, dashboard days/months, modules (enabled, disabled, removed), settings saved, notifications, rendering of header/footer/forms, hard reset. These are the extension points modules use.

**Hooks (78 filter/action names).** Used to alter menus, product types, order types, payment types, welcome route, form fields and many UI parts.

**Scheduled tasks (13 fixed).** every minute: record cron heartbeat; every 5 min: detect scheduled transactions; hourly: check storage symlinks, ensure today's combined product history exists; daily: auto-stock approved procurements (00:05), detect low stock (00:02), expire held orders (14:00), track instalments due (13:00), purge temporary order storage (15:00), update check (08:00), delete expired options (only when a real queue is configured), prune dev-tool logs (debug only); weekly: clear module temp folders. On top of these, **each recurring transaction registers its own schedule** (every x minutes/hours/days, monthly on a day, month start/middle/end) when the app boots.

**Jobs (47).** Group by purpose: order side effects (refresh, record change, track coupons, save settings, resolve instalments, cashier stats up and down, customer stats up and down), stock (handle adjustment, procurement refresh and stocking, low-stock detection, category product counts, combined history by chunk), money (accounting reflection create and delete, transaction processing, delayed transactions, scheduled/recurring triggers, cash flow recompute, balance days, cash register tracking and balance), reports (day, month, year, daily initialisation, refresh), customers (reward application, owed/rewards processing, account check, payment history), system (update check, module temp clear, expired options, scheduling config check, test worker).

**Console commands (about 40).** User creation, token generation, setup, update, reset, settings, module scaffolding and management (enable, disable, delete, migrate, symlink, make controller/model/job/event/listener/mail/request/settings), CRUD scaffolding, fake data generators (products, categories, transactions, activity simulator), translation tools (extract, sync, machine-translate), doctor (health check), env editor, session cookie reset.

**Realtime.** Notifications broadcast over a websocket server (Reverb or Pusher). Wireless barcode pairing appears to use a socket.io relay (inferred from the client dependency and page names).

**Integrations and externals (all out of scope unless you say otherwise):**
- NexoPOS marketplace and OAuth login to the vendor's site (module purchase and download)
- Update check against GitHub; telemetry call to the vendor
- Mailgun/SMTP for mail
- Paid modules (not in this repo): Gastro (restaurant/tables/kitchen), MultiStore, PIN login, Google Authenticator 2FA, Bulk Editor, Rental, Sales Commissions, WorkForce, BellSera, QR Menu, Print Server adapter, Options export/import, AI agent, Quick store configuration

**Module system.** A module is a folder with a manifest, a service provider, routes, migrations, views, assets, config. Core provides: upload (zip), dependency check, enable/disable with migration run/revert, symlinked public assets, per-module settings pages, and the whole event/hook surface above. A scaffold command generates module skeletons.

---

## 13. Components (UI vocabulary, for replica-design)

Inputs: text, number, textarea, select, multiselect, search-select, switch, checkbox, date, date-time, date-range, rich text editor, media picker, numpad (two kinds), audio picker.
Layout: tabs, wizard, notice, spinner, avatar, paginator, calendar.
Data: server-driven table (sort, filter, bulk), form builder.
Overlay: popup stack (confirm, prompt, alert, select, numpad, loading).
Charts: bar/line (orders), cards. Drag-and-drop for widget layout, category/product ordering, media.
Cross-cutting: dark and light themes, RTL, tablet/touch layout, hotkeys on POS, guided tours.

---

## 14. Your brief vs the NexoPOS core (parity gaps)

Legend: **core** = in the repo and I verified it. **partial** = some of it. **absent** = not in the open-source core. **module** = sold separately by the vendor.

| your brief | in NexoPOS core? | note |
| --- | --- | --- |
| Product grid, search, barcode scan, categories | core | plus pinned products, custom ordering, wireless scanner |
| Cart qty/unit/unit-quantity, price override | core | price override is permission-gated |
| Line and cart discounts; coupons | core | |
| Taxes inclusive and exclusive | core | |
| Hold, resume, void | core | held orders expire on a schedule |
| Split/multiple payments, partial, instalments, change | core | |
| Customer select and quick-create, billing/shipping | core | |
| **Order type: dine-in** | **module** | core only has takeaway and delivery. Dine-in comes with Gastro (tables, waiters, kitchen), which is paid and not in this repo |
| Receipt and invoice print, notes, order-level settings | core | |
| Cash register open/close, cash in/out, history | core | plus Z-report |
| Session balancing | core | difference stored on close |
| Products: simple, grouped, variable, units/groups/conversions | core | |
| SKU and barcode generation | core | several barcode types |
| Stock tracking, low-stock alerts | core | alerts as notifications and a report |
| Stock adjustments, history, damaged/defective | core | |
| **Product import** (CSV) | **absent** | CSV *export* exists on list screens. No product import found. A customer-import permission exists with no screen |
| Labels and barcode printing | core | |
| Taxes and tax groups | core | |
| Providers, procurements, receiving, payment status | core | |
| **Purchase-price history** | partial | prices are stored per procurement line and per product history; I did not find a dedicated "price history" screen |
| Orders list with filters; refunds/returns with restock | core | restock applies to "good" condition lines only |
| Customer accounts and balances, groups | core | |
| Rewards/loyalty, coupons | core | |
| Customer account history | core | |
| Expenses, categories, **recurring** | core | "categories" are accounts in a chart; recurring supported |
| Transaction accounts and history; payment types | core | |
| Reports: sales (daily, product, category, cashier) | core | cashier is a filter |
| Reports: **by customer** | **partial** | customer statement exists; a by-customer sales report does not |
| Reports: profit, stock, inventory, low stock, payment types, cash flow, annual | core | |
| Reports: export **or** print | partial | browser print; CSV only on list screens; no PDF/XLSX download of reports |
| Users, roles, granular permissions | core | |
| Settings: general, POS, orders, customers, invoices/receipts, workers, reports, accounting | core | |
| **Settings: email and notifications** | **partial/absent** | registration-email templates exist as stored options; no settings screen found; SMTP is an environment file matter |
| Multi-language and RTL | core | 13 languages, Arabic RTL |
| Themes and dark mode | core | |
| Dashboard with widgets, notifications | core | |
| **Activity log** | **absent** | there is a fake-activity simulator for demos, not an audit log. Order and stock histories are the nearest thing |
| Modules/plugin architecture, hooks, events | core | |
| REST API with token auth | core | |
| **Webhooks** | **absent** | |
| Scheduled jobs and queues | core | |
| Installation wizard | core | |
| **Backups** | **absent** | a snapshot library is a dependency and configured in storage settings, but I found no route, screen or command that uses it |
| Migrations | core | including module migrations and an upgrade screen |
| Tablet/touch UI | core | |
| POS keyboard shortcuts | core | configurable keys |
| Money in integer cents / decimal | n/a | original: decimal(18,5) and a big-decimal library |

Things NexoPOS core has that your brief does not list (kept in `features.csv` as "could"): scale/weighed-product barcodes with PLU ranges, wireless phone scanner, pinned products, quick (ad-hoc) product, protected-action approval flow, accounting rules engine and journals, wallet/deposit accounting, per-user dashboard layouts, guided tours, media library, hard reset with demo data, doctor command, MCP/AI server.

---

## 15. Ambiguities and decisions I need from you

Marked in the order they block work. I have assumed none of these.

1. **Licence and clean-room posture.** (a) Release the new app as GPL-3.0 (no residual risk, can be sold, but source must be shared with buyers). (b) Closed licence, accept the residual risk after a clean-room process (I stop reading NexoPOS source; a separate session builds only from the spec files). (c) Closed licence and take legal advice first. Which?
2. **Stack.** The Step 3 placeholder was never filled in. Options I would propose: Laravel + Vue (mirrors the original, fastest to parity, but nearest to the original's shape), or Next.js + Postgres + Prisma (clean break, one language). Preference?
3. **Dine-in order type.** Not in the core. Do you want (a) a simple dine-in type (table label on the order, no kitchen screens) or (b) a full restaurant module (tables, waiters, kitchen display) later?
4. **Items your brief lists that NexoPOS core lacks:** product CSV import, webhooks, backups, activity log, email/notification settings screen, sales-by-customer report, PDF/XLSX report export. Build them all as additions (my default recommendation, they are small next to the rest), build some, or hold to strict parity?
5. **Multi-store, paid modules, vendor marketplace, telemetry, update check, AI/MCP server.** I assume all out of scope. Confirm?
6. **Rounding rule.** The brief wants tax, discount and rounding covered by unit tests. The original's rule (round per line or per order, half-up or half-even) is not yet established from the code. Do you have a jurisdiction (the account email suggests Australia, which has 10% GST and 5-cent cash rounding)? If so I will specify to that and treat NexoPOS as secondary.
7. **Deployment target.** Single store self-hosted (like the original), or hosted SaaS with several tenants? This changes the data model.
8. **Currency, tax and language defaults** for seed data and the first locale.
9. **Documentation site.** Allow `my.nexopos.com` in the sandbox network policy so I can cross-check behaviour against the docs, or proceed from the repo alone?
10. **Name.** Do you have one? Otherwise I use a working title until `/replica-brand`.

---

## 16. Out of scope (cannot or should not be cloned)

- The NexoPOS name, logo, marketing images, demo data files (the furniture and kitchen product JSON), email wording, and the 13 translation files
- The vendor marketplace, its OAuth, licences and paid modules' code
- Telemetry to the vendor
- Anything that exists only in the vendor's hosted offers (cloud deploy, Windows apps)

## 17. Size

Screens 114 (more once settings pages and popups are counted individually), flows 24, entities about 70 tables, about 240 API endpoints.
Hard parts: (1) the order engine (tax x discount x unit x coupon x partial payment x refund, all consistent to the cent), (2) the stock ledger with units, conversion, grouped and variable products, (3) the accounting rules engine and the register ledger, (4) the POS UI on touch plus keyboard, (5) the module/hook system.
**Size: XL as a single project.** It is realistic as phased work if the vertical slice (sign-in, products, POS checkout, orders and payments) ships first and later phases are ticked off against `features.csv`. Expect many sessions, not one.
