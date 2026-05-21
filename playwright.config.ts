import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: !isCI,
  forbidOnly: isCI,
  retries: config.execution.retryCount,
  workers: config.execution.workers,
  timeout: isCI ? 120000 : config.timeouts.default,

  expect: {
    timeout: isCI ? 20000 : config.timeouts.expect,
  },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-report/results.json' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
  ],

  use: {
    baseURL: config.appUrl,
    navigationTimeout: isCI ? 90000 : config.timeouts.navigation,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: config.browser.headless,
    viewport: { width: 1920, height: 1080 },
  },

  projects: isCI
    ? [
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
            viewport: { width: 1920, height: 1080 },
            launchOptions: {
              args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1920,1080',
              ],
            },
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
      ]
    : [
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
      ],

  outputDir: 'test-results/',
});