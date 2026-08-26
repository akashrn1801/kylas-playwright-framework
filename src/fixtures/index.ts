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
import { AuthManager, registerPageForRecovery } from '../auth/authManager';
import { logger } from '../utils/logger';
import { safeWaitForURL } from '../utils/navigation';

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
      let apiErrorCode: string | undefined;
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
          // WHY captured separately from apiErrorMessage (2026-08-11): Kylas's
          // own error-code field is inconsistently named across modules
          // (`errorCode` on most, but literally `code` on Products &
          // Services's 403 RBAC response — confirmed live via
          // assertForbiddenOnRestrictedEdit()'s own body.code check) and was
          // never captured into anything before this — isExpectedRbacError()
          // could only ever pattern-match the human-readable message text,
          // never the actual machine-readable code, no matter how the
          // RBAC_EXPECTED_ERROR_CODES allowlist was configured.
          apiErrorCode = json?.errorCode || json?.code || undefined;
          if (apiErrorCode) apiErrorCode = String(apiErrorCode);
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
        apiErrorCode,
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
// WHY a real, computed deadline threaded through every step, instead of a
// fixed per-attempt timeout (redesigned 2026-08-26 — an earlier version of
// this fix statically padded testInfo.timeout by a guessed +120000ms;
// rejected as patch work, not a root-cause fix, since it didn't explain WHY
// the existing budget was insufficient, just made the guess bigger for one
// environment). The real root cause: navigateAndConfirmLoggedIn()'s own
// retry budget (up to 3 goto attempts, each independently allowed up to
// 60000ms) and createRolePage()'s outer 2-attempt recovery loop were each
// sized in isolation, with no shared awareness of the ONE governing ceiling
// (Playwright's own test timeout) they all run inside — so a slow attempt 1
// could silently consume the entire budget before recovery ever got a fair
// chance, confirmed live (sandbox run 32857739191, 2026-08-25: a recovery
// login was killed the instant it started, because attempt 1's own
// navigation had already exhausted the shared clock). A single deadline,
// derived as a fraction of whatever testInfo.timeout ACTUALLY is right now
// (120000ms on CI, 480000ms locally, or anything this config is ever changed
// to — zero environment-specific hardcoding), makes every step shrink its
// own wait to fit whatever time is genuinely left, and fail FAST with a
// clear diagnostic the moment there isn't enough left for a meaningful
// attempt — rather than blindly starting a wait it structurally cannot
// finish before Playwright's own blunt, contextless kill fires. Mirrors this
// codebase's own already-proven pattern for the identical class of problem —
// see `.claude/known-issues.md`'s CI reporting-history entry, where a fixed
// retry-delay list was replaced with a real elapsed-time-bounded backoff for
// the same underlying reason ("a bigger guessed number is still a disguised
// ceiling").
const SETUP_DEADLINE_FRACTION = 0.85;
const MIN_GOTO_STEP_BUDGET_MS = 5000;
const MIN_RECOVERY_BUDGET_MS = 15000;

