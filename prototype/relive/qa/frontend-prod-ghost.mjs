// Ghost racing against the deployed app: find a production route ridden more
// than once, open its newest ride, and drive the picker.
//
// Run from prototype/relive: node qa/frontend-prod-ghost.mjs

import { chromium } from '@playwright/test';

const OUT = 'qa/out';
const BASE = 'https://oliradlett.co.uk/fittrack';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 200)));

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// The /replay page already asks for 100 rides; reuse its response to find a
// route with history instead of guessing ids.
let rides = null;
page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('/api/v1/activities?') && response.status() === 200) {
    try {
      const body = await response.json();
      const rows = Array.isArray(body) ? body : body.items ?? [];
      if (rows.length > (rides?.length ?? 0)) rides = rows;
    } catch {
      /* ignore */
    }
  }
});

await page.goto(`${BASE}/replay`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);

if (!rides) {
  console.log('no activities payload captured');
  await browser.close();
  process.exit(1);
}

const byRoute = new Map();
for (const ride of rides) {
  if (!ride.route_id || !ride.has_streams) continue;
  const list = byRoute.get(ride.route_id) ?? [];
  list.push(ride);
  byRoute.set(ride.route_id, list);
}
const candidates = [...byRoute.entries()]
  .filter(([, list]) => list.length > 1)
  .sort((a, b) => b[1].length - a[1].length);
console.log(
  'routes with history:',
  candidates.slice(0, 5).map(([id, list]) => `${id.slice(0, 8)} x${list.length}`),
);

if (!candidates.length) {
  console.log('no production route has more than one ride in this page of results');
  await browser.close();
  process.exit(1);
}

const [routeId, list] = candidates[0];
const newest = list
  .slice()
  .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))[0];
console.log('opening', newest.id, 'from route', routeId.slice(0, 8), `(${list.length} rides)`);

await page.goto(`${BASE}/relive3d/${newest.id}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(10_000);

const baseline = await page.locator('gmp-marker-3d').count();
check('map mounts', baseline >= 3, `${baseline} markers`);

const chips = page.locator('button', { hasText: /\d{1,2} \w{3,4} \d{4} · / });
const chipCount = await chips.count();
check('ghost picker lists route history', chipCount > 0, `${chipCount} ghosts`);
await page.screenshot({ path: `${OUT}/frontend-prod-ghost-list.png` });

if (chipCount > 0) {
  await chips.first().click();
  await page.waitForTimeout(9000);
  check(
    'ghost marker added',
    (await page.locator('gmp-marker-3d').count()) === baseline + 1,
    `${await page.locator('gmp-marker-3d').count()} markers`,
  );
  const text = await page.locator('body').innerText();
  const readout = text.match(/Ghost [+-]\d+ m/)?.[0] ?? null;
  check('ghost delta shown', readout !== null, readout ?? 'none');
  await page.screenshot({ path: `${OUT}/frontend-prod-ghost-active.png` });

  const play = page.getByRole('button', { name: 'Play', exact: true });
  if (await play.count()) {
    await play.click();
    await page.waitForTimeout(5000);
    const early = (await page.locator('body').innerText()).match(/Ghost [+-]\d+ m/)?.[0];
    await page.waitForTimeout(5000);
    const late = (await page.locator('body').innerText()).match(/Ghost [+-]\d+ m/)?.[0];
    check('delta tracks time', early !== late, `${early} → ${late}`);
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    if (await pause.count()) await pause.click();
  }
}

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
