import { chromium } from '@playwright/test';

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
await page.goto('http://127.0.0.1:5199/?world=google3d&pose=climb&freeze=1&ui=0');
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(8000);
const state = await page.evaluate(() => ({
  ready: window.__relive?.ready,
  bodyReady: document.body.dataset.ready,
  fatal: document.querySelector('.fatal')?.innerText?.slice(0, 500),
  map: document.querySelector('gmp-map-3d')?.outerHTML.slice(0, 500),
  line: document.querySelector('gmp-polyline-3d')?.outerHTML.slice(0, 300),
  markers: document.querySelectorAll('gmp-marker-3d').length,
}));
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/google3d-app.png' });
await browser.close();
