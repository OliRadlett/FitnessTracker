import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  console.log('CONSOLE', message.type(), message.text());
});
page.on('pageerror', (error) => {
  console.log('PAGEERROR', error.message);
});
page.on('requestfailed', (request) => {
  console.log('REQFAIL', request.url(), request.failure()?.errorText);
});
await page.goto('http://127.0.0.1:5199/?pose=overview&freeze=1&ui=0');
await page.waitForTimeout(15000);
const state = await page.evaluate(() => {
  const r = window.__relive;
  const map = r?.map;
  return {
    ready: r?.ready,
    bodyReady: document.body.dataset.ready,
    canvas: !!document.querySelector('canvas'),
    pitch: map?.getPitch(),
    bearing: map?.getBearing(),
    zoom: map?.getZoom(),
    center: map?.getCenter(),
    terrain: map?.getTerrain?.(),
    sky: map?.getSky?.(),
    loaded: map?.loaded?.(),
    canvasSize: map ? [map.getCanvas().width, map.getCanvas().height] : null,
  };
});
console.log('STATE', JSON.stringify(state));
await page.screenshot({ path: 'qa/out/debug.png' });
await page.evaluate(() => {
  const map = window.__relive?.map;
  map?.setPitch(60);
  map?.setBearing(30);
  map?.triggerRepaint();
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'qa/out/debug2.png' });
await browser.close();
