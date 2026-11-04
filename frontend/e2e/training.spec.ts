/**
 * Training page E2E — the plan-first surface (overhaul, 2026-11).
 *
 * Guards what replaced the Plan / Review / Peaks / Plans mode switch:
 *   - the coverage spine (weeks written vs. weeks claimed), not `completed/day_count`
 *   - Week and Plan as the only two surfaces, both URL-backed (`?view=`, `?w=`)
 *   - the `?plan=&day=` deep link (goal cards land on a day, not on a week)
 *   - the capabilities that had to survive the rewrite: the block editor,
 *     strength suggestions on a `custom` plan, and multi-sport days.
 *
 * All API calls are mocked by the auth fixture. Part of `test:e2e:ci`, so this
 * page cannot silently rot again.
 */

import { test, expect } from './fixtures/authenticated-test';
import { mockTrainingPlan } from './fixtures/mock-data';
import * as mockData from './fixtures/mock-data';

test.describe('Training Page — the week surface', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
  });

  test('names the plan and states its coverage before anything else', async ({
    authenticatedPage: page,
  }) => {
    // Scoped to `main`: the app shell's wordmark is also an h1 on every page.
    // mockTrainingPlanSummaries: plan-1 is the only `active` plan.
    await expect(page.locator('main h1')).toContainText('Base Building Block');
    // The line that replaced `47/49 · 96%`: weeks written, out of weeks claimed.
    await expect(page.getByTestId('coverage-sentence')).toContainText(/weeks written/i);
  });

  test('offers exactly two surfaces', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('tab', { name: 'Week' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Plan' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Peaks' })).toHaveCount(0);
  });

  test('renders the week as rows, one per date', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('heading', { name: /^Week \d+$/ })).toBeVisible();
    // WeeklyView's grid is gone; the row list is what a week is now.
    await expect(page.locator('#plan-day-2026-08-05')).toBeVisible();
  });

  test('says what should change, exactly once', async ({ authenticatedPage: page }) => {
    await expect(page.getByRole('heading', { name: 'What should change' })).toBeVisible();
    // The old Review mode printed the snapshot AND the live engine, so it
    // contradicted itself. One panel, one verdict.
    await expect(page.getByRole('heading', { name: 'What should change' })).toHaveCount(1);
  });
});

test.describe('Training Page — the plan surface', () => {
  test('the Plan tab shows coverage and survives a reload', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: 'Plan' }).click();

    // The coverage read, in whichever of its two forms applies: a plan written
    // end to end says so, and a plan that ran dry names the gap. Asserting only
    // the gap made this test fail on a complete plan — the state is the point,
    // not the alarm.
    await expect(page.getByText(/the plan is written/i)).toBeVisible();
    await expect(page.getByText(/^Week by week$/i)).toBeVisible();
    await expect(page.getByText(/^Coverage$/i)).toBeVisible();

    await page.goto('/fittrack/training?view=plan');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/^Week by week$/i)).toBeVisible();
  });

  test('the block editor is still reachable', async ({ authenticatedPage: page }) => {
    // C1's stored blocks lost their only entry point when the derived `Blocks`
    // histogram went away; the editor must not go with it.
    const blocksRequest = page.waitForRequest(
      (r) => r.method() === 'GET' && r.url().includes('/blocks'),
    );
    await page.goto('/fittrack/training?view=plan');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /blocks & phases/i }).click();
    await blocksRequest;
    await expect(page.getByRole('dialog', { name: 'Plan blocks' })).toBeVisible();
  });
});

test.describe('Training Page — deep links', () => {
  test('?plan=&day= opens the week with that day expanded', async ({
    authenticatedPage: page,
  }) => {
    // The goal-card deep link. The old view latched its "done" flag before the
    // week payload arrived, so a slow load left the card closed for good.
    await page.goto('/fittrack/training?plan=plan-1&day=2026-08-05');
    await page.waitForLoadState('networkidle');
    const day = page.locator('#plan-day-2026-08-05');
    await expect(day).toBeVisible();
    await page.waitForTimeout(700); // smooth scroll
    await expect(day).toBeInViewport();
    await expect(page.getByRole('checkbox', { name: 'Completed', exact: true })).toBeVisible();
  });

  test('an empty plan list shows the create-first-plan state', async ({
    authenticatedPage: page,
  }) => {
    await page.route('**/api/v1/training-plans**', (route) =>
      route.fulfill({ status: 200, body: JSON.stringify([]) }),
    );
    await page.goto('/fittrack/training');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/no plan yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create a plan/i })).toBeVisible();
  });
});

