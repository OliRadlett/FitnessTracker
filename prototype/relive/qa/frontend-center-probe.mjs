// Experiment 2: drive the camera through the documented properties
// (center / range / tilt / heading) instead of the `camera-position` attribute,
// and check that the map actually lands where asked.
//
// Run from prototype/relive: node qa/frontend-center-probe.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForSelector('gmp-map-3d', { timeout: 30_000 });
await page.waitForTimeout(8000);

const read = () =>
  page.evaluate(() => {
    const map = document.querySelector('gmp-map-3d');
    const cam = map?.cameraPosition;
    return {
      centerAttr: map?.getAttribute('center'),
      rangeAttr: map?.getAttribute('range'),
      tiltAttr: map?.getAttribute('tilt'),
      headingAttr: map?.getAttribute('heading'),
      cameraPosition: map?.getAttribute('camera-position'),
      camProperty: cam
        ? { lat: cam.center?.lat, lng: cam.center?.lng, alt: cam.center?.altitude, range: cam.range, tilt: cam.tilt, heading: cam.heading }
        : null,
    };
  });

console.log('before', JSON.stringify(await read()));

// Arthur's Seat summit area, ~3 km of view.
const set = (center, range, tilt, heading) =>
  page.evaluate(
    ({ center, range, tilt, heading }) => {
      const map = document.querySelector('gmp-map-3d');
      map.setAttribute('center', center);
      map.setAttribute('range', String(range));
      map.setAttribute('tilt', String(tilt));
      map.setAttribute('heading', String(heading));
    },
    { center, range, tilt, heading },
  );

await set('55.9425,-3.1725,120', 3000, 55, 0);
await page.waitForTimeout(7000);
console.log('after set attrs', JSON.stringify(await read()));
await page.screenshot({ path: 'qa/out/center-probe-arthurs.png' });

await browser.close();
