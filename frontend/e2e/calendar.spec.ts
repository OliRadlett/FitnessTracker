/**
 * Calendar page E2E tests — the production surface, with the API mocked by the
 * shared authenticated fixture. The visual gate lives in the prototype lab;
 * these assert the page's real behaviours: URL state, month navigation, the
 * day inspector/sheet, and honest empty/error states.
 */

import { expect, test } from './fixtures/authenticated-test';
import { mockCalendarResponse } from './fixtures/calendar-mock';

const EMPTY_RESPONSE = {
  ...mockCalendarResponse,
  plan: null,
  coverage: {
    planned_sessions: 0,
    target_sessions: 0,
    planned_tss: 0,
    strength_targets_missing: 0,
  },
  days: [],
  weeks: [],
  events: [],
  goals: [],
  current: null,
};

test.describe('Calendar Page', () => {
  test('page heading renders', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar');
    await expect(page.locator('main h1')).toContainText('Calendar');
  });

  test('month label defaults to the current month', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar');
    const now = new Date();
    const label = `${now.toLocaleString('en-GB', { month: 'long' })} ${now.getFullYear()}`;
    await expect(page.getByText(new RegExp(label)).first()).toBeVisible();
  });

  test('month navigation changes the label', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.getByText('September 2026').first()).toBeVisible();
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.getByText('October 2026').first()).toBeVisible();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.getByText('September 2026').first()).toBeVisible();
  });

  test('a day URL selects that day and shows the inspector', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await expect(page.getByText('Saturday 19 September').first()).toBeVisible();
    await expect(page.getByText('Pull', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /View activity/ })).toBeVisible();
  });

  test('clicking a day updates the URL and the inspector', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await page.getByRole('button', { name: /Friday.*18 September/ }).first().click();
    await expect(page).toHaveURL(/day=2026-09-18/);
    await expect(page.getByText('Friday 18 September').first()).toBeVisible();
  });

  test('an empty month teaches the next action', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/calendar**', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify(EMPTY_RESPONSE) }),
    );
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.getByText('No training in September 2026')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Training' })).toBeVisible();
  });

  test('a failed read renders an error with retry, not an empty month', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/calendar**', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Server error' }) }),
    );
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.getByText("Couldn't load the calendar")).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry/ })).toBeVisible();
    await expect(page.getByText('No training in September 2026')).toHaveCount(0);
  });

  test('loading uses a shape-matched skeleton', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/calendar**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      route.fulfill({ status: 200, body: JSON.stringify(mockCalendarResponse) });
    });
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.locator('.animate-pulse').first()).toBeVisible();
  });
});

test.describe('Calendar Page — visual capture', () => {
  test('desktop', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await expect(page.getByText('September 2026').first()).toBeVisible();
    await expect(page.getByText('Saturday 19 September').first()).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'e2e/screenshots/calendar-production-desktop.png',
      fullPage: true,
    });
  });

  test('desktop light theme', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await expect(page.getByText('September 2026').first()).toBeVisible();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'e2e/screenshots/calendar-production-desktop-light.png',
      fullPage: true,
    });
  });

  test('mobile agenda', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.getByText('W38').first()).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'e2e/screenshots/calendar-production-mobile-agenda.png',
      fullPage: true,
    });
  });

  test('mobile sheet', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: 'e2e/screenshots/calendar-production-mobile-sheet.png',
    });
  });
});

test.describe('Calendar Page — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a day deep link opens the sheet and closes cleanly', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/fittrack/calendar?month=2026-09&day=2026-09-19');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Saturday 19 September').first()).toBeVisible();
    await page.getByRole('button', { name: 'Close day detail' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the agenda is visible without horizontal scroll', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/calendar?month=2026-09');
    await expect(page.getByText('W38').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
