import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('console', (message) => {
  if (message.type() === 'error' || message.text().includes('rider')) {
    console.log('CONSOLE', message.type(), message.text().slice(0, 500));
  }
});

for (const pose of ['climb', 'close', 'summit']) {
  await page.goto(
    `http://127.0.0.1:5199/?world=google3d&pose=${pose}&freeze=1&ui=1&rider=3d`,
  );
  await page
    .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
    .catch(() => console.log('READY TIMEOUT'));
  await page.waitForTimeout(16000);
  await page.screenshot({ path: `qa/out/rider-3d-${pose}.png` });
}
await browser.close();
