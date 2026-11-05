import { defineConfig, devices } from '@playwright/test';

/**
 * Calendar-only production-surface harness. The Next dev server is started
 * manually on 3100 so this worktree never reuses another checkout's server on
 * 3000; all API calls are mocked by e2e/fixtures/authenticated-test.ts.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /calendar.*\.(spec|gate)\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100/fittrack',
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
  ],
});
