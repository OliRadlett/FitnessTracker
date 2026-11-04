// P3 production check: the real page, real backend, real route history.
//
// Opens /fittrack/relive3d/{activity} with a QA session cookie (see
// qa/mint-token.py + qa/mint-session.mjs), then exercises the ghost picker:
//   1. the viewer loads and draws the map + route
//   2. the ghost picker lists past rides on this route
//   3. picking one adds a ghost marker and a `Ghost ±N m` readout
//   4. playing forward moves the delta
//
// Run from prototype/relive: node qa/frontend-p3-production.mjs <activity-id>

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const activityId =
  process.argv[2] ?? '8c24a0f6-f069-4c4e-bc68-61e8f6a867fb';
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));
page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log('CONSOLE', message.text().slice(0, 300));
  }
});

const markers = () => page.locator('gmp-marker-3d').count();
const ghostReadout = async () => {
  const text = await page.locator('body').innerText();
  return text.match(/Ghost [+-]\d+ m/)?.[0] ?? null;
};

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`http://localhost:3000/fittrack/relive3d/${activityId}`, {
  waitUntil: 'domcontentloaded',
});

const bodyText = await page.locator('body').innerText();
if (/Could not load this replay/.test(bodyText)) {
  console.log(bodyText.slice(0, 400));
  await page.screenshot({ path: `${OUT}/frontend-p3-production-error.png` });
  await browser.close();
  process.exit(1);
}

await page.waitForSelector('gmp-map-3d', { timeout: 40_000 });
await page.waitForTimeout(9000);

const baseline = await markers();
check('production viewer draws the route', baseline >= 3, `${baseline} markers`);

const budget = (await page.locator('body').innerText()).match(/Google 3D · \d+\/500 opens/);
check('map budget badge renders', budget !== null, budget?.[0] ?? 'missing');
await page.screenshot({ path: `${OUT}/frontend-p3-production-overview.png` });

const ghostChips = page.locator('button', { hasText: /^\d{1,2} \w{3} \d{4} · / });
const chipCount = await ghostChips.count();
check('ghost picker lists route history', chipCount > 0, `${chipCount} ghosts`);

if (chipCount === 0) {
  await browser.close();
  process.exit(1);
}

await ghostChips.first().click();
await page.waitForTimeout(9000);

check('ghost marker added', (await markers()) === baseline + 1, `${await markers()} markers`);
const readout = await ghostReadout();
check('story shows a ghost delta', readout !== null, readout ?? 'no readout');
await page.screenshot({ path: `${OUT}/frontend-p3-production-ghost.png` });

const playButton = page.getByRole('button', { name: 'Play', exact: true });
if (await playButton.count()) {
  await playButton.click();
  await page.waitForTimeout(5000);
  const early = await ghostReadout();
  await page.waitForTimeout(5000);
  const late = await ghostReadout();
  check('ghost delta tracks time', early !== late, `${early} → ${late}`);
  await page.screenshot({ path: `${OUT}/frontend-p3-production-ghost-playing.png` });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.count()) await pause.click();
} else {
  check('ghost delta tracks time', false, 'no Play button');
}

await page.getByRole('button', { name: 'Off', exact: true }).click();
await page.waitForTimeout(3000);
check('ghost cleared', (await markers()) === baseline, `${await markers()} markers`);
await page.screenshot({ path: `${OUT}/frontend-p3-production-ghost-off.png` });

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
