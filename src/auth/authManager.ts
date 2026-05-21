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

  // Per-role mutex: prevents two workers writing same file simultaneously
  private static loginInProgress: Map<string, Promise<void>> = new Map();

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

  // Validate appUrl is not empty — fail fast with clear message
  private validateAppUrl(): void {
    if (!config.appUrl || config.appUrl.trim() === '') {
      throw new Error(
        `config.appUrl is empty. ENV=${config.env}. ` +
        `Check that ${config.env.toUpperCase()}_APP_URL is set in .env or Jenkins environment.`
      );
    }
  }

  private async dismissPopupIfPresent(page: Page): Promise<void> {
    try {
      const doItLater = page.getByText("I'll do it later");
      const isVisible = await doItLater.isVisible({ timeout: 5000 });
      if (isVisible) {
        logger.info('Marketplace popup detected — dismissing');
        await doItLater.click();
        await doItLater.waitFor({ state: 'hidden', timeout: 5000 });
        logger.info('Popup dismissed');
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
        logger.info('Popup dismissed');
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

      // Use a SHORT timeout — we just want to know if session is valid
      // not wait forever. If it times out, session is invalid.
      await page.goto(config.appUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,  // 15s max — not 60s
      });

      // Wait for redirect to settle — max 5s
      try {
        await page.waitForURL(/sales\//, { timeout: 5000 });
      } catch {
        // didn't land on sales/ — session invalid
        return false;
      }

      const currentUrl = page.url();
      logger.info(`Session check URL: ${currentUrl}`);

      // Valid if landed anywhere under /sales/ — not just /sales/home
      return currentUrl.includes('/sales/');
    } catch (error) {
      logger.warn(`Session validation error: ${error}`);
      return false;
    } finally {
      if (context) await context.close();
    }
  }

  async loginAndSaveState(role: UserRole): Promise<void> {
    // If another worker is already logging in for this role, wait for it
    // instead of running a parallel login that causes a file write race
    const existing = AuthManager.loginInProgress.get(role);
    if (existing) {
      logger.info(`Login already in progress for ${role}, waiting...`);
      await existing;
      return;
    }

    const loginPromise = this._doLogin(role);
    AuthManager.loginInProgress.set(role, loginPromise);
    try {
      await loginPromise;
    } finally {
      AuthManager.loginInProgress.delete(role);
    }
  }

  private async _doLogin(role: UserRole): Promise<void> {
    this.validateAppUrl();
    logger.info(`Logging in as: ${role}`);
    const credentials = this.getCredentials(role);

    if (!credentials.email || !credentials.password) {
      throw new Error(
        `Credentials missing for role: ${role}, ENV: ${config.env}. ` +
        `Check ${config.env.toUpperCase()}_${role.toUpperCase()}_EMAIL and PASSWORD in .env`
      );
    }

    const context = await this.browser.newContext();
    const page = await context.newPage();

    try {
      // Navigate with explicit timeout
      await page.goto(config.appUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for React to hydrate — wait for actual element, not blind sleep
      await page.locator('#input_email').waitFor({
        state: 'visible',
        timeout: 30000,
      });

      // Clear then fill — more reliable than pressSequentially in CI
      await page.locator('#input_email').clear();
      await page.locator('#input_email').fill(credentials.email);

      await page.locator('#input_password').clear();
      await page.locator('#input_password').fill(credentials.password);

      // Wait for button enabled state
      await page.locator('#loginBtn:not([disabled])').waitFor({
        state: 'visible',
        timeout: 10000,
      });
      await page.locator('#loginBtn').click();

      // Wait for successful navigation to sales area
      await page.waitForURL(/sales\//, {
        timeout: config.timeouts.navigation,
      });

      logger.info(`Login successful for role: ${role}`);

      // Dismiss any post-login popups
      await this.dismissPopupIfPresent(page);

      // Save storage state
      const stateFile = this.getStorageStateFile(role);
      await context.storageState({ path: stateFile });
      logger.info(`Storage state saved for role: ${role}`);
    } finally {
      await context.close();
    }
  }

  async getContextForRole(role: UserRole): Promise<BrowserContext> {
    this.validateAppUrl();
    const stateFile = this.getStorageStateFile(role);

    if (fs.existsSync(stateFile)) {
      logger.info(`Validating existing session for role: ${role}`);
      const valid = await this.isSessionValid(stateFile);

      if (!valid) {
        logger.warn(`Session expired for ${role}, logging in fresh`);
        await this.loginAndSaveState(role);
      } else {
        logger.info(`Session still valid for role: ${role}`);
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