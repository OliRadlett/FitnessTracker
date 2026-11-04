import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  console.log('CONSOLE', message.type(), message.text().slice(0, 600));
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('requestfailed', (request) => {
  console.log('REQFAIL', request.url().slice(0, 240), request.failure()?.errorText);
});
await page.goto(
  'http://127.0.0.1:5199/?world=cesium&tiles=ion&pose=climb&freeze=1&ui=0',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(15_000);
const state = await page.evaluate(() => ({
  ready: window.__relive?.ready,
  bodyReady: document.body.dataset.ready,
  fatal: document.querySelector('.fatal')?.innerText?.slice(0, 600),
  canvas: !!document.querySelector('canvas'),
  cesium: !!document.querySelector('.cesium-viewer'),
  credits: document.querySelector('.cesium-widget-credits')?.textContent?.slice(0, 300),
}));
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/cesium-ion-app.png' });
await browser.close();
