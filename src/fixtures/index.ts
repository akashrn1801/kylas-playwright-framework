import { test as base, Page, BrowserContext } from '@playwright/test';
import { AuthManager, UserRole } from '../auth/authManager';
import { config } from '../../config/config';
import { logger } from '../utils/logger';

export type TestFixtures = {
  adminPage: Page;
  restrictedPage: Page;
  adminContext: BrowserContext;
  restrictedContext: BrowserContext;
};

export const test = base.extend<TestFixtures>({

  adminPage: async ({ browser }, use) => {
    logger.info('Setting up admin page fixture');
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('admin');
    const page = await context.newPage();
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/sales\/home/, { timeout: config.timeouts.navigation });

    await use(page);

    logger.info('Tearing down admin page fixture');
    await context.close();
  },

  restrictedPage: async ({ browser }, use) => {
    logger.info('Setting up restricted page fixture');
    const authManager = new AuthManager(browser);
    const context = await authManager.getContextForRole('restricted');
    const page = await context.newPage();
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/sales\/home/, { timeout: config.timeouts.navigation });

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
export type { UserRole };