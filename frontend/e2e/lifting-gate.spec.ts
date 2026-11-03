import { test, expect } from './fixtures/authenticated-test';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.resolve('test-results', 'lifting-gate');

test.describe('lifting production gate', () => {
  test.beforeAll(() => {
    fs.mkdirSync(OUT, { recursive: true });
  });

  test('desktop states', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const states: [string, string][] = [
      ['01-overview', '/fittrack/lifting?tab=overview'],
      ['02-sessions', '/fittrack/lifting?tab=sessions'],
      ['04-analytics', '/fittrack/lifting?tab=analytics'],
      ['05-prs', '/fittrack/lifting?tab=prs'],
    ];
    for (const [name, url] of states) {
      await page.goto(url);
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} overflow`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    }

    // Detail state, scrolled to the ladder.
    await page.goto('/fittrack/lifting?tab=sessions');
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollBy(0, 360));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '03-detail.png') });
  });

  test('mobile states', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, url] of [
      ['06-overview-mobile', '/fittrack/lifting?tab=overview'],
      ['07-sessions-mobile', '/fittrack/lifting?tab=sessions'],
    ] as [string, string][]) {
      await page.goto(url);
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} overflow`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    }

    const row = page.locator('main button').filter({ hasText: /squat day/i }).filter({ hasText: /8,500 kg/ }).first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, '08-detail-mobile.png') });
    }
  });
});
