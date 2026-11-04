import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  if (message.type() === 'error') console.log('CONSOLE', message.text().slice(0, 400));
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.addInitScript(() => {
  localStorage.setItem('relive:terrain', 'on');
  localStorage.setItem('relive:imagery', 'on');
  // Headless Chromium reports SwiftShader, which makes the old viewer drop to
  // its reduced profile immediately. For a fair full-quality comparison, report
  // a hardware renderer and a steady 60 fps clock. This is a comparison
  // harness, not production behavior.
  const patch = (proto) => {
    if (!proto) return;
    const original = proto.getParameter;
    proto.getParameter = function (parameter) {
      if (parameter === 0x9246 || parameter === 0x1f01) {
        return 'ANGLE (NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0)';
      }
      return original.call(this, parameter);
    };
  };
  patch(window.WebGLRenderingContext?.prototype);
  patch(window.WebGL2RenderingContext?.prototype);
  const raf = window.requestAnimationFrame.bind(window);
  let fake = performance.now();
  window.requestAnimationFrame = (callback) =>
    raf(() => {
      fake += 16.67;
      callback(fake);
    });
});
await page.goto('http://localhost:3001/fittrack/dev/replay');
await page.waitForSelector('canvas', { timeout: 60_000 });
await page.waitForTimeout(3000);
const buttons = await page.getByRole('button').allTextContents();
console.log('BUTTONS', JSON.stringify(buttons));
for (const name of ['orbit', 'chase', 'drone']) {
  const button = page.getByRole('button', { name, exact: true });
  if (!(await button.count())) continue;
  await button.first().click();
  console.log('clicked', name);
  await page.waitForTimeout(6000);
  await page.locator('canvas').first().screenshot({ path: `qa/out/old-${name}.png` });
  console.log('shot', name);
}
const overlay = page.getByTestId('replay-loading-overlay');
if (await overlay.count()) {
  await overlay.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => {});
}
await page.waitForTimeout(3000);
await page.locator('canvas').first().screenshot({ path: 'qa/out/old-viewer.png' });
await page.screenshot({ path: 'qa/out/old-page.png' });
console.log('done');
await browser.close();
