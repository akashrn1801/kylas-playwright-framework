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
      const dismissButton = page.locator('#cancel[data-dismiss="modal"]');
      const isVisible = await dismissButton.isVisible({ timeout: 5000 });
      if (isVisible) {
        logger.info('Marketplace popup detected — dismissing');
        await dismissButton.click();
        await dismissButton.waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Popup dismissed');
      }
    } catch {
      // Popup did not appear — this is fine
      logger.debug('No popup found — continuing');
    }
  }

  async loginAndSaveState(role: UserRole): Promise<void> {
    logger.info(`Logging in as: ${role}`);
    const credentials = this.getCredentials(role);
    const context = await this.browser.newContext();
    const page = await context.newPage();

    await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });

    // Wait for login form to be ready
    await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });

    // Fill login form
    await page.locator('#input_email').fill(credentials.email);
    await page.locator('#input_password').fill(credentials.password);
    await page.locator('#loginBtn').click();

    // Wait for successful login
    await page.waitForURL(/sales\/home/, { timeout: config.timeouts.navigation });
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

    if (!fs.existsSync(stateFile)) {
      logger.warn(`No storage state found for ${role}. Logging in fresh.`);
      await this.loginAndSaveState(role);
    }

    logger.info(`Creating context for role: ${role}`);
    return await this.browser.newContext({
      storageState: stateFile,
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