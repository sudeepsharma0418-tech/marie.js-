import { defineConfig, devices } from '@playwright/test';

const E2E_DB = process.env.E2E_DATABASE_URL ?? 'postgresql://hp:hp_dev_password@localhost:5432/hotelproc_e2e';

/** Browser tests against the real API and web app, using a throwaway e2e database. */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @hp/api exec tsx src/server.ts',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: E2E_DB,
        APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        LOG_LEVEL: 'warn',
        STORAGE_DIR: '/tmp/hp-e2e-storage',
      },
    },
    {
      command: 'pnpm --filter @hp/web exec vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
    },
  ],
});
