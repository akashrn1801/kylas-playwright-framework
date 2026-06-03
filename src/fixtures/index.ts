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
    // WHY: CI app may redirect through multiple URLs — use networkidle + loose URL check
    await page.waitForLoadState('networkidle', { timeout: process.env.CI ? 120000 : config.timeouts.navigation });
    const currentUrl = page.url();
    if (!currentUrl.includes('/sales/') && !currentUrl.includes(config.appUrl)) {
      throw new Error(`Fixture: unexpected URL after navigation: ${currentUrl}`);
    }
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
    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
    // WHY: CI app may redirect through multiple URLs — use networkidle + loose URL check
    await page.waitForLoadState('networkidle', { timeout: process.env.CI ? 120000 : config.timeouts.navigation });
    const currentUrl = page.url();
    if (!currentUrl.includes('/sales/') && !currentUrl.includes(config.appUrl)) {
      throw new Error(`Fixture: unexpected URL after navigation: ${currentUrl}`);
    }
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
