import { config } from '../../config/config';
import { Page, Locator, expect } from '@playwright/test';
import { logger } from '../utils/logger';

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── Navigation ───────────────────────────────────────────

  async navigateTo(url: string): Promise<void> {
    logger.info(`Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async reloadPage(): Promise<void> {
    logger.info('Reloading page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  // ─── Click Actions ────────────────────────────────────────

  async click(locator: Locator, description = 'element', force = false): Promise<void> {
    logger.info(`Clicking: ${description}`);
    await locator.waitFor({ state: 'visible' });
    await locator.click({ timeout: 15000, force });
  }

  async clickByText(text: string): Promise<void> {
    logger.info(`Clicking by text: ${text}`);
    await this.page.getByText(text).click();
  }

  // ─── Input Actions ────────────────────────────────────────

  async fill(locator: Locator, value: string, description = 'field'): Promise<void> {
    logger.info(`Filling ${description} with: ${value}`);
    await locator.waitFor({ state: 'visible' });
    await locator.clear();
    await locator.fill(value);
  }

  async selectOption(locator: Locator, value: string, description = 'dropdown'): Promise<void> {
    logger.info(`Selecting ${value} in ${description}`);
    await locator.waitFor({ state: 'visible' });
    await locator.selectOption(value);
  }

  // ─── Wait Helpers ─────────────────────────────────────────

  async waitForVisible(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'hidden', timeout });
  }

  async waitForUrl(urlPattern: string | RegExp, timeout = config.timeouts.navigation): Promise<void> {
    logger.info(`Waiting for URL: ${urlPattern}`);
    await this.page.waitForURL(urlPattern, { timeout });
  }

  // ─── Assertion Helpers ────────────────────────────────────

  async assertVisible(locator: Locator, description = 'element', timeout = 30000): Promise<void> {
    logger.info(`Asserting visible: ${description}`);
    await expect(locator).toBeVisible({ timeout });
  }

  async assertText(locator: Locator, expectedText: string): Promise<void> {
    logger.info(`Asserting text: ${expectedText}`);
    await expect(locator).toHaveText(expectedText);
  }

  async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    logger.info(`Asserting URL: ${expectedUrl}`);
    await expect(this.page).toHaveURL(expectedUrl);
  }

  // ─── Utility ──────────────────────────────────────────────

  async takeScreenshot(name: string): Promise<void> {
    logger.info(`Taking screenshot: ${name}`);
    await this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  async isVisible(locator: Locator): Promise<boolean> {
    return await locator.isVisible();
  }

  async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.textContent()) || '';
  }
  async assertNoFormErrors(context = 'form'): Promise<void> {
  logger.info(`Checking for validation errors in ${context}`);

  // WHY: Wait briefly for any error messages to appear after save action
  await this.page.waitForTimeout(1500);

  // Field level errors
  const fieldErrors = await this.page
    .locator('input.is-invalid, select.is-invalid, textarea.is-invalid')
    .evaluateAll((els: any[]) =>
      els.map(el => el.name || el.id || 'unknown')
    );

  // Inline validation messages
  const inlineErrors = await this.page
    .locator('.invalid-feedback:visible, .error-message:visible, .alert-danger:visible')
    .allTextContents();

  // Toast/notification errors
  const toastErrors = await this.page
    .locator('.toast, .toast-error, .toast-danger, .notification-error, [class*="toast"][class*="error"], [class*="alert"][class*="error"], .Toastify__toast--error, .swal2-error')
    .allTextContents();

  // Any visible error containers — use specific selectors to avoid false positives
  // WHY: [class*="error"] is too broad — matches React Select is-invalid__ classes
  // which contain currency values (INR). Use only known error container classes.
  const errorContainers = await this.page
    .locator('.error-container:visible, .form-error:visible, .field-error:visible, .alert.alert-danger:visible')
    .allTextContents();

  const allErrors = [
    ...inlineErrors,
    ...toastErrors,
    ...errorContainers,
  ]
    .map(e => e.trim())
    .filter(e => e.length > 0);

  if (allErrors.length > 0 || fieldErrors.length > 0) {
    throw new Error(
      `Validation errors found in ${context}:\n` +
      `Fields with errors: ${fieldErrors.join(', ')}\n` +
      `Error messages: ${allErrors.join(' | ')}`
    );
  }

  logger.success(`No validation errors found in ${context}`);
}

  async getLoggedInUserName(role: 'admin' | 'restricted' = 'restricted'): Promise<string> {
    try {
      const path = require('path');
      const fs = require('fs');
      const namesFile = path.join(__dirname, '../auth/storageStates', process.env.ENV || 'qa', 'userNames.json');
      if (fs.existsSync(namesFile)) {
        const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
        if (names[role]) {
          return names[role];
        }
      }
    } catch (e) {
      // fall through to DOM fallback
    }
    // DOM fallback
    await this.page.locator('.user-profile-dropdown').click();
    const nameLocator = this.page.locator('.user-info .user-name').first();
    await nameLocator.waitFor({ state: 'visible', timeout: 5000 });
    const name = await nameLocator.innerText();
    await this.page.keyboard.press('Escape');
    return name.trim();
  }
}