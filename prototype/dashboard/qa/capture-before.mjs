/**
 * Phase 0 — capture the CURRENT dashboard, desktop + mobile, all four tabs.
 *
 * Read-only: GETs only, no clicks that mutate. Auth is minted, not OAuth (see
 * mint-session.mjs). Every /api/v1 JSON response is also written to
 * fixtures/raw/ so the lab can replay the exact same payloads without a backend.
 *
 * Run from frontend/ after mint-session.mjs:
 *   $env:SESSION_COOKIE = node ../prototype/dashboard/qa/mint-session.mjs
 *   node ../prototype/dashboard/qa/capture-before.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(HERE, '../../../frontend/package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.FITTRACK_BASE || 'http://localhost:3000/fittrack';
const OUT = path.join(HERE, 'before');
const RAW = path.join(HERE, '..', 'fixtures', 'raw');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RAW, { recursive: true });

const COOKIE = process.env.SESSION_COOKIE;
if (!COOKIE) throw new Error('SESSION_COOKIE missing');

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

const failed = [];
const saved = new Map();

function slugFor(url) {
  const u = new URL(url);
  return (u.pathname + (u.search ? '?' + u.search : ''))
    .replace(/^\/api\/v1\//, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function capture(viewportName, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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

  // ── Dev-server artifact, not a product bug ────────────────────────────────
  // `GET /api/v1/connections/` hits Next's trailing-slash 308 -> `/api/v1/connections`,
  // whose rewrite is answered by FastAPI's own 307 to the ABSOLUTE
  // `http://localhost:8000/api/v1/connections/`. The browser follows that
  // cross-origin, strips Authorization, and the page paints "Some dashboard data
  // failed to load." In prod Caddy keeps the original Host, so the redirect stays
  // same-origin and this never happens. Serve this one path directly so the
  // "before" frame is faithful to production instead of to a local quirk.
  const backendToken = process.env.BACKEND_TOKEN;
  if (backendToken) {
    await page.route(/\/api\/v1\/connections\/?(\?.*)?$/, async (route) => {
      const res = await route.fetch({
        url: `http://localhost:8000/api/v1/connections/`,
        headers: { Authorization: `Bearer ${backendToken}` },
      });
      await route.fulfill({ response: res });
    });
  }

  page.on('response', async (r) => {
    if (!r.url().includes('/api/v1/')) return;
    const status = r.status();
    if (status >= 400) {
      failed.push(`${status} ${r.request().method()} ${r.url()}`);
      return;
    }
    // Keep the first successful payload per endpoint (the page issues some twice).
    const slug = slugFor(r.url());
    if (saved.has(slug)) return;
    try {
      const text = await r.text();
      saved.set(slug, text);
      fs.writeFileSync(path.join(RAW, `${slug}.json`), text);
    } catch {
      /* body already discarded */
    }
  });

  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // The page mounts 24 queries; let them all settle before judging a frame.
  await page.waitForTimeout(14_000);

  for (const tab of TABS) {
    const btn = page.getByRole('button', { name: new RegExp(`^${tab.label}$`, 'i') }).first();
    if ((await btn.count()) === 0) {
      console.warn(`${viewportName}/${tab.key}: tab button not found`);
      continue;
    }
    await btn.click();
    await page.waitForTimeout(6_000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUT, `${viewportName}-${tab.key}-fold.png`) });
    await page.screenshot({
      path: path.join(OUT, `${viewportName}-${tab.key}-full.png`),
      fullPage: true,
    });
    // A full-page capture under-paints offscreen Recharts in Chromium; scroll the
    // chart band into view and take a second frame so the chart is real.
    const chart = page.locator('.recharts-surface').first();
    if ((await chart.count()) > 0) {
      await chart.scrollIntoViewIfNeeded();
      await page.waitForTimeout(2_500);
      await page.screenshot({ path: path.join(OUT, `${viewportName}-${tab.key}-chart.png`) });
    }
    console.log(`captured ${viewportName}/${tab.key}`);
  }

  await browser.close();
}

await capture('desktop', { width: 1440, height: 900 });
await capture('mobile', { width: 390, height: 844 });

console.log(`\nfixtures: ${saved.size} written to fixtures/raw/`);
console.log(failed.length ? `FAILED CALLS:\n  ${[...new Set(failed)].join('\n  ')}` : 'FAILED CALLS: none');
