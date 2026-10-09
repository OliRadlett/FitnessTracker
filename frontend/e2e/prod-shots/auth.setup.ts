/**
 * One-time headed login for the PROD screenshot pipeline.
 *
 * Run:  npx playwright test --config=playwright.prod-shots.config.ts --headed auth.setup.ts
 *   (or `npm run test:prod-shots:auth` from frontend/)
 *
 * What it does:
 *  1. Opens https://oliradlett.co.uk/fittrack in a HEADED browser.
 *  2. Waits for the operator (you) to complete Google/GitHub OAuth +
 *     the email-allowlist gate MANUALLY in that window.
 *  3. Detects arrival at an authenticated (app) route and saves
 *     `e2e/prod-shots/.auth/storageState.json` for headless reuse.
 *
 * What it NEVER does: no credentials are typed or stored by the script,
 * no API calls are made directly, no local frontend is pointed at prod.
 * The storageState file is gitignored (see .gitignore) — never commit it.
 */

import { test as setup } from '@playwright/test';
import * as path from 'path';

const AUTH_FILE = path.join(__dirname, '.auth', 'storageState.json');
const PROD_BASE = process.env.PROD_BASE_URL ?? 'https://oliradlett.co.uk/fittrack';

setup('manual prod login (headed, operator completes OAuth)', async ({ page }) => {
  await page.goto(PROD_BASE, { waitUntil: 'domcontentloaded' });

  console.log('\n==============================================================');
  console.log('  PROD login required in the opened browser window.');
  console.log('  1. Click Sign in with Google (or GitHub).');
  console.log('  2. Finish OAuth + allowlist in that window.');
  console.log('  3. Wait — this script detects the dashboard and saves state.');
  console.log('==============================================================\n');

  // Authenticated (app) routes render <main><h1>; the public login page does
  // not. Poll for any known authed route for up to 10 minutes (OAuth is slow).
  await page.waitForURL(/\/fittrack\/(dashboard|today|calendar|activities)/, {
    timeout: 10 * 60_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(2000);

  await page.context().storageState({ path: AUTH_FILE });
  console.log(`Saved storageState → ${AUTH_FILE}`);
});
