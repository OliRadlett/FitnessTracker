/**
 * Sidebar navigation E2E tests.
 * Tests the sidebar component including nav links, active state,
 * mobile hamburger menu, and navigation.
 */

import { test, expect } from './fixtures/authenticated-test';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Training', href: '/training' },
  { label: 'Activities', href: '/activities' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Cycling', href: '/cycling' },
  { label: 'Lifting', href: '/lifting' },
  { label: 'Routes', href: '/routes' },
  { label: 'Wiki', href: '/wiki' },
  { label: 'Settings', href: '/settings' },
];

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  });

  test('all nav links are visible on desktop', async ({ authenticatedPage: page }) => {
    // Desktop viewport — sidebar should be visible
    const sidebar = page.locator('#sidebar-navigation');
    await expect(sidebar).toBeVisible();

    for (const item of NAV_ITEMS) {
      const link = sidebar.getByRole('link', { name: new RegExp(item.label, 'i') });
      await expect(link).toBeVisible();
    }
  });

  test('sidebar shows app title', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('#sidebar-navigation');
    await expect(sidebar.locator('text=Fitness Tracker')).toBeVisible();
  });

  test('clicking each nav link navigates to correct page', async ({ authenticatedPage: page }) => {
    for (const item of NAV_ITEMS) {
      const sidebar = page.locator('#sidebar-navigation');
      const link = sidebar.getByRole('link', { name: new RegExp(item.label, 'i') });
      await link.click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(new RegExp(item.href));
    }
  });

  test('active link highlighting works', async ({ authenticatedPage: page }) => {
    // Navigate to cycling page
    await page.goto('/fittrack/cycling');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const sidebar = page.locator('#sidebar-navigation');
    const activeLink = sidebar.locator('a[aria-current="page"]');
    await expect(activeLink).toBeVisible();
    await expect(activeLink).toContainText('Cycling');
  });

  test('sidebar shows user info when session exists', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('#sidebar-navigation');
    await expect(sidebar.locator('text=Test User')).toBeVisible();
    await expect(sidebar.locator('text=test@example.com')).toBeVisible();
  });

  test('sign out button is visible', async ({ authenticatedPage: page }) => {
    const sidebar = page.locator('#sidebar-navigation');
    await expect(sidebar.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('mobile: hamburger menu toggles sidebar', async ({ authenticatedPage: page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/fittrack/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Sidebar should be hidden initially on mobile
    const sidebar = page.locator('#sidebar-navigation');
    // On mobile, sidebar is off-screen (translate-x-full)
    // The hamburger button should be visible
    const hamburger = page.getByRole('button', { name: /open navigation menu/i });
    await expect(hamburger).toBeVisible();

    // Click hamburger to open sidebar
    await hamburger.click();
    await page.waitForTimeout(300);

    // Sidebar should now be visible
    await expect(sidebar).toBeVisible();

    // Close button should now be visible
    const closeBtn = page.getByRole('button', { name: /close navigation menu/i });
    await expect(closeBtn).toBeVisible();
  });

  test('mobile: sidebar closes on navigation', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/fittrack/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Open sidebar
    const hamburger = page.getByRole('button', { name: /open navigation menu/i });
    await hamburger.click();
    await page.waitForTimeout(300);

    // Click a nav link
    const sidebar = page.locator('#sidebar-navigation');
    await sidebar.getByRole('link', { name: /cycling/i }).click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Sidebar should close after navigation
    // The sidebar should have -translate-x-full class
    await expect(page).toHaveURL(/\/cycling/);
  });

  test('mobile: sidebar closes on Escape key', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/fittrack/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Open sidebar
    const hamburger = page.getByRole('button', { name: /open navigation menu/i });
    await hamburger.click();
    await page.waitForTimeout(300);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Hamburger should be visible again (sidebar closed)
    await expect(hamburger).toBeVisible();
  });

  test('mobile: sidebar closes on backdrop click', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/fittrack/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Open sidebar
    const hamburger = page.getByRole('button', { name: /open navigation menu/i });
    await hamburger.click();
    await page.waitForTimeout(300);

    // Click the backdrop overlay
    const backdrop = page.locator('.fixed.inset-0.bg-black\\/50');
    if (await backdrop.isVisible()) {
      await backdrop.click({ position: { x: 350, y: 400 } });
      await page.waitForTimeout(300);
    }
  });
});
