/**
 * Relive 3D visual baselines (Phase 0 of the quality rebuild).
 *
 * Renders the real Replay3D in the offline /dev/replay harness with fully
 * synthetic fixtures (no real activity data, no auth, no backend) served via
 * request mocking, waits for the tile-loading overlay to clear, then takes
 * Playwright screenshot assertions against committed baselines.
 *
 * - Terrain ON (default) so the DEM bed path is exercised; satellite imagery
 *   forced OFF via localStorage for determinism (Esri tiles are slow/flaky).
 * - 2 synthetic rides: hilly/clear (exercises drape + z-exaggeration) and
 *   flat/rainy (exercises the weather-darkened lighting path).
 * - Desktop viewport runs the full composer; the mobile viewport auto-enables
 *   Lite mode via matchMedia, covering both render paths.
 *
 * Regenerate baselines after an intentional visual change, review the diff,
 * then commit the PNGs:
 *   npx playwright test e2e/replay-visual.spec.ts --update-snapshots
 */

import { test, expect, type Page } from '@playwright/test';
import {
  VISUAL_DAY,
  VISUAL_FLAT_RAINY,
  VISUAL_HILLY,
  VISUAL_NIGHT,
} from './fixtures/replay-visual-fixtures';

// Locally the stack is served by Caddy over local TLS on dev.oliradlett.co.uk
// (https://localhost answers nothing — that default only fits CI, which sets
// PLAYWRIGHT_BASE_URL). Mirror the config's env override here.
test.use({
  baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://dev.oliradlett.co.uk/fittrack',
});

test.describe.configure({ mode: 'serial' });

const FIXTURES = {
  hilly: VISUAL_HILLY,
  flat: VISUAL_FLAT_RAINY,
  day: VISUAL_DAY,
  night: VISUAL_NIGHT,
} as const;

async function gotoHarness(page: Page, fixture: keyof typeof FIXTURES, cam: 'chase' | 'cockpit' = 'chase') {
  // Satellite off: Esri tiles are slow and non-deterministic; terrain stays on.
  await page.addInitScript(() => {
    window.localStorage?.setItem('relive:imagery', 'off');
  });
  // Forward app diagnostics so terrain failures are visible in the log.
  page.on('console', (m) => {
    if (m.text().includes('[Replay3D]')) console.log('BROWSER ' + m.text().slice(0, 200));
  });
  // Serve the same synthetic fixture for both harness slots so the first ride
  // is already the one under test (no post-load switching races). Slot-specific
  // ids — duplicate React keys break the harness ride buttons.
  const base = FIXTURES[fixture];
  await page.route('**/dev-fixtures/*.json', async (route) => {
    const slot = route.request().url().includes('act2') ? '-b' : '-a';
    const body = { ...base, id: `${base.id}${slot}` };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const t0 = Date.now();
  const mark = (s: string) => console.log(`[visual] T+${Math.round((Date.now() - t0) / 1000)}s ${s}`);
  await page.goto('/fittrack/dev/replay');
  // WebGL canvas must exist (SwiftShader in headless chromium).
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  mark('canvas visible');
  // Park the camera in a follow mode BEFORE terrain lands: the auto-orbit drifts
  // with wall-clock time, so orbit screenshots can never match run to run.
  // Follow cams converge from the fixed home pose to a static frame at t=0
  // (not playing). Button labels render lowercase, so match case-sensitively.
  await page.getByRole('button', { name: cam, exact: true }).click({ timeout: 30_000 });
  mark(`${cam} clicked`);
  // Tile-loading overlay clears (aria-hidden flips to true) once terrain is on.
  await expect(page.getByTestId('replay-loading-overlay')).toHaveAttribute('aria-hidden', 'true', {
    timeout: 100_000,
  });
  mark('overlay hidden');
  // The DEM bed must be attached AND STABLE. The overlay clears on 'failed'
  // too, and the first attach triggers a drape rebuild that destroys the mesh
  // and refetches — a single present-check can land mid-rebuild. Require 3 s
  // of continuous presence before trusting the scene.
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __relive?: { sceneRef?: { current?: { terrain?: unknown } } };
        __terrainStableSince?: number;
      };
      const has = Boolean(w.__relive?.sceneRef?.current?.terrain);
      const now = Date.now();
      if (!has) {
        w.__terrainStableSince = 0;
        return false;
      }
      if (!w.__terrainStableSince) w.__terrainStableSince = now;
      return now - w.__terrainStableSince > 3000;
    },
    { timeout: 90_000, polling: 500 },
  );
  mark('terrain stable');
  // Let the chase transition converge from the fixed home pose to its static
  // frame (exponential lerp — 5 s settles it past pixel tolerance).
  await page.waitForTimeout(5000);
  mark('screenshotting');
}

test.describe('replay visual baselines', () => {
  test.setTimeout(300_000);

  test('hilly ride, full composer', async ({ page }) => {
    await gotoHarness(page, 'hilly');
    await expect(page).toHaveScreenshot('replay-hilly-full.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });

  test('flat rainy ride, full composer', async ({ page }) => {
    await gotoHarness(page, 'flat');
    await expect(page).toHaveScreenshot('replay-flat-rainy-full.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });

  test('hilly ride from the cockpit, full composer', async ({ page }) => {
    await gotoHarness(page, 'hilly', 'cockpit');
    await expect(page).toHaveScreenshot('replay-cockpit-full.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });

  test('hilly ride at solar noon, full composer', async ({ page }) => {
    await gotoHarness(page, 'day');
    await expect(page).toHaveScreenshot('replay-day-full.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });

  test('hilly ride at night, full composer', async ({ page }) => {
    await gotoHarness(page, 'night');
    await expect(page).toHaveScreenshot('replay-night-full.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });

  test.describe('mobile lite mode', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('hilly ride, lite composer', async ({ page }) => {
      await gotoHarness(page, 'hilly');
      await expect(page).toHaveScreenshot('replay-hilly-lite.png', {
        maxDiffPixelRatio: 0.05,
        animations: 'disabled',
      });
    });
  });
});
