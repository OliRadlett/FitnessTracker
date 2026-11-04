// P5: the classic 3D list routes into the new viewer when the flag is on, and
// keeps a working link back to the old Theater.
//
// Run from prototype/relive: node qa/frontend-p5-rollout.mjs

import { readFileSync } from 'node:fs';

import { chromium } from '@playwright/test';

const OUT = 'qa/out';
const session = JSON.parse(readFileSync('../../.tmp/qa-session.json', 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
page.on('pageerror', (error) => console.log('PAGEERROR', error.message.slice(0, 200)));

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto('http://localhost:3000/fittrack/replay', {
  waitUntil: 'domcontentloaded',
});
await page.waitForTimeout(4000);

const classic = page.getByRole('link', { name: 'Classic 3D' }).first();
await classic.waitFor({ state: 'attached', timeout: 45_000 }).catch(() => {});
check('classic 3D link present', (await classic.count()) > 0);
const classicHref = await classic.getAttribute('href');
check(
  'classic link targets the old theater',
  Boolean(classicHref?.includes('/activities?replay=')),
  classicHref ?? 'none',
);

const firstCard = page.locator('a[href*="/relive3d/"]').first();
check('cards open the new viewer', (await firstCard.count()) > 0);
const href = await firstCard.getAttribute('href');
await page.screenshot({ path: `${OUT}/frontend-p5-replay-list.png` });

await firstCard.click();
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 });
await page.waitForTimeout(6000);
check(
  'new viewer opens from the list',
  page.url().includes('/relive3d/'),
  page.url().replace('http://localhost:3000', ''),
);

const back = page.getByRole('link', { name: '← Activity' });
check('viewer has a way back', (await back.count()) === 1);
await page.screenshot({ path: `${OUT}/frontend-p5-from-list.png` });

await browser.close();

const failed = results.filter((result) => !result.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
