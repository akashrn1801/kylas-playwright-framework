import { test as base, Page, BrowserContext } from '@playwright/test';
import { config } from '../../config/config';
import * as path from 'path';

const stateFor = (role: string) =>
  path.join(__dirname, '../auth/storageStates', config.env, `${role}.json`);

export type TestFixtures = {
  adminPage: Page;
  restrictedPage: Page;
  adminContext: BrowserContext;
  restrictedContext: BrowserContext;
};

export const test = base.extend<TestFixtures>({

  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: stateFor('admin') });
    const page = await context.newPage();
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });
    try {
      const popup = page.locator('#cancel[data-dismiss="modal"]');
      await popup.waitFor({ state: 'visible', timeout: 3000 });
      await popup.click();
      await popup.waitFor({ state: 'hidden', timeout: 3000 });
    } catch { /* no popup — continue */ }
    await use(page);
    await context.close();
  },

  restrictedPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: stateFor('restricted') });
    const page = await context.newPage();
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
