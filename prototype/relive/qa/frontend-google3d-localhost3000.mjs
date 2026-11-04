import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 500)));
page.on('console', (message) => {
  if (message.type() === 'error') {
    console.log('CONSOLE', message.text().slice(0, 500));
  }
});

await page.goto('http://localhost:3000/fittrack/dev/relive3d');
await page.waitForTimeout(5000);
await page.screenshot({ path: 'qa/out/frontend-google3d-loading.png' });

const map = page.locator('gmp-map-3d');
await map.waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {
  console.log('MAP NOT ATTACHED');
});
await page.waitForTimeout(12_000);
const state = await page.evaluate(() => ({
  badge: document.body.innerText.slice(0, 500),
  map: Boolean(document.querySelector('gmp-map-3d')),
  mapsKey: Boolean(document.querySelector('gmp-map-3d')?.getAttribute('camera-position')),
}));
console.log('STATE', JSON.stringify(state, null, 2));
await page.screenshot({ path: 'qa/out/frontend-google3d-lake.png' });

const arthur = page.getByRole('button', { name: "Arthur's Seat" });
if (await arthur.count()) {
  await arthur.click();
  await page.waitForTimeout(10_000);
  await page.screenshot({ path: 'qa/out/frontend-google3d-arthurs.png' });
}
await browser.close();
