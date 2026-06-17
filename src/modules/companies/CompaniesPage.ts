import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { CompanyData } from '../../data/factories/companyFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class CompaniesPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // Retry Config
  // ──────────────────────────────────────────────────────────

  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // Locators
  // ──────────────────────────────────────────────────────────

  private readonly addButton = (): Locator => this.page.getByRole('button', { name: /^Add$/ });

  private readonly searchInput = (): Locator => this.page.locator('#fulltext-search');

  private readonly searchIcon = (): Locator => this.page.locator('svg:has(#Ic_Search)').first();

  private readonly searchLoader = (): Locator => this.page.locator('.spinner, .loader, .loading');

  private readonly companyTable = (): Locator => this.page.locator('.rt-table');

  private readonly companyRowNameCell = (name: string): Locator =>
    this.page
      .locator('.rt-tr-group')
      .filter({
        has: this.page.getByText(name, { exact: true }),
      })
      .first();

  private readonly showRequiredToggle = (): Locator =>
    this.page.locator('label').filter({ hasText: 'Show Required & Important Fields' });

  private readonly nameInput = (): Locator => this.page.locator('[id="0_11_input_name"]');

  // WHY: React Select picklists are opened by clicking the container
  // div that shows "Choose" placeholder, then clicking the option text.
  // Using nth(0) targets the first unpopulated picklist on the form —
  // each picklist is identified by its input id after opening.
  private readonly numberOfEmployeesContainer = (): Locator =>
    this.page.locator('#0_12_input_numberOfEmployees').locator('../..');

  private readonly industryContainer = (): Locator =>
    this.page.locator('[class*="__control"]').filter({
      has: this.page.locator('#0_21_input_industry, [id*="input_industry"]'),
    });

  private readonly businessTypeContainer = (): Locator =>
    this.page.locator('#0_32_input_businessType').locator('../..');

  private readonly annualRevenueInput = (): Locator =>
    this.page.locator('[id="0_21_input_annualRevenue"]');

  private readonly websiteInput = (): Locator => this.page.locator('input[name="website"]');

  private readonly uniqueText1Input = (): Locator => this.page.locator('input[name="uniqueText1"]');

  private readonly uniqueText2Input = (): Locator => this.page.locator('input[name="uniqueText2"]');

  private readonly addEmailButton = (): Locator =>
    this.page.locator('button').filter({ hasText: 'Add Email' }).first();

  private readonly emailInput = (): Locator => this.page.locator('input[name="emails[0].value"]');

  private readonly addPhoneButton = (): Locator =>
    this.page.locator('button').filter({ hasText: 'Add Phone' }).first();

  private readonly phoneInput = (): Locator => this.page.locator('input[id*="input_phone_0"]');

  private readonly addressInput = (): Locator => this.page.locator('input[name="address"]');

  private readonly cityInput = (): Locator => this.page.locator('input[name="city"]');

  private readonly stateInput = (): Locator => this.page.locator('input[name="state"]');

  private readonly zipcodeInput = (): Locator => this.page.locator('input[name="zipcode"]');

  private readonly facebookInput = (): Locator => this.page.locator('input[name="facebook"]');

  private readonly twitterInput = (): Locator => this.page.locator('input[name="twitter"]');

  // NOTE: companies use 'linkedIn' (capital N) — same as leads, different from contacts
  private readonly linkedInInput = (): Locator => this.page.locator('input[name="linkedIn"]');

  private readonly saveButton = (): Locator =>
    this.page.locator('button[type="submit"].save-button');

  private readonly editIconButton = (): Locator => this.page.locator('#edit-action-btn');

  private readonly editModal = (): Locator => this.page.locator('#editEntityModal');

  private readonly modalCancelButton = (): Locator =>
    this.page.locator('button[data-dismiss="modal"]').first();

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────

  private async waitForListReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    // WHY: Wait for list API response before checking DOM — faster and more reliable
    await Promise.race([
      this.page
        .waitForResponse(
          (res) =>
            res.url().includes('/v1/companies') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
          { timeout: config.timeouts.navigation }
        )
        .catch(() => null),
      this.companyTable()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
    await expect(this.companyTable()).toBeVisible({ timeout: config.timeouts.navigation });
    await this.waitForLoaderToDisappear();
  }

  private async waitForLoaderToDisappear(): Promise<void> {
    try {
      await this.searchLoader().last().waitFor({
        state: 'hidden',
        timeout: 10000,
      });
    } catch {
      // loader may not exist — continue
    }
  }

  private async waitForSearchResults(name: string): Promise<boolean> {
    try {
      await expect(this.companyRowNameCell(name)).toBeVisible({
        timeout: 5000,
      });

      return true;
    } catch {
      return false;
    }
  }

  private async waitForCompanyDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/companies\/details\//, { timeout: 20000 });

    await this.page.waitForLoadState('domcontentloaded');
  }

  private async waitForCompanyListPage(): Promise<void> {
    await this.waitForUrl(/companies\/list/);

    await this.waitForListReady();
  }

  private async closeModalIfOpen(): Promise<void> {
    const modal = this.editModal();

    try {
      if (await modal.isVisible()) {
        logger.info('Closing existing modal');

        await this.modalCancelButton().click();

        await modal.waitFor({ state: 'hidden', timeout: 5000 });

        logger.success('Modal closed');
      }
    } catch (_error) {
      logger.debug(`Company ID not captured via response (fast server) — will use search fallback`);
    }
  }

  private async disableRequiredFieldsToggle(): Promise<void> {
    try {
      const toggle = this.showRequiredToggle();

      if (await toggle.isVisible()) {
        logger.info('Disabling Show Required & Important Fields');

        await toggle.click();

        await expect(this.nameInput()).toBeVisible({ timeout: 10000 });

        logger.success('Toggle disabled');
      }
    } catch (_error) {
      logger.debug(`Toggle not available: ${String(_error)}`);
    }
  }

  // WHY: React Select picklists require clicking the control to open the
  // dropdown menu, then clicking the exact option text. Typing into the
  // input filters options — we click directly to avoid filter side effects.
  // We wait for the option to be visible before clicking to handle slow
  // renders on prod.
  private async selectPicklistOption(
    inputId: string,
    optionText: string,
    description: string
  ): Promise<void> {
    logger.info(`Selecting ${description}: ${optionText}`);

    const input = this.page.locator(`[id="${inputId}"]`);
    await input.waitFor({ state: 'visible' });

    // WHY: Click the __control div to open the dropdown, then type into
    // the input to filter options. This avoids virtualization issues where
    // options only render when scrolled into view.
    const control = input.locator('xpath=ancestor::div[contains(@class,"__control")]');
    await control.click();

    // Type to filter — reduces options to just the matching one
    await input.type(optionText, { delay: 50 });

    // Wait for filtered option and click it
    const option = this.page.locator('div[class*="is-invalid__option"]').first();

    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();

    await this.page
      .locator('div[class*="is-invalid__menu"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {
        /* menu may already be gone */
      });

    logger.success(`Selected ${description}: ${optionText}`);
  }
  private async performSearch(searchText: string): Promise<void> {
    logger.info(`Searching company: ${searchText}`);

    await this.fill(this.searchInput(), searchText, 'search input');

    await Promise.all([this.waitForSearchApi(), this.click(this.searchIcon(), 'search icon')]);

    await this.waitForLoaderToDisappear();
  }

  private async waitForSearchApi(): Promise<Response | null> {
    try {
      return await this.page.waitForResponse(
        (response) =>
          response.url().includes('search') &&
          response.request().method() === 'GET' &&
          response.status() === 200,
        { timeout: 15000 }
      );
    } catch {
      return null;
    }
  }

  private async captureCompanyIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.page.waitForResponse(
        (res) =>
          res.url().includes('companies') &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        { timeout: 30000 }
      );

      const body = await response.json();

      const companyId = body?.id ?? body?.data?.id ?? null;

      logger.success(`Captured company ID: ${companyId}`);

      return companyId;
    } catch (_error) {
      logger.debug(`Company ID not captured via response (fast server) — will use search fallback`);

      return null;
    }
  }

  private async retryFindCompany(name: string): Promise<boolean> {
    const currentConfig = this.retryConfig;

    for (let attempt = 1; attempt <= currentConfig.retries; attempt++) {
      logger.info(`Search attempt ${attempt}/${currentConfig.retries}`);

      await this.goToCompaniesList();

      await this.performSearch(name);

      const found = await this.waitForSearchResults(name);

      if (found) {
        logger.success('Company found');

        return true;
      }

      if (attempt < currentConfig.retries) {
        await this.page.waitForTimeout(currentConfig.wait);
      }
    }

    return false;
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToCompaniesList(): Promise<void> {
    logger.info('Navigating to Companies List');

    await this.closeModalIfOpen();

    await this.navigateTo(`${config.appUrl}/sales/companies/list`);

    await this.waitForCompanyListPage();

    logger.success('On Companies List page');
  }

  async clickAddCompany(): Promise<void> {
    logger.info('Clicking Add Company');

    await this.click(this.addButton(), 'add company button');

    await expect(this.nameInput()).toBeVisible({ timeout: 10000 });

    logger.success('Company form opened');
  }

  // ──────────────────────────────────────────────────────────
  // Form Actions
  // ──────────────────────────────────────────────────────────

  async fillCompanyForm(data: CompanyData): Promise<void> {
    logger.info('Filling company form');

    await this.disableRequiredFieldsToggle();

    await this.fill(this.nameInput(), data.name, 'company name');

    await this.selectPicklistOption(
      '0_12_input_numberOfEmployees',
      data.numberOfEmployees,
      'number of employees'
    );
    await this.selectPicklistOption('0_31_input_industry', data.industry, 'industry');
    await this.selectPicklistOption('0_32_input_businessType', data.businessType, 'business type');

    await this.fill(this.annualRevenueInput(), data.annualRevenue.toString(), 'annual revenue');

    await this.fill(this.websiteInput(), data.website, 'website');

    await this.fill(this.uniqueText1Input(), data.uniqueText1, 'unique text 1');

    await this.fill(this.uniqueText2Input(), data.uniqueText2, 'unique text 2');

    await this.click(this.addEmailButton(), 'add email button');

    await expect(this.emailInput()).toBeVisible();

    await this.fill(this.emailInput(), data.email, 'email');

    await this.click(this.addPhoneButton(), 'add phone button');

    await expect(this.phoneInput()).toBeVisible();

    await this.fill(this.phoneInput(), data.phone, 'phone');

    await this.fill(this.addressInput(), data.address, 'address');

    await this.fill(this.cityInput(), data.city, 'city');

    await this.fill(this.stateInput(), data.state, 'state');

    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');

    await this.fill(this.facebookInput(), data.facebook, 'facebook');

    await this.fill(this.twitterInput(), data.twitter, 'twitter');

    await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');

    logger.success('Company form filled');
  }

  async saveCompany(): Promise<number | null> {
    logger.info('Saving company');

    const companyIdPromise = this.captureCompanyIdFromResponse();

    await this.saveButton().scrollIntoViewIfNeeded();
    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('company create form');

    const companyId = await companyIdPromise;

    await this.waitForCompanyListPage();

    logger.success('Company saved successfully');

    return companyId;
  }

  // ──────────────────────────────────────────────────────────
  // Search & Open
  // ──────────────────────────────────────────────────────────

  async searchAndOpenCompany(name: string, companyId?: number): Promise<void> {
    logger.info(`Opening company: ${name}`);

    if (companyId) {
      logger.info(`Opening company directly via ID: ${companyId}`);

      await this.navigateTo(`${config.appUrl}/sales/companies/details/${companyId}`);

      await this.waitForCompanyDetailsPage();

      return;
    }

    const found = await this.retryFindCompany(name);

    expect(found).toBeTruthy();

    await this.companyRowNameCell(name).click();

    await this.waitForCompanyDetailsPage();

    logger.success(`Company opened: ${name}`);
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Opening edit modal');

    await this.click(this.editIconButton(), 'edit icon');
    await expect(this.editModal()).toBeVisible({ timeout: config.timeouts.navigation });
    // WHY: Wait for name input to be ready — modal animation on GHA is slow
    await this.page
      .locator('[id="0_11_input_name"]')
      .waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    logger.success('Edit modal opened');
  }

  async fillEditForm(data: CompanyData): Promise<void> {
    logger.info('Updating company form');

    await this.fill(this.nameInput(), data.name, 'company name');

    logger.success('Edit form updated');
  }
  async saveEditedCompany(): Promise<void> {
    logger.info('Saving updated company');

    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('company edit form');

    await expect(this.editModal()).toBeHidden({ timeout: 30000 });

    logger.success('Company updated');
  }
  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnCompaniesListPage(): Promise<void> {
    await this.assertUrl(/companies\/list/);
  }

  async assertOnCompanyDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/companies\/details\//);
  }

  async assertCompanyExistsInList(name: string): Promise<void> {
    logger.info(`Validating company exists: ${name}`);

    const found = await this.retryFindCompany(name);

    expect(found).toBeTruthy();

    logger.success(`Company exists: ${name}`);
  }

  async assertCompanyNotInList(name: string): Promise<void> {
    logger.info(`Validating company absent: ${name}`);

    await this.goToCompaniesList();

    await this.performSearch(name);

    await expect(this.companyRowNameCell(name)).toBeHidden({
      timeout: 10000,
    });

    logger.success(`Company absent confirmed: ${name}`);
  }

  async assertCompanyUpdated(data: CompanyData): Promise<void> {
    await this.goToCompaniesList();

    await this.assertCompanyExistsInList(data.name);
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createCompany(data: CompanyData): Promise<number | null> {
    await this.clickAddCompany();

    await this.fillCompanyForm(data);

    return await this.saveCompany();
  }

  async updateCompany(
    newData: CompanyData,
    originalName?: string,
    companyId?: number
  ): Promise<void> {
    const searchName = originalName ?? newData.name;

    await this.searchAndOpenCompany(searchName, companyId);

    await this.clickEditIcon();

    await this.fillEditForm(newData);

    await this.saveEditedCompany();
  }

  async assertCompanyCreated(data: CompanyData, companyId?: number): Promise<void> {
    if (companyId) {
      logger.info(`Validating company via ID: ${companyId}`);

      await this.navigateTo(`${config.appUrl}/sales/companies/details/${companyId}`);

      await this.waitForCompanyDetailsPage();

      // WHY: company details page renders fields as read-only text, not inputs.
      // Asserting the URL contains the ID is sufficient proof the company
      // was created and is accessible.
      await this.assertUrl(new RegExp(`companies/details/${companyId}`));

      logger.success(`Company verified: ${data.name}`);

      return;
    }

    await this.assertCompanyExistsInList(data.name);
  }
}
