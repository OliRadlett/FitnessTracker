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

const poses = [
  ['overview', 'Overview'],
  ['lausanne', 'Lausanne'],
  ['montreux', 'Montreux'],
  ['climb', 'Climb'],
  ['summit', 'Summit'],
  ['close', 'Close'],
];

for (const [name, label] of poses) {
  const button = page.getByRole('button', { name: label, exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: `qa/out/frontend-p2-lake-${name}.png` });
}

await page.getByRole('button', { name: "Arthur's Seat" }).click();
await page.waitForTimeout(8000);

const arthurPoses = [
  ['overview', 'Overview'],
  ['start', 'Start'],
  ['mid', 'Mid'],
  ['climb', 'Climb'],
  ['summit', 'Summit'],
  ['close', 'Close'],
];

for (const [name, label] of arthurPoses) {
  const button = page.getByRole('button', { name: label, exact: true });
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(3500);
  }
  await page.screenshot({ path: `qa/out/frontend-p2-arthurs-${name}.png` });
}

await browser.close();