async function navigateAndConfirmLoggedIn(
  page: Page,
  role: 'admin' | 'restricted',
  deadline: number
): Promise<NavOutcome> {
  // WHY: QA env has intermittent TCP timeouts under parallel load — retry the
  // raw navigation itself before ever judging where it landed. Each attempt's
  // own timeout is capped by whatever real time remains before `deadline`,
  // not a flat 60000ms regardless of how much of the shared budget is
  // already spent.
  for (let gotoAttempt = 1; gotoAttempt <= 3; gotoAttempt++) {
    const budget = deadline - Date.now();
    if (budget < MIN_GOTO_STEP_BUDGET_MS) {
      logger.warn(
        `${role}Page goto: only ${Math.max(0, budget)}ms left before the fixture-setup deadline — ` +
          `not attempting goto (attempt ${gotoAttempt}/3)`
      );
      return 'timeout';
    }
    try {
      await page.goto(config.appUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(60000, budget) });
      break;
    } catch (e) {
      if (gotoAttempt === 3) throw e;
      const remaining = deadline - Date.now();
      if (remaining < MIN_GOTO_STEP_BUDGET_MS) throw e;
      const backoffBudget = Math.min(3000, remaining);
      logger.warn(`${role}Page goto attempt ${gotoAttempt} failed — backing off (up to ${backoffBudget}ms) before retrying`);
      // WHY page.waitForLoadState() instead of an unconditional fixed sleep
      // (found and fixed 2026-08-26 — this exact line was flagged by the
      // pre-commit hook as a genuine pre-existing blind-wait call that
      // happened to move into the staged diff, the same class of catch
      // already documented in known-issues.md's Sandbox Build #144 entry):
      // a failed goto() can still be completing its navigation in the
      // background (it can throw on the waitUntil condition timing out
      // while the page genuinely finishes loading moments later) — waiting
      // on the page's own real load state, bounded by the same backoff
      // budget, resolves EARLY the instant that happens instead of always
      // waiting the full duration, and degrades identically (a bounded,
      // capped wait) when it doesn't. The .catch(() => {}) also closes a
      // real latent gap the old fixed sleep had: on an already-closed/
      // crashed page (e.g. the "Target page, context or browser has been
      // closed" class from the 2026-08-25 investigation), the old call
      // threw uncaught here — this doesn't.
      await page.waitForLoadState('load', { timeout: backoffBudget }).catch(() => {});
    }
  }

  // WHY: migrated 2026-07-19 to safeWaitForURL() — both branches were bare
  // waitForURL() calls defaulting to 'load'. This function runs on EVERY
  // test's fixture setup — CI evidence (2026-07-19, sandbox run 29673393047,
  // commit a91270f) shows 58 "Test timeout of 120000ms exceeded while
  // setting up 'adminPage'/'restrictedPage'" failures, several tracing
  // through this exact code path (createRolePage → getContextForRole). The
  // race's own timeout is now also deadline-bounded, same reasoning as above.
  const raceTimeout = Math.max(
    MIN_GOTO_STEP_BUDGET_MS,
    Math.min(config.timeouts.navigation, deadline - Date.now())
  );
  return Promise.race([
    safeWaitForURL(page, /sales\//, raceTimeout)
      .then((): NavOutcome => 'sales')
      .catch((): NavOutcome => 'timeout'),
    safeWaitForURL(page, /\/(signIn|login)/, raceTimeout)
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

  // WHY 85% of whatever testInfo.timeout currently is, not a fixed number:
  // see navigateAndConfirmLoggedIn()'s own WHY comment for the full
  // reasoning. This scales automatically with CI's 120000ms, local dev's
  // 480000ms, or any future value — reserving the remaining 15% guarantees
  // the test body + normal teardown always keep a real slice of the shared
  // clock, rather than fixture setup being free to consume the entire
  // budget as it could before (which is exactly what happened in the
  // confirmed live failures this replaces).
  const setupDeadline = Date.now() + testInfo.timeout * SETUP_DEADLINE_FRACTION;

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
  // WHY: registers (role, authManager) for this exact page so BasePage's
  // click()/fill() can call tryRecoverSessionForPage() if a mid-test
  // redirect to /signIn is ever hit — see authManager.ts's own comment for
  // the full mechanism and why a WeakMap registry instead of a constructor
  // param on every page object.
  registerPageForRecovery(page, role, authManager);

  // WHY: Stagger restricted user initialization on CI to avoid concurrent session conflicts
  if (role === 'restricted' && process.env.CI) {
    await page.waitForTimeout(Math.floor(Math.random() * 3000));
  }

  const maxAttempts = 2;
  let landed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await navigateAndConfirmLoggedIn(page, role, setupDeadline);
    if (outcome === 'sales') {
      landed = true;
      break;
    }

    // WHY checking the real remaining budget here too, not just `attempt ===
    // maxAttempts`: the recovery step below (clear storage + full re-login +
    // a fresh context) is itself a multi-second operation — starting it with
    // only a few hundred ms left before the deadline just means it also gets
    // cut off mid-flight, producing the exact same opaque, contextless
    // Playwright kill this whole redesign exists to replace. Failing here
    // instead, with a clear breakdown of why, is strictly more useful to
    // whoever reads this next.
    const timeLeftForRecovery = setupDeadline - Date.now();
    const outOfTime = timeLeftForRecovery < MIN_RECOVERY_BUDGET_MS;
    if (attempt === maxAttempts || outOfTime) {
      // WHY: Confirmed live (2026-07-07 reporting-overhaul investigation) —
      // this used to throw directly, leaking the context/page created above
      // (or re-created on a prior loop iteration) since a throw before
      // reaching `await use(page)` skips this fixture's own teardown code
      // entirely. Every time this genuine-failure path fired, one browser
      // context leaked for the rest of the worker's lifetime. Capture the URL
      // before closing — page.url() after close() is not reliable.
      const failureUrl = page.url();
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      const reason =
        outOfTime && attempt !== maxAttempts
          ? `only ${Math.max(0, timeLeftForRecovery)}ms left before the fixture-setup deadline — ` +
            `not enough to attempt another recovery login (attempt ${attempt}/${maxAttempts})`
          : `after ${maxAttempts} login attempts`;
      throw new Error(
        `${role} page failed to reach the app's /sales/ area (${reason}) — last outcome: ${outcome}, ` +
          `current URL: ${failureUrl}. This is a genuine failure, not a session-expiry false ` +
          `positive a retry could paper over — investigate the app/environment.`
      );
    }

    logger.warn(
      `${role} page did not land on /sales/ (outcome: ${outcome}, url: ${page.url()}) — ` +
        `forcing a fresh login and retrying (attempt ${attempt}/${maxAttempts})`
    );
    await authManager.clearStorageState(role).catch(() => {});
    AuthManager['lastValidated'].delete(role);
    try {
      await authManager.loginAndSaveState(role);
    } catch (recoveryError) {
      // WHY: a transient failure here (e.g. a CDP-level browser.newContext()
      // Protocol error — confirmed real, sandbox run 32839778416, 2026-08-25,
      // see known-issues.md) must not burn the remaining retry attempt. Log
      // and fall through — the next loop iteration's own
      // getContextForRole()/navigateAndConfirmLoggedIn() below gets a
      // genuine second try (getContextForRole() has its own "no valid state,
      // login fresh" fallback) instead of this throwing straight past the
      // whole loop.
      logger.warn(
        `${role} page: recovery login failed on attempt ${attempt}/${maxAttempts} ` +
          `(${String(recoveryError)}) — will retry`
      );
    }
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    context = await authManager.getContextForRole(role);
    page = await context.newPage();
    attachErrorListeners(page);
    attachSessionExpiryListener(page, role, authManager);
    registerPageForRecovery(page, role, authManager);
  }

  if (!landed) {
    // Unreachable — the loop above either sets landed=true or throws — but
    // keeps TypeScript's control-flow analysis happy without a non-null cast.
    throw new Error(`${role} page never landed on /sales/ — see prior log for details`);
  }

  await dismissStartupPopup(page);

  // WHY here, after landing/popup-dismiss but before the test body runs
  // (2026-07-23, Option 6 — proactive layer): this is the natural "test is
  // about to start" point for every adminPage/restrictedPage fixture,
  // mirroring exactly how registerPageForRecovery()/attachErrorListeners()
  // above are already wired in once per page with zero action needed from
  // any test or page object. See AuthManager.ensureFreshSession()'s own
  // comment for the full mechanism — this is complementary to, not a
  // replacement for, the reactive withSessionExpiryRecovery() a test can
  // still fall back on if it runs long enough to cross the buffer mid-test.
  // WHY wrapped in try/catch (2026-07-28, found via a real CI incident — see
  // authManager.ts's getLoginUrl()/loginHeadless() comments for the full
  // story): this call used to be unguarded, so ANY failure inside it (the
  // 404-from-a-mismatched-apiBaseUrl bug that caused this, or any other
  // future transient failure of the same headless-login call) threw straight
  // out of fixture setup and failed the ENTIRE test before its body even
  // ran — turning an optional pre-flight optimization into a single point of
  // failure with much higher blast radius than the problem it exists to
  // prevent. This is a proactive layer only; withSessionExpiryRecovery() and
  // the click()/fill()/navigateTo() reactive paths remain the backstop if a
  // genuine mid-test expiry happens anyway, so silently proceeding here is
  // safe — the test is no worse off than it would be if this check didn't
  // exist at all.
  try {
    await authManager.ensureFreshSession(page, role);
  } catch (error) {
    logger.warn(
      `ensureFreshSession failed for role ${role} — proceeding without proactive refresh; ` +
        `reactive session-expiry recovery will handle a genuine mid-test expiry if one occurs: ${String(error)}`
    );
  }

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
