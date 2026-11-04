import { chromium } from '@playwright/test';

const key = process.env.GOOGLE_KEY;
if (!key) throw new Error('GOOGLE_KEY is not set');

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(`http://127.0.0.1:5199/google3d-test.html?key=${key}`);
await page.waitForTimeout(6000);

const info = await page.evaluate(() => {
  const tags = [
    'gmp-polyline-3d',
    'gmp-polyline-3d-interactive',
    'gmp-model-3d',
    'gmp-model-3d-interactive',
    'gmp-marker-3d',
    'gmp-marker-3d-interactive',
  ];
  const out = {};
  for (const tag of tags) {
    const ctor = customElements.get(tag);
    if (!ctor) continue;
    out[tag] = {
      observedAttributes: ctor.observedAttributes ?? [],
      prototype: Object.getOwnPropertyNames(ctor.prototype),
    };
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
