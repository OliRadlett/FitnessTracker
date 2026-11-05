/**
 * Real-API production gate. Runs against the disposable `fittrack_gate`
 * database (220 activities, 30 lifts, a 62-day plan) and a JWT minted for its
 * user. The authenticated fixture still mocks the shell's non-calendar API
 * calls; only `/api/v1/calendar` is allowed through to the real backend.
 *
 * Prerequisites:
 *   - backend on :8001 with DATABASE_URL=fittrack_gate
 *   - frontend dev on :3100 with INTERNAL_API_URL=http://127.0.0.1:8001
 *   - E2E_BACKEND_TOKEN=<JWT for the gate user>
 */

import type { Page, Route } from '@playwright/test';

import { expect, test } from './fixtures/authenticated-test';

test.use({ serviceWorkers: 'block' });

async function gotoRealCalendar(page: Page, path: string) {
  await page.route('**/api/v1/calendar**', (route: Route) => route.continue());
  await page.goto(path);
  await expect(page.getByText('September 2026').first()).toBeVisible();
  // The header is independent of the query; wait for the data-bearing week
  // header (present in both desktop grid and mobile agenda) before assertions.
  await expect(page.getByText('W38').first()).toBeVisible({ timeout: 30_000 });
}

test.describe('Calendar — real API gate', () => {
  test('220-activity month renders from the real endpoint', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoRealCalendar(page, '/fittrack/calendar?month=2026-09&day=2026-09-18');
    await expect(page.getByText('220 activities · 30 lifts').first()).toBeVisible();
    await expect(page.getByText('12,500').first()).toBeVisible();
    await expect(page.getByText(/temporarily unavailable/)).toHaveCount(0);
    await page.screenshot({
      path: 'e2e/screenshots/calendar-real-api-desktop.png',
      fullPage: true,
    });
  });

  test('day deep link without a month lands in the day month', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoRealCalendar(page, '/fittrack/calendar?day=2026-09-19');
    await expect(page.getByText('Saturday 19 September').first()).toBeVisible();
  });

  test('real API light theme', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoRealCalendar(page, '/fittrack/calendar?month=2026-09&day=2026-09-18');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({
      path: 'e2e/screenshots/calendar-real-api-desktop-light.png',
      fullPage: true,
    });
  });

  test('375 / 390 / 412 px have no horizontal overflow', async ({
    authenticatedPage: page,
  }) => {
    for (const width of [375, 390, 412]) {
      await page.setViewportSize({ width, height: 844 });
      await gotoRealCalendar(page, '/fittrack/calendar?month=2026-09');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
    }
  });

  test('axe: no serious or critical WCAG A/AA violations', async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoRealCalendar(page, '/fittrack/calendar?month=2026-09&day=2026-09-18');
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js',
    });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: any }).axe;
      const result = await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      });
      return result.violations.map((violation: any) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        examples: violation.nodes.slice(0, 8).map((node: any) => ({
          target: node.target,
          html: String(node.html).slice(0, 140),
          failure: String(node.failureSummary ?? '').slice(0, 240),
        })),
      }));
    });
    const serious = violations.filter(
      (violation: { impact: string | null }) =>
        violation.impact === 'serious' || violation.impact === 'critical',
    );
    console.log('axe violations', JSON.stringify(violations));
    expect(serious).toEqual([]);
  });
});