test.describe('Training Page — filling an empty week', () => {
  test('Write this week calls extend with the end of the viewed week', async ({
    authenticatedPage: page,
  }) => {
    // The most common state on the owner's real plan: content stops mid-plan, so
    // the week on screen is empty and the primary action used to do nothing.
    await page.route(/\/api\/v1\/training-plans\/[^/]+\/week\/\d+/, (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ ...mockData.mockTrainingWeek, week_number: 3, days: [] }),
      }),
    );
    await page.route('**/api/v1/training-plans/*/extend', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          plan_id: 'plan-1',
          created: 7,
          until: '2026-08-23',
          end_date: '2026-09-12',
          source_week: 1,
        }),
      }),
    );

    await page.goto('/fittrack/training?w=3');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/has no sessions/i)).toBeVisible();

    const [post] = await Promise.all([
      page.waitForRequest(
        (r) => r.method() === 'POST' && r.url().includes('/extend'),
      ),
      page.getByRole('button', { name: /write this week/i }).click(),
    ]);

    // `until` is the Sunday of the week being viewed — the pattern itself is the
    // server's business, and a client that computed it would be a second source
    // of truth for the plan's weekday shape.
    expect(post.postDataJSON()).toEqual({ until: '2026-08-09' });
  });

  test('Extend fills to the plan end, not just one week', async ({ authenticatedPage: page }) => {
    await page.route(/\/api\/v1\/training-plans\/[^/]+\/week\/\d+/, (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ ...mockData.mockTrainingWeek, week_number: 3, days: [] }),
      }),
    );
    await page.route('**/api/v1/training-plans/*/extend', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          plan_id: 'plan-1',
          created: 30,
          until: '2026-09-12',
          end_date: '2026-09-12',
          source_week: 1,
        }),
      }),
    );

    await page.goto('/fittrack/training?w=3');
    await page.waitForLoadState('networkidle');

    const [post] = await Promise.all([
      page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/extend')),
      page.getByRole('button', { name: /extend to/i }).click(),
    ]);

    expect(post.postDataJSON()).toEqual({ until: '2026-09-12' });
  });
});

test.describe('Training Page — capabilities that had to survive', () => {
  test('a custom plan with strength days renders strength suggestions', async ({
    authenticatedPage: page,
  }) => {
    // The old gate was `plan_type === 'strength'`, so S1–S4 never rendered for a
    // `custom` plan — including the owner's. The key is whether the plan has
    // strength days at all.
    await page.route('**/api/v1/training-plans/plan-1', (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          ...mockTrainingPlan,
          plan_type: 'custom',
          days: mockTrainingPlan.days.map((d) =>
            d.id === 'day-3'
              ? {
                  ...d,
                  // The card is keyed off *having a strength day*, not plan_type —
                  // the old `plan_type === 'strength'` gate hid S1–S4 from every
                  // custom plan. This plan is custom AND has a strength day.
                  sport: 'strength' as const,
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

    // Apply All must merge into the day's list: the array PATCH is destructive by
    // omission, so sending only the suggestions would delete the exercises they
    // omit — the bug this case exists to keep fixed.
    expect(patches).toHaveLength(1);
    const sent = patches[0].planned_exercises ?? [];
    expect(sent.map((e) => e.exercise)).toEqual(['Back Squat', 'Plank', 'Romanian Deadlift']);
    expect(sent[0]).toMatchObject({ weight_kg: 105, pct_1rm: 0.8 });
    expect(sent[1]).toMatchObject({ weight_kg: 0 });
    expect(sent[2]).toMatchObject({ weight_kg: 85 });
  });

  test('a date holding two sessions renders a row each', async ({ authenticatedPage: page }) => {
    // #297: one date may hold a lift and a ride. A one-day-per-date map silently
    // drops one of them, which is what this guards.
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
    await expect(page.getByText('Squat', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Ride|45 TSS/).first()).toBeVisible();
  });
});
