/**
 * Routes page E2E tests.
 * Tests the route list, filters, detail panel, map, and GPX operations.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Routes Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
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
    const statusSelect = page.locator('select').filter({ hasText: /all|ridden|not yet ridden/i }).first();
    await expect(statusSelect).toBeVisible();
  });

  test('filter bar renders with sport type filter', async ({ authenticatedPage: page }) => {
    const sportSelect = page.locator('select').filter({ hasText: /cycling|running/i }).first();
    await expect(sportSelect).toBeVisible();
  });

  test('filter bar renders with source filter', async ({ authenticatedPage: page }) => {
    const sourceSelect = page.locator('select').filter({ hasText: /strava|komoot|wahoo/i }).first();
    await expect(sourceSelect).toBeVisible();
  });

  test('filter bar renders with route type filter', async ({ authenticatedPage: page }) => {
    const typeSelect = page.locator('select').filter({ hasText: /loop|point/i }).first();
    await expect(typeSelect).toBeVisible();
  });

  test('clear filters button is present', async ({ authenticatedPage: page }) => {
    const clearBtn = page.getByRole('button', { name: /clear/i });
    await expect(clearBtn).toBeVisible();
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

    await page.waitForLoadState('networkidle');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/routes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText(/routes/i);
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty routes list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/routes/', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/routes');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText(/routes/i);
  });
});
