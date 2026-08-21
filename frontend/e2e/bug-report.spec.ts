/**
 * Bug Report — automated walkthrough of FitTrack frontend.
 *
 * Navigates through all major pages, captures screenshots, and checks
 * for common issues (broken images, console errors, missing elements).
 *
 * Run: npx playwright test e2e/bug-report.spec.ts --reporter=list
 */

import { test, expect, Page } from '@playwright/test';

const BASE = 'https://localhost/fittrack';

// Collect console errors across all tests
const consoleErrors: string[] = [];
const networkErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  // Collect console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  // Collect failed network requests
  page.on('requestfailed', (request) => {
    networkErrors.push(`[FAIL] ${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });
});

test.afterAll(async () => {
  console.log('\n═══════════════════════════════════════════');
  console.log('BUG REPORT SUMMARY');
  console.log('═══════════════════════════════════════════');

  if (consoleErrors.length > 0) {
    console.log(`\n⚠️  Console Errors (${consoleErrors.length}):`);
    consoleErrors.forEach((e) => console.log(`  • ${e}`));
  } else {
    console.log('\n✅ No console errors detected');
  }

  if (networkErrors.length > 0) {
    console.log(`\n⚠️  Network Errors (${networkErrors.length}):`);
    networkErrors.forEach((e) => console.log(`  • ${e}`));
  } else {
    console.log('✅ No network errors detected');
  }

  console.log('\n═══════════════════════════════════════════\n');
});

// ── Helper: wait for page to be stable ──────────────────────────────────

async function waitForPage(page: Page, name: string) {
  // Wait for network to be idle
  await page.waitForLoadState('networkidle').catch(() => {});
  // Small delay for React rendering
  await page.waitForTimeout(1000);
  // Take screenshot
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}

// ── Tests ───────────────────────────────────────────────────────────────

test.describe('FitTrack Bug Report', () => {

  test('01 — Landing page loads', async ({ page }) => {
    await page.goto(BASE);
    await waitForPage(page, '01-landing');

    // Should see sign-in or redirect to dashboard
    const title = await page.title();
    console.log(`  Page title: ${title}`);
  });

  test('02 — Dashboard page', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await waitForPage(page, '02-dashboard');

    // Check for key elements
    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Dashboard heading: ${await heading.textContent()}`);
    }

    // Check for broken images
    const images = page.locator('img');
    const imageCount = await images.count();
    for (let i = 0; i < imageCount; i++) {
      const img = images.nth(i);
      const src = await img.getAttribute('src');
      // Attempt to decode the image before checking naturalWidth
      await img.evaluate(el => (el as HTMLImageElement).decode().catch(() => {}));
      const isSvg = await img.evaluate(el => (el as HTMLImageElement).src.endsWith('.svg'));
      if (isSvg) continue; // SVGs may report naturalWidth=0 in headless Chrome
      const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      if (naturalWidth === 0 && src) {
        console.log(`  ⚠️  Broken image: ${src}`);
      }
    }
  });

  test('03 — Cycling page', async ({ page }) => {
    await page.goto(`${BASE}/cycling`);
    await waitForPage(page, '03-cycling');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Cycling heading: ${await heading.textContent()}`);
    }
  });

  test('04 — Lifting page', async ({ page }) => {
    await page.goto(`${BASE}/lifting`);
    await waitForPage(page, '04-lifting');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Lifting heading: ${await heading.textContent()}`);
    }
  });

  test('05 — Activities page', async ({ page }) => {
    await page.goto(`${BASE}/activities`);
    await waitForPage(page, '05-activities');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Activities heading: ${await heading.textContent()}`);
    }
  });

  test('06 — Calendar page', async ({ page }) => {
    await page.goto(`${BASE}/calendar`);
    await waitForPage(page, '06-calendar');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Calendar heading: ${await heading.textContent()}`);
    }
  });

  test('07 — Routes page', async ({ page }) => {
    await page.goto(`${BASE}/routes`);
    await waitForPage(page, '07-routes');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Routes heading: ${await heading.textContent()}`);
    }
  });

  test('08 — Training page', async ({ page }) => {
    await page.goto(`${BASE}/training`);
    await waitForPage(page, '08-training');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Training heading: ${await heading.textContent()}`);
    }
  });

  test('09 — Settings page — check logos', async ({ page }) => {
    await page.goto(`${BASE}/settings`);
    await waitForPage(page, '09-settings');

    // Check integration logos
    const integrationImages = page.locator('img[alt="Strava"], img[alt="Komoot"], img[alt="Wahoo"], img[alt="Whoop"]');
    const count = await integrationImages.count();
    console.log(`  Integration logos found: ${count}`);

    for (let i = 0; i < count; i++) {
      const img = integrationImages.nth(i);
      const alt = await img.getAttribute('alt');
      const src = await img.getAttribute('src');
      // Attempt to decode the image before checking naturalWidth
      await img.evaluate(el => (el as HTMLImageElement).decode().catch(() => {}));
      const isSvg = await img.evaluate(el => (el as HTMLImageElement).src.endsWith('.svg'));
      if (isSvg) {
        console.log(`  ✅ Logo OK: ${alt} (SVG, skipped naturalWidth check)`);
        continue;
      }
      const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      if (naturalWidth === 0) {
        console.log(`  ⚠️  Broken logo: ${alt} (src: ${src})`);
      } else {
        console.log(`  ✅ Logo OK: ${alt} (${naturalWidth}px wide)`);
      }
    }
  });

  test('10 — Wiki page', async ({ page }) => {
    await page.goto(`${BASE}/wiki`);
    await waitForPage(page, '10-wiki');

    const heading = page.locator('h1').first();
    if (await heading.isVisible()) {
      console.log(`  Wiki heading: ${await heading.textContent()}`);
    }
  });

  test('11 — Sidebar navigation works', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);

    // Check sidebar links
    const navLinks = page.locator('nav a');
    const linkCount = await navLinks.count();
    console.log(`  Sidebar nav links: ${linkCount}`);

    for (let i = 0; i < linkCount; i++) {
      const link = navLinks.nth(i);
      const text = await link.textContent();
      const href = await link.getAttribute('href');
      console.log(`    • ${text?.trim()} → ${href}`);
    }
  });

  test('12 — Check for broken images across all pages', async ({ page }) => {
    test.setTimeout(90000); // 90s — navigates through 9 pages
    const pages = ['dashboard', 'cycling', 'lifting', 'activities', 'calendar', 'routes', 'training', 'settings', 'wiki'];
    let brokenCount = 0;

    for (const pageName of pages) {
      await page.goto(`${BASE}/${pageName}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(500);

      const images = page.locator('img');
      const count = await images.count();

      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        const src = await img.getAttribute('src');
        // Attempt to decode the image before checking naturalWidth
        await img.evaluate(el => (el as HTMLImageElement).decode().catch(() => {}));
        const isSvg = await img.evaluate(el => (el as HTMLImageElement).src.endsWith('.svg'));
        if (isSvg) continue; // SVGs may report naturalWidth=0 in headless Chrome
        const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        if (naturalWidth === 0 && src) {
          console.log(`  ⚠️  Broken image on /${pageName}: ${src}`);
          brokenCount++;
        }
      }
    }

    console.log(`  Total broken images: ${brokenCount}`);
  });
});
