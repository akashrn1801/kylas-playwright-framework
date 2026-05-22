// src/auth/globalSetup.ts
import { chromium, FullConfig } from '@playwright/test';
import { config } from '../../config/config';
import * as fs from 'fs';
import * as path from 'path';

// WHY: per-env subdirectory — switching ENV=staging never accidentally
// reuses a cached QA session, which would cause silent auth failures
const STORAGE_STATE_DIR = path.join(__dirname, 'storageStates', config.env);

async function globalSetup(_playwrightConfig: FullConfig): Promise<void> {
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });

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

  // WHY: skip login if state is fresh (under 8 hours old) — speeds up local re-runs
  if (fs.existsSync(stateFile)) {
    const age = Date.now() - fs.statSync(stateFile).mtimeMs;
    if (age < 8 * 60 * 60 * 1000) {
      console.log(`[globalSetup] Reusing fresh state for: ${role}`);
      return;
    }
  }

  console.log(`[globalSetup] Logging in as: ${role}`);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('#input_email').fill(credentials.email);
    await page.locator('#input_password').fill(credentials.password);
    await page.locator('#loginBtn').click();
    await page.waitForURL(/sales\/home/, { timeout: config.timeouts.navigation });

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