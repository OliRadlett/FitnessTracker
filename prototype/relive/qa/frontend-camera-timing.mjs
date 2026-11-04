// Experiment 3: when `center`/`range`/`tilt`/`heading` change, does the map
// animate the camera or jump? Samples the read-only `cameraPosition` over time.
//
// Run from prototype/relive: node qa/frontend-camera-timing.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForSelector('gmp-map-3d', { timeout: 30_000 });
await page.waitForTimeout(8000);

const sample = () =>
  page.evaluate(() => {
    const map = document.querySelector('gmp-map-3d');
    return {
      cam: map?.getAttribute('camera-position'),
      center: map?.getAttribute('center'),
      range: map?.getAttribute('range'),
      tilt: map?.getAttribute('tilt'),
    };
  });

console.log('start', JSON.stringify(await sample()));

await page.evaluate(() => {
  const map = document.querySelector('gmp-map-3d');
  map.setAttribute('center', '55.9425,-3.1725,120');
  map.setAttribute('range', '3000');
  map.setAttribute('tilt', '55');
  map.setAttribute('heading', '0');
});

const t0 = Date.now();
for (let i = 0; i < 8; i += 1) {
  await page.waitForTimeout(400);
  console.log(`${Date.now() - t0}ms`, JSON.stringify(await sample()));
}

// Now a small follow-style nudge, to see whether rapid updates track.
for (let i = 1; i <= 4; i += 1) {
  await page.evaluate((step) => {
    const map = document.querySelector('gmp-map-3d');
    map.setAttribute('center', `55.9425,${-3.1725 + step * 0.0005},120`);
  }, i);
  await page.waitForTimeout(150);
  console.log(`nudge ${i}`, JSON.stringify(await sample()));
}

await browser.close();
