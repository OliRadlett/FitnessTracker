import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Overridable for CI, which serves the production build directly
    // (PLAYWRIGHT_BASE_URL=http://localhost:3000/fittrack). Default is the
    // local Caddy stack. API calls stay mocked either way — no backend needed.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost/fittrack',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    // No service workers in E2E: the update banner (controllerchange on
    // first claim) overlays fresh profiles and eats clicks in CI.
    serviceWorkers: 'block',
  },
  // CI has no stack running: build + serve production Next.js. Locally this
  // reuses the already-running dev server / Caddy instead.
  webServer: {
    command: 'npm run build && npm run start -- --port 3000',
    port: 3000,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      ...process.env as Record<string, string>,
      NEXT_PUBLIC_API_URL: '',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
