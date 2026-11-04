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
page.on('pageerror', (error) => {
  console.log('PAGEERROR', error.message);
});
page.on('requestfailed', (request) => {
  console.log('REQFAIL', request.url().slice(0, 200), request.failure()?.errorText);
});
await page.goto(`http://127.0.0.1:5199/google3d-test.html?key=${key}`);
await page.waitForTimeout(20000);
const state = await page.evaluate(() => ({
  google3d: window.__google3d,
  canvas: !!document.querySelector('canvas'),
  text: document.body.innerText.slice(0, 300),
}));
console.log('STATE', JSON.stringify(state));
await page.screenshot({ path: 'qa/out/google3d-test.png' });
await browser.close();
