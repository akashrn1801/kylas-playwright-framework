import { Browser, BrowserContext, Page } from '@playwright/test';
import { config, buildApiUrl } from '../../config/config';
import { logger } from '../utils/logger';
import { safeWaitForURL } from '../utils/navigation';
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
        // WHY: migrated 2026-07-19 to safeWaitForURL() — this was a bare
        // waitForURL() defaulting to 'load'. This method is called from
        // getContextForRole() on every cache-miss (see that method's own
        // call site) — CI evidence (2026-07-19, sandbox run 29673393047,
        // commit a91270f) shows 58 "Test timeout of 120000ms exceeded while
        // setting up 'adminPage'/'restrictedPage'" fixture failures with a
        // clean signal (zero backend-connectivity noise in the same run),
        // strongly implicating this exact call: a 'load' hang here can
        // falsely report a valid session as invalid, forcing a full
        // re-login under file-lock contention that can cascade past the
        // 120s fixture-setup budget.
        await safeWaitForURL(page, /sales\//, 10000);
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

  // WHY headless, not the UI-driven _doLogin() (2026-07-23 architecture
  // overhaul — see attachSessionExpiryInterceptor() in fixtures/index.ts for
  // the full history of why mid-test recovery was rebuilt around this):
  // confirmed live, via real network capture against the actual Kylas app,
  // that login is a plain `PUT /v1/users/login` with JSON
  // `{email, password, rememberMe}`, returning `{token: <JWT>}` — no CSRF
  // token, no cookie, no UI dependency of any kind. Measured ~300ms per
  // call. _doLogin()'s UI-driven flow (navigate to /signIn, wait for DOM,
  // fill inputs, click, wait for redirect) takes several seconds and depends
  // on the login FORM rendering correctly — an acceptable cost for the
  // suite's ONE initial per-role login (still used there, untouched), but
  // needlessly slow and fragile for MID-TEST recovery, which can happen
  // many times per run and, for the new network-level interceptor below,
  // must complete fast enough to hold a single in-flight request open.
  // Deliberately calls the real endpoint directly rather than adding a
  // fake/mocked login — this IS the same request the browser's own login
  // form issues; we're just skipping the DOM round-trip to get there.
  // WHY this delegates to the shared buildApiUrl() (refactored 2026-07-28,
  // see config.ts's own comment on buildApiUrl for the full history): this
  // method used to carry its own inline normalization logic — a second,
  // independent hand-rolled copy of the same fix was then found needed in
  // DealsPage.ts's fetchCurrentDealApiData(), which is exactly the kind of
  // drift a single shared implementation prevents. No behavior change for
  // this method's callers — same computed URL as before.
  private getLoginUrl(): string {
    return buildApiUrl('/users/login');
  }

  private async loginHeadless(role: UserRole, page: Page): Promise<string> {
    const credentials = this.getCredentials(role);
    if (!credentials.email || !credentials.password) {
      throw new Error(
        `Credentials missing for role: ${role}, ENV: ${config.env}. ` +
          `Check ${config.env.toUpperCase()}_${role.toUpperCase()}_EMAIL and PASSWORD in .env`
      );
    }
    // WHY page.request (not a fresh APIRequestContext): reuses the page's
    // own browser context — no extra process/context to spin up and tear
    // down, and keeps this call attributable to the same context the
    // caller is already operating on.
    // WHY normalized via getLoginUrl(), not a hardcoded `${apiBaseUrl}/users/login`
    // (fixed 2026-07-28, replacing the 2026-07-23 version of this comment):
    // that version asserted config.apiBaseUrl "ALREADY includes the /v1 suffix
    // for every environment," confirmed only against the LOCAL .env file. Real
    // CI evidence (sandbox run 30286886093 AND qa-regression run 30092655209,
    // both 2026-07-26/27) proved this false — the GitHub Actions secret backing
    // QA_API_BASE_URL does NOT include /v1, so this exact call 404'd on every
    // single invocation in CI (confirmed via direct curl against the real
    // backend: with /v1 → 401 as expected; without /v1 → 404, an exact match
    // for the CI error text). That made every proactive/reactive re-auth in CI
    // fail outright, which is what actually produced the mass test-failure
    // pattern investigated that day — not a token-lifetime or concurrency bug.
    // getLoginUrl() normalizes so this is correct regardless of which shape a
    // given environment's config happens to have, instead of re-relying on a
    // convention that has already silently drifted once between local and CI.
    const response = await page.request.put(this.getLoginUrl(), {
      data: { email: credentials.email, password: credentials.password, rememberMe: false },
    });
    if (!response.ok()) {
      throw new Error(
        `Headless login failed for role ${role}: HTTP ${response.status()} from ${this.getLoginUrl()}`
      );
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) {
      throw new Error(`Headless login for role ${role} returned no token in the response body`);
    }
    return body.token;
  }

  // WHY mid-test session recovery lives here (2026-07-09 investigation,
  // rebuilt headless 2026-07-23) — a real, reproducible Kylas backend
  // hiccup ("001002 we are not able to recognize you") can occasionally hit
  // a request mid-test and cause the app's own frontend to redirect to
  // /signIn, unrelated to the token's actual ~10h lifetime (confirmed by
  // decoding the stored JWT — expiresIn is ~37569s). This method re-
  // authenticates the CALLER's already-open page in place (a test's page
  // object holds references into that specific page and can't simply be
  // handed a brand-new browser context) by writing the fresh JWT directly
  // into its localStorage — no cookies involved, confirmed live (2026-07-23)
  // that clearing localStorage ALONE (cookies untouched) immediately
  // redirects to /signIn, i.e. Kylas's own session lives entirely in this
  // one localStorage value, never a cookie. Also persists the fresh state to
  // the shared per-role file (same atomic temp-then-rename as _doLogin(),
  // and under the SAME cross-process file lock, since this writes the exact
  // same file _doLogin() does and is just as exposed to the same concurrent-
  // worker race) so the NEXT test's fixture setup doesn't redundantly
  // re-login for a session that's already fresh.
  async reauthenticatePage(page: Page, role: UserRole): Promise<void> {
    logger.warn(`Mid-test session expiry for role ${role} — re-authenticating headlessly (no UI navigation)`);

    const token = await this.loginHeadless(role, page);
    await page.evaluate((t) => window.localStorage.setItem('token', t), token);

    await this.withFileLock(role, async () => {
      const stateFile = this.getStorageStateFile(role);
      const tmpStateFile = `${stateFile}.tmp.${process.pid}`;
      await page.context().storageState({ path: tmpStateFile });
      fs.renameSync(tmpStateFile, stateFile);
    });
    AuthManager.lastValidated.set(role, Date.now());

    logger.info(`Headless re-authentication complete for role: ${role}`);
  }

  // WHY this exists (2026-07-30, defensive hardening — root cause NOT fully
  // confirmed, see the investigation this fix is based on): two independent
  // real occurrences (Meeting custom-field tests, companies.rbac.spec.ts)
  // showed the SAME pattern — reauthenticatePage()'s headless token swap
  // reports success, tryRecoverSessionForPage()'s own goto+verification
  // confirms the app STILL redirects back to /signIn immediately after, and
  // this can happen TWICE in a row (once via the proactive ensureFreshSession()
  // path, once via the reactive withSessionExpiryRecovery() path) before a
  // test finally fails. Both occurrences showed an HTTP 400 on the app's own
  // `GET /v1/tokens/refresh/` firing at the exact moment of each redirect —
  // that endpoint was independently confirmed broken/non-functional earlier
  // in this codebase's history (see loginHeadless()'s own comment history),
  // suggesting the app's frontend may force a signIn redirect when ITS OWN
  // internal refresh attempt fails, regardless of whether our actual bearer
  // token is still valid. A direct, targeted reproduction attempt (a second
  // headless login for the same account immediately after a fresh UI login)
  // did NOT reproduce this — the real trigger likely requires genuine
  // multi-hour token age, which cannot be forced on demand. This fix is
  // therefore HARDENING BASED ON CODE REVIEW, not a proven root-cause fix
  // (per this codebase's own standing rule: document defensive fixes as
  // such, don't overstate them) — it gives tryRecoverSessionForPage() a
  // qualitatively different fallback (a real, full UI-driven login,
  // exercising the app's actual login form end-to-end) to try before giving
  // up, rather than a second identical headless-swap attempt that has now
  // been observed to fail the same way twice.
  //
  // WHY UI-driven here specifically, despite reauthenticatePage()'s own
  // comment explaining why headless was chosen over this for the COMMON
  // case (speed: ~300ms vs several seconds): this method is only ever
  // reached as a LAST-RESORT escalation, after the fast headless path has
  // already been tried and confirmed not to have taken effect — the speed
  // cost that matters for the common path is irrelevant here, and a real
  // login form submission exercises code (the app's own post-login
  // initialization) that a silent localStorage swap never touches.
  async reauthenticatePageViaUI(page: Page, role: UserRole): Promise<void> {
    logger.warn(
      `Escalating to a full UI-driven re-login for role ${role} — the headless recovery ` +
        `did not stick (still redirected to signIn immediately after)`
    );
    const credentials = this.getCredentials(role);
    if (!credentials.email || !credentials.password) {
      throw new Error(
        `Credentials missing for role: ${role}, ENV: ${config.env} — cannot escalate to UI login`
      );
    }

    await this.navigateToLoginPage(page);

    const emailInput = page.locator('#input_email');
    await emailInput.clear();
    await emailInput.fill(credentials.email);

    const passwordInput = page.locator('#input_password');
    await passwordInput.clear();
    await passwordInput.fill(credentials.password);

    await page.locator('#loginBtn:not([disabled])').waitFor({ state: 'visible', timeout: 15000 });
    await page.locator('#loginBtn').click();
    await page.waitForURL(/sales\//, { timeout: 90000, waitUntil: 'domcontentloaded' });
    await this.dismissPopupIfPresent(page);

    await this.withFileLock(role, async () => {
      const stateFile = this.getStorageStateFile(role);
      const tmpStateFile = `${stateFile}.tmp.${process.pid}`;
      await page.context().storageState({ path: tmpStateFile });
      fs.renameSync(tmpStateFile, stateFile);
    });
    AuthManager.lastValidated.set(role, Date.now());

    logger.info(`UI-driven re-authentication complete for role: ${role}`);
  }

  // WHY this exists (2026-07-23, Option 6 — a PROACTIVE layer, complementary
  // to withSessionExpiryRecovery()'s REACTIVE one): that mechanism only ever
  // helps after something has already failed because the session expired.
  // This checks the token's own remaining lifetime BEFORE a test starts and
  // refreshes ahead of time if it's running low — preventing the failure
  // from ever happening in the common case, rather than cleaning up after
  // it. Uses the exact same fast headless login as the reactive path (no
  // new mechanism, no route interception/replay — the thing that got the
  // network interceptor rejected by the real backend never enters into
  // this at all, since this never touches in-flight traffic).
  async ensureFreshSession(page: Page, role: UserRole): Promise<void> {
    const rawToken = await page
      .evaluate(() => window.localStorage.getItem('token'))
      .catch(() => null);
    if (!rawToken) {
      // Nothing to check yet (e.g. called before the very first page load) —
      // the existing pre-flight session validation in getContextForRole()
      // already covers this case.
      return;
    }
    const remainingMs = getTokenRemainingMs(rawToken);
    if (remainingMs === null) {
      logger.debug(
        `ensureFreshSession: could not decode token expiry for role ${role} — skipping proactive check`
      );
      return;
    }
    if (remainingMs > PROACTIVE_REFRESH_BUFFER_MS) {
      logger.debug(
        `ensureFreshSession: token for role ${role} has ${Math.round(remainingMs / 1000)}s remaining — no proactive refresh needed`
      );
      return;
    }
    logger.info(
      `ensureFreshSession: token for role ${role} has only ${Math.round(remainingMs / 1000)}s remaining — proactively refreshing before the test starts`
    );
    await this.reauthenticatePage(page, role);
  }
}

// WHY this exists (2026-07-23, for AuthManager.ensureFreshSession() above):
// confirmed live via real network capture that the JWT stored in
// localStorage.token embeds its own absolute expiry as a ms-epoch timestamp
// at payload.data.expiry (decoded from a real token: expiresIn 37569s
// [~10.4h], expiry a concrete ms-epoch value) — reading it costs nothing (no
// network call), which is what makes a cheap, unconditional proactive check
// at the start of every test practical.
export function getTokenRemainingMs(rawToken: string): number | null {
  try {
    const payloadSegment = rawToken.split('.')[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64').toString('utf-8')) as {
      data?: { expiry?: number };
    };
    const expiry = payload.data?.expiry;
    if (typeof expiry !== 'number') return null;
    return expiry - Date.now();
  } catch {
    return null;
  }
}

// WHY 10 minutes, not an arbitrary small number: this session's own full-
// suite heartbeat/timing data (both the live stage run and historical logs
// inspected while building the heartbeat tooling) shows individual test
// durations up to ~2.1 minutes for the heaviest NORMAL (non-failure) flows
// — failure-inflated durations (a test waiting out a session-expiry timeout)
// don't count, since those are exactly what this mechanism prevents. 10
// minutes gives comfortable (~5x) margin over the heaviest observed normal
// test, while remaining a tiny fraction (~1.6%) of the token's own ~10.4h
// lifetime — refreshing early costs one extra ~300ms-1s headless login
// call, negligible next to the cost of a mid-test expiry.
const PROACTIVE_REFRESH_BUFFER_MS = 10 * 60 * 1000;

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

// WHY this exists (added 2026-07-20, found via deliberate stress-testing of
// this recovery mechanism before extending it further — not a reported bug):
// tryRecoverSessionForPage() throws if the page isn't registered, on the
// assumption every caller's page always is. That's false for any test using
// the plain @playwright/test `page` fixture instead of `adminPage`/
// `restrictedPage` (e.g. login.spec.ts, which is never registered since it
// never goes through createRolePage()). Those tests' own LoginPage actions
// (goto/fill/click) legitimately land on or start from the signIn page as
// their EXPECTED state, not a session-expiry symptom — there is no role to
// recover, and there must not be one invented. Without this check, a plain
// action failure that happens to occur while genuinely on signIn would throw
// a confusing "Page was not registered for session recovery" instead of the
// test's real, original error — a latent trap that had simply never been
// triggered in practice (those specific actions rarely fail). Every call
// site that attempts recovery (BasePage's click(), fill(), navigateTo())
// must check this FIRST and skip straight to the original error when false,
// preserving pre-mechanism behavior exactly for unregistered pages.
export function isPageRegisteredForRecovery(page: Page): boolean {
  return pageRecoveryRegistry.has(page);
}

export function isSignInUrl(url: string): boolean {
  return /\/(signIn|login)/.test(url);
}

// WHY this exists (2026-07-23, found via deliberate reproduction while
// verifying withSessionExpiryRecovery() — not assumed): every recovery gate
// check in this codebase (click()/fill()/navigateTo()/assertUrl()/
// withSessionExpiryRecovery()) only ever checked isSignInUrl(). Reproduced
// live: a full page reload while the session token is invalid does NOT
// always redirect to /signIn — it can instead render a distinct client-side
// "Forbidden" page (confirmed via screenshot: heading "Forbidden" + a "Home"
// button) while the URL stays completely unchanged (confirmed via trace
// inspection — still exactly the pre-reload URL, e.g. /sales/leads/list).
// A mid-session expiry while the app is already running and reacting to a
// live API 401 consistently redirects to /signIn instead (confirmed
// repeatedly this same session) — this "Forbidden" page appears to be a
// DIFFERENT code path specific to the app's own bootstrap-time auth check
// on a fresh load/reload, not the runtime API-error-handler path. Both are
// real, both mean the same underlying thing (no valid session), so both
// must trigger recovery — a URL-only check silently misses the second one.
// Grepped this entire codebase for any existing test that relies on this
// exact "Forbidden" page as an expected, correct RBAC-denial outcome —
// zero hits — so recognizing it here cannot mask any current test's
// genuine permission-boundary assertion.
// WHY async (a real signature change from the old sync isSignInUrl-only
// checks): recognizing "Forbidden" requires reading the page's own body
// text, which is unavoidably an async operation — every call site updated
// to use this needed `await` added, a small, mechanical, one-line-per-site
// change.
const FORBIDDEN_PAGE_PATTERN = /^\s*Forbidden\s*$/m;

export async function isSessionExpiryPage(page: Page): Promise<boolean> {
  if (isSignInUrl(page.url())) {
    return true;
  }
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return FORBIDDEN_PAGE_PATTERN.test(bodyText);
}

// ── Session-expiry-aware waitForResponse (2026-07-20) ────────────────────────
// WHY this exists: `click()`/`fill()`/`navigateTo()` all recover from a mid-
// test session expiry, but a `page.waitForResponse()` armed to capture a
// save's response ID has NO such coverage — confirmed live twice today
// (leads.rbac.spec.ts:398, call-logs.spec.ts:305): when the session expires
// while such a promise is pending, the real response never arrives in the
// shape the predicate wants, and the caller waits out the FULL configured
// timeout (often 30-60s) before giving up with a generic "ID not captured
// after save" error — the passive detector (attachSessionExpiryListener in
// fixtures/index.ts) already logs the expiry, but nothing SHORT-CIRCUITS the
// wait itself. This is a genuinely different code path from click()/fill():
// those retry a stable, still-present locator; a waitForResponse is racing
// an already-in-flight network request whose triggering UI state (e.g. a
// create-form modal) may already be gone by the time expiry is detected
// (confirmed live — the app does a full-page redirect to /signIn, destroying
// the modal). Blindly re-clicking a vanished button would be a WORSE failure
// than today's slow-but-self-healing behavior, so this deliberately does
// NOT attempt to resume the original in-flight request — see
// armResponseWaitWithRecovery()'s own comment in BasePage.ts for the fuller
// design rationale and the "fail fast, recover, let the caller's own retry
// finish the job" tradeoff this represents.

// WHY these exact two conditions, not new ones: reuses the identical
// detection logic already trusted by attachSessionExpiryListener() in
// fixtures/index.ts (401 on a backend API call, or a main-frame navigation
// to /signIn) as a one-shot AWAITABLE signal, instead of that function's
// passive fire-and-log behavior. Keeping both call sites in sync matters —
// if fixtures/index.ts's detection conditions are ever tuned, this should be
// tuned identically; that's why this lives in the same file as
// isSignInUrl()/tryRecoverSessionForPage(), not duplicated in BasePage.ts.
// WHY `hasFired()` exists alongside `promise` (added 2026-07-20, found via
// deliberate reproduction of withSessionExpiryRetry() below — not a guess):
// the first design only exposed the Promise, and had a SEPARATE WeakMap
// flag that armResponseWaitWithRecovery() set only AFTER it had fully
// awaited tryRecoverSessionForPage() (a real re-login, taking 10+ seconds).
// That flag arrived too late for methods shaped like LeadsPage.saveLead():
// `const idPromise = this.captureLeadIdFromResponse();` (armed but NOT
// awaited yet) followed by OTHER code (`assertNoFormErrors()`) that reacts
// to the SAME underlying failure much faster (a DOM toast-check, ~1.5s) —
// reproduced live: assertNoFormErrors() threw and propagated out of the
// whole workflow BEFORE the slow re-login had gotten far enough to set the
// flag, so withSessionExpiryRetry() saw an unset flag and didn't retry, even
// though this WAS a genuine, confirmed session expiry. `hasFired()` fixes
// this by being a synchronous boolean toggled the INSTANT the underlying
// browser event arrives (page.on('response')/'framenavigated' callbacks are
// synchronous, immediate — no awaited chain in between) — this reliably
// precedes any JS-level reaction to that same event (network event fires
// before the app's JS can process the response and render a toast), so
// checking `hasFired()` at catch-time is race-free regardless of how slow
// any NESTED recovery attempt is. withSessionExpiryRetry() below arms its
// OWN signal for this exact reason — not to duplicate detection work, but
// so its own synchronous flag can never lag behind a sibling code path in
// the same workflow.
export function armSessionExpirySignal(page: Page): {
  promise: Promise<void>;
  cancel: () => void;
  hasFired: () => boolean;
} {
  let fired = false;
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  const mark = (): void => {
    fired = true;
    resolveFn();
  };

  const onResponse = (response: import('@playwright/test').Response): void => {
    if (response.status() === 401) {
      const url = response.url();
      if (url.includes('/v1/') || url.includes('/api/')) {
        mark();
      }
    }
  };
  const onFrameNavigated = (frame: import('@playwright/test').Frame): void => {
    if (frame === page.mainFrame() && isSignInUrl(frame.url())) {
      mark();
    }
  };

  page.on('response', onResponse);
  page.on('framenavigated', onFrameNavigated);

  const cancel = (): void => {
    page.off('response', onResponse);
    page.off('framenavigated', onFrameNavigated);
  };

  return { promise, cancel, hasFired: () => fired };
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

  // WHY this retry exists (2026-07-20, found via deliberate reproduction of
  // Gap 2's fix, not a guess): when expiry is detected mid-interaction
  // (e.g. while a save's response is pending, not during a page-level
  // navigation), the real app's own frontend can independently fire its own
  // client-side redirect to /signIn in reaction to the same 401/400 — a
  // genuine competing navigation on the SAME page/frame that this method's
  // own goto() races against. Confirmed live: this goto failed with
  // `net::ERR_ABORTED; maybe frame was detached?` navigating back to a
  // leads-list URL, immediately after a deliberately-injected 401 on a
  // lead-create POST — the app's own concurrent redirect won the race.
  // `ERR_ABORTED` specifically (and only this) means "a different
  // navigation pre-empted this one" — it is not a real network failure and
  // not ambiguous with one, so retrying it once, after the competing
  // navigation has had a moment to fully settle, is safe: by the second
  // attempt there is nothing left racing this goto. Bounded to exactly one
  // retry, matching every other recovery step in this codebase.
  try {
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  } catch (error) {
    if (!/ERR_ABORTED/.test(String(error))) {
      throw error;
    }
    logger.warn(
      `Recovery navigation to ${returnUrl} for role ${role} was aborted by a competing ` +
        `navigation (the app's own redirect reacting to the same expiry) — retrying once`
    );
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  }

  if (isSignInUrl(page.url())) {
    // WHY escalate here instead of throwing immediately (2026-07-30,
    // defensive hardening — see AuthManager.reauthenticatePageViaUI()'s own
    // comment for the full investigation and why this is labeled hardening,
    // not a proven fix): two independent real occurrences showed the
    // headless recovery above report success while the app still redirects
    // back to signIn moments later. Try a qualitatively different recovery
    // — a real, full UI-driven login — exactly once before giving up.
    logger.warn(
      `Session recovery for role ${role} via headless re-auth did not stick — still on ` +
        `${page.url()} after re-authenticating and navigating back to ${returnUrl}. ` +
        `Escalating to a full UI-driven re-login before giving up.`
    );
    await authManager.reauthenticatePageViaUI(page, role);
    await page.goto(returnUrl, { waitUntil: 'domcontentloaded' });

    if (isSignInUrl(page.url())) {
      throw new Error(
        `Session recovery for role ${role} failed even after escalating to a full UI-driven ` +
          `re-login — still on ${page.url()} after navigating back to ${returnUrl}`
      );
    }
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (PERMISSION_ERROR_PATTERN.test(bodyText)) {
    throw new Error(
      `Session recovery for role ${role} landed on a permission-denied page, not a genuine ` +
        `session blip — refusing to retry the original action. Body snippet: ${bodyText.slice(0, 300)}`
    );
  }
}
