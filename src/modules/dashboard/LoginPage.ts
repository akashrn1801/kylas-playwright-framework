import { Page } from '@playwright/test';
import { BasePage, RequestWatch } from '../../core/BasePage';
import { logger } from '../../utils/logger';
import { config } from '../../../config/config';
import { UserRole } from '../../auth/authManager';

export class LoginPage extends BasePage {
  // ─── Locators ─────────────────────────────────────────────
  private readonly emailInput = () => this.page.locator('#input_email');
  private readonly passwordInput = () => this.page.locator('#input_password');
  private readonly loginButton = () => this.page.locator('#loginBtn');
  private readonly errorMessage = () =>
    this.page.locator('.alert-danger, .error-message, [class*="error"]');

  // WHY (sandbox 44464192762, login.spec LG2: waitForURL 15 s on both attempts): nothing recorded the login request, so
  // "login held", "login rejected" and "app stuck after the login" looked the same. The watcher is armed by the click
  // and read only when assertLoggedIn() is about to fail. Error text only; no wait or retry changed.
  private loginWatch: RequestWatch | null = null;

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
    this.loginWatch?.stop();
    this.loginWatch = this.watchRequests((r) => r.method() === 'PUT' && /\/v1\/users\/login\/?$/.test(new URL(r.url()).pathname));
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
    try {
      await this.waitForUrl(/sales\/home/, 15000);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      err.message = `${err.message}\n${await this.describeLoginFailure()}`;
      throw err;
    } finally {
      this.loginWatch?.stop();
      this.loginWatch = null;
    }
    logger.success('User is logged in');
  }

  private finalUrlWithoutQuery(): string {
    try {
      const url = new URL(this.page.url());
      return `${url.origin}${url.pathname}`;
    } catch {
      return this.page.url();
    }
  }

  // Which of the login outcomes happened: request never sent, sent with no answer, rejected, or accepted but the app did not
  // reach /sales/home. Paths, status and visible page text only (no credentials, no body).
  private async describeLoginFailure(): Promise<string> {
    const watch = this.loginWatch;
    const request = !watch
      ? 'login request not tracked (clickLogin() was not used)'
      : watch.sentCount() === 0
        ? 'the login request was NEVER SENT (the Sign In click or submit was lost)'
        : watch.unansweredCount() > 0
          ? `the login request was SENT but got NO ANSWER (backend did not answer): ${watch.describe()}`
          : `the login request was answered: ${watch.describe()}`;
    const visibleError = await this.errorMessage()
      .first()
      .innerText({ timeout: 1000 })
      .then((text) => text.trim().slice(0, 200))
      .catch(() => '');
    return `[login] ${request}; final URL: ${this.finalUrlWithoutQuery()}; visible error text: ${visibleError || '(none)'}`;
  }
}
