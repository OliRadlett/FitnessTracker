// Verifies the P3 ghost picker on the production Relive3D component, driven
// through the dev harness (fixture selector + ghost selector).
//
// Checks, in order:
//   1. the dev harness renders the map for the default (Lake) fixture
//   2. selecting Arthur's Seat reveals the ghost bar with one button per ghost
//   3. picking a ghost adds one extra marker to the map and a `Ghost ±N m`
//      readout to the story panel
//   4. playing forward moves the delta (the ghost is sampled at the same
//      elapsed time, not pinned to the start)
//   5. clearing the ghost removes the marker and the readout
//
// Run from prototype/relive: node qa/frontend-ghost.mjs

import { chromium } from '@playwright/test';

const OUT = 'qa/out';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForSelector('gmp-map-3d', { timeout: 30_000 });
await page.waitForTimeout(8000);

const baseline = await markers();
check('dev harness renders a map', baseline > 0, `${baseline} markers`);
await page.screenshot({ path: `${OUT}/frontend-p3-dev-lake.png` });

await page.getByRole('button', { name: "Arthur's Seat" }).click();
await page.waitForTimeout(6000);

const ghostBar = page.getByRole('button', { name: "Arthur's Seat · 25 Jul" });
check('ghost bar lists the ride history', (await ghostBar.count()) === 1);
check('no ghost marker before selection', (await markers()) === baseline, `${await markers()} markers`);
await page.screenshot({ path: `${OUT}/frontend-p3-dev-arthurs-off.png` });

await ghostBar.click();
await page.waitForTimeout(6000);

check('ghost marker added', (await markers()) === baseline + 1, `${await markers()} markers`);
const readout = await ghostReadout();
check('story shows a ghost delta', readout !== null, readout ?? 'no readout');
await page.screenshot({ path: `${OUT}/frontend-p3-dev-ghost.png` });

// Play forward: the ghost is sampled at the same elapsed time as the rider, so
// the gap must move as the two rides diverge (they have different durations).
const playButton = page.getByRole('button', { name: 'Play', exact: true });
if (await playButton.count()) {
  await playButton.click();
  await page.waitForTimeout(5000);
  const early = await ghostReadout();
  await page.waitForTimeout(5000);
  const late = await ghostReadout();
  check('ghost delta tracks time', early !== late, `${early} → ${late}`);
  await page.screenshot({ path: `${OUT}/frontend-p3-dev-ghost-playing.png` });
  const pauseButton = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pauseButton.count()) await pauseButton.click();
} else {
  check('ghost delta tracks time', false, 'no Play button found');
}

await page.getByRole('button', { name: 'Off', exact: true }).click();
await page.waitForTimeout(3000);

check('ghost marker removed', (await markers()) === baseline, `${await markers()} markers`);
check('ghost delta cleared', (await ghostReadout()) === null);
await page.screenshot({ path: `${OUT}/frontend-p3-dev-ghost-off.png` });

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
