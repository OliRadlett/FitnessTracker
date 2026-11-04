import { chromium } from '@playwright/test';

const key = process.env.GOOGLE_KEY;
if (!key) throw new Error('GOOGLE_KEY is not set');

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(`http://127.0.0.1:5199/google3d-test.html?key=${key}`);
await page.waitForTimeout(6000);
const before = await page.evaluate(() =>
  document.querySelector('gmp-map-3d')?.getAttribute('camera-position'),
);
const result = await page.evaluate(() => {
  const map = document.querySelector('gmp-map-3d');
  try {
    map.flyCameraTo({
      endCamera: {
        cameraPosition: new google.maps.LatLngAltitude({
          lat: 46.5073,
          lng: 6.6323,
          altitude: 400,
        }),
        heading: 0,
        tilt: 70,
        roll: 0,
      },
      durationMillis: 1000,
    });
    return 'ok';
  } catch (error) {
    return String(error);
  }
});
await page.waitForTimeout(2500);
const after = await page.evaluate(() =>
  document.querySelector('gmp-map-3d')?.getAttribute('camera-position'),
);
console.log(JSON.stringify({ before, result, after }, null, 2));
await browser.close();
