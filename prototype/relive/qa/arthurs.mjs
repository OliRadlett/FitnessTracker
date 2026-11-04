import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) =>
  console.log('PAGEERROR', (error.stack ?? error.message).slice(0, 800)),
);
await page.goto(
  'http://127.0.0.1:5199/?ride=arthurs&world=google3d&pose=summit&freeze=1&ui=1&ghost=1',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(9000);
const state = await page.evaluate(() => window.__relive.getState());
const delta = await page.textContent('#ghost');
const title = await page.textContent('h1');
const buttons = await page.getByRole('button').allTextContents();
console.log('STATE', JSON.stringify({ state, delta, title, buttons }));
await page.screenshot({ path: 'qa/out/arthurs-ghost.png' });
await browser.close();
