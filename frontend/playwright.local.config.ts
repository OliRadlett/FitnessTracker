import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright against a locally started instance on a non-default port.
 *
 * `playwright.config.ts` hardcodes `port: 3000` with `reuseExistingServer: true`,
 * so on a machine where another checkout is already serving :3000 the suite
 * silently tests *that* build. This config has no webServer: start the app
 * yourself (`npx next start -p 3010`) and point the suite here.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3010/fittrack',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
});
