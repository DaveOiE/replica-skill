// Device speed baseline. Runs the in-app benchmark (the same one you can open at /bench/ on a real tablet) under
// Chromium CPU throttling. THROTTLING IS AN EMULATION: it slows JavaScript and WebAssembly execution but not memory,
// storage or the real hardware. Treat these as a lower bound on a slow tablet, never as a measurement of one.
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { openApp, newStore } from './helpers';

const rssMb = (): number => {
  try {
    const out = execSync("ps -eo rss,args | grep -i 'pw-browsers' | grep -v grep | awk '{s+=$1} END {print s}'").toString().trim();
    return Math.round(Number(out) / 1024);
  } catch { return -1; }
};

const RUNS: { throttle: number; products: number; mode: 'relaxed' | 'strict' }[] = [
  { throttle: 1, products: 2000, mode: 'relaxed' }, { throttle: 1, products: 2000, mode: 'strict' },
  { throttle: 4, products: 2000, mode: 'relaxed' }, { throttle: 6, products: 2000, mode: 'relaxed' },
  { throttle: 1, products: 10000, mode: 'relaxed' }, { throttle: 4, products: 10000, mode: 'relaxed' },
];

for (const r of RUNS) {
  test(`device speed: ${r.products} products at ${r.throttle}x CPU slowdown, ${r.mode} storage`, async ({ browser }) => {
    test.setTimeout(900_000);
    const ctx = await browser.newContext(); const p = await openApp(ctx);
    const t0 = Date.now();
    await newStore(p);
    const coldStartMs = Date.now() - t0;
    const rssIdle = rssMb();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: r.throttle });
    await p.getByRole('link', { name: 'Device speed' }).click();
    await p.getByTestId('bench-n').selectOption(String(r.products));
    await p.getByTestId('bench-durability').selectOption(r.mode);
    await p.getByTestId('bench-run').click();
    await expect(p.getByTestId('bench-result')).toBeVisible({ timeout: 800_000 });
    const result = JSON.parse((await p.getByTestId('bench-result').textContent())!);
    const rssAfter = rssMb();
    const out = { emulation: { cpuSlowdown: r.throttle, note: 'Chromium CPU throttling on a server CPU; not a real tablet' }, coldStartToReadyMs: coldStartMs, browserRssMb: { idleAfterSetup: rssIdle, afterBenchmark: rssAfter }, ...result };
    mkdirSync('../replica/perf', { recursive: true });
    writeFileSync(`../replica/perf/sandbox-${r.throttle}x-${r.products}-${r.mode}.json`, JSON.stringify(out, null, 2));
    console.log(`PERF ${r.throttle}x/${r.products}/${r.mode}: ` + JSON.stringify({ coldStartMs, rssIdle, rssAfter, ...result.ms }));
    await ctx.close();
  });
}
