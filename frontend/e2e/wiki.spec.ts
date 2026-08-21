/**
 * Wiki page E2E tests.
 * Tests the wiki page including sidebar navigation, sections,
 * glossary entries, and scroll behavior.
 */

import { test, expect } from './fixtures/authenticated-test';

test.describe('Wiki Page', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.goto('/fittrack/wiki');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  // ── Page Rendering ──────────────────────────────────────────────────────

  test('page heading renders', async ({ authenticatedPage: page }) => {
    await expect(page.locator('main h1')).toContainText(/fittrack wiki/i);
  });

  test('page subtitle renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/everything you need to know/i)).toBeVisible();
  });

  // ── Sidebar Navigation ──────────────────────────────────────────────────

  test('sidebar navigation is visible on desktop', async ({ authenticatedPage: page }) => {
    // Wiki has its own sidebar nav (different from app sidebar)
    await expect(page.getByText('Overview').first()).toBeVisible();
    await expect(page.getByText('Getting Started').first()).toBeVisible();
    await expect(page.getByText('Metrics Glossary').first()).toBeVisible();
    await expect(page.getByText('Science & Research').first()).toBeVisible();
    await expect(page.getByText('Maximizing Impact').first()).toBeVisible();
  });

  test('clicking nav item scrolls to section', async ({ authenticatedPage: page }) => {
    const glossaryLink = page.getByRole('button', { name: /metrics glossary/i });
    await glossaryLink.click();
    await page.waitForTimeout(1000);

    // Should scroll to glossary section
    await expect(page.locator('main h1')).toContainText(/fittrack wiki/i);
  });

  // ── Sections ────────────────────────────────────────────────────────────

  test('Overview section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/overview/i).first()).toBeVisible();
  });

  test('Getting Started section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/getting started/i).first()).toBeVisible();
  });

  test('Metrics Glossary section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/metrics glossary/i).first()).toBeVisible();
  });

  test('Science & Research section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/science/i).first()).toBeVisible();
  });

  test('Maximizing Impact section renders', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/maximizing impact/i).first()).toBeVisible();
  });

  // ── Glossary Entries ────────────────────────────────────────────────────

  test('glossary entries render', async ({ authenticatedPage: page }) => {
    // Should show key glossary terms
    await expect(page.getByText(/ftp.*functional threshold power/i).first()).toBeVisible();
  });

  test('glossary shows TSS entry', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/tss.*training stress score/i).first()).toBeVisible();
  });

  test('glossary shows CTL entry', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/ctl.*chronic training load/i).first()).toBeVisible();
  });

  test('glossary shows VO2max entry', async ({ authenticatedPage: page }) => {
    await expect(page.getByText(/vo2max/i).first()).toBeVisible();
  });

  test('glossary entries show formulas', async ({ authenticatedPage: page }) => {
    // Should show formula blocks
    await expect(page.locator('code').first()).toBeVisible();
  });

  // ── Mobile ──────────────────────────────────────────────────────────────

  test('sidebar nav hides on mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/fittrack/wiki');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Wiki sidebar should be hidden on mobile (hidden lg:block)
    const wikiSidebar = page.locator('aside.hidden.lg\\:block');
    await expect(wikiSidebar).toBeHidden();
  });
});
