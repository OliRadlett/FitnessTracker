// Which requests 404 on the deployed pages?
//
// Run from prototype/relive: node qa/frontend-prod-404s.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
});
const page = await context.newPage();
page.on('response', (response) => {
  if (response.status() >= 400) {
    console.log(response.status(), response.url().slice(0, 140));
  }
});

for (const path of ['/fittrack/replay', '/fittrack']) {
  console.log(`--- ${path} ---`);
  await page.goto(`https://oliradlett.co.uk${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
}

await browser.close();
