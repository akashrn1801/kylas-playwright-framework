import { defineConfig, devices } from '@playwright/test';
import { config } from './config/config';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: config.execution.retryCount,
  // WHY: WORKERS env var (set explicitly in Jenkinsfiles) now actually controls
  // worker count — previously this was hardcoded to 2 in CI regardless of WORKERS,
  // making the Jenkinsfiles' WORKERS setting dead configuration. Falls back to 2
  // in CI / config.execution.workers locally when WORKERS is not set.
  workers: process.env.WORKERS ? Number(process.env.WORKERS) : isCI ? 2 : config.execution.workers,
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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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

  // WHY: Confirmed live (2026-07-07) — matches the env-namespacing already
  // used above for html/json/allure reporters locally. Without this, two
  // concurrent runs against different environments (e.g. QA + Staging run in
  // parallel) would write trace/screenshot artifacts for the SAME test name
  // into the SAME directory (names are derived from test title, identical
  // across environments), corrupting each other's evidence. CI behavior
  // (single job at a time) is preserved unchanged.
  outputDir: process.env.CI ? 'test-results/' : `test-results/${config.env}`,
});
