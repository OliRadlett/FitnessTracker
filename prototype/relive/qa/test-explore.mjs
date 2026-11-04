import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:5199/?world=google3d&pose=overview&ui=1');
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(4000);

const camera = () =>
  page.evaluate(() => document.querySelector('gmp-map-3d')?.getAttribute('camera-position'));
const state = () => page.evaluate(() => window.__relive.getState());

const before = await camera();
const beforeState = await state();
await page.getByRole('button', { name: 'Follow', exact: true }).click();
await page.waitForTimeout(3000);
const afterFollow = await camera();
const afterFollowState = await state();
await page.screenshot({ path: 'qa/out/explore-follow.png' });

await page.evaluate(() =>
  document.querySelector('[data-pose="lausanne"]')?.click(),
);
await page.waitForTimeout(3000);
const afterPose = await camera();
const afterPoseState = await state();
await page.screenshot({ path: 'qa/out/explore-lausanne.png' });

console.log(
  JSON.stringify(
    { before, beforeState, afterFollow, afterFollowState, afterPose, afterPoseState },
    null,
    2,
  ),
);
await browser.close();
