import { defineConfig } from '@playwright/test';

export default defineConfig({
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  testDir: 'tests/e2e',
  use: { baseURL: 'http://127.0.0.1:4173' },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0
});
