/**
 * Capture the production /training surface for review (mocked API, real render).
 * Not part of the gate suite — this is the "look at it" step.
 */
import { test } from './fixtures/authenticated-test';
import { mockTrainingWeek } from './fixtures/mock-data';
import * as fs from 'fs';
import * as path from 'path';

const OUT = path.join(__dirname, 'out');

async function shot(page: any, name: string, url: string, fullPage = false) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const audit = await page.evaluate(() => {
    const texts: HTMLElement[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<HTMLElement>();
    let n: Node | null;
    while ((n = w.nextNode())) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (el && !seen.has(el)) {
        seen.add(el);
        texts.push(el);
      }
    }
    let smallest = 99;
    for (const el of texts) {
      const s = parseFloat(getComputedStyle(el).fontSize);
      if (s < smallest) smallest = s;
    }
    return {
      smallestFont: smallest,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      docHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
    };
  });
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(audit, null, 2));
  return audit;
}

test.describe('training surface', () => {
  test('desktop', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const a = await shot(page, '01-week-desktop', '/fittrack/training');
    const b = await shot(page, '02-plan-desktop', '/fittrack/training?view=plan', true);
    const c = await shot(page, '03-day-expanded', '/fittrack/training?plan=plan-1&day=2026-08-05', true);
    console.log('desktop audits', JSON.stringify({ a, b, c }));
  });

  test('mobile', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const a = await shot(page, '04-week-mobile', '/fittrack/training', true);
    const b = await shot(page, '05-plan-mobile', '/fittrack/training?view=plan', true);
    console.log('mobile audits', JSON.stringify({ a, b }));
  });

  test('empty week (the state the primary action exists for)', async ({
    authenticatedPage: page,
  }) => {
    // The owner's real plan stops mid-way through its claimed range, so this is
    // the most common state, not an edge case.
    await page.route(/\/api\/v1\/training-plans\/[^/]+\/week\/\d+/, (route) =>
      route.fulfill({
        status: 200,
        body: JSON.stringify({ ...mockTrainingWeek, week_number: 3, days: [] }),
      }),
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    const a = await shot(page, '06-empty-week', '/fittrack/training?w=3');
    await page.setViewportSize({ width: 390, height: 844 });
    const b = await shot(page, '07-empty-week-mobile', '/fittrack/training?w=3', true);
    console.log('empty-week audits', JSON.stringify({ a, b }));
  });
});
