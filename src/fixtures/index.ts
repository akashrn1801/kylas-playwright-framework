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

import { test as base, Page, BrowserContext, Browser, TestInfo } from '@playwright/test';
import { config } from '../../config/config';
import * as path from 'path';
import { ErrorCollector } from '../error-collector/ErrorCollector';
import { AuthManager } from '../auth/authManager';
import { logger } from '../utils/logger';

const stateFor = (role: string) =>
  path.join(__dirname, '../auth/storageStates', config.env, `${role}.json`);

// ── Session expiry detection ─────────────────────────────────────────────────

function attachSessionExpiryListener(page: Page, role: 'admin' | 'restricted', authManager: AuthManager): void {
  // WHY: Watch for 401 responses during tests — these indicate session expiry
  // When detected, clear the storage state so the NEXT test gets a fresh login
  page.on('response', async (response) => {
    if (response.status() === 401) {
      const url = response.url();
      if (url.includes('/v1/') || url.includes('/api/')) {
        logger.warn(`Session expiry detected for ${role} — 401 on ${url} — clearing storage state`);
        await authManager.clearStorageState(role).catch(() => {});
        // WHY: Reset validation cache so next test re-validates immediately
        AuthManager['lastValidated'].delete(role);
      }
    }
  });

  // WHY: Watch for navigation to /signIn mid-test
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      const url = frame.url();
      if (url.includes('/signIn') || url.includes('/login')) {
        logger.warn(`Session expiry detected for ${role} — redirected to ${url}`);
        authManager.clearStorageState(role).catch(() => {});
        AuthManager['lastValidated'].delete(role);
      }
    }
  });
}

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

// ── Role page lifecycle (shared by adminPage + restrictedPage) ────────────────

type NavOutcome = 'sales' | 'signIn' | 'timeout';

// WHY: Confirmed live (2026-07-06) — this used to be duplicated 2x per fixture
// (once for the "fresh" path, once for the "session expired" path), and the
// ONLY session-expiry detection was a one-shot check of page.url() for
// '/signIn'/'/login' taken right after goto(). If the page was neither on
// signIn NOR yet on /sales/ within the timeout (a one-off slow load, or a
// session that expired in the brief window between AuthManager's own
// validation and this page's navigation), there was NO recovery path at
// all — a hard, unrecoverable `waitForURL` timeout failed the test outright.
// This raced the two genuine terminal outcomes instead of a blind wait, so a
// signIn/login redirect is caught whenever it actually happens, and gives a
// bounded number of forced-relogin retries before finally throwing — a real
// failure (e.g. the app is genuinely down) still fails loudly, it's just no
// longer indistinguishable from an ordinary, recoverable session expiry.
async function navigateAndConfirmLoggedIn(
  page: Page,
  role: 'admin' | 'restricted'
): Promise<NavOutcome> {
  // WHY: QA env has intermittent TCP timeouts under parallel load — retry the
  // raw navigation itself before ever judging where it landed.
  for (let gotoAttempt = 1; gotoAttempt <= 3; gotoAttempt++) {
    try {
      await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      break;
    } catch (e) {
      if (gotoAttempt === 3) throw e;
      logger.warn(`${role}Page goto attempt ${gotoAttempt} failed — retrying in 3s`);
      await page.waitForTimeout(3000);
    }
  }

  return Promise.race([
    page
      .waitForURL(/sales\//, { timeout: config.timeouts.navigation })
      .then((): NavOutcome => 'sales')
      .catch((): NavOutcome => 'timeout'),
    page
      .waitForURL(/\/(signIn|login)/, { timeout: config.timeouts.navigation })
      .then((): NavOutcome => 'signIn')
      .catch((): NavOutcome => 'timeout'),
  ]);
}

async function dismissStartupPopup(page: Page): Promise<void> {
  try {
    const popup = page.locator('#cancel[data-dismiss="modal"]');
    await popup.waitFor({ state: 'visible', timeout: 3000 });
    await popup.click();
    await popup.waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    /* no popup — continue */
  }
}

async function createRolePage(
  browser: Browser,
  role: 'admin' | 'restricted',
  testInfo: TestInfo,
  use: (page: Page) => Promise<void>
): Promise<void> {
  // WHY: Set current test context so errors captured during this test
  // are tagged with the correct test title and file
  ErrorCollector.setCurrentTest(testInfo.title, testInfo.file);

  // WHY: Use AuthManager.getContextForRole() instead of raw storageState —
  // AuthManager validates the session before creating the context and
  // re-logins automatically if expired. This prevents mid-suite session
  // expiry from causing flaky failures.
  const authManager = new AuthManager(browser);
  let context = await authManager.getContextForRole(role);
  let page = await context.newPage();

  // WHY: Attach error listeners before navigating so we capture ALL errors
  // from the very first page load, not just after the test starts
  attachErrorListeners(page);
  attachSessionExpiryListener(page, role, authManager);

  // WHY: Stagger restricted user initialization on CI to avoid concurrent session conflicts
  if (role === 'restricted' && process.env.CI) {
    await page.waitForTimeout(Math.floor(Math.random() * 3000));
  }

  const maxAttempts = 2;
  let landed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await navigateAndConfirmLoggedIn(page, role);
    if (outcome === 'sales') {
      landed = true;
      break;
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `${role} page failed to reach the app's /sales/ area after ${maxAttempts} login ` +
          `attempts (last outcome: ${outcome}, current URL: ${page.url()}). This is a genuine ` +
          `failure, not a session-expiry false positive a retry could paper over — investigate ` +
          `the app/environment.`
      );
    }

    logger.warn(
      `${role} page did not land on /sales/ (outcome: ${outcome}, url: ${page.url()}) — ` +
        `forcing a fresh login and retrying (attempt ${attempt}/${maxAttempts})`
    );
    await authManager.clearStorageState(role).catch(() => {});
    AuthManager['lastValidated'].delete(role);
    await authManager.loginAndSaveState(role);
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    context = await authManager.getContextForRole(role);
    page = await context.newPage();
    attachErrorListeners(page);
    attachSessionExpiryListener(page, role, authManager);
  }

  if (!landed) {
    // Unreachable — the loop above either sets landed=true or throws — but
    // keeps TypeScript's control-flow analysis happy without a non-null cast.
    throw new Error(`${role} page never landed on /sales/ — see prior log for details`);
  }

  await dismissStartupPopup(page);

  await use(page);

  ErrorCollector.clearCurrentTest();
  await context.close();
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
    await createRolePage(browser, 'admin', testInfo, use);
  },

  restrictedPage: async ({ browser }, use, testInfo) => {
    await createRolePage(browser, 'restricted', testInfo, use);
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
