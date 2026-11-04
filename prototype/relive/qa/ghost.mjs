import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) =>
  console.log('PAGEERROR', (error.stack ?? error.message).slice(0, 800)),
);
await page.goto(
  'http://127.0.0.1:5199/?world=google3d&pose=climb&freeze=1&ui=1&ghost=1',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(7000);

const read = async (label) => {
  const state = await page.evaluate(() => window.__relive.getState());
  const delta = await page.textContent('#ghost');
  console.log(label, JSON.stringify({ state, delta }));
};

await read('initial');
const ghostButton = page.getByRole('button', { name: 'Ghost', exact: true });
await ghostButton.click();
await page.waitForTimeout(2000);
await read('after off');
await ghostButton.click();
await page.waitForTimeout(2000);
await read('after on');

const fastest = page.getByRole('button', { name: /Fastest km/ }).first();
await fastest.click();
await page.waitForTimeout(8000);
await read('after seek');
await page.screenshot({ path: 'qa/out/google3d-ghost-seek.png' });
await browser.close();
