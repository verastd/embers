import { defineConfig, devices } from '@playwright/test';

/** Overridable so several worktrees can run e2e at once. */
const PORT = Number(process.env.E2E_PORT ?? 3410);
const STUB = Number(process.env.E2E_STUB_PORT ?? 4010);
/** Test-only secret; also used by e2e/auth.spec.ts to seal sessions. */
export const E2E_SESSION_SECRET = 'e2e-session-secret-0123456789abcdef0123';

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
      env: {
        LEDGER_URL: `http://127.0.0.1:${STUB}/v1`,
        EMBERS_DIST_DIR: '.next-e2e',
        EMBERS_SESSION_SECRET: E2E_SESSION_SECRET,
        EMBERS_PUBLIC_ORIGIN: `http://localhost:${PORT}`,
        // A fake app: the sign-in redirect is testable; GitHub itself is never reached.
        GITHUB_CLIENT_ID: 'Iv1.e2e0000000000000',
        GITHUB_CLIENT_SECRET: 'e2e-fake-client-secret',
      },
      port: PORT,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
