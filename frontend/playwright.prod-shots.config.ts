import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * Standalone Playwright config for the PROD screenshot pipeline (t2).
 *
 * Deliberately SEPARATE from playwright.config.ts:
 *  - different baseURL (real prod, not localhost/Caddy),
 *  - no webServer (must NEVER build/serve local frontend for prod shots),
 *  - no API mocks (shots show real prod data),
 *  - storageState auth (headed manual OAuth once, headless reuse after).
 *
 * Run from frontend/:
 *   npm run test:prod-shots:auth   # headed, manual OAuth, saves storageState (once)
 *   npm run test:prod-shots        # headless capture, desktop + mobile
 */
const PROD_BASE = process.env.PROD_BASE_URL ?? 'https://oliradlett.co.uk/fittrack';
const AUTH_FILE = path.join(__dirname, 'e2e', 'prod-shots', '.auth', 'storageState.json');

export default defineConfig({
  testDir: './e2e/prod-shots',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0, // read-only: never retry-storm prod
  workers: 1, // sequential, minimal prod load
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: PROD_BASE,
    storageState: AUTH_FILE,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      // The setup step CREATES the storageState — it must not require it.
      // Uses the real installed Edge (not bundled Chromium) because Google
      // OAuth rejects automated browsers ("browser may not be secure").
      use: {
        storageState: { cookies: [], origins: [] },
        channel: 'msedge',
        launchOptions: {
          args: ['--disable-blink-features=AutomationControlled'],
        },
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      dependencies: [],
      testIgnore: /auth\.setup\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testIgnore: /auth\.setup\.ts/,
    },
    {
      // Public login page only — runs WITHOUT storageState (desktop).
      name: 'login-no-auth',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: { cookies: [], origins: [] },
      },
      testMatch: /prod-shots\.spec\.ts/,
    },
    {
      // Public login page only — runs WITHOUT storageState (mobile).
      name: 'login-no-auth-mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        storageState: { cookies: [], origins: [] },
      },
      testMatch: /prod-shots\.spec\.ts/,
    },
  ],
});
