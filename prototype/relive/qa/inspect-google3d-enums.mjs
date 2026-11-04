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
  const m3 = g?.maps?.maps3d;
  const clean = (obj) => {
    if (!obj) return null;
    const out = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      out[key] = typeof value === 'object' ? JSON.stringify(value) : value;
    }
    return out;
  };
  return {
    orientationStatic: Object.getOwnPropertyNames(g.maps.Orientation3D),
    orientationProto: Object.getOwnPropertyNames(g.maps.Orientation3D.prototype),
    latLngAltitudeStatic: Object.getOwnPropertyNames(g.maps.LatLngAltitude),
    latLngAltitudeProto: Object.getOwnPropertyNames(g.maps.LatLngAltitude.prototype),
    altitudeMode: clean(m3.AltitudeMode),
    qualityMode: clean(m3.QualityMode),
    mapMode: clean(m3.MapMode),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
