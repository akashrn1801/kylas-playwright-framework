import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: config.execution.retryCount,
  workers: isCI ? 4 : config.execution.workers,

  // WHY: 30s is too tight — fixture setup (goto + waitForURL) alone
  // can take 10-15s on QA, leaving almost no time for the actual test
  timeout: 60000,

  expect: {
    timeout: isCI ? 20000 : config.timeouts.expect,
  },

  globalSetup: './src/auth/globalSetup.ts',

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-report/results.json' }],
    ['allure-playwright', { resultsDir: 'reports/allure-results' }],
  ],

  use: {
    baseURL: config.appUrl,
    navigationTimeout: isCI ? 90000 : config.timeouts.navigation,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: isCI ? true : config.browser.headless,
    viewport: { width: 1920, height: 1080 },
    launchOptions: {
      args: isCI ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  ],

  outputDir: 'test-results/',
});