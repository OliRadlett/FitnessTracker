// Debug: dump the dock's buttons on a production ride with route history.
//
// Run from prototype/relive: node qa/frontend-prod-dock-probe.mjs <activity-id>

import { chromium } from '@playwright/test';

const activityId = process.argv[2] ?? '5c0b9287-463a-418a-8c59-dc257cd33ff6';

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-webgl'] });
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('response', async (response) => {
  if (response.url().includes('/ghosts')) {
    console.log('GHOSTS', response.status(), JSON.stringify(await response.json()).slice(0, 400));
  }
});

await page.goto(`https://oliradlett.co.uk/fittrack/relive3d/${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(9000);

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll('button')).map((b) => ({
    text: (b.textContent ?? '').trim().slice(0, 40),
    cls: (b.className ?? '').toString().slice(0, 60),
  })),
);
console.log('buttons:', JSON.stringify(buttons, null, 1).slice(0, 2000));
await page.screenshot({ path: 'qa/out/frontend-prod-dock-probe.png' });

await browser.close();
