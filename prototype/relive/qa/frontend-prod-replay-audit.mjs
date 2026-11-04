// Why does the deployed /replay list offer so few rides?
//
// Captures the app's own activities response on /fittrack/activities and counts
// how many rides would pass the /replay filter (`has_streams && encoded_polyline`).
//
// Run from prototype/relive: node qa/frontend-prod-replay-audit.mjs

import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();

let payload = null;
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/v1/activities?') && response.status() === 200) {
    try {
      payload = await response.json();
    } catch {
      /* ignore */
    }
  }
});

await page.goto('https://oliradlett.co.uk/fittrack/activities', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(12000);

if (!payload) {
  console.log('no activities payload captured');
  await browser.close();
  process.exit(1);
}

const rows = Array.isArray(payload) ? payload : payload.items ?? [];
console.log('activities in response:', rows.length);

const withStreams = rows.filter((a) => a.has_streams).length;
const withPolyline = rows.filter((a) => Boolean(a.encoded_polyline)).length;
const both = rows.filter((a) => a.has_streams && a.encoded_polyline).length;
console.log({ withStreams, withPolyline, both });

console.log(
  'sample:',
  rows.slice(0, 8).map((a) => ({
    date: (a.start_date ?? '').slice(0, 10),
    km: a.distance_meters ? Math.round(a.distance_meters / 1000) : null,
    sport: a.sport_type,
    streams: a.has_streams,
    polyline: Boolean(a.encoded_polyline),
    route: a.route_id ? 'yes' : null,
  })),
);

await page.goto('https://oliradlett.co.uk/fittrack/replay', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const cards = await page.locator('a[href*="/relive3d/"]').count();
const body = await page.locator('body').innerText();
console.log('replay cards:', cards);
console.log('replay page text:', body.slice(0, 300).replace(/\n+/g, ' | '));

await browser.close();
