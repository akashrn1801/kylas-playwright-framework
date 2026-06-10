/**
 * ADDITIONS TO src/fixtures/index.ts
 * 
 * Add this import at the top of the existing fixtures/index.ts:
 * import { ErrorCollector } from '../error-collector/ErrorCollector';
 * 
 * Then replace the adminPage fixture with the version below that includes
 * error listener attachment. Do the same for restrictedPage.
 * 
 * The key additions per page fixture are:
 * 1. ErrorCollector.setCurrentTest(testInfo.title, testInfo.file)
 * 2. attachErrorListeners(page) call
 * 3. ErrorCollector.clearCurrentTest() in the use() callback
 */

import { test as base, Page, BrowserContext } from '@playwright/test';
import { config } from '../../config/config';
import * as path from 'path';
import { ErrorCollector } from '../error-collector/ErrorCollector';

const stateFor = (role: string) =>
  path.join(__dirname, '../auth/storageStates', config.env, `${role}.json`);

// ── Error listener attachment ─────────────────────────────────────────────────

function attachErrorListeners(page: Page): void {
  // WHY: pageerror — uncaught JS exceptions in the browser (e.g. ReferenceError)
  page.on('pageerror', (err: Error) => {
    ErrorCollector.capture({
      type:    'pageerror',
      message: err.message || String(err),
      url:     err.stack?.split('\n')[1]?.trim(),
    });
  });

  // WHY: console — captures console.error() calls from app code
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      ErrorCollector.capture({
        type:    'console-error',
        message: msg.text(),
        url:     msg.location()?.url,
      });
    }
  });

  // WHY: requestfailed — DNS failures, connection refused, request aborted
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    ErrorCollector.capture({
      type:    'requestfailed',
      message: failure?.errorText || 'Request failed',
      url:     request.url(),
    });
  });

  // WHY: response — captures 4xx/5xx HTTP errors from the CRM API
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      ErrorCollector.capture({
        type:       'response-error',
        message:    `HTTP ${status} ${response.statusText()} — ${response.url()}`,
        url:        response.url(),
        statusCode: status,
      });
    }
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export type TestFixtures = {
  adminPage: Page;
  restrictedPage: Page;
  adminContext: BrowserContext;
  restrictedContext: BrowserContext;
};

export const test = base.extend<TestFixtures>({

  adminPage: async ({ browser }, use, testInfo) => {
    // WHY: Set current test context so errors captured during this test
    // are tagged with the correct test title and file
    ErrorCollector.setCurrentTest(testInfo.title, testInfo.file);

    const context = await browser.newContext({ storageState: stateFor('admin') });
    const page    = await context.newPage();

    // WHY: Attach error listeners before navigating so we capture ALL errors
    // from the very first page load, not just after the test starts
    attachErrorListeners(page);

    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });
    try {
      const popup = page.locator('#cancel[data-dismiss="modal"]');
      await popup.waitFor({ state: 'visible', timeout: 3000 });
      await popup.click();
      await popup.waitFor({ state: 'hidden', timeout: 3000 });
    } catch { /* no popup — continue */ }

    await use(page);

    ErrorCollector.clearCurrentTest();
    await context.close();
  },

  restrictedPage: async ({ browser }, use, testInfo) => {
    ErrorCollector.setCurrentTest(testInfo.title, testInfo.file);

    const context = await browser.newContext({ storageState: stateFor('restricted') });
    const page    = await context.newPage();

    // WHY: Attach error listeners before any navigation
    attachErrorListeners(page);

    // WHY: Stagger restricted user initialization on GHA to avoid concurrent session conflicts
    if (process.env.CI) await page.waitForTimeout(Math.floor(Math.random() * 3000));

    // WHY: On GHA with parallel workers, concurrent restricted sessions can cause
    // redirect back to login. Retry navigation up to 3 times before failing.
    let landed = false;
    for (let i = 0; i < 3; i++) {
      await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
      try {
        await page.waitForURL(/sales\//, { timeout: 30000 });
        landed = true;
        break;
      } catch {
        if (i < 2) await page.waitForTimeout(3000);
      }
    }
    if (!landed) throw new Error('restrictedPage: failed to reach /sales/ after 3 attempts');

    try {
      const popup = page.locator('#cancel[data-dismiss="modal"]');
      await popup.waitFor({ state: 'visible', timeout: 3000 });
      await popup.click();
      await popup.waitFor({ state: 'hidden', timeout: 3000 });
    } catch { /* no popup — continue */ }

    await use(page);

    ErrorCollector.clearCurrentTest();
    await context.close();
  },

  adminContext: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: stateFor('admin') });
    await use(context);
    await context.close();
  },

  restrictedContext: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: stateFor('restricted') });
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
export type { UserRole } from '../auth/authManager';