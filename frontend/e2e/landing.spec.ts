/**
 * Landing page E2E tests.
 * Tests the login page at / (root) which shows sign-in buttons
 * or redirects to /dashboard when a session exists.
 */

import { test, expect } from './fixtures/authenticated-test';

const BASE = 'https://localhost/fittrack';

test.describe('Landing Page', () => {
  test('shows sign-in buttons when unauthenticated', async ({ page }) => {
    // Override session to return unauthenticated
    await page.route('**/api/auth/session', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Should show the app title
    await expect(page.locator('h1')).toContainText('Fitness Tracker');

    // Should show sign-in buttons
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /continue with github/i })).toBeVisible();

    // Should show the description text
    await expect(page.getByText(/track your activities/i)).toBeVisible();
  });

  test('shows app branding elements', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Should show the muscle emoji
    await expect(page.locator('text=💪')).toBeVisible();

    // Should show the subtitle
    await expect(page.getByText(/track cycling, running/i)).toBeVisible();
  });

  test('redirects to dashboard when session exists', async ({ authenticatedPage: page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // Should redirect to /dashboard
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('shows loading state while checking session', async ({ page }) => {
    // Delay the session response to observe loading state
    await page.route('**/api/auth/session', async (route) => {
      await new Promise((r) => setTimeout(r, 1000));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(BASE);

    // Should show a loading spinner
    const spinner = page.locator('.animate-spin');
    await expect(spinner).toBeVisible();

    // Wait for loading to complete
    await page.waitForLoadState('networkidle');
  });

  test('Google sign-in button is clickable', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const googleButton = page.getByRole('button', { name: /continue with google/i });
    await expect(googleButton).toBeEnabled();
  });

  test('GitHub sign-in button is clickable', async ({ page }) => {
    await page.route('**/api/auth/session', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    const githubButton = page.getByRole('button', { name: /continue with github/i });
    await expect(githubButton).toBeEnabled();
  });
});
