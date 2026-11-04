import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) =>
  console.log('PAGEERROR', (error.stack ?? error.message).slice(0, 800)),
);
await page.goto(
  'http://127.0.0.1:5199/?ride=arthurs&world=google3d&pose=summit&freeze=1&ui=1&ghost=1',
);
await page
  .waitForFunction(() => window.__relive?.ready === true, null, { timeout: 60_000 })
  .catch(() => console.log('READY TIMEOUT'));
await page.waitForTimeout(7000);
await page.evaluate(() => window.__relive.whenIdle());
await page.waitForTimeout(5000);

const select = page.locator('.ghost-picker');
const options = await select.locator('option').evaluateAll((nodes) =>
  nodes.map((node) => ({ value: node.value, text: node.textContent })),
);
console.log('OPTIONS', JSON.stringify(options));

const read = async (label) => {
  const state = await page.evaluate(() => window.__relive.getState());
  const delta = await page.textContent('#ghost');
  console.log(label, JSON.stringify({ state, delta }));
};

await read('initial');
await page.screenshot({ path: 'qa/out/arthurs-ghost-picker.png' });
for (const value of [
  'arthurs-ghost-2025-01-27',
  'arthurs-ghost-2026-07-25',
  '',
]) {
  await select.selectOption(value);
  await page.waitForTimeout(2500);
  await read(value || 'off');
}
await browser.close();
