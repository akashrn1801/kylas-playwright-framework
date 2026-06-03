import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: config.execution.retryCount,
  workers: isCI ? 1 : config.execution.workers,
  timeout: isCI ? 120000 : 60000,

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

  projects: isCI
    ? [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1920, height: 1080 },
          launchOptions: {
            args: ['--start-maximized'],
          },
        },
      },
    ]
    : [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 1920, height: 1080 },
        },
      },
      {
        name: 'firefox',
        use: {
          ...devices['Desktop Firefox'],
          viewport: { width: 1920, height: 1080 },
        },
      },
      {
        name: 'webkit',
        use: {
          ...devices['Desktop Safari'],
          viewport: { width: 1920, height: 1080 },
        },
      },
      {
        name: 'mobile-chrome',
        use: { ...devices['Pixel 5'] },
      },
    ],

  outputDir: 'test-results/',
});
