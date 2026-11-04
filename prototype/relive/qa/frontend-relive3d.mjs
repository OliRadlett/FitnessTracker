import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log('CONSOLE', message.text().slice(0, 400));
  }
});

await page.goto('http://127.0.0.1:3001/fittrack/dev/relive3d');
await page.waitForTimeout(5000);
await page.screenshot({ path: 'qa/out/frontend-relive3d-lake.png' });

const arthur = page.getByRole('button', { name: "Arthur's Seat" });
if (await arthur.count()) {
  await arthur.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'qa/out/frontend-relive3d-arthurs.png' });
}
await browser.close();
