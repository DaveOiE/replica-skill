import { defineConfig } from '@playwright/test';
// PW_CHROMIUM points at a Chromium already on the machine (the build sandbox has one); CI downloads Playwright's own.
// The device-speed baseline is slow and CPU-sensitive, so it only runs when asked: PERF=1 npx playwright test e2e/perf.spec.ts
export default defineConfig({
  testDir: 'e2e', timeout: 120_000, workers: 1, retries: process.env.CI ? 1 : 0, reporter: [['list']],
  testIgnore: process.env.PERF ? [] : ['**/perf.spec.ts'],
  use: { baseURL: 'http://127.0.0.1:3100', launchOptions: { ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}), args: ['--no-sandbox'] } },
  webServer: [
    { command: 'node e2e/static-server.mjs', url: 'http://127.0.0.1:3100/', reuseExistingServer: false, timeout: 30_000 },
    { command: 'npx tsx e2e/start-sync.ts', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false, timeout: 60_000 },
  ],
});
