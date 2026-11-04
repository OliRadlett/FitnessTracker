// P4: the viewer must degrade to a static route poster when the Google 3D
// library cannot load (offline, blocked, key rejected, quota exhausted).
//
// Blocks maps.googleapis.com before navigation and checks:
//   1. no unhandled page error
//   2. the poster SVG renders the route
//   3. the controls still work (presets, data toggle) without the map
//
// Run from prototype/relive: node qa/frontend-p4-fallback.mjs

import { chromium } from '@playwright/test';

const OUT = 'qa/out';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));

await page.route('**://maps.googleapis.com/**', (route) => route.abort());
await page.route('**://maps.gstatic.com/**', (route) => route.abort());

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto('http://localhost:3000/fittrack/dev/relive3d', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(12_000);

check('no unhandled page errors', errors.length === 0, errors.join(' | ').slice(0, 240));

const mapCount = await page.locator('gmp-map-3d').count();
const svgPaths = await page.locator('svg path').count();
check('no 3D map mounted', mapCount === 0, `${mapCount} map elements`);
check('static poster drawn', svgPaths > 0, `${svgPaths} svg paths`);
await page.screenshot({ path: `${OUT}/frontend-p4-fallback-poster.png` });

// Presets and the data toggle must still respond.
await page.getByRole('button', { name: 'Summit', exact: true }).click();
await page.waitForTimeout(1200);
const summitActive = await page
  .getByRole('button', { name: 'Summit', exact: true })
  .getAttribute('class');
check('preset still selectable', (summitActive ?? '').includes('active'), summitActive ?? '');

await page.getByRole('button', { name: 'Data', exact: true }).click();
await page.waitForTimeout(600);
const bodyText = await page.locator('body').innerText();
check('data panel toggles', !/Climb \d/.test(bodyText));
await page.screenshot({ path: `${OUT}/frontend-p4-fallback-poster-summit.png` });

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
