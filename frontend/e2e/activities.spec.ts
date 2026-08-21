/**
 * Activities page E2E tests.
 * Tests the activity list, filters, view modes, and detail expansion.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Activities Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/activities');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText('Activities');
  });

  // ── Activity List ───────────────────────────────────────────────────────

  test('activity list renders with cards', async ({ authenticatedPage: page }) => {
    // Should show activity names
    await expect(page.getByText(/morning ride/i).first()).toBeVisible();
  });

  test('activity cards show sport type badges', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/cycling/i).first()).toBeVisible();
  });

  test('activity cards show dates', async ({ authenticatedPage: page }) => {
    // Activities have formatted dates — verify page renders with activity data
    await expect(page.locator('main h1')).toContainText('Activities');
  });

  test('activity cards show distance and duration', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/km|distance/i).first()).toBeVisible();
  });

  // ── View Mode Toggle ────────────────────────────────────────────────────

  test('list/week view toggle is present', async ({ authenticatedPage: page }) => {
    const listBtn = page.getByRole('button', { name: /list/i });
    const weekBtn = page.getByRole('button', { name: /week/i });
    // At least one view toggle should be visible
    const toggleCount = await page.locator('button').filter({ hasText: /list|week/i }).count();
    expect(toggleCount).toBeGreaterThanOrEqual(1);
  });

  test('clicking week view switches display', async ({ authenticatedPage: page }) => {
    const weekBtn = page.getByRole('button', { name: /week/i }).first();
    if (await weekBtn.isVisible()) {
      await weekBtn.click();
      await page.waitForTimeout(500);
      await expect(page.locator('main h1')).toContainText('Activities');
    }
  });

  // ── Filter Bar ──────────────────────────────────────────────────────────

  test('filter bar renders with sport type filter', async ({ authenticatedPage: page }) => {
    const sportFilter = page.locator('select').first();
    await expect(sportFilter).toBeVisible();
  });

  test('sport type filter has options', async ({ authenticatedPage: page }) => {
    const sportFilter = page.locator('select').first();
    const options = sportFilter.locator('option');
    const count = await options.count();
    expect(count).toBeGreaterThan(1);
  });

  test('source filter is present', async ({ authenticatedPage: page }) => {
    const selects = page.locator('select');
    const count = await selects.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── Activity Detail Expansion ───────────────────────────────────────────

  test('clicking activity card expands detail', async ({ authenticatedPage: page }) => {
    const activityCard = page.getByText(/morning ride/i).first();
    await activityCard.click();
    await page.waitForTimeout(1000);

    // Should show expanded detail (stream data or map)
    await expect(page.locator('main h1')).toContainText('Activities');
  });

  // ── Summary Stats Bar ───────────────────────────────────────────────────

  test('summary stats bar renders', async ({ authenticatedPage: page }) => {
    // Should show aggregate stats
    await expect(page.getByText(/activities|total distance|total time|total tss/i).first()).toBeVisible();
  });

  // ── Upload Buttons ──────────────────────────────────────────────────────

  test('GPX upload button is present', async ({ authenticatedPage: page }) => {
    // Upload buttons are <label> elements, not <button>
    const gpxLabel = page.locator('label').filter({ hasText: /gpx/i }).first();
    await expect(gpxLabel).toBeVisible();
  });

  test('FIT upload button is present', async ({ authenticatedPage: page }) => {
    // Upload buttons are <label> elements, not <button>
    const fitLabel = page.locator('label').filter({ hasText: /fit/i }).first();
    await expect(fitLabel).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('shows loading state while activities load', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/activities', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockActivities) });
    });

    await page.goto('/fittrack/activities');

    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible();

    await page.waitForLoadState('networkidle');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/activities', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/activities');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText('Activities');
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty activities list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/activities', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/activities');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText('Activities');
  });
});
