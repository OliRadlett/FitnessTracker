import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(
  'http://127.0.0.1:5199/?world=google3d&pose=close&freeze=1&ui=0',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => {});
await page.waitForTimeout(6000);
const state = await page.evaluate(() => {
  const map = document.querySelector('gmp-map-3d');
  const markers = [...document.querySelectorAll('gmp-marker-3d')].map((m) => ({
    position: m.getAttribute('position'),
    label: m.getAttribute('label'),
    altitudeMode: m.getAttribute('altitude-mode'),
    sizePreserved: m.getAttribute('size-preserved'),
    html: m.outerHTML.slice(0, 200),
  }));
  return {
    camera: map?.getAttribute('camera-position'),
    center: map?.getAttribute('center'),
    range: map?.getAttribute('range'),
    tilt: map?.getAttribute('tilt'),
    heading: map?.getAttribute('heading'),
    markers,
  };
});
console.log(JSON.stringify(state, null, 2));
await browser.close();
