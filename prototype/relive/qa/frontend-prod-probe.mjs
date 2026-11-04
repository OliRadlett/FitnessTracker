// Debug: open the deployed /replay list, take the first ride, then open the
// deployed viewer for it.
//
// Run from prototype/relive: node qa/frontend-prod-probe.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 200)));
page.on('response', (response) => {
  if (response.url().includes('/api/v1/activities/')) {
    console.log('HTTP', response.status(), response.url().slice(0, 140));
  }
});

await page.goto('https://oliradlett.co.uk/fittrack/replay', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('replay list URL', page.url());

const first = page.locator('a[href*="/relive3d/"]').first();
const count = await first.count();
console.log('relive3d cards:', count);
const href = count ? await first.getAttribute('href') : null;
console.log('first href:', href);
await page.screenshot({ path: 'qa/out/frontend-prod-list.png' });

if (!href) {
  console.log((await page.locator('body').innerText()).slice(0, 600));
  await browser.close();
  process.exit(1);
}

await page.goto(`https://oliradlett.co.uk${href}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(14000);
console.log('viewer URL', page.url());
console.log((await page.locator('body').innerText()).slice(0, 500));
console.log('markers:', await page.locator('gmp-marker-3d').count());
await page.screenshot({ path: 'qa/out/frontend-prod-probe.png' });

await browser.close();
