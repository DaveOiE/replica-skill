import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Uses the Chromium already installed in the cloud image when present; otherwise Playwright's own.
const local = ['/opt/pw-browsers/chromium/chrome-linux/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
export default defineConfig({
  testDir: 'app/e2e', timeout: 30000, reporter: 'line',
  webServer: { command: 'node --no-warnings app/e2e/serve.mjs', url: 'http://127.0.0.1:4010/api/v1/health', reuseExistingServer: false, timeout: 20000 },
  use: { launchOptions: local ? { executablePath: local } : {} },
});
