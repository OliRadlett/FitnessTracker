import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));
page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log('CONSOLE', message.text().slice(0, 300));
  }
});

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForTimeout(8000);
await page.getByRole('button', { name: "Arthur's Seat" }).click();
await page.waitForTimeout(10000);

for (const [name, label] of [
  ['start', 'Start'],
  ['climb', 'Climb'],
  ['close', 'Close'],
]) {
  const button = page.getByRole('button', { name: label, exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(9000);
  }
  await page.screenshot({ path: `qa/out/frontend-p2-arthurs-${name}-wait.png` });
}

await browser.close();
