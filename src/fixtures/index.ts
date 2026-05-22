import { test as base, Page, BrowserContext } from '@playwright/test';
import { config } from '../../config/config';
import * as path from 'path';

// WHY: per-env subdirectory matches globalSetup — ensures fixtures always
// load the state file that matches the currently running environment
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

    // Single navigation — AuthManager already validated session
    // No duplicate page.goto here
    await page.goto(config.appUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForURL(/sales\//, {
      timeout: config.timeouts.navigation,
    });

    await use(page);
    logger.info('Tearing down admin page fixture');
    await context.close();
  },

  restrictedPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: stateFor('restricted') });
    const page = await context.newPage();

    await page.goto(config.appUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForURL(/sales\//, {
      timeout: config.timeouts.navigation,
    });

    await use(page);
    logger.info('Tearing down restricted page fixture');
    await context.close();
  },

  adminContext: async ({ browser }, use) => {
    logger.info('Setting up admin context fixture');
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('admin');
    await use(context);
    await context.close();
  },

  restrictedContext: async ({ browser }, use) => {
    logger.info('Setting up restricted context fixture');
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('restricted');
    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';
export type { UserRole } from '../auth/authManager';