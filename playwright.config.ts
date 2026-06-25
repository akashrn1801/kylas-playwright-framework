import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: config.execution.retryCount,
  // WHY: 2 workers on CI — halves run time while maintaining stability
  workers: isCI ? 2 : config.execution.workers,
  timeout: isCI ? 120000 : 480000,

  expect: {
    timeout: isCI ? 20000 : config.timeouts.expect,
  },

  globalSetup: './src/auth/globalSetup.ts',

  reporter: [
    ['list'],
    [
      'html',
      {
        outputFolder: process.env.CI
          ? 'reports/playwright-report'
          : `reports/${config.env}/latest/playwright-report`,
        open: 'never',
      },
    ],
    [
      'json',
      {
        outputFile: process.env.CI
          ? 'reports/playwright-report/results.json'
          : `reports/${config.env}/latest/playwright-report/results.json`,
      },
    ],
    [
      'allure-playwright',
      {
        resultsDir: process.env.CI
          ? 'reports/allure-results'
          : `reports/${config.env}/latest/allure-results`,
      },
    ],
    ['./src/reporters/MiscErrorReporter.ts'],
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
