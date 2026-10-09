/**
 * Read-only PROD screenshot capture.
 *
 * Runs AGAINST PROD (https://oliradlett.co.uk/fittrack) with the
 * storageState saved by auth.setup.ts. Takes full-page screenshots for
 * every route in routes.manifest.ts at desktop (1440x900) + mobile
 * (390x844) into screenshots/prod/<viewport>/<slug>*.png.
 *
 * SAFETY (read-only contract — t2):
 *  - Only GETs/navigations. Any request with a mutating method
 *    (POST/PATCH/PUT/DELETE) to /api/** is ABORTED by the guard below,
 *    so even a stray component auto-save cannot write to prod.
 *  - No clicks on Generate/Save/Merge/Sync/Connect/Log buttons — the spec
 *    only performs GET navigations + client-side tab switches.
 *  - Never points a local frontend at the prod API; never copies the prod
 *    DB. This spec drives the real prod frontend in the cloud.
 *
 * Run (after `npm run test:prod-shots:auth` once):
 *   npm run test:prod-shots            # headless, all routes, both viewports
 *   VIEWPORT=desktop npx playwright test --config=playwright.prod-shots.config.ts
 *   SHOT_FILTER=08-lifting npx playwright test --config=playwright.prod-shots.config.ts
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PROD_SHOT_TARGETS } from './routes.manifest';

const OUT_ROOT = path.join(__dirname, '..', '..', '..', 'screenshots', 'prod');
const SHOT_FILTER = process.env.SHOT_FILTER ?? ''; // substring match on slug, e.g. SHOT_FILTER=08-lifting

const targets = PROD_SHOT_TARGETS.filter(
  (t) => !SHOT_FILTER || t.slug.includes(SHOT_FILTER),
);

// Fail fast with a clear message when storageState is missing/expired:
// unauthenticated prod bounces to the public login page (AppLayout).
test.beforeEach(async ({ page }) => {
  // ── READ-ONLY GUARD: abort every mutating API call ──────────────────
  await page.route('**/api/**', (route) => {
    const method = route.request().method().toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      console.warn(`[read-only guard] blocked ${method} ${route.request().url()}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  // First-run overlays must not cover prod shots (same keys as mocked E2E).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fittrack-onboarding-done', 'true');
      localStorage.setItem('fittrack-routes-tips', 'done');
      localStorage.setItem('fittrack-install-dismissed', String(Date.now()));
    } catch {
      /* ignore */
    }
  });
});

for (const target of targets) {
  test(`${target.slug} ${target.path}`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const isLogin = target.slug === '00-login';

    // Project split: `login-no-auth*` captures ONLY the public login page
    // (no storageState); desktop/mobile capture everything else.
    const isNoAuthProject = project.startsWith('login-no-auth');
    if (isNoAuthProject && !isLogin) {
      test.skip(true, 'no-auth project captures only the login page');
    }
    if (!isNoAuthProject && isLogin) {
      test.skip(true, 'login shot belongs to the no-auth project');
    }

    await page.goto(target.path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // networkidle settles Recharts/Leaflet; tiles are real on prod so allow
    // a generous window but never fail the suite on it.
    await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(isLogin ? 1500 : 2000);

    const viewportDir = page.viewportSize()?.width === 390 ? 'mobile' : 'desktop';
    const dir = path.join(OUT_ROOT, viewportDir);
    fs.mkdirSync(dir, { recursive: true });

    if (isLogin) {
      // Public page: no auth guard, no tabs — single shot.
      await page.screenshot({ path: path.join(dir, `${target.slug}.png`), fullPage: true });
      return;
    }

    // Guard: bounced to login => storageState expired. Fail loudly so t3
    // re-runs auth.setup.ts instead of screenshotting the login page 18x.
    if (/\/fittrack\/?(\?.*)?$/.test(new URL(page.url()).pathname + new URL(page.url()).search) &&
        (await page.getByRole('button', { name: /sign in/i }).count()) > 0) {
      throw new Error(
        `Not authenticated on prod for ${target.path} — re-run 'npm run test:prod-shots:auth'.`,
      );
    }
    // Page-ready signal: first heading inside <main>. Most pages render an
    // h1; Notifications uses CardTitle (an h3), so accept any heading level.
    await expect(page.locator('main :is(h1, h2, h3)').first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({ path: path.join(dir, `${target.slug}.png`), fullPage: true });

    // Tab states: client-side switches only (no navigation, no writes).
    for (const tab of target.tabs ?? []) {
      const tabBtn = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
      if ((await tabBtn.count()) === 0) continue;
      await tabBtn.click();
      await page.waitForTimeout(1500);
      const safe = tab.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await page.screenshot({
        path: path.join(dir, `${target.slug}--tab-${safe}.png`),
        fullPage: true,
      });
    }
  });
}
