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
import { mockTrainingPlan } from './fixtures/mock-data';
import * as mockData from './fixtures/mock-data';

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
    await expect(page.getByRole('button', { name: /go to plans/i })).toBeVisible();
  });
});

test.describe('Training Page — plan blocks (C1)', () => {
  test('the strip opens the Blocks editor and posts a new block', async ({
    authenticatedPage: page,
  }) => {
    // The strip fetches its blocks on load; without this the editor would have
    // nothing to list. The fixture answers [] for /blocks.
    const blocksRequest = page.waitForRequest(
      (r) => r.method() === 'GET' && r.url().includes('/blocks'),
    );
    await page.goto('/fittrack/training');
    await blocksRequest;

    // The editor is the interactive half of C1 — reachable, and its form wired
    // to the block endpoint. Without this the strip could render bands that
    // nothing can ever create.
    await page.getByRole('button', { name: 'Blocks' }).click();
    const dialog = page.getByRole('dialog', { name: 'Plan blocks' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/no blocks yet/i)).toBeVisible();

    // The add form is the last set of fields (one set precedes per block).
    await dialog.getByLabel('Block name').last().fill('Base 1');
    await dialog.getByLabel('Block start').last().fill('2026-08-03');
    await dialog.getByLabel('Block end').last().fill('2026-08-09');

    const [post] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === 'POST' && r.url().includes('/blocks'),
      ),
      dialog.getByRole('button', { name: /add block/i }).click(),
    ]);
    expect(post.postDataJSON()).toMatchObject({
      name: 'Base 1',
      start_date: '2026-08-03',
      end_date: '2026-08-09',
    });
  });
});

test.describe('Training Page — strength suggestions (plan §12.1)', () => {
  test('Apply All merges every suggested weight into the day', async ({
    authenticatedPage: page,
  }) => {
    // Only a strength plan renders the card (WeeklyView gates on plan_type).
    // The day also carries a lift that gets no suggestion, which is the case
    // the merge exists for: sending the suggestions alone would delete it.
    await page.route('**/api/v1/training-plans/plan-1', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          ...mockTrainingPlan,
          plan_type: 'strength',
          days: mockTrainingPlan.days.map((d) =>
            d.id === 'day-3'
              ? {
                  ...d,
                  planned_exercises: [
                    { exercise: 'Back Squat', sets: 5, reps: 5, weight_kg: 100, pct_1rm: 0.8 },
                    { exercise: 'Plank', sets: 3, reps: 1, weight_kg: 0 },
                  ],
                }
              : d,
          ),
        }),
      }),
    );

    const patches: {
      planned_exercises?: { exercise: string; weight_kg?: number; pct_1rm?: number }[];
    }[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/days/')) {
        patches.push(req.postDataJSON());
      }
    });

    await page.goto('/fittrack/training?plan=plan-1&day=2026-08-04');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: /apply all/i }).click();
    await expect(page.getByText(/all weight suggestions applied/i)).toBeVisible();

    // The day's list is replaced by whatever the call sends (the array PATCH is
    // destructive by omission), so one call per exercise keeps only the last,
    // and sending only the suggestions deletes every exercise they omit.
    expect(patches).toHaveLength(1);
    const sent = patches[0].planned_exercises ?? [];
    expect(sent.map((e) => e.exercise)).toEqual([
      'Back Squat',
      'Plank',
      'Romanian Deadlift',
    ]);
    expect(sent[0]).toMatchObject({ weight_kg: 105, pct_1rm: 0.8 });
    expect(sent[1]).toMatchObject({ weight_kg: 0 });
    expect(sent[2]).toMatchObject({ weight_kg: 85 });
  });
});

test.describe('Training Page — week ahead (C3)', () => {
  test('Review mode shows the persisted weekly review', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/fittrack/training?mode=review');
    await page.waitForLoadState('networkidle');

    // The card is the only surface for the persisted review; without it the C3
    // backend work is invisible.
    await expect(page.getByText('Week ahead')).toBeVisible();
    await expect(page.getByText('Week of 3 Aug 2026')).toBeVisible();
    await expect(page.getByText('CTL 48 · ATL 43 · TSB +5')).toBeVisible();
    await expect(page.getByText('72% · stable')).toBeVisible();
    await expect(page.getByText('2 missed · 5 Aug, 7 Aug')).toBeVisible();
    await expect(
      page.getByText('Hold the build; you are absorbing the load well.'),
    ).toBeVisible();
    await expect(page.getByText('Active goals')).toBeVisible();
  });

  test('renders with load, conformity and adaptive all degraded', async ({
    authenticatedPage: page,
  }) => {
    // Each engine degrades to null independently, so this is the designed
    // state, not an error. Registered after the fixture, so it wins.
    await page.route('**/api/v1/training-plans/*/review*', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          ...mockData.mockPlanReview,
          load: null,
          conformity: null,
          adaptive: null,
        }),
      }),
    );
    await page.goto('/fittrack/training?mode=review');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Week of 3 Aug 2026')).toBeVisible();
    await expect(page.getByText('2 missed · 5 Aug, 7 Aug')).toBeVisible();
    await expect(
      page.getByText('Not available this week: load, conformity, adaptive advice.'),
    ).toBeVisible();
    await expect(page.getByText('CTL 48 · ATL 43 · TSB +5')).toHaveCount(0);
  });
});

test.describe('Training Page — multi-sport days', () => {
  /**
   * One date holds two sessions (a lift and a ride). The fixture for this case
   * is its own (`mockTrainingWeekMultiSport`) so the cases above keep asserting
   * against the one-session-per-date week they were written for.
   */
  test('a date holding two sessions renders a chip each, keyed by session', async ({
    authenticatedPage: page,
  }) => {
    await page.route(/\/api\/v1\/training-plans\/[^/]+\/week\/\d+/, (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify(mockData.mockTrainingWeekMultiSport),
      }),
    );
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');

    const twoSessions = page.locator('#plan-day-2026-08-06');
    await expect(twoSessions).toBeVisible();

    // A chip per session, not one day overwriting the other.
    const squatChip = twoSessions.getByRole('button', { name: 'Squat' });
    const rideChip = twoSessions.getByRole('button', { name: /45 TSS/ });
    await expect(squatChip).toBeVisible();
    await expect(rideChip).toBeVisible();

    // The one-session date still renders its full body.
    const oneSession = page.locator('#plan-day-2026-08-05');
    await expect(oneSession.getByText(/60 min/)).toBeVisible();

    // "Add session" is offered while a sport is missing, and disabled once the
    // date holds both.
    await expect(
      oneSession.getByTitle('Add a strength session on 2026-08-05'),
    ).toBeVisible();
    await expect(
      twoSessions.getByRole('button', { name: 'Add session' }),
    ).toBeDisabled();

    // Each chip opens its own session's editor.
    await squatChip.click();
    await expect(page.getByText('2026-08-06 · Strength details')).toBeVisible();
    await expect(page.getByLabel('Sport')).toHaveValue('strength');
  });
});
