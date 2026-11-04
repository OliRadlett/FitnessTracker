/**
 * Smoke test: can a minted NextAuth cookie load /dashboard with real data?
 * Prints the page title, the number of failed API responses, and writes one PNG.
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, '../../../frontend/package.json'));
const { chromium } = require('@playwright/test');

const OUT = path.join(HERE, 'smoke.png');
const COOKIE = process.env.SESSION_COOKIE;
if (!COOKIE) throw new Error('SESSION_COOKIE missing');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addCookies([
  { name: 'next-auth.session-token', value: COOKIE, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
]);
const page = await context.newPage();
const failures = [];
page.on('response', (r) => {
  if (r.url().includes('/api/v1/') && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
});
await page.goto('http://localhost:3000/fittrack/dashboard', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(15000);
const h1 = await page.locator('main h1').first().textContent().catch(() => null);
console.log('url:', page.url());
console.log('h1:', JSON.stringify(h1));
console.log('failed api:', failures.length ? '\n  ' + failures.join('\n  ') : 'none');
await page.screenshot({ path: OUT, fullPage: true });
console.log('shot:', OUT);
await browser.close();
