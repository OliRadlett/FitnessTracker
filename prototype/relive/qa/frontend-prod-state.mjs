// Snapshot of what production is serving right now: dashboard alerts, how many
// rides the replay list offers, and the viewer's own state.
//
// Run from prototype/relive: node qa/frontend-prod-state.mjs

import { chromium } from '@playwright/test';

const BASE = 'https://oliradlett.co.uk/fittrack';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text().slice(0, 120));
});

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const dashboard = await page.locator('body').innerText();
const alerts = dashboard
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /Action needed|re-authorisation|reconnect|failed|paused/i.test(line));
console.log('dashboard alerts:', alerts.length ? alerts.slice(0, 4) : 'none');

await page.goto(`${BASE}/replay`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const replayText = await page.locator('body').innerText();
const rides = replayText.match(/(\d+) rides available/)?.[1] ?? 'unknown';
const cards = await page.locator('a[href*="/relive3d/"]').count();
console.log(`replay list: ${rides} rides available, ${cards} new-viewer cards`);

const href = await page.locator('a[href*="/relive3d/"]').first().getAttribute('href');
await page.goto(`https://oliradlett.co.uk${href}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(9000);

const text = await page.locator('body').innerText();
console.log('viewer budget:', text.match(/Google 3D[^\n]*/)?.[0] ?? 'no badge');
console.log('viewer map error:', /3D map unavailable/.test(text) ? 'YES' : 'none');
console.log('viewer markers:', await page.locator('gmp-marker-3d').count());
const ghosts = await page.locator('button[class*="preset"]').evaluateAll((nodes) =>
  nodes.filter((node) => /\d{4} · /.test(node.textContent ?? '')).length,
);
console.log('ghost chips:', ghosts);
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none');

await browser.close();
