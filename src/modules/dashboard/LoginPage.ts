import { Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { logger } from '../../utils/logger';
import { config } from '../../../config/config';
import { UserRole } from '../../auth/authManager';

export class LoginPage extends BasePage {
  // ─── Locators ─────────────────────────────────────────────
  private readonly emailInput = () => this.page.locator('#input_email');
  private readonly passwordInput = () => this.page.locator('#input_password');
  private readonly loginButton = () => this.page.locator('#loginBtn');
  private readonly errorMessage = () => this.page.locator('.alert-danger, .error-message, [class*="error"]');

  constructor(page: Page) {
    super(page);
  }

  // ─── Actions ──────────────────────────────────────────────

  async goto(): Promise<void> {
    await this.navigateTo(config.appUrl);
  }

  async enterEmail(email: string): Promise<void> {
    await this.fill(this.emailInput(), email, 'email field');
  }

  async enterPassword(password: string): Promise<void> {
    await this.fill(this.passwordInput(), password, 'password field');
  }

  async clickLogin(): Promise<void> {
    await this.click(this.loginButton(), 'login button');
  }

  async loginAs(role: UserRole): Promise<void> {
    const credentials = config.users[role];
    logger.info(`Logging in as ${role}: ${credentials.email}`);
    await this.goto();
    await this.enterEmail(credentials.email);
    await this.enterPassword(credentials.password);
    await this.clickLogin();
    await this.waitForUrl(/sales\/home/, config.timeouts.navigation);
    logger.success(`Successfully logged in as ${role}`);
  }

  async loginWithCredentials(email: string, password: string): Promise<void> {
    logger.info(`Logging in with email: ${email}`);
    await this.goto();
    await this.enterEmail(email);
    await this.enterPassword(password);
    await this.clickLogin();
  }

  // ─── Assertions ───────────────────────────────────────────

  async assertLoginPageVisible(): Promise<void> {
    await this.assertVisible(this.loginButton(), 'login button');
  }

  async assertErrorMessageVisible(): Promise<void> {
    await this.assertVisible(this.errorMessage(), 'error message');
  }

  async assertErrorMessage(expectedText: string): Promise<void> {
    await this.assertText(this.errorMessage(), expectedText);
  }

  async assertLoggedIn(): Promise<void> {
    await this.waitForUrl(/sales\/home/, 15000);
    logger.success('User is logged in');
  }
}
