/**
 * Training page E2E tests — the plan-first shell (Phase 0).
 *
 * Guards the structure Phase 1 will rewrite: the plan spine, the
 * Plan / Review / Peaks mode switch (`?mode=`), the Plans surface, and the
 * `?plan=&day=` deep link. All API calls are mocked by the auth fixture.
 *
 * In CI via `npm run test:e2e:ci` (see package.json) — this spec is part of
 * that subset so the training page cannot silently rot again.
 */

import { test, expect } from './fixtures/authenticated-test';

test.describe('Training Page — shell', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
  });

  test('renders the page header and subtitle', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText(/training/i);
    await expect(page.getByText(/author the plan/i)).toBeVisible();
  });

  test('plan spine shows the most recent active plan', async ({ authenticatedPage: page }) => {
    // mockTrainingPlanSummaries: plan-1 is the only `active` plan.
    await expect(page.getByText('Base Building Block').first()).toBeVisible();
  });

  test('mode switch offers Plan, Review and Peaks', async ({ authenticatedPage: page }) => {
    for (const name of ['Plan', 'Review', 'Peaks']) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
  });

  test('Plan mode shows the week view', async ({ authenticatedPage: page }) => {
    // The unified week view (one editor) with its Week | All weeks toggle.
    await expect(page.getByRole('button', { name: 'All weeks' })).toBeVisible();
  });

  test('Review mode shows the periodization chart', async ({ authenticatedPage: page }) => {
    await page.getByRole('tab', { name: 'Review' }).click();
    await expect(page.getByText(/periodization/i).first()).toBeVisible();
  });

  test('Peaks mode shows the events', async ({ authenticatedPage: page }) => {
    await page.getByRole('tab', { name: 'Peaks' }).click();
    await expect(page.getByText(/surrey hills sportive/i).first()).toBeVisible();
  });
});

test.describe('Training Page — deep links & Plans surface', () => {
  test('reload at ?mode=review keeps the mode', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training?mode=review');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/periodization/i).first()).toBeVisible();
  });

  test('?mode=plans opens the Plans surface', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training?mode=plans');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/all plans/i).first()).toBeVisible();
    await expect(page.getByText('Pre-Season Build').first()).toBeVisible();
  });

  test('?plan=&day= opens the week with that day', async ({ authenticatedPage: page }) => {
    // The goal-card deep link: selects the plan, lands in Plan mode, opens the
    // week containing the date and expands that day's card.
    await page.goto('/fittrack/training?plan=plan-1&day=2026-08-05');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#plan-day-2026-08-05')).toBeVisible();
    // The deep link auto-expands the day → the unified DayEditor renders.
    await expect(page.getByRole('checkbox', { name: 'Completed', exact: true })).toBeVisible();
  });

  test('empty plans list shows the create-first-plan state', async ({
    authenticatedPage: page,
  }) => {
    // Registered after the fixture's catch-all, so this override wins.
    await page.route('**/api/v1/training-plans**', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify([]) }),
    );
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/no plan selected/i).first()).toBeVisible();
  });
});
