import { chromium } from '@playwright/test';

const key = process.env.GOOGLE_KEY;
if (!key) throw new Error('GOOGLE_KEY is not set');

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  console.log('CONSOLE', message.type(), message.text().slice(0, 500));
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('requestfailed', (request) => {
  console.log('REQFAIL', request.url().slice(0, 200), request.failure()?.errorText);
});
page.on('response', (response) => {
  if (response.url().includes('.glb')) {
    console.log('GLB', response.status(), response.headers()['content-type'], response.url());
  }
});
await page.goto(`http://127.0.0.1:5199/google3d-ride-test.html?key=${key}`);
await page.waitForTimeout(20000);
const state = await page.evaluate(() => {
  const model = document.querySelector('gmp-model-3d');
  return {
    ready: window.__ready,
    canvas: !!document.querySelector('canvas'),
    map: document.querySelector('gmp-map-3d')?.outerHTML.slice(0, 400),
    line: document.querySelector('gmp-polyline-3d')?.outerHTML.slice(0, 300),
    model: document.querySelector('gmp-model-3d')?.outerHTML.slice(0, 300),
    modelInternals: model
      ? {
          src: model.src,
          hasRh: Boolean(model.Rh),
          sh: model.sh,
          position: model.position,
          orientation: model.orientation,
          scale: model.scale,
          altitudeMode: model.altitudeMode,
        }
      : null,
  };
});
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/google3d-ride-test.png' });
await browser.close();
