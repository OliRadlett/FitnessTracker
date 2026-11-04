/**
 * Measure a single cold load of /dashboard: request count, bytes, paint timings.
 * Writes qa/before/load-metrics.json. Read-only.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, '../../../frontend/package.json'));
const { chromium } = require('@playwright/test');

const COOKIE = process.env.SESSION_COOKIE;
const TOKEN = process.env.BACKEND_TOKEN;
if (!COOKIE) throw new Error('SESSION_COOKIE missing');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: 'next-auth.session-token', value: COOKIE, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
]);
const page = await context.newPage();
if (TOKEN) {
  await page.route(/\/api\/v1\/connections\/?(\?.*)?$/, (route) =>
    route.fetch({ url: 'http://localhost:8000/api/v1/connections/', headers: { Authorization: `Bearer ${TOKEN}` } })
      .then((r) => route.fulfill({ response: r })),
  );
}

const api = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/api/v1/')) return;
  let bytes = 0;
  try {
    bytes = (await r.body()).length;
  } catch {
    /* no body */
  }
  api.push({ url: new URL(u).pathname + new URL(u).search, status: r.status(), bytes });
});

const t0 = Date.now();
await page.goto('http://localhost:3000/fittrack/dashboard', { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(
  () => !!document.querySelector('main h1')?.textContent?.includes('Good'),
  { timeout: 120_000 },
).catch(() => {});
const shellAt = Date.now() - t0;
// Settle: every query has stopped fetching AND the last paint happened.
await page.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {});
const settledAt = Date.now() - t0;

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = Object.fromEntries(
    performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
  );
  return {
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
    loadEvent: Math.round(nav?.loadEventEnd ?? 0),
    ...paints,
    viewportHeight: window.innerHeight,
    pageHeight: document.documentElement.scrollHeight,
  };
});

const totalBytes = api.reduce((s, r) => s + r.bytes, 0);
const out = {
  capturedAt: new Date().toISOString(),
  apiRequests: api.length,
  apiBytes: totalBytes,
  apiFailures: api.filter((r) => r.status >= 400),
  shellAt,
  settledAt,
  ...metrics,
  endpoints: api.map((r) => `${r.status} ${r.url} ${r.bytes}B`),
};
fs.writeFileSync(path.join(HERE, 'before', 'load-metrics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, endpoints: undefined }, null, 2));
console.log(`viewports of scrolling: ${(metrics.pageHeight / metrics.viewportHeight).toFixed(1)}`);
await browser.close();
