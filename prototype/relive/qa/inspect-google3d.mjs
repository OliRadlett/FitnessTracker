import { chromium } from '@playwright/test';

const key = process.env.GOOGLE_KEY;
if (!key) throw new Error('GOOGLE_KEY is not set');

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto(`http://127.0.0.1:5199/google3d-test.html?key=${key}`);
await page.waitForTimeout(8000);

const info = await page.evaluate(() => {
  const el = document.querySelector('gmp-map-3d');
  const proto = el ? Object.getOwnPropertyNames(Object.getPrototypeOf(el)) : [];
  const ctor = customElements.get('gmp-map-3d');
  const ctorProto = ctor ? Object.getOwnPropertyNames(ctor.prototype) : [];
  const tags = [
    'gmp-map-3d',
    'gmp-marker-3d',
    'gmp-marker-3d-interactive',
    'gmp-polyline-3d',
    'gmp-polyline-3d-interactive',
    'gmp-model-3d',
    'gmp-model-3d-interactive',
  ];
  return {
    proto,
    ctorProto,
    defined: tags.filter((t) => Boolean(customElements.get(t))),
    html: el?.outerHTML.slice(0, 600),
    center: el?.center,
    range: el?.range,
    tilt: el?.tilt,
    heading: el?.heading,
    mode: el?.mode,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
