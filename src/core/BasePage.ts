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

  async click(locator: Locator, description = 'element'): Promise<void> {
    logger.info(`Clicking: ${description}`);
    await locator.waitFor({ state: 'visible' });
    await locator.click();
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

  async waitForUrl(urlPattern: string | RegExp, timeout = 30000): Promise<void> {
    logger.info(`Waiting for URL: ${urlPattern}`);
    await this.page.waitForURL(urlPattern, { timeout });
  }

  // ─── Assertion Helpers ────────────────────────────────────

  async assertVisible(locator: Locator, description = 'element'): Promise<void> {
    logger.info(`Asserting visible: ${description}`);
    await expect(locator).toBeVisible();
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
}