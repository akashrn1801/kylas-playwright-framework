import { Browser, BrowserContext, Page } from '@playwright/test';
import { config } from '../../config/config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export type UserRole = 'admin' | 'restricted';

export interface UserCredentials {
  email: string;
  password: string;
  role: string;
}

export class AuthManager {
  private browser: Browser;
  private storageStatePath = path.join(__dirname, 'storageStates', config.env);

  // Prevent parallel login race conditions
  private static loginInProgress: Map<string, Promise<void>> = new Map();

  // WHY: Cache last successful validation time per role — avoids launching
  // a full browser context just to validate session on every single test.
  // If validated within SESSION_CACHE_MS, skip re-validation entirely.
  private static lastValidated: Map<string, number> = new Map();
  // WHY: 30min cache — check session more frequently to catch expiry before tests fail
  // App session TTL is ~1hr; checking every 30min ensures we re-login before expiry
  private static readonly SESSION_CACHE_MS = 30 * 60 * 1000; // 30 minutes

  constructor(browser: Browser) {
    this.browser = browser;
    this.ensureStorageStateDir();
  }

  private ensureStorageStateDir(): void {
    if (!fs.existsSync(this.storageStatePath)) {
      fs.mkdirSync(this.storageStatePath, { recursive: true });
    }
  }

  private getStorageStateFile(role: UserRole): string {
    return path.join(this.storageStatePath, `${role}.json`);
  }

  private getCredentials(role: UserRole): UserCredentials {
    return config.users[role];
  }

  private validateAppUrl(): void {
    if (!config.appUrl || config.appUrl.trim() === '') {
      throw new Error(
        `config.appUrl is empty. ENV=${config.env}. ` +
          `Check that ${config.env.toUpperCase()}_APP_URL is set in .env or Jenkins environment.`
      );
    }
  }

  private async dismissPopupIfPresent(page: Page): Promise<void> {
    try {
      const doItLater = page.getByText("I'll do it later");

      const isVisible = await doItLater.isVisible({
        timeout: 5000,
      });

      if (isVisible) {
        logger.info('Marketplace popup detected — dismissing');

        await doItLater.click();

        await doItLater.waitFor({
          state: 'hidden',
          timeout: 5000,
        });

        logger.info('Marketplace popup dismissed');

        return;
      }
    } catch {
      logger.debug('No marketplace popup found');
    }

    try {
      const dismissButton = page.locator('#cancel[data-dismiss="modal"]');

      const isVisible = await dismissButton.isVisible({
        timeout: 3000,
      });

      if (isVisible) {
        logger.info('Modal popup detected — dismissing');

        await dismissButton.click();

        await dismissButton.waitFor({
          state: 'hidden',
          timeout: 5000,
        });

        logger.info('Modal popup dismissed');
      }
    } catch {
      logger.debug('No modal popup found');
    }
  }

