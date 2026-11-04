import { chromium } from '@playwright/test';

const key = process.env.GOOGLE_KEY;
if (!key) throw new Error('GOOGLE_KEY is not set');

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5199/google3d-test.html?key=${key}`);
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const g = window.google;
  const maps = g?.maps;
  const maps3d = maps?.maps3d;
  const keys = (obj) => (obj ? Object.keys(obj).sort() : null);
  return {
    mapsKeys: (keys(maps) ?? []).filter((k) =>
      /orientation|latlng|model|altitude|maps3d|geometry/i.test(k),
    ),
    maps3dKeys: keys(maps3d),
    hasOrientation3D: Boolean(maps?.Orientation3D || maps3d?.Orientation3D),
    hasLatLngAltitude: Boolean(maps?.LatLngAltitude || maps3d?.LatLngAltitude),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
