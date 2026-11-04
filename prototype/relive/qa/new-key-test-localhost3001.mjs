import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log('CONSOLE', message.text().slice(0, 600));
  }
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 400)));

await page.goto(
  'http://localhost:3001/?world=google3d&pose=climb&freeze=1&ui=1',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(15000);
const state = await page.evaluate(() => ({
  body: document.body.innerText.slice(0, 300),
  map: document.querySelector('gmp-map-3d')?.outerHTML.slice(0, 300),
}));
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/new-key-climb.png' });
await browser.close();
