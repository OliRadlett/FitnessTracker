import { chromium } from '@playwright/test';

const browser = await chromium.launch({
  args: ['--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (message) => {
  if (message.type() === 'error' || message.text().includes('studio')) {
    console.log('CONSOLE', message.type(), message.text().slice(0, 500));
  }
});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
await page.goto('http://127.0.0.1:5199/rider-studio.html');
await page.waitForTimeout(12000);
await page.screenshot({ path: 'qa/out/rider-studio.png' });

await page.selectOption('#lighting', 'relive');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'qa/out/rider-studio-relive.png' });

await page.selectOption('#lighting', 'daylight');
await page.click('[data-preset="close"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'qa/out/rider-studio-close.png' });

await page.click('[data-preset="hero"]');
await page.check('#ghost');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'qa/out/rider-studio-ghost.png' });
await browser.close();
