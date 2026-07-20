import { chromium, FullConfig } from '@playwright/test';
import { ErrorCollector } from '../error-collector/ErrorCollector';
import { config } from '../../config/config';
import * as fs from 'fs';
import * as path from 'path';

const STORAGE_STATE_DIR = path.join(__dirname, 'storageStates', config.env);

// WHY: added 2026-07-19 — playwright.config.ts's `trace: 'retain-on-failure'`
// only applies to the standard per-test fixture lifecycle. globalSetup runs
// its own browser/context/page entirely outside that mechanism, so a
// globalSetup hang (like the Staging waitUntil:'load' hang this was added
// alongside) produced zero trace/HAR artifact — nothing to inspect after the
// fact. Mirrors the same outputDir convention playwright.config.ts already
// uses (CI vs local split) so these land in a predictable, already-gitignored
// location, not a new one-off path.
const GLOBAL_SETUP_TRACE_DIR = path.join(
  process.env.CI ? 'test-results' : `test-results/${config.env}`,
  'global-setup-traces'
);

async function globalSetup(_playwrightConfig: FullConfig): Promise<void> {
  ErrorCollector.attachNodeListeners();
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_SETUP_TRACE_DIR, { recursive: true });

  // WHY: Remove any stale advisory-lock directories left behind by a crashed
  // previous run — otherwise AuthManager.withFileLock() would make every
  // worker wait the full 30s timeout before proceeding with login.
  for (const role of ['admin', 'restricted'] as const) {
    const lockPath = path.join(STORAGE_STATE_DIR, `${role}.lock`);
    try {
      fs.rmdirSync(lockPath);
    } catch {
      /* not present */
    }
  }

  // WHY: --no-sandbox is required inside Docker/Jenkins containers
  // Without it Chromium cannot create a sandbox process and times out
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    await setupRole('admin', browser);
    await setupRole('restricted', browser);
  } finally {
    await browser.close();
  }
}

