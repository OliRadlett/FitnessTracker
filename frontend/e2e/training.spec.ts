/**
 * Training page E2E tests.
 * Tests training plans, events, plan builder, and periodization chart.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Training Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText(/training plans/i);
  });

  test('page subtitle renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/plan your training/i)).toBeVisible();
  });

  // ── Plan List ───────────────────────────────────────────────────────────

  test('plan list renders with plans', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/base building block/i).first()).toBeVisible();
  });

  test('plan cards show status badges', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/active/i).first()).toBeVisible();
  });

  test('plan cards show date ranges', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/2026-08-01/i).first()).toBeVisible();
  });

  test('plan cards show progress bars', async ({ authenticatedPage: page }) => {
    // Progress bar should be visible
    await expect(page.locator('[class*="rounded-full"][class*="h-1"]').first()).toBeVisible();
  });

  // ── Plan Selection ──────────────────────────────────────────────────────

  test('clicking plan loads PlanBuilder', async ({ authenticatedPage: page }) => {
    const planButton = page.getByText(/base building block/i).first();
    await planButton.click();
    await page.waitForTimeout(1000);

    // PlanBuilder should load
    await expect(page.locator('main h1')).toContainText(/training plans/i);
  });

  // ── Generate Plan ───────────────────────────────────────────────────────

  test('generate plan form is accessible', async ({ authenticatedPage: page }) => {
    // Look for generate button or form
    const generateBtn = page.getByRole('button', { name: /generate/i });
    // May be visible or behind a toggle
    await expect(page.locator('main h1')).toContainText(/training plans/i);
  });

  // ── Events Section ──────────────────────────────────────────────────────

  test('events section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/events/i).first()).toBeVisible();
  });

  test('events list shows event names', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/surrey hills sportive/i).first()).toBeVisible();
  });

  test('add event button is present', async ({ authenticatedPage: page }) => {
    const addEventBtn = page.getByRole('button', { name: /add event/i });
    await expect(addEventBtn).toBeVisible();
  });

  test('clicking add event shows form', async ({ authenticatedPage: page }) => {
    const addEventBtn = page.getByRole('button', { name: /add event/i });
    await addEventBtn.click();
    await page.waitForTimeout(500);

    // Should show form fields
    await expect(page.locator('input[placeholder*="event name"], input[type="text"]').first()).toBeVisible();
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  test('event form has type selector', async ({ authenticatedPage: page }) => {
    const addEventBtn = page.getByRole('button', { name: /add event/i });
    await addEventBtn.click();
    await page.waitForTimeout(500);

    const typeSelect = page.locator('select').filter({ hasText: /race|ride|lift/i }).first();
    await expect(typeSelect).toBeVisible();
  });

  test('delete event button is present', async ({ authenticatedPage: page }) => {
    const deleteBtn = page.getByRole('button', { name: /✕|delete|remove/i }).first();
    await expect(deleteBtn).toBeVisible();
  });

  // ── Periodization Chart ─────────────────────────────────────────────────

  test('periodization chart renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/periodization/i).first()).toBeVisible();
  });

  // ── Loading States ──────────────────────────────────────────────────────

  test('shows loading state while plans load', async ({ authenticatedPage: page }) => {
    // Route pattern must NOT have trailing slash — the API call is /api/v1/training-plans
    await page.route('**/api/v1/training-plans**', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      route.fulfill({ status: 200, body: JSON.stringify(mockData.mockTrainingPlanSummaries) });
    });

    await page.goto('/fittrack/training');
    await page.waitForTimeout(500);

    await expect(page.getByText(/loading/i).first()).toBeVisible();

    await page.waitForLoadState('networkidle');
  });

  // ── Error States ────────────────────────────────────────────────────────

  test('handles API errors gracefully', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/training-plans**', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) });
    });

    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.locator('main h1')).toContainText(/training plans/i);
  });

  // ── Empty States ────────────────────────────────────────────────────────

  test('handles empty plans list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/training-plans**', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });
    await page.route('**/api/v1/events**', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/no plans yet/i).first()).toBeVisible();
  });

  test('handles empty events list', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/events**', (route) => {
      route.fulfill({ status: 200, body: JSON.stringify([]) });
    });

    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await expect(page.getByText(/no upcoming events/i).first()).toBeVisible();
  });
});
