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
  private storageStatePath = path.join(__dirname, 'storageStates');

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

  private async dismissPopupIfPresent(page: Page): Promise<void> {
    try {
      const doItLater = page.getByText("I'll do it later");
      const isVisible = await doItLater.isVisible({ timeout: 5000 });
      if (isVisible) {
        logger.info('Marketplace popup detected — dismissing');
        await doItLater.click();
        await doItLater.waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Popup dismissed');
        return;
      }
    } catch {
      logger.debug('No marketplace popup — continuing');
    }
    try {
      const dismissButton = page.locator('#cancel[data-dismiss="modal"]');
      const isVisible = await dismissButton.isVisible({ timeout: 3000 });
      if (isVisible) {
        logger.info('Modal popup detected — dismissing');
        await dismissButton.click();
        await dismissButton.waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Popup dismissed');
      }
    } catch {
      logger.debug('No popup found — continuing');
    }
  }

  private async isSessionValid(stateFile: string): Promise<boolean> {
    let context: BrowserContext | null = null;
    try {
      context = await this.browser.newContext({ storageState: stateFile });
      const page = await context.newPage();

      // Navigate and wait for final URL to settle
      await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });

      // Wait a bit for any redirects to complete
      await page.waitForTimeout(3000);

      const currentUrl = page.url();
      logger.info(`Session check URL: ${currentUrl}`);

      return currentUrl.includes('sales/home');
    } catch (error) {
      logger.warn(`Session validation error: ${error}`);
      return false;
    } finally {
      if (context) await context.close();
    }
  }

  async loginAndSaveState(role: UserRole): Promise<void> {
    logger.info(`Logging in as: ${role}`);
    const credentials = this.getCredentials(role);
    const context = await this.browser.newContext();
    const page = await context.newPage();

  await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// Wait for email input
await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });

// Type credentials to trigger React onChange events
await page.locator('#input_email').click();
await page.locator('#input_email').pressSequentially(credentials.email, { delay: 50 });
await page.waitForTimeout(300);

await page.locator('#input_password').click();
await page.locator('#input_password').pressSequentially(credentials.password, { delay: 50 });
await page.waitForTimeout(500);

// Wait for button to become enabled then click
await page.locator('#loginBtn:not([disabled])').waitFor({ state: 'visible', timeout: 10000 });
await page.locator('#loginBtn').click();

// Wait for successful login
await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });
    logger.success(`Login successful for role: ${role}`);

    // Dismiss marketplace popup if it appears
    await this.dismissPopupIfPresent(page);

    // Save storage state after popup is handled
    const stateFile = this.getStorageStateFile(role);
    await context.storageState({ path: stateFile });
    logger.success(`Storage state saved for role: ${role}`);

    await context.close();
  }

  async getContextForRole(role: UserRole): Promise<BrowserContext> {
    const stateFile = this.getStorageStateFile(role);

    if (fs.existsSync(stateFile)) {
      logger.info(`Validating existing session for role: ${role}`);
      const valid = await this.isSessionValid(stateFile);

      if (!valid) {
        logger.warn(`Session expired for ${role}, logging in fresh`);
        await this.loginAndSaveState(role);
      } else {
        logger.success(`Session still valid for role: ${role}`);
      }
    } else {
      logger.warn(`No storage state found for ${role}. Logging in fresh.`);
      await this.loginAndSaveState(role);
    }

    logger.info(`Creating context for role: ${role}`);
    return await this.browser.newContext({
      storageState: this.getStorageStateFile(role),
    });
  }

  async clearStorageState(role: UserRole): Promise<void> {
    const stateFile = this.getStorageStateFile(role);
    if (fs.existsSync(stateFile)) {
      fs.unlinkSync(stateFile);
      logger.info(`Storage state cleared for role: ${role}`);
    }
  }

  async clearAllStorageStates(): Promise<void> {
    const files = fs.readdirSync(this.storageStatePath);
    files.forEach((file) => {
      fs.unlinkSync(path.join(this.storageStatePath, file));
    });
    logger.info('All storage states cleared');
  }
}