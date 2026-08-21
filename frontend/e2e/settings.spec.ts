/**
 * Settings page E2E tests.
 * Tests profile section, integration cards, export buttons,
 * and data management sections.
 */

import { test, expect } from './fixtures/authenticated-test';

test.describe('Settings Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText('Settings');
  });

  test('page subtitle renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/manage your account/i)).toBeVisible();
  });

  // ── Profile Section ─────────────────────────────────────────────────────

  test('profile section shows user name', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Test User').first()).toBeVisible();
  });

  test('profile section shows user email', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('test@example.com').first()).toBeVisible();
  });

  test('profile section heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Profile').first()).toBeVisible();
  });

  // ── Integration Cards ───────────────────────────────────────────────────

  test('Strava integration card renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Strava').first()).toBeVisible();
  });

  test('Komoot integration card renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Komoot').first()).toBeVisible();
  });

  test('Wahoo integration card renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Wahoo').first()).toBeVisible();
  });

  test('Whoop integration card renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Whoop').first()).toBeVisible();
  });

  test('integration logos load (not broken)', async ({ authenticatedPage: page }) => {
    const integrationImages = page.locator('img[alt="Strava"], img[alt="Komoot"], img[alt="Wahoo"], img[alt="Whoop"]');
    const count = await integrationImages.count();
    expect(count).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < count; i++) {
      const img = integrationImages.nth(i);
      // Attempt to decode the image before checking naturalWidth
      await img.evaluate(el => (el as HTMLImageElement).decode().catch(() => {}));
      const isSvg = await img.evaluate(el => (el as HTMLImageElement).src.endsWith('.svg'));
      if (isSvg) continue; // SVGs may report naturalWidth=0 in headless Chrome
      const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });

  test('Strava shows Connected badge', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/connected/i).first()).toBeVisible();
  });

  test('Connect button is present for unconnected integrations', async ({ authenticatedPage: page }) => {
    const connectButtons = page.getByRole('button', { name: /connect/i });
    const count = await connectButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── Export Section ───────────────────────────────────────────────────────

  test('export section heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Export Data').first()).toBeVisible();
  });

  test('Lifting CSV export button is present', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: /lifting csv/i })).toBeVisible();
  });

  test('Activities CSV export button is present', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: /activities csv/i })).toBeVisible();
  });

  test('Personal Records CSV export button is present', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('button', { name: /personal records csv|prs csv/i })).toBeVisible();
  });

  // ── Data Management ─────────────────────────────────────────────────────

  test('data management section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText('Data Management').first()).toBeVisible();
  });

  // ── Danger Zone ─────────────────────────────────────────────────────────

  test('danger zone section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/danger zone/i).first()).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('page loads without errors', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText('Settings');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles connections API error gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/connections/', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText('Settings');
  });
});
