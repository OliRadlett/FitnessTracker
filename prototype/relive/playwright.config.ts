import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './qa',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--ignore-gpu-blocklist', '--enable-webgl'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
