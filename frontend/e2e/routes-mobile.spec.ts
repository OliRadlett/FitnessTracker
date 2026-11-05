/**
 * Routes atlas on a phone (390x844).
 *
 * Locks the contract that made the atlas worth building: a route is visible in
 * the first viewport, the atlas screen itself does not scroll, and the two
 * heavy surfaces (filters, secondary actions) are sheets rather than chrome.
 */

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/authenticated-test';

test.use({ viewport: { width: 390, height: 844 } });

const firstRow = (page: Page) =>
  page.locator('main button[aria-pressed]').filter({ hasText: 'km' }).first();

test.describe('Routes atlas — phone', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/routes');
    await expect(page.locator('main h1')).toContainText(/routes/i);
    await expect(
      page.locator('main button[aria-pressed]').filter({ hasText: 'km' }).first(),
    ).toBeVisible({ timeout: 15000 });
  });

  test('the first route is visible without scrolling', async ({ authenticatedPage: page }) => {
    const box = await firstRow(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThan(0);
    expect(box!.y).toBeLessThan(844);
  });

  test('the atlas screen does not scroll the page', async ({ authenticatedPage: page }) => {
    const dims = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight,
      inner: window.innerHeight,
    }));
    expect(dims.scroll).toBeLessThanOrEqual(dims.inner + 1);
  });

  test('filters open as a sheet and close with a count', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /filters/i }).click();
    const dialog = page.getByRole('dialog', { name: /route filters/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /show \d+ routes/i }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('route detail opens as a sheet and closes back to the list', async ({
    authenticatedPage: page,
  }) => {
    await firstRow(page).click();
    const dialog = page.getByRole('dialog', { name: /details/i }).first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('button', { name: /filters/i })).toBeVisible();
  });

  test('secondary actions live in one sheet', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: 'Route actions' }).click();
    await expect(page.getByText(/upload gpx/i)).toBeVisible();
    await expect(page.getByText(/collections & tags/i)).toBeVisible();
    await expect(page.getByText(/library health/i)).toBeVisible();
  });
});
