# Device speed: sandbox results

**These are not tablet measurements.** They come from a 4-core server CPU with 16 GB of RAM running headless Chromium. The "4x" and "6x" columns slow Chromium's JavaScript and WebAssembly down to *imitate* a weaker device. That does not slow storage, memory or the real chip, so it is a rough lower bound at best. A real low-end Android tablet (3 to 4 GB RAM) and an N100 mini PC have **not** been measured. `README.md` in this folder explains how to run the same test on the tablet in about 3 minutes.

Raw results: `sandbox-<slowdown>x-<products>-<storage>.json`. Each run: new store, catalogue of N products, 100 two-line sales.

## Results

| measure (ms, median unless noted) | target (provisional) | 1x, 2,000 | 4x, 2,000 | 6x, 2,000 | 1x, 10,000 | 4x, 10,000 | 1x, 2,000, flush after every statement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| sale shown to cashier | 100 (p95 300) | **23** (p95 31) | 169 (p95 213) | 320 (p95 416) | 33 (p95 39) | 265 (p95 338) | 504 (p95 600) |
| sale safely stored ("paid") | 400 (p95 800) | **163** (p95 208) | 697 (p95 872) | 1,301 (p95 1,511) | 195 (p95 223) | 1,189 (p95 1,315) | 680 (p95 785) |
| show first 60 products | 150 | 74 | 436 | 792 | 380 | **2,716** | 140 |
| search by name | 150 | 26 | 140 | 312 | 183 | **1,271** | 80 |
| scan a barcode | 150 | 16 | 90 | 175 | 36 | 241 | 63 |
| open database at start (engine + migrate) | under 5,000 | 4,156 | 15,054 | 29,124 | 4,103 | 18,988 | 5,060 |
| first-ever start, to ready | | 6,095 | 6,398 | 8,075 | 5,990 | 7,936 | 6,674 |
| unlock with PIN (PBKDF2 100k) | 300 | 50 | 82 | 51 | 47 | 45 | 52 |
| logical backup export | 20,000 | 471 | 2,793 | 4,288 | 3,501 | **20,325** | 630 |
| physical backup | 20,000 | 935 | 4,744 | 7,992 | 1,570 | 8,907 | 1,266 |
| JS heap used (MB) | about 400 | **729** | 733 | 733 | **933** | 628 | 739 |
| whole browser, memory after run (MB) | | 1,619 | 1,620 | 1,576 | 1,540 | 1,536 | 1,657 |

Bold marks a clear miss or the one number to watch.

## What the numbers say

1. **Saving a sale is fixed on a fast CPU and still marginal on a slow one.** Write-behind (section 2.11 of the plan) takes a durable sale from about 680 ms to about 163 ms at 1x, and the cashier sees the result in about 23 ms. But the "safely stored" figure scales with CPU: about 700 ms at 4x and 1.3 s at 6x. If the real tablet behaves like 4x or worse, the durable time misses the 400 ms target. The storage layer rescans files on every write, which is the thing to attack next (OPFS spike, plan 2.11).
2. **The product grid and search are too slow at 10,000 products on a slow CPU** (2.7 s and 1.3 s at 4x). This is expected: no indexes are tuned yet, and the grid reads from the database each time. The plan already has "indexes for the grid and search" and a cached in-memory product list in Phase 2. It is a known gap, not a surprise.
3. **Memory is the number I am most worried about.** The JS heap is 630 to 930 MB (729 MB with 2,000 products, 628 to 933 MB with 10,000; it varies with when the garbage collector last ran), against a provisional budget of about 400 MB for a 3 to 4 GB tablet, and the whole browser sits at 1.1 to 1.6 GB. Headless desktop Chromium is not a tablet browser and these include the engine's own memory, so the figure may differ on Android, but if it does not, a 3 GB tablet may run short. **Only the real tablet can settle this.** If it fails there, the options are a lighter engine configuration, smaller caches, or the Tauri wrapper on PCs.
4. **PIN unlock time barely changes with throttling** because PBKDF2 runs in the browser's native crypto, which CPU throttling does not slow. On a real tablet with a slow chip it will be slower; the number above should not be read as a tablet figure.
5. **First-ever start is about 6 to 8 s** (compile the engine, create and migrate the database). Later starts, which open an existing database, are 4 s at 1x and 15 to 29 s at 4x to 6x. That is poor on a slow device and is on the list to improve (cache the compiled engine, lazy-run migrations only when the schema changed).
6. **Bulk loading 10,000 products takes 14 s at 1x and 150 s at 4x.** Fine for a one-off import with a progress bar; it must not run on the main thread in the real import (Phase 2).

## How these were produced, and one lesson

The first attempt at the slower runs showed a blank result after about 6 minutes. The cause was the app's own **inactivity lock** (it listens for touches and key presses): a long benchmark with nobody touching the screen locked the app, which unmounted the benchmark screen. The test now sends a touch event while it waits. It is also a small product point: a long-running task such as a large import or a backup must count as activity or hold the lock off. That goes on the Phase 2 list.

Runs ranked by CPU slowdown, same code, same machine:

```
PERF=1 PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test e2e/perf.spec.ts --workers=1
```
