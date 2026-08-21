/**
 * Lifting page E2E tests.
 * Tests the lifting sessions page including session list,
 * detail panel, exercise forms, PRs, and warmup templates.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Lifting Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/lifting');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText('Lifting');
  });

  // ── Session List ────────────────────────────────────────────────────────

  test('session list renders with sessions', async ({ authenticatedPage: page }) => {
    // Should show session dates/focus
    await expect(page.getByText(/squat day|bench day|deadlift day/i).first()).toBeVisible();
  });

  test('session list shows session dates', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/2026|aug/i).first()).toBeVisible();
  });

  // ── Create New Session ──────────────────────────────────────────────────

  test('new session button is present', async ({ authenticatedPage: page }) => {
    const newButton = page.getByRole('button', { name: /new session|add session|create session/i });
    await expect(newButton).toBeVisible();
  });

  test('clicking new session shows form', async ({ authenticatedPage: page }) => {
    const newButton = page.getByRole('button', { name: /new session|add session|create session/i });
    await newButton.click();
    await page.waitForTimeout(500);

    // Should show form fields
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  // ── Session Detail ──────────────────────────────────────────────────────

  test('clicking session shows detail panel', async ({ authenticatedPage: page }) => {
    // Click on the first session
    const sessionButton = page.getByText(/squat day/i).first();
    await sessionButton.click();
    await page.waitForTimeout(1000);

    // Should show exercise groups
    await expect(page.getByText(/squat|romanian deadlift|leg press/i).first()).toBeVisible();
  });

  test('session detail shows sets', async ({ authenticatedPage: page }) => {
    const sessionButton = page.getByText(/squat day/i).first();
    await sessionButton.click();
    await page.waitForTimeout(1000);

    // Should show weight/reps info
    await expect(page.getByText(/120|140|160/).first()).toBeVisible();
  });

  // ── Add Exercise Form ───────────────────────────────────────────────────

  test('add exercise button is present in detail view', async ({ authenticatedPage: page }) => {
    const sessionButton = page.getByText(/squat day/i).first();
    await sessionButton.click();
    await page.waitForTimeout(1000);

    const addExerciseBtn = page.getByRole('button', { name: /add exercise/i });
    await expect(addExerciseBtn).toBeVisible();
  });

  // ── Exercise Groups ─────────────────────────────────────────────────────

  test('exercise groups display correctly', async ({ authenticatedPage: page }) => {
    const sessionButton = page.getByText(/squat day/i).first();
    await sessionButton.click();
    await page.waitForTimeout(1000);

    // Should show exercise names as group headers
    await expect(page.getByText(/squat/i).first()).toBeVisible();
  });

  // ── PR Section ──────────────────────────────────────────────────────────

  test('PR section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/personal records|prs/i).first()).toBeVisible();
  });

  test('PR entries show exercise names', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/squat|bench press|deadlift/i).first()).toBeVisible();
  });

  // ── Warmup Templates ────────────────────────────────────────────────────

  test('warmup template section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/warmup/i).first()).toBeVisible();
  });

  // ── Volume Trends ───────────────────────────────────────────────────────

  test('volume trends chart renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/volume/i).first()).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('shows loading state while sessions load', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/lifting/sessions', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockLiftingSessions) });
    });

    await page.goto('/fittrack/lifting');

    const skeleton = page.locator('.animate-pulse').first();
    await expect(skeleton).toBeVisible();

    await page.waitForLoadState('networkidle');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/lifting/sessions', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/lifting');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText('Lifting');
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty sessions list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/lifting/sessions', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/v1/lifting/prs', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/lifting');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText('Lifting');
  });
});
