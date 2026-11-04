// Production: does an activity lead into Relive 3D, and what 404s on the way?
//
// Run from prototype/relive: node qa/frontend-prod-activity-entry.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('response', (response) => {
  if (response.status() >= 400) console.log('HTTP', response.status(), response.url().slice(0, 130));
});

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto('https://oliradlett.co.uk/fittrack/activities', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.getByText('55.63 km').first().click();
await page.waitForTimeout(6000);
await page.getByText('Replay', { exact: true }).first().click();
await page.waitForTimeout(3000);

const link = page.getByRole('link', { name: /Watch in Relive 3D/i }).first();
check('activity page offers Relive 3D', (await link.count()) > 0);
const href = await link.getAttribute('href').catch(() => null);
check('link points at the viewer', Boolean(href?.includes('/relive3d/')), href ?? 'none');
check('classic theater still reachable', (await page.getByText(/classic theater/i).count()) > 0);
await page.screenshot({ path: 'qa/out/frontend-prod-activity-entry.png' });

if (href) {
  await link.click();
  await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
  await page.waitForTimeout(7000);
  check('opens the viewer', page.url().includes('/relive3d/'), page.url().replace('https://oliradlett.co.uk', ''));
  await page.screenshot({ path: 'qa/out/frontend-prod-activity-viewer.png' });
}

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
