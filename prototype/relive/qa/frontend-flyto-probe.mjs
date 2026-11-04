// Experiment: does `flyCameraTo` with an explicit maps3d.Camera give a
// deterministic camera, where setting the `camera-position` attribute does not?
//
// Run from prototype/relive: node qa/frontend-flyto-probe.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForSelector('gmp-map-3d', { timeout: 30_000 });
await page.waitForTimeout(8000);

const api = await page.evaluate(() => {
  const maps3d = window.google?.maps?.maps3d;
  return {
    maps3dKeys: maps3d ? Object.keys(maps3d).sort() : null,
    hasCamera: Boolean(maps3d?.Camera),
    hasFly: typeof document.querySelector('gmp-map-3d')?.flyCameraTo,
    protoMethods: Object.getOwnPropertyNames(
      Object.getPrototypeOf(document.querySelector('gmp-map-3d') ?? {}),
    ).sort(),
  };
});
console.log(JSON.stringify(api, null, 2));

const readCamera = () =>
  page.evaluate(() => {
    const map = document.querySelector('gmp-map-3d');
    const cam = map?.cameraPosition;
    return {
      cameraPosition: map?.getAttribute('camera-position'),
      centerAttr: map?.getAttribute('center'),
      rangeAttr: map?.getAttribute('range'),
      tiltAttr: map?.getAttribute('tilt'),
      headingAttr: map?.getAttribute('heading'),
      camProperty: cam
        ? {
            lat: cam.center?.lat,
            lng: cam.center?.lng,
            altitude: cam.center?.altitude,
            range: cam.range,
            tilt: cam.tilt,
            heading: cam.heading,
          }
        : null,
    };
  });

console.log('before', JSON.stringify(await readCamera()));

const flyResult = await page.evaluate(async () => {
  const map = document.querySelector('gmp-map-3d');
  const maps3d = window.google?.maps?.maps3d;
  if (!map?.flyCameraTo || !maps3d?.Camera) return 'unavailable';
  const endCamera = new maps3d.Camera({
    center: { lat: 55.9425, lng: -3.1725, altitude: 120 },
    heading: 0,
    tilt: 55,
    range: 3000,
    roll: 0,
    fov: 45,
  });
  try {
    await map.flyCameraTo({ endCamera, durationMillis: 0 });
    return 'ok';
  } catch (error) {
    return `error: ${error.message}`;
  }
});
console.log('flyCameraTo', flyResult);
await page.waitForTimeout(6000);
console.log('after', JSON.stringify(await readCamera()));
await page.screenshot({ path: 'qa/out/flyto-probe-arthurs.png' });

await browser.close();
