import { chromium } from '@playwright/test';

const poses = ['overview', 'lausanne', 'montreux', 'climb', 'summit', 'close'];
const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
for (const pose of poses) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(
    `http://127.0.0.1:5199/?world=google3d&pose=${pose}&freeze=1&ui=0`,
  );
  await page
    .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
    .catch(() => {});
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => {
    const map = document.querySelector('gmp-map-3d');
    return {
      center: map?.getAttribute('center'),
      range: map?.getAttribute('range'),
      tilt: map?.getAttribute('tilt'),
      heading: map?.getAttribute('heading'),
      camera: map?.getAttribute('camera-position'),
    };
  });
  console.log(pose, JSON.stringify(state));
  await page.close();
}
await browser.close();
