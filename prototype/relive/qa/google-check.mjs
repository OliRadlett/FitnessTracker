import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  console.log('CONSOLE', message.type(), message.text().slice(0, 500));
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('response', (response) => {
  const url = response.url();
  if (
    (url.includes('tile.googleapis.com') || url.includes('maps.googleapis.com')) &&
    response.status() >= 400
  ) {
    console.log('HTTP', response.status(), url.slice(0, 240));
  }
});
await page.goto('http://127.0.0.1:5199/?world=google3d&pose=climb&freeze=1&ui=0');
await page.waitForTimeout(15000);
const state = await page.evaluate(() => ({
  body: document.body.innerText.slice(0, 400),
  map: document.querySelector('gmp-map-3d')?.outerHTML.slice(0, 500),
  google: Boolean(window.google?.maps),
  error: document.querySelector('.gm-err-container')?.textContent?.slice(0, 300),
}));
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/google-check.png' });
await browser.close();
