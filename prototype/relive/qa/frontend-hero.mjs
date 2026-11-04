// Hero-ride check: the most recent Lake Geneva ride (174.8 km) in the
// production viewer, which is a very different scale from the 19 km test loop.
//
// Run from prototype/relive: node qa/frontend-hero.mjs [activity-id]

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const activityId = process.argv[2] ?? '014e884f-4a17-4b51-93b5-8d71e466f6ae';
const OUT = 'qa/out';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
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

await page.goto(`http://localhost:3000/fittrack/relive3d/${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(10_000);
await page.screenshot({ path: `${OUT}/frontend-hero-overview.png` });

for (const [name, label] of [
  ['lausanne', 'Lausanne'],
  ['montreux', 'Montreux'],
  ['summit', 'Summit'],
]) {
  const button = page.getByRole('button', { name: label, exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(7000);
    await page.screenshot({ path: `${OUT}/frontend-hero-${name}.png` });
  }
}

const text = await page.locator('body').innerText();
console.log('ghost picker present:', /GHOST/i.test(text));
console.log('distance line:', text.match(/[\d.]+ km loop/)?.[0] ?? 'none');
console.log('markers:', await page.locator('gmp-marker-3d').count());

await browser.close();
