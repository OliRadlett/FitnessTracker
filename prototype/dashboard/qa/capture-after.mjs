/**
 * Capture the REAL redesigned page (not the lab) for the production gate.
 *
 * Same minted-session technique as capture-before.mjs, but it writes to qa/after/
 * so the "before" evidence stays intact, and it targets whichever port the
 * worktree's dev server is on.
 *
 * Run from frontend/:  node ../prototype/dashboard/qa/capture-after.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, '../../../frontend/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.FITTRACK_BASE || 'http://localhost:3100/fittrack';
const OUT = path.join(HERE, 'after');
fs.mkdirSync(OUT, { recursive: true });

const COOKIE = process.env.SESSION_COOKIE;
const TOKEN = process.env.BACKEND_TOKEN;
if (!COOKIE) throw new Error('SESSION_COOKIE missing');

const FRAMES = [
  { slug: '01-today-1440', path: '/dashboard', vp: [1440, 900] },
  { slug: '02-trends-1440', path: '/dashboard?view=trends&range=90d', vp: [1440, 900] },
  { slug: '03-history-1440', path: '/dashboard?view=history', vp: [1440, 900] },
  { slug: '04-today-390', path: '/dashboard', vp: [390, 844] },
  { slug: '05-trends-390', path: '/dashboard?view=trends', vp: [390, 844] },
  { slug: '06-history-390', path: '/dashboard?view=history', vp: [390, 844] },
];

const browser = await chromium.launch();
const problems = [];

for (const frame of FRAMES) {
  const context = await browser.newContext({
    viewport: { width: frame.vp[0], height: frame.vp[1] },
    deviceScaleFactor: 1,
    // The production build registers a service worker, and a worker's fetches do not
    // go through `page.route` — so the connections intercept below was being bypassed
    // and the worker followed the proxy's cross-origin 307 instead, surfacing as a
    // 503. The E2E config blocks workers for the same reason.
    serviceWorkers: 'block',
  });
  await context.addCookies([
    {
      name: 'next-auth.session-token',
      value: COOKIE,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  // First-run UI must not appear in the artifact: the onboarding wizard auto-opens
  // after auth and would cover every frame. Same keys the E2E fixture seeds.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fittrack-onboarding-done', 'true');
      localStorage.setItem('fittrack-routes-tips', 'done');
      localStorage.setItem('fittrack-install-dismissed', String(Date.now()));
    } catch {
      /* storage unavailable — ignore */
    }
  });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // Same dev-server quirk as before: the trailing-slash 308 -> FastAPI 307 to the
  // absolute :8000 URL drops the Authorization header. Serve this one path directly.
  //
  // Fetched Node-side, not with `route.fetch`: that runs inside the page's origin, so
  // an Authorization header makes it a cross-origin request and the backend's CORS
  // allowlist (which knows :3000, not the capture port) answers 503. Node has no
  // origin, so the header is sent as written.
  if (TOKEN) {
    await page.route(/\/api\/v1\/connections\/?(\?.*)?$/, async (route) => {
      const res = await fetch('http://localhost:8000/api/v1/connections/', {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      route.fulfill({
        status: res.status,
        contentType: 'application/json',
        body: await res.text(),
      });
    });
  }

  await page.goto(`${BASE}${frame.path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForTimeout(9_000);

  const metrics = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    h: document.documentElement.scrollHeight,
    vh: window.innerHeight,
  }));
  if (metrics.scrollW > metrics.clientW + 1) {
    problems.push(`${frame.slug}: horizontal overflow ${metrics.scrollW} > ${metrics.clientW}`);
  }
  if (errors.length) problems.push(`${frame.slug}: console ${errors.join(' | ').slice(0, 160)}`);

  if (frame.vp[0] < 500) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const ok = await page.evaluate(() => {
      const nav = document.querySelector('nav.fixed.bottom-0');
      const main = document.querySelector('main');
      // <main> holds a single padded wrapper (pb-tabbar-clear). The wrapper's own
      // bottom is the viewport bottom by construction — the thing that must clear
      // the nav is its last CONTENT child.
      const wrapper = main?.lastElementChild;
      const last = wrapper?.lastElementChild ?? wrapper;
      if (!nav || !last) return true;
      return last.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top;
    });
    if (!ok) problems.push(`${frame.slug}: content sits under the bottom nav`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await page.screenshot({ path: path.join(OUT, `${frame.slug}.png`), fullPage: true });
  await page.screenshot({ path: path.join(OUT, `${frame.slug}--fold.png`) });
  console.log(
    `${frame.slug.padEnd(18)} ${frame.vp[0]}x${frame.vp[1]}  page ${metrics.h}px (${(metrics.h / metrics.vh).toFixed(1)} screens)`,
  );
  await context.close();
}

await browser.close();
console.log(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nPROBLEMS: none');
