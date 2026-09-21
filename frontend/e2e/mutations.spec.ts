/**
 * Mutation-flow E2E tests (B-35). Unlike the render-heavy specs, these drive
 * create/update flows end-to-end (against mocked API responses) plus
 * deep-links and the new /today brief.
 */

import { test, expect } from './fixtures/authenticated-test';
import * as mockData from './fixtures/mock-data';

test.describe('Lifting session creation', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/lifting');
    await page.waitForLoadState('networkidle');
  });

  test('new session form opens and submits', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /\+ New Session/i }).click();
    await expect(page.getByText(/New Lifting Session/i)).toBeVisible();

    // Register the POST mock AFTER the fixture (last registration wins).
    await page.route('**/api/v1/lifting/sessions', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ ...mockData.mockLiftingSessions[0], id: 'lift-new', focus: 'Push Day' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.locator('input[type="date"]').first().fill('2026-09-20');
    await page.getByPlaceholder(/upper body, legs, push/i).fill('Push Day');
    await page.getByRole('button', { name: /^Create Session$/i }).click();

    // Form closes on success (mutation onSuccess hides it).
    await expect(page.getByText(/New Lifting Session/i)).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Goal creation', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/goals');
    await page.waitForLoadState('networkidle');
  });

  test('create-goal modal opens with metric picker', async ({ authenticatedPage: page }) => {
    await page.getByRole('button', { name: /\+ New Goal/i }).click();
    await expect(page.getByRole('dialog', { name: /create goal/i })).toBeVisible();
    await expect(page.getByText(/Metric/i).first()).toBeVisible();
  });
});

test.describe('Deep links', () => {
  test('activity deep-link selects the record', async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/activities?activity=act-1');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Surrey Hills/i).first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Today brief (B-16)', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/today');
    await page.waitForLoadState('networkidle');
  });

  test('renders verdict with visible reasoning', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/Today's Brief/i)).toBeVisible();
    // Recovery 72 + mocked debt 1.5h → green verdict with signal rows.
    await expect(page.getByText(/Green light/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Recovery/i).first()).toBeVisible();
  });

  test('renders sleep-debt-aware top insight', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/Insight of the Day/i)).toBeVisible();
    await expect(page.getByText(/7h\+/i).first()).toBeVisible({ timeout: 8000 });
  });
});
