/**
 * Routes collections drawer E2E tests (B-36). Tag filtering + collections.
 * The sidebar now lives behind the header's "Collections" button.
 */

import { test, expect } from './fixtures/authenticated-test';

test.describe('Routes collections drawer', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/routes/i);
    await page.getByRole('button', { name: /collections/i }).click();
    await expect(page.getByRole('dialog', { name: /collections and tags/i })).toBeVisible();
  });

  test('drawer shows tags and collections', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Hilly').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Weekend Rides').first()).toBeVisible();
  });

  test('smart collection shows auto badge', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Long Climbs').first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('auto', { exact: true }).first()).toBeVisible();
  });

  test('clicking a tag toggles the filter chip', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /Hilly/ }).first().click();
    // Multi-select keeps the drawer open, and the tag shows as an active chip.
    await expect(page.getByRole('button', { name: /Remove tag filter Hilly/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('clicking a collection applies it, closes the drawer and updates the URL', async ({
    authenticatedPage: page,
  }) => {
    await page.getByRole('button', { name: /Weekend Rides/ }).click();
    await expect(page.getByRole('dialog', { name: /collections and tags/i })).toHaveCount(0);
    await expect(page.getByText(/surrey hills loop/i).first()).toBeVisible();
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('collection=col-1');
  });

  test('tag selection is URL state', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /Hilly/ }).first().click();
    await expect.poll(() => page.url(), { timeout: 5000 }).toContain('tags=tag-1');
  });

  test('a tagged link opens with the tag applied', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes?tags=tag-1');
    await page.getByRole('button', { name: /collections/i }).click();
    await expect(page.getByRole('button', { name: /Remove tag filter Hilly/i })).toBeVisible({
      timeout: 8000,
    });
  });
});
