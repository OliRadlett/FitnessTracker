import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  console.log('CONSOLE', message.type(), message.text().slice(0, 500));
});
page.on('pageerror', (error) => {
  console.log('PAGEERROR', error.message);
});
page.on('requestfailed', (request) => {
  console.log('REQFAIL', request.url().slice(0, 200), request.failure()?.errorText);
});
await page.goto('http://127.0.0.1:5199/?world=cesium&pose=overview&freeze=1&ui=0');
await page.waitForTimeout(20000);
const state = await page.evaluate(() => ({
  ready: window.__relive?.ready,
  bodyReady: document.body.dataset.ready,
  fatal: document.querySelector('.fatal')?.innerText?.slice(0, 500),
  canvas: !!document.querySelector('canvas'),
}));
console.log('STATE', JSON.stringify(state));
await page.screenshot({ path: 'qa/out/cesium-debug.png' });
await browser.close();
