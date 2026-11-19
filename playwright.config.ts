import { defineConfig, devices } from '@playwright/test';

/**
 * Chromium is the default because CI runs it. The `webkit` project exists for
 * the iOS-shaped bugs: WebKit is the engine behind iOS Safari, and the sheet
 * gesture work has to be verified there, not only in Chromium.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173/DuoReader/',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/DuoReader/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