  private async navigateToLoginPage(page: Page): Promise<void> {
    let navigationSuccess = false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        logger.info(`Navigation attempt ${attempt} to: ${config.appUrl}`);

        await page.goto(config.appUrl, {
          waitUntil: 'commit',
          timeout: 60000,
        });

        logger.info('Application responded successfully');

        await page.waitForLoadState('domcontentloaded', {
          timeout: 30000,
        });

        logger.info('DOM content loaded');

        await page.locator('#input_email').waitFor({
          state: 'visible',
          timeout: 60000,
        });

        logger.info('Login page loaded successfully');

        navigationSuccess = true;
        break;
      } catch (error) {
        lastError = error;

        logger.warn(`Navigation attempt ${attempt} failed: ${String(error)}`);

        logger.warn(`Current URL: ${page.url()}`);

        try {
          const title = await page.title();
          logger.warn(`Current page title: ${title}`);
        } catch {
          logger.warn('Could not retrieve page title');
        }

        if (attempt < 3) {
          logger.info('Retrying navigation in 3 seconds...');
          await page.waitForTimeout(3000);
        }
      }
    }

    if (!navigationSuccess) {
      throw new Error(
        `Failed to load login page after 3 attempts. ` + `Last error: ${String(lastError)}`
      );
    }
  }

  private async isSessionValid(stateFile: string): Promise<boolean> {
    let context: BrowserContext | null = null;

    try {
      context = await this.browser.newContext({
        storageState: stateFile,
      });

      const page = await context.newPage();

      logger.info('Validating existing session');

      await page.goto(config.appUrl, {
        waitUntil: 'commit',
        timeout: 30000,
      });

      try {
        await page.waitForURL(/sales\//, {
          timeout: 10000,
        });
      } catch {
        logger.warn('Did not redirect to sales page');
        return false;
      }

      const currentUrl = page.url();

      logger.info(`Session validation URL: ${currentUrl}`);

      return currentUrl.includes('/sales/');
    } catch (error) {
      logger.warn(`Session validation failed: ${String(error)}`);
      return false;
    } finally {
      if (context) {
        await context.close();
      }
    }
  }

  async loginAndSaveState(role: UserRole): Promise<void> {
    // WHY: Fast path for same-process concurrent callers (e.g. adminPage +
    // restrictedPage fixtures both requesting a login in the same worker) —
    // this Map does NOT protect against a different worker process doing the
    // same thing, which is why _doLogin below is also wrapped in a cross-process
    // file lock (withFileLock).
    const existing = AuthManager.loginInProgress.get(role);

    if (existing) {
      logger.info(`Login already in progress for role: ${role}. Waiting...`);

      await existing;
      return;
    }

    const loginPromise = this.withFileLock(role, async () => {
      // WHY: Re-check under the cross-process lock — another worker may have
      // completed login (and written a fresh state file) while we were
      // waiting to acquire the lock, making our own login redundant.
      const stateFile = this.getStorageStateFile(role);
      if (fs.existsSync(stateFile) && !process.env.CI) {
        const stats = fs.statSync(stateFile);
        if (Date.now() - stats.mtimeMs < 60 * 60 * 1000) {
          logger.info(`Login skipped — fresh state file found under lock for: ${role}`);
          return;
        }
      }
      await this._doLogin(role);
    });

    AuthManager.loginInProgress.set(role, loginPromise);

    try {
      await loginPromise;
    } finally {
      AuthManager.loginInProgress.delete(role);
    }
  }

  private getLockPath(role: UserRole): string {
    return path.join(this.storageStatePath, `${role}.lock`);
  }

  // WHY: Cross-process advisory lock. Each Playwright worker is a separate OS
  // process, so the in-memory loginInProgress Map above cannot serialize
  // logins across workers — two workers could otherwise both decide a session
  // is stale and both call _doLogin(role) at the same time, racing on the
  // same admin.json/restricted.json file. fs.mkdirSync is atomic on POSIX
  // (it either creates the directory or throws EEXIST), making it the
  // simplest cross-process mutex available without adding a dependency.
  private async withFileLock<T>(role: UserRole, fn: () => Promise<T>): Promise<T> {
    const lockPath = this.getLockPath(role);
    const maxWait = 30000; // 30s max wait for another process to release the lock
    const interval = 500;
    let waited = 0;

    while (true) {
      try {
        fs.mkdirSync(lockPath);
        break; // Lock acquired
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;

        if (waited >= maxWait) {
          // WHY: Stale lock from a crashed process — remove and give it one
          // more full wait cycle before considering it stale again.
          logger.warn(`Stale lock detected for role: ${role} — removing and retrying`);
          try {
            fs.rmdirSync(lockPath);
          } catch {
            /* another process already removed it */
          }
          waited = 0;
          continue;
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
        waited += interval;
      }
    }

    try {
      return await fn();
    } finally {
      try {
        fs.rmdirSync(lockPath);
      } catch {
        /* already removed or never created */
      }
    }
  }

  private async _doLogin(role: UserRole): Promise<void> {
    this.validateAppUrl();

    logger.info(`Logging in as role: ${role}`);

    const credentials = this.getCredentials(role);

    if (!credentials.email || !credentials.password) {
      throw new Error(
        `Credentials missing for role: ${role}, ENV: ${config.env}. ` +
          `Check ${config.env.toUpperCase()}_${role.toUpperCase()}_EMAIL and PASSWORD in .env`
      );
    }

    const context = await this.browser.newContext({
      viewport: {
        width: 1920,
        height: 1080,
      },
    });

    const page = await context.newPage();

    try {
      await this.navigateToLoginPage(page);

      logger.info('Entering user credentials');

      const emailInput = page.locator('#input_email');

      await emailInput.clear();
      await emailInput.fill(credentials.email);

      const passwordInput = page.locator('#input_password');

      await passwordInput.clear();
      await passwordInput.fill(credentials.password);

      logger.info('Waiting for login button');

      await page.locator('#loginBtn:not([disabled])').waitFor({
        state: 'visible',
        timeout: 15000,
      });

      logger.info('Clicking login button');

      await page.locator('#loginBtn').click();

      logger.info('Waiting for successful login redirect');

      // WHY: domcontentloaded sufficient to confirm redirect — faster than load under parallel stress.
      await page.waitForURL(/sales\//, {
        timeout: 90000,
        waitUntil: 'domcontentloaded',
      });

      logger.info(`Login successful for role: ${role}`);

      await this.dismissPopupIfPresent(page);

      const stateFile = this.getStorageStateFile(role);

      // WHY: Write to a per-process temp file then atomically rename — with
      // multiple CI workers, writing directly to the shared stateFile risks
      // another worker reading it mid-write (truncated/corrupt JSON). Rename
      // is atomic on POSIX filesystems since both paths share the same directory.
      const tmpStateFile = `${stateFile}.tmp.${process.pid}`;

      await context.storageState({
        path: tmpStateFile,
      });

      fs.renameSync(tmpStateFile, stateFile);

      logger.info(`Storage state saved: ${stateFile}`);
    } catch (error) {
      logger.error(`Login failed for role ${role}: ${String(error)}`);

      try {
        const screenshotPath = `test-results/login-failure-${role}.png`;

        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        logger.error(`Failure screenshot captured: ${screenshotPath}`);
      } catch (_error) {
        logger.error('Failed to capture screenshot');
      }

      throw error;
    } finally {
      await context.close();
    }
  }

  async getContextForRole(role: UserRole): Promise<BrowserContext> {
    this.validateAppUrl();

    const stateFile = this.getStorageStateFile(role);

    if (fs.existsSync(stateFile)) {
      // WHY: Check in-memory cache first — if we validated this role within
      // SESSION_CACHE_MS, skip the full browser navigation check entirely.
      // This prevents 35 extra browser launches for a 35-test suite.
      const lastValidatedAt = AuthManager.lastValidated.get(role) ?? 0;
      const cacheAge = Date.now() - lastValidatedAt;

      if (cacheAge < AuthManager.SESSION_CACHE_MS) {
        logger.info(
          `Session cache hit for role: ${role} (age: ${Math.round(cacheAge / 1000)}s) — skipping validation`
        );
      } else {
        logger.info(`Existing storage state found for role: ${role}`);
        const valid = await this.isSessionValid(stateFile);

        if (!valid) {
          logger.warn(`Session expired or invalid for role: ${role}`);
          await this.loginAndSaveState(role);
        } else {
          logger.info(`Session is still valid for role: ${role}`);
        }
        // WHY: Update cache timestamp after successful validation or re-login
        AuthManager.lastValidated.set(role, Date.now());
      }
    } else {
      logger.warn(`No storage state found for role: ${role}. Logging in fresh.`);
      await this.loginAndSaveState(role);
      AuthManager.lastValidated.set(role, Date.now());
    }

    logger.info(`Creating authenticated browser context for role: ${role}`);

    return await this.browser.newContext({
      storageState: stateFile,
      viewport: {
        width: 1920,
        height: 1080,
      },
    });
  }

  async clearStorageState(role: UserRole): Promise<void> {
    const stateFile = this.getStorageStateFile(role);

    // WHY: unlink directly instead of existsSync-then-unlink — eliminates the
    // TOCTOU race where another worker deletes the file between the check and
    // the unlink. ENOENT means another worker already deleted it, which is fine.
    try {
      fs.unlinkSync(stateFile);
      logger.info(`Storage state cleared for role: ${role}`);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      logger.debug(`Storage state already cleared for role: ${role}`);
    }
  }

  async clearAllStorageStates(): Promise<void> {
    const files = fs.readdirSync(this.storageStatePath);

    files.forEach((file) => {
      fs.unlinkSync(path.join(this.storageStatePath, file));
    });

    logger.info('All storage states cleared');
  }

  // WHY: mid-test session recovery (2026-07-09 investigation) — a real,
  // reproducible Kylas QA backend hiccup ("001002 we are not able to
  // recognize you") can occasionally hit a request mid-test and cause the
  // app's own frontend to redirect to /signIn, unrelated to the token's
  // actual ~12h lifetime (confirmed by decoding the stored JWT — expiresIn
  // is 43199s). loginAndSaveState() already knows how to re-login safely
  // (cross-process file lock, reused as-is) — this method additionally
  // pushes the freshly-written storage state's cookies/localStorage into
  // the CALLER'S already-open page/context, since the test's page object
  // holds references into that specific page and can't simply be handed a
  // brand-new browser context.
  async reauthenticatePage(page: Page, role: UserRole): Promise<void> {
    logger.warn(`Mid-test session redirect detected for role ${role} — re-authenticating in place`);

    await this.loginAndSaveState(role);

    const stateFile = this.getStorageStateFile(role);
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as {
      cookies?: Parameters<BrowserContext['addCookies']>[0];
      origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
    };

    if (state.cookies?.length) {
      await page.context().addCookies(state.cookies);
    }

    const origin =
      state.origins?.find((o) => o.origin === config.appUrl) ?? state.origins?.[0];
    if (origin?.localStorage?.length) {
      await page.evaluate((items) => {
        for (const item of items) {
          window.localStorage.setItem(item.name, item.value);
        }
      }, origin.localStorage);
    }

    logger.info(`Re-authentication complete for role: ${role}`);
  }
}

