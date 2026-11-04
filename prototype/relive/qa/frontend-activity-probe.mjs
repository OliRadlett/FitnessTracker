// Debug: what does the activity detail show on its 3D tab?
//
// Run from prototype/relive: node qa/frontend-activity-probe.mjs [activity-id]

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const activityId = process.argv[2] ?? '8c24a0f6-f069-4c4e-bc68-61e8f6a867fb';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 200)));

await page.goto(`http://localhost:3000/fittrack/activities?activity=${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(8000);
console.log('URL', page.url());

const tabs = await page.locator('button').evaluateAll((nodes) =>
  nodes.map((n) => (n.textContent ?? '').trim()).filter((t) => /replay|3d|theater/i.test(t)),
);
console.log('matching buttons:', tabs);

const body = await page.locator('body').innerText();
console.log('--- body (first 700) ---');
console.log(body.slice(0, 700));
await page.screenshot({ path: 'qa/out/frontend-activity-probe.png' });

await browser.close();
