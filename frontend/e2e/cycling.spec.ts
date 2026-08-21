/**
 * Cycling page E2E tests.
 * Tests the cycling analytics page including profile editor,
 * metric cards, training load, power curve, zones, and VO2max.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Cycling Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/cycling');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText('Cycling');
  });

  test('page subtitle renders', async ({ authenticatedPage: page }) => {
    // Wait for the page to finish loading (profileLoading gate) before checking subtitle
    await expect(page.locator('main p').filter({ hasText: 'Power analysis' })).toBeVisible({ timeout: 10000 });
  });

  // ── Profile Editor ──────────────────────────────────────────────────────

  test('profile editor shows FTP value', async ({ authenticatedPage: page }) => {
    // Look for FTP input or display
    const ftpValue = page.getByText(/260/).first();
    await expect(ftpValue).toBeVisible();
  });

  test('profile editor shows weight value', async ({ authenticatedPage: page }) => {
    const weightValue = page.getByText(/78/).first();
    await expect(weightValue).toBeVisible();
  });

  test('profile editor shows LTHR value', async ({ authenticatedPage: page }) => {
    // LTHR is in an input field value, check the input exists with correct value
    const lthrInput = page.locator('input[type="number"]').nth(2); // 3rd number input = LTHR
    await expect(lthrInput).toHaveValue('172');
  });

  // ── Metric Cards ────────────────────────────────────────────────────────

  test('metric cards render with values', async ({ authenticatedPage: page }) => {
    // Should show cycling metrics
    await expect(page.getByText(/ftp/i).first()).toBeVisible();
  });

  test('power-to-weight ratio displays', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/3\.33|w\/kg/i).first()).toBeVisible();
  });

  // ── Training Load Section ───────────────────────────────────────────────

  test('training load section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/training load/i).first()).toBeVisible();
  });

  test('CTL/ATL/TSB values display', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/ctl/i).first()).toBeVisible();
  });

  // ── Power Curve Section ─────────────────────────────────────────────────

  test('power curve section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/power curve/i).first()).toBeVisible();
  });

  // ── Power Zones Section ─────────────────────────────────────────────────

  test('power zones section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/power zones/i).first()).toBeVisible();
  });

  // ── VO2max Section ──────────────────────────────────────────────────────

  test('VO2max section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/vo2max/i).first()).toBeVisible();
  });

  test('VO2max value displays', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/52\.5/).first()).toBeVisible();
  });

  // ── Day Range Selector ──────────────────────────────────────────────────

  test('day range selector is present', async ({ authenticatedPage: page }) => {
    // Look for range selector buttons (30d, 60d, 90d, 180d)
    const rangeButton = page.locator('button').filter({ hasText: /90d/i }).first();
    await expect(rangeButton).toBeVisible();
  });

  // ── Action Buttons ──────────────────────────────────────────────────────

  test('Recalculate TSS button is present', async ({ authenticatedPage: page }) => {
    const recalcButton = page.getByRole('button', { name: /calculate tss/i });
    await expect(recalcButton).toBeVisible();
  });

  test('Fetch Streams button is present', async ({ authenticatedPage: page }) => {
    const streamsButton = page.getByRole('button', { name: /fetch streams|backfill streams/i });
    await expect(streamsButton).toBeVisible();
  });

  test('Recalculate TSS button triggers mutation', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/cycling/recalculate-tss', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ updated: 10, total_checked: 50 }) });
    });

    const recalcButton = page.getByRole('button', { name: /calculate tss/i });
    await recalcButton.click();
    await page.waitForTimeout(1000);

    // Should show a result message
    await expect(page.getByText(/updated|recalculated/i).first()).toBeVisible();
  });

  // ── FTP Estimation ──────────────────────────────────────────────────────

  test('Estimate FTP button is present', async ({ authenticatedPage: page }) => {
    const estimateButton = page.getByRole('button', { name: /auto-estimate/i });
    await expect(estimateButton).toBeVisible();
  });

  test('FTP estimation flow works', async ({ authenticatedPage: page }) => {
    const estimateButton = page.getByRole('button', { name: /auto-estimate/i });
    await estimateButton.click();
    await page.waitForTimeout(1000);

    // Should show FTP estimate results
    await expect(page.getByText(/271|estimated ftp/i).first()).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('shows loading skeleton while profile loads', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/cycling/profile', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockCyclingProfile) });
    });

    await page.goto('/fittrack/cycling');

    // Should show loading skeleton
    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible();

    await page.waitForLoadState('networkidle');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/cycling/profile', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/cycling');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Page should still render
    await expect(page.locator('main h1')).toContainText('Cycling');
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty cycling data', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/cycling/profile', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ id: 'cp-1', user_id: 'user-1', auto_estimate_ftp: false, created_at: '', updated_at: '' }) });
    });
    await page.route('**/api/v1/cycling/metrics-summary', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify({ recent_tss: 0, recent_distance_km: 0, recent_time_hours: 0, recent_elevation_m: 0, recent_rides: 0 }) });
    });

    await page.goto('/fittrack/cycling');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Page should render without crashing
    await expect(page.locator('main h1')).toContainText('Cycling');
  });
});
