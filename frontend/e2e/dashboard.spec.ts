/**
 * Dashboard E2E — what the user observes, not that an <h1> exists.
 *
 * The suite this replaces had eleven tests, and every one of them ended in
 * `expect(page.locator('main h1')).toBeVisible()`, including the one named
 * `handles API errors gracefully`. Seven addressed tabs by emoji that a later
 * refactor deleted. It could not fail when the page was wrong.
 *
 * These assert the claims the page makes: the stance is specific, it never
 * repeats the API's plan sentence, every engine is accounted for, a chart is
 * never empty, the zones and ranges deep-link, and content clears the mobile nav.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

const STANCE = /^(TRAIN|EASY|REST)$/;

test.describe('Dashboard — Today', () => {
  test('states a stance and backs it with a number', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();

    const stance = page.locator('main span').filter({ hasText: STANCE }).first();
    await expect(stance).toBeVisible({ timeout: 15_000 });

    // The sentence under it must carry a figure — a stance with no evidence is the
    // failure mode this page exists to remove.
    const sentence = page.locator('main p').filter({ hasText: /form |recovery|engines/i }).first();
    await expect(sentence).toContainText(/\d/);
  });

  test('never repeats the API headline claim about a plan', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    await expect(page.locator('main span').filter({ hasText: STANCE }).first()).toBeVisible({
      timeout: 15_000,
    });
    // The mocked verdict's own headline says "train as planned". The page composes
    // its sentence from fields, so that string must never reach the screen.
    await expect(page.locator('main')).not.toContainText(/as planned/i);
    await expect(page.locator('main')).not.toContainText(/today's plan/i);
  });

  test('accounts for every engine the verdict contains', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    const list = page.getByRole('list', { name: 'Verdict engines' });
    await expect(list).toBeVisible({ timeout: 15_000 });
    // Exactly one row per engine in the payload the page was given — a silent engine
    // must be visible, not omitted. This is the "2 of 6 signals" failure.
    await expect(list.locator('li')).toHaveCount(mockData.mockTodaySummary.verdict.consensus.length);
  });

  test('renders the cross-domain strip as an accessible figure', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    await expect(
      page.getByRole('img', { name: /daily cycling load and HRV/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('shows recent rows, not an empty card', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    await expect(page.getByText('Recent', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main')).not.toContainText(/Nothing recorded yet/i);
  });
});

test.describe('Dashboard — zones and deep links', () => {
  test('a legacy ?tab=weekly bookmark lands on Trends', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard?tab=weekly');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
    // ...and the URL is rewritten to the new contract.
    await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('trends');
  });

  test('changing the range updates the URL and the range control', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard?view=trends&range=90d');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('tab', { name: '30D' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('range')).toBe('30d');
  });

  test('History renders the month table', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard?view=history');
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('columnheader', { name: /Month/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Recovery/i })).toBeVisible();
  });

  test('the analysis is rendered as prose, never as markdown source', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard?view=trends');
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible({ timeout: 15_000 });
    await page.getByText('Performance analysis').click();
    // Asterisks in the visible text is the bug: the string is markdown and used to be
    // dropped into a div.
    await expect(page.locator('main')).not.toContainText('**');
  });
});

test.describe('Dashboard — failure and layout', () => {
  test('a failed verdict shows an error with a retry, not an empty page', async ({ authenticatedPage: page }) => {
    await page.route('**/api/v1/dashboard/today', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'boom' }) }),
    );
    await page.goto('/fittrack/dashboard');
    await expect(page.getByText(/could not load today's verdict/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
  });

  test('no horizontal scroll at 390, 768 or 1440', async ({ authenticatedPage: page }) => {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/fittrack/dashboard');
      await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
      const over = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(over.scrollW, `overflow at ${width}px`).toBeLessThanOrEqual(over.clientW + 1);
    }
  });

  test('content clears the fixed bottom nav at 390', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fittrack/dashboard');
    await expect(page.locator('main')).toBeVisible({ timeout: 15_000 });
    // Let the zone settle before scrolling: charts and the strip change the page height.
    await expect(page.getByRole('list', { name: 'Verdict engines' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(800);

    const clearance = await page.evaluate(() => {
      const nav = document.querySelector('nav.fixed.bottom-0');
      const main = document.querySelector('main');
      if (!nav || !main) return { ok: true, gap: 0 };
      // <main> holds one padded wrapper (pb-tabbar-clear); the wrapper's bottom is the
      // viewport bottom by construction. The element that must clear the nav is the
      // wrapper's last content child.
      const wrapper = main.lastElementChild as HTMLElement | null;
      const last = (wrapper?.lastElementChild ?? wrapper) as HTMLElement | null;
      if (!last) return { ok: true, gap: 0 };
      return { ok: last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top, gap: 0 };
    });
    expect(clearance.ok, 'the last content element sits under the bottom nav').toBe(true);
  });
});
