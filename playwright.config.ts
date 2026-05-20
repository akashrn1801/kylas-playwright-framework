import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

export default defineConfig({
  // Directory where tests are located
  testDir: './tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if test.only is accidentally left in source
  forbidOnly: !!process.env.CI,

  // Retry failed tests
  retries: config.execution.retryCount,

  // Number of parallel workers
  workers: config.execution.workers,

  // Timeout for each test
  timeout: config.timeouts.default,

  // Timeout for each expect assertion
  expect: {
    timeout: config.timeouts.expect,
  },

  // Reporters
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-report/results.json' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL from environment config
    baseURL: config.appUrl,

    // Navigation timeout
    navigationTimeout: config.timeouts.navigation,

    // Collect trace on first retry
    trace: 'on-first-retry',

    // Capture screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on first retry
    video: 'on-first-retry',

    // Headless mode from config
    headless: config.browser.headless,


      launchOptions: {
    args: ['--start-maximized'],
  },
  viewport: null, // 👈 Also add this — tells Playwright not to override the window size

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