// The activity page must offer Relive 3D as the primary 3D action, with the
// classic theater still reachable.
//
// Run from prototype/relive: node qa/frontend-activity-entry.mjs [activity-id]

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const activityId = process.argv[2] ?? '8c24a0f6-f069-4c4e-bc68-61e8f6a867fb';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-webgl'] });
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

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`http://localhost:3000/fittrack/activities?activity=${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(6000);

// Open the detail's 3D tab.
const tab = page.getByText('Replay', { exact: true }).first();
if (await tab.count()) {
  await tab.click();
  await page.waitForTimeout(2500);
}

const link = page.getByRole('link', { name: /Watch in Relive 3D/i }).first();
check('activity page offers Relive 3D', (await link.count()) > 0);
const href = await link.getAttribute('href').catch(() => null);
check('link points at the viewer', Boolean(href?.includes('/relive3d/')), href ?? 'none');

const classic = page.getByRole('button', { name: /classic theater/i }).first();
check('classic theater still reachable', (await classic.count()) > 0);
await page.screenshot({ path: 'qa/out/frontend-activity-entry.png' });

if (href) {
  await link.click();
  await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
  await page.waitForTimeout(6000);
  check('clicking opens the viewer', page.url().includes('/relive3d/'), page.url().replace('http://localhost:3000', ''));
  await page.screenshot({ path: 'qa/out/frontend-activity-entry-viewer.png' });
}

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
