/**
 * Routes page E2E tests — the atlas (browse + maintain).
 *
 * The page draws every route as a line and every row as a shape; the old
 * Map/List/Grid toggle and the 7-tab detail are gone. These tests assert what
 * a user observes on the new surface.
 */

import { test, expect } from './fixtures/authenticated-test';
import { mockRoutes } from './fixtures/mock-data';

test.describe('Routes Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/routes/i);
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible({ timeout: 15000 });
  });

  // ── Browse ────────────────────────────────────────────────────────────

  test('page heading renders with the library count', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText(/^routes$/i);
    await expect(page.locator('main header').getByText('4', { exact: true }).first()).toBeVisible();
  });

  test('every route row carries a shape and a distance', async ({ authenticatedPage: page }) => {
    const row = page.getByRole('button', { name: /surrey hills loop/i }).first();
    await expect(row).toContainText(/65 km/i);
    await expect(row.locator('svg[aria-label="Route shape"]')).toBeVisible();
  });

  test('the map draws a line per route', async ({ authenticatedPage: page }) => {
    await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('search narrows to matching routes', async ({ authenticatedPage: page }) => {
    await page.getByLabel('Search routes').fill('Richmond');
    await expect(page.getByText(/richmond park circuit/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/surrey hills loop/i)).toHaveCount(0);
  });

  test('distance facet filters server-side', async ({ authenticatedPage: page }) => {
    await page.locator('label:has(span:text-is("Distance")) select').selectOption('short');
    await expect(page.getByText(/richmond park circuit/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/surrey hills loop/i)).toHaveCount(0);
  });

  test('clear resets the filters', async ({ authenticatedPage: page }) => {
    await page.getByLabel('Search routes').fill('Richmond');
    await expect(page.getByText(/surrey hills loop/i)).toHaveCount(0, { timeout: 8000 });
    await page.getByRole('button', { name: /^clear$/i }).click();
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible({ timeout: 8000 });
  });

  // ── Detail ────────────────────────────────────────────────────────────

  test('selecting a route opens a one-scroll detail with no tab museum', async ({
    authenticatedPage: page,
  }) => {
    await page.getByRole('button', { name: /surrey hills loop/i }).first().click();
    const dialog = page.getByRole('dialog', { name: /surrey hills loop details/i });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog).toContainText(/65 km/i);
    await expect(dialog).toContainText(/ride history/i);
    await expect(dialog.locator('[role="tablist"]')).toHaveCount(0);
  });

  test('the detail exposes the deep tools on demand', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /surrey hills loop/i }).first().click();
    const dialog = page.getByRole('dialog', { name: /surrey hills loop details/i });
    const more = dialog.getByRole('button', { name: /map, weather, effort/i });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByText(/segments/i).first()).toBeVisible();
  });

  test('closing the detail returns to the list', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /surrey hills loop/i }).first().click();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/richmond park circuit/i).first()).toBeVisible();
  });

  // ── Compare ───────────────────────────────────────────────────────────

  test('compare selects two routes and opens the overlay', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /compare/i }).first().click();
    await page.getByRole('button', { name: /surrey hills loop/i }).first().click();
    await expect(page.getByText(/select a second route/i)).toBeVisible();
    await page.getByRole('button', { name: /richmond park circuit/i }).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: /surrey hills/i })).toBeVisible({
      timeout: 10000,
    });
  });

  // ── Maintain ──────────────────────────────────────────────────────────

  test('maintain mode shows library health without auto-scanning', async ({
    authenticatedPage: page,
  }) => {
    let duplicateRequests = 0;
    await page.route('**/api/v1/routes/duplicates', (route) => {
      duplicateRequests += 1;
      route.fulfill({ status: 200, body: '[]' });
    });

    await page.getByRole('button', { name: /^maintain$/i }).click();
    await expect(page.getByText(/duplicate review/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /run duplicate scan/i })).toBeVisible();
    await expect(page.getByText(/merged routes/i)).toBeVisible();
    expect(duplicateRequests).toBe(0);
  });

  test('a running scan is reported without mounting the queue', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/routes/duplicates/status', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          state: 'running',
          started_at: new Date(Date.now() - 60_000).toISOString(),
          finished_at: null,
          pairs: null,
          error: null,
        }),
      });
    });

    await page.getByRole('button', { name: /^maintain$/i }).click();
    await expect(page.getByText(/scanning the library/i)).toBeVisible();
    await expect(page.getByText(/duplicate routes/i)).toHaveCount(0);
  });

  test('a finished scan with no pairs says so', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/duplicates/status', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          state: 'ready',
          started_at: '2026-08-20T08:00:00Z',
          finished_at: '2026-08-20T08:16:00Z',
          pairs: 0,
          error: null,
        }),
      });
    });

    await page.getByRole('button', { name: /^maintain$/i }).click();
    await expect(page.getByText(/no duplicate candidates/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /re-scan/i })).toBeVisible();
  });

  // ── Header actions ────────────────────────────────────────────────────

  test('GPX upload opens the file picker', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /upload gpx|^gpx$/i }).first().click();
    await expect(page.locator('input[type="file"]').first()).toBeVisible();
  });

  test('sync reports its result', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /^sync$/i }).click();
    await expect(page.getByText(/synced/i).first()).toBeVisible({ timeout: 8000 });
  });

  // ── States ────────────────────────────────────────────────────────────

  test('shows a skeleton while routes load', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      route.fulfill({
        status: 200,
        headers: { 'X-Total-Count': '1' },
        body: JSON.stringify([mockRoutes[0]]),
      });
    });
    await page.goto('/fittrack/routes');
    await expect(page.locator('.animate-pulse').first()).toBeVisible();
  });

  test('renders a real error state, not an empty page', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/**', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });
    await page.goto('/fittrack/routes');
    await expect(page.getByText(/couldn't load routes/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  test('renders the first-run empty state', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/**', (route) => {
      route.fulfill({ status: 200, headers: { 'X-Total-Count': '0' }, body: '[]' });
    });
    await page.goto('/fittrack/routes');
    await expect(page.getByText(/no routes yet/i)).toBeVisible({ timeout: 10000 });
  });
});
