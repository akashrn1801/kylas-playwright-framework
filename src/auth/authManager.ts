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
  private storageStatePath = path.join(__dirname, 'storageStates', config.env);

  // Prevent parallel login race conditions
  private static loginInProgress: Map<string, Promise<void>> = new Map();

  // WHY: Cache last successful validation time per role — avoids launching
  // a full browser context just to validate session on every single test.
  // If validated within SESSION_CACHE_MS, skip re-validation entirely.
  private static lastValidated: Map<string, number> = new Map();
  private static readonly SESSION_CACHE_MS = 60 * 60 * 1000; // 1 hour

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

      const isVisible = await doItLater.isVisible({
        timeout: 5000,
      });

      if (isVisible) {
        logger.info('Marketplace popup detected — dismissing');

        await doItLater.click();

        await doItLater.waitFor({
          state: 'hidden',
          timeout: 5000,
        });

        logger.info('Marketplace popup dismissed');

        return;
      }
    } catch {
      logger.debug('No marketplace popup found');
    }

    try {
      const dismissButton = page.locator('#cancel[data-dismiss="modal"]');

      const isVisible = await dismissButton.isVisible({
        timeout: 3000,
      });

      if (isVisible) {
        logger.info('Modal popup detected — dismissing');

        await dismissButton.click();

        await dismissButton.waitFor({
          state: 'hidden',
          timeout: 5000,
        });

        logger.info('Modal popup dismissed');
      }
    } catch {
      logger.debug('No modal popup found');
    }
  }

  private async navigateToLoginPage(page: Page): Promise<void> {
    let navigationSuccess = false;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        logger.info(`Navigation attempt ${attempt} to: ${config.appUrl}`);

        await page.goto(config.appUrl, {
          waitUntil: 'commit',
          timeout: 60000,
        });

        logger.info('Application responded successfully');

        await page.waitForLoadState('domcontentloaded', {
          timeout: 30000,
        });

        logger.info('DOM content loaded');

        await page.locator('#input_email').waitFor({
          state: 'visible',
          timeout: 60000,
        });

        logger.info('Login page loaded successfully');

        navigationSuccess = true;
        break;
      } catch (error) {
        lastError = error;

        logger.warn(`Navigation attempt ${attempt} failed: ${String(error)}`);

        logger.warn(`Current URL: ${page.url()}`);

        try {
          const title = await page.title();
          logger.warn(`Current page title: ${title}`);
        } catch {
          logger.warn('Could not retrieve page title');
        }

        if (attempt < 3) {
          logger.info('Retrying navigation in 3 seconds...');
          await page.waitForTimeout(3000);
        }
      }
    }

    if (!navigationSuccess) {
      throw new Error(
        `Failed to load login page after 3 attempts. ` + `Last error: ${String(lastError)}`
      );
    }
  }

  private async isSessionValid(stateFile: string): Promise<boolean> {
    let context: BrowserContext | null = null;

    try {
      context = await this.browser.newContext({
        storageState: stateFile,
      });

      const page = await context.newPage();

      logger.info('Validating existing session');

      await page.goto(config.appUrl, {
        waitUntil: 'commit',
        timeout: 30000,
      });

      try {
        await page.waitForURL(/sales\//, {
          timeout: 10000,
        });
      } catch {
        logger.warn('Did not redirect to sales page');
        return false;
      }

      const currentUrl = page.url();

      logger.info(`Session validation URL: ${currentUrl}`);

      return currentUrl.includes('/sales/');
    } catch (error) {
      logger.warn(`Session validation failed: ${String(error)}`);
      return false;
    } finally {
      if (context) {
        await context.close();
      }
    }
  }

  async loginAndSaveState(role: UserRole): Promise<void> {
    const existing = AuthManager.loginInProgress.get(role);

    if (existing) {
      logger.info(`Login already in progress for role: ${role}. Waiting...`);

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

    logger.info(`Logging in as role: ${role}`);

    const credentials = this.getCredentials(role);

    if (!credentials.email || !credentials.password) {
      throw new Error(
        `Credentials missing for role: ${role}, ENV: ${config.env}. ` +
          `Check ${config.env.toUpperCase()}_${role.toUpperCase()}_EMAIL and PASSWORD in .env`
      );
    }

    const context = await this.browser.newContext({
      viewport: {
        width: 1440,
        height: 900,
      },
    });

    const page = await context.newPage();

    try {
      await this.navigateToLoginPage(page);

      logger.info('Entering user credentials');

      const emailInput = page.locator('#input_email');

      await emailInput.clear();
      await emailInput.fill(credentials.email);

      const passwordInput = page.locator('#input_password');

      await passwordInput.clear();
      await passwordInput.fill(credentials.password);

      logger.info('Waiting for login button');

      await page.locator('#loginBtn:not([disabled])').waitFor({
        state: 'visible',
        timeout: 15000,
      });

      logger.info('Clicking login button');

      await page.locator('#loginBtn').click();

      logger.info('Waiting for successful login redirect');

      // WHY: domcontentloaded sufficient to confirm redirect — faster than load under parallel stress.
      await page.waitForURL(/sales\//, {
        timeout: 90000,
        waitUntil: 'domcontentloaded',
      });

      logger.info(`Login successful for role: ${role}`);

      await this.dismissPopupIfPresent(page);

      const stateFile = this.getStorageStateFile(role);

      await context.storageState({
        path: stateFile,
      });

      logger.info(`Storage state saved: ${stateFile}`);
    } catch (error) {
      logger.error(`Login failed for role ${role}: ${String(error)}`);

      try {
        const screenshotPath = `test-results/login-failure-${role}.png`;

        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
        });

        logger.error(`Failure screenshot captured: ${screenshotPath}`);
      } catch (_error) {
        logger.error('Failed to capture screenshot');
      }

      throw error;
    } finally {
      await context.close();
    }
  }

  async getContextForRole(role: UserRole): Promise<BrowserContext> {
    this.validateAppUrl();

    const stateFile = this.getStorageStateFile(role);

    if (fs.existsSync(stateFile)) {
      // WHY: Check in-memory cache first — if we validated this role within
      // SESSION_CACHE_MS, skip the full browser navigation check entirely.
      // This prevents 35 extra browser launches for a 35-test suite.
      const lastValidatedAt = AuthManager.lastValidated.get(role) ?? 0;
      const cacheAge = Date.now() - lastValidatedAt;

      if (cacheAge < AuthManager.SESSION_CACHE_MS) {
        logger.info(
          `Session cache hit for role: ${role} (age: ${Math.round(cacheAge / 1000)}s) — skipping validation`
        );
      } else {
        logger.info(`Existing storage state found for role: ${role}`);
        const valid = await this.isSessionValid(stateFile);

        if (!valid) {
          logger.warn(`Session expired or invalid for role: ${role}`);
          await this.loginAndSaveState(role);
        } else {
          logger.info(`Session is still valid for role: ${role}`);
        }
        // WHY: Update cache timestamp after successful validation or re-login
        AuthManager.lastValidated.set(role, Date.now());
      }
    } else {
      logger.warn(`No storage state found for role: ${role}. Logging in fresh.`);
      await this.loginAndSaveState(role);
      AuthManager.lastValidated.set(role, Date.now());
    }

    logger.info(`Creating authenticated browser context for role: ${role}`);

    return await this.browser.newContext({
      storageState: stateFile,
      viewport: {
        width: 1440,
        height: 900,
      },
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
