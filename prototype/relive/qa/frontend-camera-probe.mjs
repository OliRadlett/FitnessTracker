// Diagnostic: what camera does the Google 3D map actually end up at, and does
// the route polyline render? Screenshots the map area only (data hidden) so the
// route is not obscured by the story panel.
//
// Run from prototype/relive: node qa/frontend-camera-probe.mjs [width] [height]

import { chromium } from '@playwright/test';

const width = Number(process.argv[2] ?? 1440);
const height = Number(process.argv[3] ?? 900);

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width, height } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForSelector('gmp-map-3d', { timeout: 30_000 });
await page.waitForTimeout(9000);

const probe = () =>
  page.evaluate(() => {
    const map = document.querySelector('gmp-map-3d');
    if (!map) return null;
    const line = document.querySelector('gmp-polyline-3d');
    const center = map.center;
    return {
      center: center
        ? { lat: center.lat, lng: center.lng, altitude: center.altitude }
        : null,
      range: map.range,
      tilt: map.tilt,
      heading: map.heading,
      steady:
        typeof map.isSteady === 'function' ? map.isSteady() : map.isSteady,
      cameraPosition: map.getAttribute('camera-position'),
      polylinePoints: line?.path?.length ?? null,
      polylineFirst: line?.path?.[0] ?? null,
      polylineStroke: line?.getAttribute('stroke-width'),
    };
  });

console.log('lake overview', JSON.stringify(await probe()));

// Hide the data panel so the map is not obscured.
await page.keyboard.press('d');
await page.waitForTimeout(1500);
await page.screenshot({ path: `qa/out/camera-probe-lake-${width}x${height}.png` });

await page.getByRole('button', { name: "Arthur's Seat" }).click();
await page.waitForTimeout(8000);
console.log('arthurs overview', JSON.stringify(await probe()));
await page.screenshot({ path: `qa/out/camera-probe-arthurs-${width}x${height}.png` });

await browser.close();
