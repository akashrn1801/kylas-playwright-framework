import { chromium, FullConfig } from '@playwright/test';
import { config } from '../../config/config';
import * as fs from 'fs';
import * as path from 'path';

// WHY: per-env subdirectory — switching ENV=staging never accidentally
// reuses a cached QA session, which would cause silent auth failures
const STORAGE_STATE_DIR = path.join(__dirname, 'storageStates', config.env);

async function globalSetup(_playwrightConfig: FullConfig): Promise<void> {
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
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

  console.log(`[globalSetup] Logging in as: ${role}`);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // WHY: Jenkins server is slower than local — 30s default is not enough
// for the initial page load on a memory-constrained CI server
// WHY: 'commit' fires on first byte received — more reliable than
// 'domcontentloaded' in headless Docker where JS may hang on load
await page.goto(config.appUrl, { waitUntil: 'commit', timeout: 60000 });
    await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#input_email').fill(credentials.email);
    await page.locator('#input_password').fill(credentials.password);
    await page.locator('#loginBtn').click();
    // WHY: CI environments (GitHub Actions) are slower — use 120s timeout
    const navTimeout = process.env.CI ? 120000 : config.timeouts.navigation;
    await page.waitForURL(/sales\//, { timeout: navTimeout });

    // WHY: validate we actually landed on the app not redirected back to login
    const currentUrl = page.url();
    if (currentUrl.includes('signIn') || currentUrl.includes('login')) {
      throw new Error(`[globalSetup] Login failed for ${role} — redirected to ${currentUrl}. Check credentials for ENV=${config.env}`);
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
  } finally {
    await context.close();
  }
}

export default globalSetup;
