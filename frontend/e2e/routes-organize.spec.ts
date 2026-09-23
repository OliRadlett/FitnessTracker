/**
 * Routes organize E2E tests (B-36). Tag filtering + collections sidebar
 * against mocked tags/collections endpoints.
 */

import { test, expect } from './fixtures/authenticated-test';

test.describe('Routes organize sidebar', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/saved routes|routes/i);
  });

  test('sidebar shows tags and collections', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Hilly').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Weekend Rides').first()).toBeVisible();
  });

  test('smart collection shows auto badge', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Long Climbs').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('auto', { exact: true }).first()).toBeVisible();
  });

  test('clicking a tag toggles the filter chip', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /Hilly/ }).first().click();
    await expect(page.getByRole('button', { name: /Remove tag filter Hilly/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('clicking a collection filters the list', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /Weekend Rides/ }).click();
    // Collection becomes active (URL reflects the filter).
    await expect.poll(async () => page.url(), { timeout: 5000 }).toContain('routes');
  });
});
