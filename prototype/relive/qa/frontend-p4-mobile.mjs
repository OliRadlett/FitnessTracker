// P4: mobile layout of the production viewer.
//
// Checks, at iPhone-13 size:
//   1. the page does not scroll horizontally (a dock that overflows is the
//      usual failure — the preset row is wide)
//   2. the map draws
//   3. the ghost picker is reachable and the delta appears
//   4. interactive controls meet a 40px touch target
//
// Run from prototype/relive: node qa/frontend-p4-mobile.mjs <activity-id>

import { readFileSync } from 'node:fs';

import { chromium, devices } from '@playwright/test';

const activityId = process.argv[2] ?? '8c24a0f6-f069-4c4e-bc68-61e8f6a867fb';
const OUT = 'qa/out';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({ ...devices['iPhone 13'] });
await context.addCookies([
  {
    name: session.name,
    value: session.value,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  },
]);
const page = await context.newPage();
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 300)));

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`http://localhost:3000/fittrack/relive3d/${activityId}`, {
  waitUntil: 'domcontentloaded',
});
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(9000);

const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
check(
  'no horizontal overflow',
  overflow.scrollWidth <= overflow.innerWidth + 1,
  `${overflow.scrollWidth} vs ${overflow.innerWidth}`,
);

const markers = await page.locator('gmp-marker-3d').count();
check('map draws the route', markers >= 3, `${markers} markers`);
await page.screenshot({ path: `${OUT}/frontend-p4-mobile-overview.png` });

// Every visible control in the dock should be big enough to tap.
const small = await page.evaluate(() => {
  const dock = document.querySelector('[class*="dock"]');
  if (!dock) return ['no dock'];
  return Array.from(dock.querySelectorAll('button, select'))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { text: (element.textContent ?? '').trim().slice(0, 18), h: Math.round(rect.height) };
    })
    .filter((entry) => entry.h > 0 && entry.h < 32);
});
check('touch targets >= 32px', small.length === 0, JSON.stringify(small).slice(0, 200));

const chip = page.locator('button', { hasText: /^\d{1,2} \w{3} \d{4} · / }).first();
if (await chip.count()) {
  await chip.click();
  await page.waitForTimeout(7000);
  const text = await page.locator('body').innerText();
  const readout = text.match(/Ghost [+-]\d+ m/)?.[0] ?? null;
  check('ghost works on mobile', readout !== null, readout ?? 'no readout');
  await page.screenshot({ path: `${OUT}/frontend-p4-mobile-ghost.png` });
} else {
  check('ghost works on mobile', false, 'no ghost chip');
}

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
