// Production verification of the deployed viewer.
//
// Uses the saved prod session (`frontend/e2e/prod-shots/.auth/storageState.json`),
// finds a ride the deployed /replay list offers, and drives the deployed viewer.
// This is the only check that exercises the production Maps key referrer rules
// and the real map budget.
//
// Run from prototype/relive: node qa/frontend-prod-verify.mjs

import { chromium } from '@playwright/test';

const OUT = 'qa/out';
const BASE = 'https://oliradlett.co.uk/fittrack';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 200)));

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`${BASE}/replay`, { waitUntil: 'domcontentloaded' });
const card = page.locator('a[href*="/relive3d/"]').first();
await card.waitFor({ state: 'attached', timeout: 45_000 }).catch(() => {});
check('deployed /replay offers the new viewer', (await card.count()) > 0);
const href = await card.getAttribute('href');
await page.screenshot({ path: `${OUT}/frontend-prod-replay-list.png` });

if (!href) {
  await browser.close();
  process.exit(1);
}

await page.goto(`https://oliradlett.co.uk${href}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(10_000);
await page.screenshot({ path: `${OUT}/frontend-prod-viewer.png` });

const markers = await page.locator('gmp-marker-3d').count();
check('map mounts on the production origin', markers >= 3, `${markers} markers`);
const text = await page.locator('body').innerText();
check('no map error badge', !/3D map unavailable/.test(text));
check('no replay error', !/Could not load this replay/.test(text));
check(
  'map budget badge reads the server',
  /Google 3D · \d+\/500 opens/.test(text),
  text.match(/Google 3D[^\n]*/)?.[0],
);
check('story renders', /km loop/.test(text), text.match(/[\d.]+ km loop/)?.[0]);
check('presets render', (await page.getByRole('button', { name: 'Overview' }).count()) === 1);

const chip = page.locator('button', { hasText: /\d{1,2} \w{3} \d{4} · / }).first();
if (await chip.count()) {
  const before = await page.locator('gmp-marker-3d').count();
  await chip.click();
  await page.waitForTimeout(8000);
  check('ghost marker added', (await page.locator('gmp-marker-3d').count()) === before + 1);
  check('ghost delta shown', /Ghost [+-]\d+ m/.test(await page.locator('body').innerText()));
  await page.screenshot({ path: `${OUT}/frontend-prod-viewer-ghost.png` });
} else {
  console.log('note: this ride has no route history, so the ghost picker is hidden');
}

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
