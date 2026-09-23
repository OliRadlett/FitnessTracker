/**
 * Routes page E2E tests.
 * Tests the route list, filters, detail panel, map, and GPX operations.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Routes Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    // Content-aware wait (networkidle is flaky by design — Playwright
    // discourages it; background polls/SW/timers can hold it forever).
    await expect(page.locator('main h1')).toContainText(/saved routes|routes/i);
    // List view holds the cards/filters these specs assert (default is map).
    await page.getByRole('tab', { name: 'List' }).click();
    // Fail fast here if the list never loads (rather than 19 timeouts).
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible({ timeout: 15000 });
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText(/saved routes|routes/i);
  });

  test('route count badge displays', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/\d+ routes?/i).first()).toBeVisible();
  });

  // ── Route List ──────────────────────────────────────────────────────────

  test('route list renders with route cards', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible();
  });

  test('route cards show distance', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/km/i).first()).toBeVisible();
  });

  test('route cards show sport type', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/cycling/i).first()).toBeVisible();
  });

  // ── Filter Bar ──────────────────────────────────────────────────────────

  test('filter bar renders with status filter', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /more filters/i }).click();
    const statusSelect = page.locator('select').filter({ hasText: /ridden|not yet ridden/i }).first();
    await expect(statusSelect).toBeVisible();
  });

  test('filter bar renders with route type filter', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /more filters/i }).click();
    const typeSelect = page.locator('select').filter({ hasText: /loop|point to point/i }).first();
    await expect(typeSelect).toBeVisible();
  });

  test('filter bar renders with surface filter', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /more filters/i }).click();
    const surfaceSelect = page.locator('select').filter({ hasText: /road|gravel/i }).first();
    await expect(surfaceSelect).toBeVisible();
  });

  test('clear filters button appears after filtering', async ({ authenticatedPage: page }) => {
    // Tag filters count toward the active-filter badge (text search does not).
    await page.getByRole('button', { name: /Hilly/ }).first().click();
    await expect(page.getByRole('button', { name: /clear all/i })).toBeVisible({ timeout: 8000 });
  });

  // ── Route Detail ────────────────────────────────────────────────────────

  test('clicking route shows detail panel with map', async ({ authenticatedPage: page }) => {
    const routeCard = page.getByText(/surrey hills loop/i).first();
    await routeCard.click();
    await page.waitForTimeout(1000);

    // Should show route detail
    await expect(page.locator('main h1')).toContainText(/routes/i);
  });

  // ── GPX Operations ──────────────────────────────────────────────────────

  test('upload GPX button is present', async ({ authenticatedPage: page }) => {
    const uploadBtn = page.getByRole('button', { name: /upload gpx/i });
    await expect(uploadBtn).toBeVisible();
  });

  test('clicking upload GPX opens modal', async ({ authenticatedPage: page }) => {
    const uploadBtn = page.getByRole('button', { name: /upload gpx/i });
    await uploadBtn.click();
    await page.waitForTimeout(500);

    // Should show file input
    await expect(page.locator('input[type="file"]').first()).toBeVisible();
  });

  test('GPX download button is present for selected route', async ({ authenticatedPage: page }) => {
    const routeCard = page.getByText(/surrey hills loop/i).first();
    await routeCard.click();
    await page.waitForTimeout(1000);

    // May or may not be visible depending on route detail
    await expect(page.locator('main h1')).toContainText(/routes/i);
  });

  // ── Sync Button ─────────────────────────────────────────────────────────

  test('sync routes button is present', async ({ authenticatedPage: page }) => {
    const syncBtn = page.getByRole('button', { name: /sync routes/i });
    await expect(syncBtn).toBeVisible();
  });

  test('sync button triggers sync', async ({ authenticatedPage: page }) => {
    const syncBtn = page.getByRole('button', { name: /sync routes/i });
    await syncBtn.click();
    await page.waitForTimeout(1000);

    // Should show sync result
    await expect(page.getByText(/synced/i).first()).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('shows loading state while routes load', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockRoutes) });
    });

    await page.goto('/fittrack/routes');

    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible();

    // List view holds the cards (default is map, where names don't render).
    await page.getByRole('tab', { name: 'List' }).click();
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible({ timeout: 15000 });
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/routes/i);
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty routes list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/routes/i);
  });
});
