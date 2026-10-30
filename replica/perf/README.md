# Device speed: how to measure the real tablet

The numbers in this folder come from the build sandbox: a 4-core server CPU with 16 GB of RAM, running headless Chromium, with the processor slowed down by Chromium's CPU throttling (4x and 6x) to *imitate* a slow device. **Throttling slows JavaScript and WebAssembly. It does not slow storage, memory or the real chip, so it is only a rough lower bound. It is not a measurement of any tablet.** Only the real device can answer the question.

## Run it on the tablet (about 3 minutes)

1. Put the built app (`app/out/`) on any web server the tablet can reach, or use the shop's mini PC. Any static host works.
2. On the tablet, open the address in **Chrome**. Install it to the home screen if offered (this also affects how long the browser keeps the data).
3. Choose **Start a new store**, set a PIN, then open **Device speed** in the menu.
4. Leave **Number of products** at 2,000 and **Storage mode** on *Write-behind (what the app uses)*. Tap **Run the test** and stay with it until it finishes (see step 7).
5. Tap **Copy results** (or **Download results**) and send me the text. Do it a second time with **10,000** products if the shop's catalogue is that large.
6. For a fair comparison also run once with **Strict** storage and send that too.
7. Keep touching the screen now and then during a long run: the app locks itself after the idle time (default 5 minutes) and a lock ends the test.

The test uses a separate temporary database. It never touches the shop's real data and deletes itself when done.

## What the numbers mean

| field | what it is | what I need to see on the tablet |
| --- | --- | --- |
| `ms.checkoutMedian`, `checkoutP95` | how long the cashier waits for a two-line sale to go through | about 100 ms or less median, 300 ms or less at p95 |
| `ms.checkoutDurableMedian`, `checkoutDurableP95` | the same sale plus the wait until it is safely in browser storage (what the customer sees before "paid") | about 400 ms or less median, 800 ms or less p95 |
| `ms.commitMedian` | one committed write, strict | context for the two lines above |
| `ms.gridFirst60Median`, `searchNameMedian`, `scanBarcodeMedian` | showing the product grid, typing a search, scanning a barcode | each 150 ms or less |
| `ms.engineStart` + `ms.migrate` | opening the database each time the app starts | under 5 s |
| `ms.pbkdf2_100k` | cost of unlocking with the PIN | under 300 ms (otherwise I lower the PIN strength setting for that tablet) |
| `ms.logicalExport`, `physicalBackup` | time for a backup | under 20 s |
| `device.heapUsedMb`, `device.memoryGb` | memory | heap under about 400 MB on a 3 to 4 GB tablet |

These targets are **provisional**: they are my proposal for the budget, to be agreed once we have one real tablet reading.

## Files here

`sandbox-<slowdown>x-<products>-<storage>.json` are the sandbox runs, each with the full result. `summary.md` is the table built from them.
