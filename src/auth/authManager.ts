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

  // ─── Private Helpers ─────────────────────────────────────

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

  private isStorageStateExpired(stateFile: string): boolean {
    try {
      const stats = fs.statSync(stateFile);
      const ageInHours = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
      // Consider session expired after 12 hours
      if (ageInHours > 12) {
        logger.warn(`Storage state is ${ageInHours.toFixed(1)}h old — treating as expired`);
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private async dismissPopupIfPresent(page: Page): Promise<void> {
    // Try "I'll do it later" button
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
      // No popup
    }

    // Try modal dismiss button
    try {
      const dismissButton = page.locator('#cancel[data-dismiss="modal"]');
      const isVisible = await dismissButton.isVisible({ timeout: 3000 });
      if (isVisible) {
        logger.info('Modal popup detected — dismissing');
        await dismissButton.click();
        await dismissButton.waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Modal dismissed');
      }
    } catch {
      logger.debug('No popup found — continuing');
    }
  }

  // ─── Core Auth Methods ────────────────────────────────────

  async loginAndSaveState(role: UserRole): Promise<void> {
    logger.info(`Logging in as: ${role}`);
    const credentials = this.getCredentials(role);
    const context = await this.browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate to app
      await page.goto(config.appUrl, { waitUntil: 'domcontentloaded' });

      // Wait for page to settle in headless mode
      await page.waitForTimeout(3000);

      // Wait for login form
      await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });

      // Fill login form
      await page.locator('#input_email').fill(credentials.email);
      await page.locator('#input_password').fill(credentials.password);
      await page.locator('#loginBtn').click();

      // Wait for successful login — accept any sales page
      await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });
      logger.success(`Login successful for role: ${role}`);

      // Dismiss any popup
      await this.dismissPopupIfPresent(page);

      // Save storage state
      const stateFile = this.getStorageStateFile(role);
      await context.storageState({ path: stateFile });
      logger.success(`Storage state saved for role: ${role}`);

    } finally {
      await context.close();
    }
  }

  async getContextForRole(role: UserRole): Promise<BrowserContext> {
    const stateFile = this.getStorageStateFile(role);

    // Check if state file exists and is not expired
    if (!fs.existsSync(stateFile) || this.isStorageStateExpired(stateFile)) {
      logger.warn(`No valid session for ${role} — logging in fresh`);
      await this.loginAndSaveState(role);
    } else {
      logger.info(`Using existing session for role: ${role}`);
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