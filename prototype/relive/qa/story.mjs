import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) =>
  console.log('PAGEERROR', (error.stack ?? error.message).slice(0, 1200)),
);
const sync = process.env.SYNC === '1' ? '&sync=1' : '';
await page.goto(
  `http://127.0.0.1:5199/?world=google3d&pose=climb&freeze=1&ui=1${sync}`,
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(7000);
await page.screenshot({ path: 'qa/out/google3d-story.png' });

const chapters = await page.getByRole('button').allTextContents();
console.log('BUTTONS', JSON.stringify(chapters));

const before = await page.evaluate(() => window.__relive.getState());
const fastest = page.getByRole('button', { name: /Fastest km/ }).first();
if (await fastest.count()) {
  await fastest.click();
  await page.waitForTimeout(8000);
  const after = await page.evaluate(() => window.__relive.getState());
  console.log('SEEK', JSON.stringify({ before, after }));
  await page.screenshot({ path: 'qa/out/google3d-chapter-fastest.png' });
}
await browser.close();
