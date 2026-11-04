import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('request', (request) => {
  if (request.url().includes('maps.googleapis.com')) {
    console.log('REQ', request.url().slice(0, 160));
    console.log('HEADERS', JSON.stringify(request.headers()));
  }
});
page.on('response', async (response) => {
  if (response.url().includes('dev/relive3d')) {
    console.log('DOC HEADERS', JSON.stringify(response.headers()));
  }
});
await page.goto('http://127.0.0.1:3001/fittrack/dev/relive3d');
await page.waitForTimeout(3000);
const info = await page.evaluate(() => ({
  href: location.href,
  referrer: document.referrer,
  meta: document.querySelector('meta[name="referrer"]')?.getAttribute('content'),
}));
console.log('INFO', JSON.stringify(info, null, 2));
await browser.close();
