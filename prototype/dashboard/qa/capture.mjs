/**
 * Render the lab artifact: fixed states, both candidates, desktop + mobile.
 *
 * Writes qa/out/*.png. Deterministic: the fixture pins the clock via ?now=, the
 * URL pins zone + candidate, and animation is off in every chart.
 *
 * Run: node qa/capture.mjs   (after `npm run dev` in this directory)
 */
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('@playwright/test');

const BASE = process.env.LAB_BASE || 'http://127.0.0.1:5302';
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const FRAMES = [
  { slug: '01-a-today-now', variant: 'a', zone: 'today', now: '2026-11-04', vp: [1440, 900] },
  { slug: '02-a-today-lift', variant: 'a', zone: 'today', now: '2026-11-03', vp: [1440, 900] },
  { slug: '03-a-today-ride', variant: 'a', zone: 'today', now: '2026-10-27', vp: [1440, 900] },
  { slug: '04-a-trends', variant: 'a', zone: 'trends', now: '2026-11-04', vp: [1440, 900] },
  { slug: '04b-a-trends-analysis', variant: 'a', zone: 'trends', now: '2026-11-04', vp: [1440, 900], analysis: 'open' },
  { slug: '05-a-history', variant: 'a', zone: 'history', now: '2026-11-04', vp: [1440, 900] },
  { slug: '06-b-today-now', variant: 'b', zone: 'today', now: '2026-11-04', vp: [1440, 900] },
  { slug: '07-b-today-ride', variant: 'b', zone: 'today', now: '2026-10-27', vp: [1440, 900] },
  { slug: '08-b-trends', variant: 'b', zone: 'trends', now: '2026-11-04', vp: [1440, 900] },
  { slug: '09-a-today-now-390', variant: 'a', zone: 'today', now: '2026-11-04', vp: [390, 844] },
  { slug: '10-a-today-ride-390', variant: 'a', zone: 'today', now: '2026-10-27', vp: [390, 844] },
  { slug: '11-a-trends-390', variant: 'a', zone: 'trends', now: '2026-11-04', vp: [390, 844] },
  { slug: '12-b-today-now-390', variant: 'b', zone: 'today', now: '2026-11-04', vp: [390, 844] },
];

const browser = await chromium.launch();
const problems = [];

for (const frame of FRAMES) {
  const context = await browser.newContext({
    viewport: { width: frame.vp[0], height: frame.vp[1] },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  const url = `${BASE}/?capture=1&variant=${frame.variant}&zone=${frame.zone}&now=${frame.now}${
    frame.analysis ? `&analysis=${frame.analysis}` : ''
  }`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  // Recharts and fonts settle on the frame after data render.
  await page.waitForTimeout(900);

  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, h: de.scrollHeight };
  });
  if (overflow.scrollW > overflow.clientW + 1) {
    problems.push(`${frame.slug}: horizontal overflow ${overflow.scrollW} > ${overflow.clientW}`);
  }
  if (errors.length) problems.push(`${frame.slug}: console ${errors.join(' | ').slice(0, 200)}`);

  await page.screenshot({ path: path.join(OUT, `${frame.slug}.png`), fullPage: true });
  await page.screenshot({ path: path.join(OUT, `${frame.slug}--fold.png`) });

  // Mobile only: does the content clear the fixed bottom nav at full scroll?
  if (frame.vp[0] < 500) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const clearance = await page.evaluate(() => {
      const nav = document.querySelector('nav.fixed.bottom-0');
      const main = document.querySelector('main');
      if (!nav || !main) return { ok: true, gap: 0 };
      // Measure the last CONTENT element, not <main>: main's padding-bottom is meant
      // to overlap the nav — that is how the clearance works.
      const last = main.lastElementChild;
      if (!last) return { ok: true, gap: 0 };
      const gap = last.getBoundingClientRect().bottom - nav.getBoundingClientRect().top;
      return { ok: gap <= 0, gap: Math.round(gap) };
    });
    if (!clearance.ok) {
      problems.push(`${frame.slug}: content sits ${clearance.gap}px under the bottom nav`);
    }
    await page.screenshot({ path: path.join(OUT, `${frame.slug}--bottom.png`) });
  }
  console.log(
    `${frame.slug.padEnd(24)} ${frame.vp[0]}x${frame.vp[1]}  page ${overflow.h}px  (${(overflow.h / frame.vp[1]).toFixed(1)} screens)`,
  );
  await context.close();
}

await browser.close();

// Tablet width is a gate requirement but not a deliverable frame — probe it directly.
const probe = await chromium.launch();
for (const zone of ['today', 'trends', 'history']) {
  const ctx = await probe.newContext({ viewport: { width: 768, height: 1024 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?capture=1&variant=a&zone=${zone}&now=2026-11-04`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const over = await p.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  if (over.scrollW > over.clientW + 1) {
    problems.push(`768/${zone}: horizontal overflow ${over.scrollW} > ${over.clientW}`);
  }
  await ctx.close();
}
await probe.close();

console.log(problems.length ? `\nPROBLEMS:\n  ${problems.join('\n  ')}` : '\nPROBLEMS: none');
