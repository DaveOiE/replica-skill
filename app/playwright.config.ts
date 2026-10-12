import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 120_000, workers: 1, retries: 0, reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3100', launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] } },
  webServer: [
    { command: 'node e2e/static-server.mjs', url: 'http://127.0.0.1:3100/', reuseExistingServer: false, timeout: 30_000 },
    { command: 'npx tsx e2e/start-sync.ts', url: 'http://127.0.0.1:4100/health', reuseExistingServer: false, timeout: 60_000 },
  ],
});
