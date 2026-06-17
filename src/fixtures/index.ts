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
import { AuthManager } from '../auth/authManager';
import { logger } from '../utils/logger';

const stateFor = (role: string) =>
  path.join(__dirname, '../auth/storageStates', config.env, `${role}.json`);

// ── Error listener attachment ─────────────────────────────────────────────────

function attachErrorListeners(page: Page): void {
  // WHY: pageerror — uncaught JS exceptions in the browser (e.g. ReferenceError)
  page.on('pageerror', (err: Error) => {
    ErrorCollector.capture({
      type: 'pageerror',
      message: err.message || String(err),
      url: err.stack?.split('\n')[1]?.trim(),
    });
  });

  // WHY: console — captures console.error() calls from app code
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      ErrorCollector.capture({
        type: 'console-error',
        message: msg.text(),
        url: msg.location()?.url,
      });
    }
  });

  // WHY: requestfailed — DNS failures, connection refused, request aborted
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    const method = request.method();
    const resourceType = request.resourceType();
    ErrorCollector.capture({
      type: 'requestfailed',
      message: failure?.errorText || 'Request failed',
      url: request.url(),
      method,
      responseBody: `Resource type: ${resourceType} | Failure: ${failure?.errorText || 'unknown'}`,
    });
  });

  // WHY: response — captures 4xx/5xx HTTP errors from the CRM API
  // Captures method, response body and API error message for full context
  page.on('response', async (response) => {
    const status = response.status();
    if (status >= 400) {
      const method = response.request().method();
      let responseBody: string | undefined;
      let apiErrorMessage: string | undefined;
      try {
        const text = await response.text();
        responseBody = text.substring(0, 500);
        // WHY: Try to extract error message from JSON response body
        // Kylas API returns { message: '...' } or { error: '...' } on failures
        try {
          const json = JSON.parse(text);
          apiErrorMessage =
            json?.message || json?.error || json?.errorMessage || json?.details || undefined;
          if (apiErrorMessage) apiErrorMessage = String(apiErrorMessage).substring(0, 300);
        } catch {
          // not JSON — use raw text as error message if short
          if (text.length < 200) apiErrorMessage = text;
        }
      } catch {
        responseBody = undefined;
      }
      ErrorCollector.capture({
        type: 'response-error',
        message: `HTTP ${status} [${method}] ${response.url()}`,
        url: response.url(),
        method,
        statusCode: status,
        responseBody,
        apiErrorMessage,
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

    // WHY: Use AuthManager.getContextForRole() instead of raw storageState —
    // AuthManager validates the session before creating the context and
    // re-logins automatically if expired. This prevents mid-suite session
    // expiry from causing flaky failures.
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('admin');
    const page = await context.newPage();

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
    } catch {
      /* no popup — continue */
    }

    await use(page);

    ErrorCollector.clearCurrentTest();
    await context.close();
  },

  restrictedPage: async ({ browser }, use, testInfo) => {
    ErrorCollector.setCurrentTest(testInfo.title, testInfo.file);
    // WHY: Use AuthManager.getContextForRole() — validates session before
    // creating context and re-logins if expired. Same as adminPage.
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('restricted');
    const page = await context.newPage();
    // WHY: Attach error listeners before any navigation
    attachErrorListeners(page);
    // WHY: Stagger restricted user initialization on GHA to avoid concurrent session conflicts
    if (process.env.CI) await page.waitForTimeout(Math.floor(Math.random() * 3000));
    // WHY: QA env has intermittent TCP timeouts under parallel load — mirror AuthManager 3-retry pattern.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        logger.warn(`restrictedPage goto attempt ${attempt} failed — retrying in 3s`);
        await page.waitForTimeout(3000);
      }
    }
    await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });
    try {
      const popup = page.locator('#cancel[data-dismiss="modal"]');
      await popup.waitFor({ state: 'visible', timeout: 3000 });
      await popup.click();
      await popup.waitFor({ state: 'hidden', timeout: 3000 });
    } catch {
      /* no popup — continue */
    }
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
