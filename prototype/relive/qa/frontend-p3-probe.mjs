// Debug: what does the production relive3d page render with a QA session?
//
// Run from prototype/relive: node qa/frontend-p3-probe.mjs <activity-id>

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const activityId = process.argv[2] ?? '8c24a0f6-f069-4c4e-bc68-61e8f6a867fb';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addCookies([
  {
    name: session.name,
    value: session.value,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  },
]);
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));
page.on('console', (message) => console.log('CONSOLE', message.type(), message.text().slice(0, 200)));
page.on('response', (response) => {
  if (response.url().includes('/api/')) {
    console.log('HTTP', response.status(), response.url());
  }
});

await page.goto(`http://localhost:3000/fittrack/relive3d/${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(12000);

console.log('URL', page.url());
console.log('--- body ---');
console.log((await page.locator('body').innerText()).slice(0, 1200));
await page.screenshot({ path: 'qa/out/frontend-p3-probe.png' });

await browser.close();