// ── Mid-test session recovery ────────────────────────────────────────────────
// WHY a module-level registry, not a constructor param on BasePage: every
// page object in this codebase extends BasePage with just `super(page)` —
// changing that signature everywhere would be a huge, unrelated diff. A
// WeakMap keyed by the Page instance lets fixtures/index.ts register the
// (role, AuthManager) pairing once per page, and BasePage's click()/fill()
// look it up without needing to know about roles or AuthManager at all.

const pageRecoveryRegistry = new WeakMap<Page, { authManager: AuthManager; role: UserRole }>();

export function registerPageForRecovery(
  page: Page,
  role: UserRole,
  authManager: AuthManager
): void {
  pageRecoveryRegistry.set(page, { authManager, role });
}

export function isSignInUrl(url: string): boolean {
  return /\/(signIn|login)/.test(url);
}

// WHY this exact phrasing: matches CallLogsPage.ts's own existing
// permission-error detection (`isPermissionError` there) — reusing the same
// signal this codebase already trusts to identify a genuine RBAC denial,
// rather than inventing a second, possibly-inconsistent pattern.
const PERMISSION_ERROR_PATTERN =
  /necessary permission|don.t have enough permissions|not authorised to perform this operation/i;

// WHY this must throw (never silently return false) on every non-recoverable
// path: a caller (BasePage.click()/fill()) treats a normal return as "safe to
// retry the original action" — any ambiguity here would risk retrying into a
// masked RBAC failure, which is the one thing this mechanism must never do.
// WHY `returnUrl` is a required param, not derived from page.url() inside
// this function: by the time this is called, the page is ALREADY on
// /signIn (that's the very condition that triggered recovery) — deriving
// "where to go back to" from the current URL would just navigate back to
// signIn itself. The caller must capture page.url() BEFORE the original
// action was attempted, while the page was still on the real target page.
export async function tryRecoverSessionForPage(page: Page, returnUrl: string): Promise<void> {
  const ctx = pageRecoveryRegistry.get(page);
  if (!ctx) {
    throw new Error(
      'Page was not registered for session recovery (registerPageForRecovery was never ' +
        'called for it) — cannot recover without a known role'
    );
  }
  const { authManager, role } = ctx;

  await authManager.reauthenticatePage(page, role);
  await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });

  if (isSignInUrl(page.url())) {
    throw new Error(
      `Session recovery for role ${role} failed — still on ${page.url()} after ` +
        `re-authenticating and navigating back to ${returnUrl}`
    );
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (PERMISSION_ERROR_PATTERN.test(bodyText)) {
    throw new Error(
      `Session recovery for role ${role} landed on a permission-denied page, not a genuine ` +
        `session blip — refusing to retry the original action. Body snippet: ${bodyText.slice(0, 300)}`
    );
  }
}
