import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  // Directory where tests are located
  testDir: './tests',

  // Run tests in files in parallel
  fullyParallel: !isCI,

  // Fail the build on CI if test.only is accidentally left in source
  forbidOnly: isCI,

  // Retry failed tests
  retries: config.execution.retryCount,

  // Number of parallel workers
  workers: config.execution.workers,

  // Timeout for each test
  timeout: isCI ? 120000 : config.timeouts.default,

  // Timeout for each expect assertion
  expect: {
    timeout: isCI ? 20000 : config.timeouts.expect,
  },

  // Reporters
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-report/results.json' }],
    ['allure-playwright', { resultsDir: 'allure-results' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL from environment config
    baseURL: config.appUrl,

    // Navigation timeout
    navigationTimeout: isCI ? 90000 : config.timeouts.navigation,

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on first retry
    video: 'on-first-retry',

    // Headless mode from config
    headless: config.browser.headless,

    // Viewport — fixed size for consistency in headless
    viewport: isCI ? { width: 1920, height: 1080 } : null,

    // Browser launch options
    launchOptions: {
      args: isCI
        ? [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--window-size=1920,1080',
          ]
        : ['--start-maximized'],
    },
  },

  // Test projects (browsers)
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Output folder for test artifacts
  outputDir: 'test-results/',
});