async function setupRole(
  role: 'admin' | 'restricted',
  browser: import('@playwright/test').Browser
): Promise<void> {
  const stateFile = path.join(STORAGE_STATE_DIR, `${role}.json`);
  const credentials = config.users[role];

  // WHY: in CI always force fresh login — cached state from previous
  // builds may be expired or from a different environment
  if (fs.existsSync(stateFile) && !process.env.CI) {
    const age = Date.now() - fs.statSync(stateFile).mtimeMs;
    if (age < 1 * 60 * 60 * 1000) {
      console.log(`[globalSetup] Reusing fresh state for: ${role}`);
      return;
    }
  }

  // WHY: A single failed page.goto()/login-click here aborts the ENTIRE suite
  // run with zero retry, unlike authManager.ts's runtime re-login path which
  // already retries navigation 3x. Mirror that same 3-attempt/backoff pattern
  // for this one-time, most-consequential login.
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[globalSetup] Logging in as: ${role} (attempt ${attempt}/${maxAttempts})`);
    const context = await browser.newContext();
    // WHY: retain-on-failure, same convention as playwright.config.ts's own
    // test-level tracing — start unconditionally (cheap), only save the
    // trace to disk if this attempt actually fails, so a green CI run never
    // accumulates trace zips for a login that worked fine.
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    let capturedUserName = '';
    let succeeded = false;

    // Intercept /v1/users/me response to capture display name
    page.on('response', async (r) => {
      if (r.url().includes('/v1/users/me') && r.status() === 200) {
        const body = await r.json().catch(() => null);
        const n = body?.name || body?.fullName || body?.firstName || '';
        if (n) capturedUserName = n;
      }
    });

    try {
      // WHY: Jenkins server is slower than local — 30s default is not enough
      // for the initial page load on a memory-constrained CI server
      // WHY: "commit" fires on first byte received — more reliable than
      // "domcontentloaded" in headless Docker where JS may hang on load
      await page.goto(config.appUrl, { waitUntil: 'commit', timeout: 60000 });
      await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });
      await page.locator('#input_email').fill(credentials.email);
      await page.locator('#input_password').fill(credentials.password);
      await page.locator('#loginBtn').click();
      // WHY: fixed 2026-07-19 — this bare waitForURL() had no explicit
      // waitUntil, so it defaulted to Playwright's 'load', which waits for
      // EVERY resource on the page (analytics, chat widgets, tracking
      // pixels) to finish, not just the URL changing — the exact same
      // mechanism BasePage.waitForUrl() was already hardened against
      // (2026-07-07, see that method's own comment). Two consecutive
      // stage.yml runs hung the full 120000ms here, 3/3 attempts each run,
      // while a manual Staging login succeeds in ~2s — consistent with a
      // headless/extension-free CI context never firing 'load' for some
      // third-party resource the app waits on. This line pre-dates this
      // fix by ~2 months (introduced 2026-05-22, briefly swapped to
      // 'networkidle' and reverted the same day in early June) and was
      // never brought in line with the domcontentloaded convention
      // established elsewhere. Bringing it in line here, matching the one
      // proven fix already in this codebase rather than guessing a new one.
      await page.waitForURL(/sales\//, {
        timeout: config.timeouts.navigation,
        waitUntil: 'domcontentloaded',
      });

      // WHY: validate we actually landed on the app not redirected back to login
      const currentUrl = page.url();
      if (currentUrl.includes('signIn') || currentUrl.includes('login')) {
        throw new Error(
          `[globalSetup] Login failed for ${role} — redirected to ${currentUrl}. Check credentials for ENV=${config.env}`
        );
      }

      try {
        const dismissBtn = page.locator('#cancel[data-dismiss="modal"]');
        await dismissBtn.waitFor({ state: 'visible', timeout: 5000 });
        await dismissBtn.click();
        await dismissBtn.waitFor({ state: 'hidden', timeout: 5000 });
        console.log(`[globalSetup] Dismissed popup for: ${role}`);
      } catch {
        // No popup — continue
      }

      await context.storageState({ path: stateFile });
      console.log(`[globalSetup] State saved for: ${role}`);

      // Save captured display name to userNames.json
      await page.waitForTimeout(2000);
      if (capturedUserName) {
        const namesFile = path.join(STORAGE_STATE_DIR, 'userNames.json');
        const existing = fs.existsSync(namesFile)
          ? JSON.parse(fs.readFileSync(namesFile, 'utf8'))
          : {};
        existing[role] = capturedUserName.trim();
        fs.writeFileSync(namesFile, JSON.stringify(existing, null, 2));
        console.log(`[globalSetup] Display name saved for ${role}: ${capturedUserName.trim()}`);
      } else {
        console.warn(`[globalSetup] Could not capture display name for ${role}`);
      }

      succeeded = true;
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[globalSetup] Login attempt ${attempt}/${maxAttempts} failed for ${role}: ${String(error)}`
      );
      if (attempt < maxAttempts) {
        console.log('[globalSetup] Retrying in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      if (succeeded) {
        // WHY: discard — nothing went wrong, no point keeping the trace
        await context.tracing.stop().catch(() => null);
      } else {
        const tracePath = path.join(
          GLOBAL_SETUP_TRACE_DIR,
          `${role}-attempt${attempt}-${Date.now()}.zip`
        );
        await context.tracing
          .stop({ path: tracePath })
          .then(() => console.log(`[globalSetup] Trace saved: ${tracePath}`))
          .catch((traceError) =>
            console.warn(`[globalSetup] Could not save trace for ${role}: ${String(traceError)}`)
          );
      }
      await context.close();
    }
  }

  throw new Error(
    `GlobalSetup failed after 3 attempts — environment may be unreachable. ` +
      `Role: ${role}, ENV: ${config.env}. Last error: ${String(lastError)}`
  );
}

export default globalSetup;
