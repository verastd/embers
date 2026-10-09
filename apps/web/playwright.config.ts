import { defineConfig, devices } from '@playwright/test';

const PORT = 3410;
const STUB = 4010;

/**
 * PRD 5.9 / 12: every page under Slow 3G shows a loading indicator within
 * 100 ms of each action, an error state for a 500 and an empty state for an
 * empty payload. The app runs against a stub ledger (e2e/stub-ledger.mjs)
 * serving the captured examples, so the BFF path is exercised end to end.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: `node e2e/stub-ledger.mjs`, env: { STUB_LEDGER_PORT: String(STUB) }, port: STUB, reuseExistingServer: false },
    {
      command: `pnpm exec next dev --port ${PORT}`,
      env: { LEDGER_URL: `http://127.0.0.1:${STUB}`, EMBERS_DIST_DIR: '.next-e2e' },
      port: PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
