// Accessibility audit of the viewer with axe-core, injected at runtime so the
// repo gains no dependency.
//
// Run from prototype/relive:
//   node qa/frontend-axe.mjs                     # local dev harness (Lake)
//   node qa/frontend-axe.mjs prod <activity-id>  # production page

import { chromium } from '@playwright/test';

const AXE_URL = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';
const mode = process.argv[2] ?? 'local';
const activityId = process.argv[3];

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});

const context =
  mode === 'prod'
    ? await browser.newContext({
        storageState: '../../frontend/e2e/prod-shots/.auth/storageState.json',
        viewport: { width: 1440, height: 900 },
      })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });

const page = await context.newPage();
const url =
  mode === 'prod'
    ? `https://oliradlett.co.uk/fittrack/relive3d/${activityId}`
    : 'http://localhost:3000/fittrack/dev/relive3d';

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('gmp-map-3d', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(9000);

await page.addScriptTag({ url: AXE_URL });
const result = await page.evaluate(async () => {
  // The map is a third-party canvas element; audit the chrome we own.
  const map = document.querySelector('gmp-map-3d');
  if (map) map.setAttribute('data-axe-ignore', 'true');
  return await window.axe.run(document, {
    resultTypes: ['violations'],
    rules: {
      // Colour contrast inside a WebGL canvas is not something axe can judge.
      'color-contrast': { enabled: true },
    },
  });
});

console.log(`axe on ${url}`);
console.log('violations:', result.violations.length);
for (const violation of result.violations) {
  console.log(
    `\n[${violation.impact}] ${violation.id}: ${violation.help}`,
  );
  for (const node of violation.nodes.slice(0, 4)) {
    console.log('  ', node.target.join(' '));
    console.log('   ', (node.failureSummary ?? '').replace(/\n/g, ' ').slice(0, 220));
  }
}

await browser.close();
