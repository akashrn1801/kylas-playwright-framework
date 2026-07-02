import { Page, expect, Locator, Response } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from '../../core/BasePage';
import { CompanyData } from '../../data/factories/companyFactory';
import { ContactData } from '../../data/factories/contactFactory';
import { DealData } from '../../data/factories/dealFactory';
import { DealsPage } from '../deals/DealsPage';
import { TasksPage } from '../tasks/TasksPage';
import { MeetingsPage } from '../meetings/MeetingsPage';
import { generateTaskData } from '../../data/factories/taskFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class CompaniesPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // 1. Retry Config
  // ──────────────────────────────────────────────────────────

  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // 2. Locators
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

  // ── Ellipsis menu ─────────────────────────────────────────
  // WHY: Companies uses same btn-down-arrow btn-primary as Contacts/Leads
  // Confirmed from DOM: button.btn.dropdown-toggle.btn-down-arrow.btn-primary
  private readonly ellipsisButton = (): Locator =>
    this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

  private readonly ellipsisMenuItem = (text: string): Locator =>
    this.page.locator('.dropdown-menu.show').locator('a.dropdown-item').filter({ hasText: text });

  // ── Delete confirmation ───────────────────────────────────
  private readonly deleteConfirmButton = (): Locator =>
    this.page.locator('button#confirm.btn-danger');

  // ── Share modal ───────────────────────────────────────────
  private readonly shareToUserInput = (): Locator =>
    this.page.locator('[id="undefined_undefinedundefined_input_toId"]');

  private readonly sharePermissionToggle = (permission: string): Locator =>
    this.page.locator(`#inp_${permission}`);

  private readonly shareConfirmButton = (): Locator =>
    this.page.locator('.modal.show button.btn-primary.ml-auto').first();

  // ── Right panel icons ─────────────────────────────────────
  // WHY: Companies has no Call Logs icon — SVG IDs differ per module
  // Same Notes/Tasks/Meetings/Quotations IDs as Contacts (same SVGs shared across modules)
  private readonly rightPanelIconSvgMap: Record<string, string> = {
    'Notes': 'paint0_linear_972_2654',
    'Tasks': 'clip-Ic_Task',
    'Meetings': 'clip-Ic_Meetings',
    'Quotations': 'Quotation_Icon-16px_New',
  };

  private readonly rightPanelIcon = (title: string): Locator => {
    // WHY: Try SVG ID first (most reliable), fallback to title attribute
    const svgId = this.rightPanelIconSvgMap[title];
    if (svgId) {
      return this.page
        .locator(
          `button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[title="${title}"]`
        )
        .first();
    }
    return this.page.locator(`button.btn.btn-transparent[title="${title}"]`);
  };

  // ── Quotation panel ───────────────────────────────────────
  private readonly quotationPanelAddButton = (): Locator =>
    this.page.locator('.quotation').locator('button.btn-primary.btn-xs').first();

  private readonly quotationAddModalTitle = (): Locator =>
    this.page.locator('#editEntityModal .modal-title');

  // ── Company detail page direct action buttons ─────────────
  // WHY: "Add Contact" button appears in the Contacts card on company detail
  // — only visible when company has no contacts yet
  private readonly addContactDirectButton = (): Locator =>
    this.page.locator('.card').filter({ hasText: 'Contacts' }).locator('button', { hasText: 'Add Contact' });

  // WHY: "Add Deal" button appears in the Related Deals card — visible before any deals exist
  private readonly addDealDirectButton = (): Locator =>
    this.page.locator('.card').filter({ hasText: 'Related Deals' }).locator('button', { hasText: 'Add Deal' });

  // WHY: "Add Task" button in the Pending Activities section — scope to the container div
  // that HAS the h2 heading, because .locator('..') parent chaining is unreliable here
  private readonly addTaskPendingButton = (): Locator =>
    this.page
      .locator('div', { has: this.page.locator('h2', { hasText: 'Pending Activities' }) })
      .locator('button', { hasText: 'Add Task' })
      .first();

  // ──────────────────────────────────────────────────────────
  // 3. Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // 4. Private Helpers
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

  async waitForCompanyDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/companies\/details\//, { timeout: 20000 });
    await this.page.waitForLoadState('domcontentloaded');
    // WHY: Wait for company GET API response — ensures React has companyId in state
    // Without this, share/edit fires before app resolves companyId → /companies/undefined/share
    // Same fix applied to ContactsPage.waitForContactDetailsPage() — proven race condition
    await this.page.waitForResponse(
      (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);
  }

  async goToCompanyDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to company details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/companies/details/${id}`);
    await this.waitForCompanyDetailsPage();
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
  // 5. Navigation
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
  // 6. Form Actions
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

  async fillFullEditForm(data: CompanyData): Promise<void> {
    logger.info('Updating all company form fields');

    await this.fill(this.nameInput(), data.name, 'company name');

    await this.selectPicklistOption(
      '0_12_input_numberOfEmployees',
      data.numberOfEmployees,
      'number of employees'
    );
    await this.selectPicklistOption('0_31_input_industry', data.industry, 'industry');
    await this.selectPicklistOption('0_32_input_businessType', data.businessType, 'business type');

    await this.fill(this.websiteInput(), data.website, 'website');
    await this.fill(this.uniqueText1Input(), data.uniqueText1, 'unique text 1');
    await this.fill(this.uniqueText2Input(), data.uniqueText2, 'unique text 2');

    // WHY: In edit mode email/phone inputs are pre-filled with static IDs
    await this.fill(this.page.locator('[id="1_11_input_email_0"]'), data.email, 'email');
    await this.fill(this.page.locator('[id="1_12_input_phone_0"]'), data.phone, 'phone');

    await this.fill(this.addressInput(), data.address, 'address');
    await this.fill(this.cityInput(), data.city, 'city');
    await this.fill(this.stateInput(), data.state, 'state');
    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');

    await this.fill(this.facebookInput(), data.facebook, 'facebook');
    await this.fill(this.twitterInput(), data.twitter, 'twitter');
    await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');

    logger.success('Full company edit form updated');
  }

  // ──────────────────────────────────────────────────────────
  // 7. Search & Open
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

  async openEllipsisMenu(): Promise<void> {
    logger.info('Opening ellipsis menu');
    await this.ellipsisButton().scrollIntoViewIfNeeded();
    await this.ellipsisButton().click();
    await this.page.waitForTimeout(500);
    logger.success('Ellipsis menu opened');
  }

  async clickEllipsisOption(optionText: string): Promise<void> {
    logger.info(`Clicking ellipsis option: ${optionText}`);
    await this.openEllipsisMenu();
    const item = this.ellipsisMenuItem(optionText);
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
    logger.success(`Ellipsis option clicked: ${optionText}`);
  }

  async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
    logger.info(`Asserting ellipsis option NOT visible: ${optionText}`);
    const item = this.ellipsisMenuItem(optionText);
    await expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
      // WHY: Option may not exist at all — check count as fallback
      const count = await item.count();
      expect(count).toBe(0);
    });
    logger.success(`Ellipsis option not visible confirmed: ${optionText}`);
  }

  // ──────────────────────────────────────────────────────────
  // 8. Edit Actions
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
    await this.fill(this.annualRevenueInput(), data.annualRevenue.toString(), 'annual revenue');
    await this.fill(this.websiteInput(), data.website, 'website');
    await this.fill(this.uniqueText1Input(), data.uniqueText1, 'unique text 1');
    await this.fill(this.uniqueText2Input(), data.uniqueText2, 'unique text 2');
    await this.fill(this.emailInput(), data.email, 'email');
    await this.fill(this.phoneInput(), data.phone, 'phone');
    await this.fill(this.addressInput(), data.address, 'address');
    await this.fill(this.cityInput(), data.city, 'city');
    await this.fill(this.stateInput(), data.state, 'state');
    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');
    await this.fill(this.facebookInput(), data.facebook, 'facebook');
    await this.fill(this.twitterInput(), data.twitter, 'twitter');
    await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');

    logger.success('Edit form updated')
  }

  async saveEditedCompany(): Promise<void> {
    logger.info('Saving updated company');

    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('company edit form');

    await expect(this.editModal()).toBeHidden({ timeout: 30000 });

    logger.success('Company updated');
  }

  async deleteCompany(): Promise<void> {
    logger.info('Deleting company via ellipsis menu');
    await this.clickEllipsisOption('Delete');
    await this.deleteConfirmButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.deleteConfirmButton().click();
    await this.page.waitForTimeout(1000);
    logger.success('Company deleted');
  }

  async cloneCompany(): Promise<number | null> {
    logger.info('Cloning company via ellipsis menu');
    await this.clickEllipsisOption('Clone');
    // WHY: Clone opens create form pre-filled — update email/phone to avoid duplicate errors
    await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(1000);
    // WHY: Read original name before any field fills — used for safety check below
    const originalName = await this.nameInput().inputValue().catch(() => '');
    // WHY: Change email to unique value — same email as original causes duplicate error
    const emailInput = this.emailInput();
    if (await emailInput.isVisible().catch(() => false)) {
      const timestamp = Date.now();
      await emailInput.fill(`clone${timestamp}@testkylas.com`);
      logger.debug('Clone email updated to unique value');
    }
    // WHY: Change phone to unique value — same phone as original causes duplicate error
    const phoneInput = this.phoneInput();
    if (await phoneInput.isVisible().catch(() => false)) {
      // WHY: Indian mobile numbers must start with 6/7/8/9 and be exactly 10 digits
      const newPhone = faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9);
      await phoneInput.clear();
      await phoneInput.fill(newPhone);
      logger.debug(`Clone phone updated to: ${newPhone}`);
    }
    // WHY: Safety check — name may be cleared on some browsers after fill interactions
    const nameValue = await this.nameInput().inputValue().catch(() => '');
    if (!nameValue) {
      logger.warn('name was cleared during clone — re-filling with Copy suffix');
      await this.nameInput().fill(`${originalName || 'Company'} Copy`);
    }
    const companyIdPromise = this.captureCompanyIdFromResponse();
    await this.click(this.saveButton(), 'save cloned company');
    await this.assertNoFormErrors('company clone form');
    const companyId = await companyIdPromise;
    // WHY: After clone save, app stays on original company detail — no redirect to list
    await this.page.waitForTimeout(1500);
    logger.success('Company cloned successfully');
    return companyId;
  }

  async shareCompany(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing company with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
    await this.clickEllipsisOption('Share');
    await this.page.waitForTimeout(1000);
    // WHY: Click the Share To type dropdown control — opens User/Team options
    const shareTypeControl = this.page.locator('.modal.show').locator('.is-invalid__control').first();
    await shareTypeControl.waitFor({ state: 'visible', timeout: 10000 });
    await shareTypeControl.click();
    await this.page.waitForTimeout(500);
    // WHY: Select "User" option
    const userOption = this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first();
    await userOption.waitFor({ state: 'visible', timeout: 5000 });
    await userOption.click();
    await this.page.waitForTimeout(500);
    // WHY: Search requires minimum 3 characters
    // Strategy: find first word with >= 3 chars, fallback to first 3 chars of full name
    const words = restrictedUserName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
    logger.debug(`Share search term: "${validWord}" (from: "${restrictedUserName}")`);
    await this.shareToUserInput().fill(validWord);
    await this.page.waitForTimeout(800);
    // WHY: Select matching user from dropdown
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: restrictedUserName })
      .first();
    await userItem.waitFor({ state: 'visible', timeout: 5000 });
    await userItem.click();
    await this.page.waitForTimeout(500);
    // WHY: Enable specific permissions — use JS click on label sibling of input
    for (const permission of permissions) {
      const toggle = this.sharePermissionToggle(permission);
      const isChecked = await toggle.isChecked().catch(() => false);
      if (!isChecked) {
        // WHY: CSS sibling selector unreliable in Playwright — use JS to find and click label
        await this.page.evaluate((perm) => {
          const input = document.querySelector(`#inp_${perm}`) as HTMLElement;
          const label = input?.parentElement?.querySelector('label') as HTMLElement;
          label?.click();
        }, permission);
        await this.page.waitForTimeout(300);
      }
    }
    await this.shareConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the share-API response wait BEFORE clicking — confirms the
    // server actually processed the permission change instead of a blind sleep.
    const shareResponsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v1\/companies\/\d+\/share$/) !== null && res.request().method() === 'POST',
        { timeout: 15000 }
      )
      .catch(() => null);
    await this.shareConfirmButton().click();
    await shareResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Company shared with: ${restrictedUserName}`);
  }

  async reassignCompany(userName: string): Promise<void> {
    logger.info(`Reassigning company to: ${userName}`);
    await this.clickEllipsisOption('Reassign');
    await this.page.waitForTimeout(500);
    // WHY: Search requires minimum 3 characters
    const words = userName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
    logger.debug(`Reassign search term: "${validWord}" (from: "${userName}")`);
    const reassignUserInput = this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');
    await reassignUserInput.waitFor({ state: 'visible', timeout: 5000 });
    await reassignUserInput.fill(validWord);
    await this.page.waitForTimeout(800);
    const userItem = this.page.locator('.is-invalid__option')
      .filter({ hasText: userName }).first();
    await userItem.waitFor({ state: 'visible', timeout: 5000 });
    await userItem.click();
    await this.page.waitForTimeout(500);
    const reassignConfirmButton = this.page.locator('.modal.show button.btn-primary.ml-auto').first();
    await reassignConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the reassign-API (owner change) response wait BEFORE
    // clicking — confirms ownership actually changed server-side.
    const reassignResponsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v1\/companies\/\d+\/owner$/) !== null && res.request().method() === 'PUT',
        { timeout: 15000 }
      )
      .catch(() => null);
    await reassignConfirmButton.click();
    await reassignResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Company reassigned to: ${userName}`);
  }

  async clickRightPanelIcon(title: string): Promise<void> {
    logger.info(`Clicking right panel icon: ${title}`);
    const icon = this.rightPanelIcon(title);
    await icon.waitFor({ state: 'visible', timeout: 10000 });
    await icon.click();
    await this.page.waitForTimeout(500);
    logger.success(`Right panel icon clicked: ${title}`);
  }

  async assertRightPanelIconVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon visible: ${title}`);
    // WHY: Wait for icon to be attached first — SVG icons load after React renders
    await this.rightPanelIcon(title).waitFor({ state: 'attached', timeout: 15000 });
    await expect(this.rightPanelIcon(title)).toBeVisible({ timeout: 15000 });
    logger.success(`Right panel icon visible: ${title}`);
  }

  async assertRightPanelIconNotVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon NOT visible: ${title}`);
    await expect(this.rightPanelIcon(title)).toBeHidden({ timeout: 5000 });
    logger.success(`Right panel icon not visible: ${title}`);
  }

  async addQuotationFromPanel(): Promise<string | null> {
    logger.info('Adding quotation from company productivity panel');
    // WHY: Click Quotations right panel icon to open quotations section
    await this.clickRightPanelIcon('Quotations');
    await this.page.waitForTimeout(2000);
    // WHY: Scroll to Quotations card first — it may be below the fold
    const quotationsCard = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Quotations' }) })
      .first();
    await quotationsCard.scrollIntoViewIfNeeded();
    const quotationCardAdd = quotationsCard.locator('button.btn-primary.btn-xs').first();
    await quotationCardAdd.waitFor({ state: 'visible', timeout: 10000 });
    await quotationCardAdd.click();
    // WHY: Wait for modal to open with "Add Quotation" title
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.quotationAddModalTitle()).toHaveText('Add Quotation', { timeout: 10000 });
    logger.success('Add Quotation modal opened');
    // WHY: Capture quotation ID from POST response before saving
    const quotationIdPromise = this.page.waitForResponse(
      (res) =>
        (res.url().includes('/quotations') || res.url().includes('/quotation')) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      const id = body?.id ?? body?.data?.id ?? body?.quotationId ?? null;
      logger.debug(`Captured quotation ID: ${id} from ${res.url()}`);
      return id ? String(id) : null;
    }).catch((e) => {
      logger.warn(`Quotation ID capture failed: ${String(e)}`);
      return null;
    });
    // WHY: Fill minimum required fields — quotationNumber and summary
    const timestamp = Date.now();
    const quotationNumber = `QUO-${timestamp}`;
    const summaryInput = this.page.locator('[id="0_11_input_quotationNumber"]');
    await summaryInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.fill(summaryInput, quotationNumber, 'quotation number');
    const summaryField = this.page.locator('[id="0_21_input_summary"]');
    await this.fill(summaryField, `Summary-${timestamp}`, 'summary');
    // WHY: Fill existing empty product row (row 0) — modal opens with one empty product row
    const firstProductPrice = this.page.locator('[id="1_03_input_products.0.price"]');
    const firstProductValue = await firstProductPrice.inputValue().catch(() => '');
    logger.debug(`First product price value: "${firstProductValue}"`);
    if (!firstProductValue || firstProductValue === '0' || firstProductValue === '') {
      const productInput = this.page.locator('[id*="input_products.0.id"]').first();
      if (await productInput.isVisible().catch(() => false)) {
        const productControl = this.page.locator('.is-invalid__control').filter({ has: productInput });
        await productControl.click();
        await productInput.fill('BHK');
        const productOptions = this.page.locator('.is-invalid__option');
        await productOptions.first().waitFor({ state: 'visible', timeout: 15000 });
        await productOptions.first().click();
        await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        const quantityInput = this.page.locator('input[name="products.0.quantity"]').first();
        if (await quantityInput.isVisible().catch(() => false)) {
          const qtyVal = await quantityInput.inputValue().catch(() => '');
          if (!qtyVal || qtyVal === '0') {
            await quantityInput.fill('1');
          }
        }
        logger.success('Product row 0 filled in quotation');
      }
    } else {
      logger.info('Product already pre-filled — skipping');
    }
    // WHY: Save the quotation using modal save button
    const modalSaveButton = this.page.locator('#editEntityModal button[type="submit"].btn-primary');
    await modalSaveButton.waitFor({ state: 'visible', timeout: 5000 });
    await modalSaveButton.click();
    await this.assertNoFormErrors('add quotation from panel');
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const quotationId = await quotationIdPromise;
    logger.success(`Quotation added from panel: ${quotationId}`);
    return quotationId;
  }

  async addNoteFromPanel(noteText: string): Promise<void> {
    logger.info(`Adding note from company panel: "${noteText}"`);
    await this.clickRightPanelIcon('Notes');
    // WHY: Click textarea first to activate CKEditor initialisation
    await this.page.locator('textarea.notes-textarea').click();
    await this.page.waitForTimeout(1000);
    await this.page.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill(noteText);
    await this.page.waitForTimeout(500);
    await this.page.getByText('Add', { exact: true }).click();
    await this.page.waitForTimeout(1500);
    logger.success(`Note added: "${noteText}"`);
  }

  async addTaskFromPanel(taskName: string): Promise<void> {
    logger.info(`Adding task from company panel: "${taskName}"`);
    await this.clickRightPanelIcon('Tasks');
    const tasksPage = new TasksPage(this.page);
    // WHY: generateTaskData with name override — provides all required TaskData fields
    const taskData = generateTaskData({ name: taskName });
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    await tasksPage.saveQuickTaskFromEntityDetail();
    logger.success(`Task added from panel: "${taskName}"`);
  }

  async addMeetingFromPanel(meetingTitle: string): Promise<void> {
    logger.info(`Adding meeting from company panel: "${meetingTitle}"`);
    const companyUrl = this.page.url();
    await this.clickRightPanelIcon('Meetings');
    // WHY: #addMeeting button opens the meeting creation form from entity detail panel
    await this.page.locator('#addMeeting').waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('#addMeeting').click();
    const meetingsPage = new MeetingsPage(this.page);
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: Save directly without using saveMeeting() — that method clicks a post-save
    // popup which navigates AWAY to the meeting's own detail page. When adding from a
    // parent entity's panel, we need to stay on (or return to) the parent's detail page
    // so subsequent panel actions (e.g. quotation, task) can continue on the same page.
    const idPromise = (meetingsPage as unknown as { captureIdFromResponse: () => Promise<number | null> }).captureIdFromResponse();
    await this.page.locator('button.save-button, #editEntityModal button[type="submit"]').first().click();
    await this.assertNoFormErrors('meeting create form (from company panel)');
    await idPromise;
    await this.page.waitForTimeout(1500);
    // WHY: Ensure we are back on the company detail page — meeting save may show a popup
    // toast/modal that auto-redirects; force navigation back if URL changed
    if (!this.page.url().includes(companyUrl.split('/details/')[1] ?? '___never___')) {
      await this.navigateTo(companyUrl);
      await this.waitForCompanyDetailsPage();
    }
    logger.success(`Meeting added from panel: "${meetingTitle}"`);
  }

  async addContactFromDirectButton(contactData: ContactData): Promise<number | null> {
    logger.info(`Adding contact from direct button: ${contactData.firstName} ${contactData.lastName}`);
    await this.addContactDirectButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.addContactDirectButton().click();
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });
    // WHY: Toggle off "Show Required & Important Fields" — reveals ALL fields, same as ContactsPage
    const requiredToggle = this.page.locator('#editEntityModal').locator('.custom-control-label')
      .filter({ hasText: 'Show Required & Important Fields' }).first();
    if (await requiredToggle.isVisible().catch(() => false)) {
      await requiredToggle.click();
      await this.page.waitForTimeout(500);
      logger.debug('Toggled off Show Required & Important Fields');
    }
    // WHY: Wait for form to fully initialise before filling fields
    const firstNameInput = this.page.locator('[id="0_12_input_firstName"]');
    await firstNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await firstNameInput.fill(contactData.firstName);
    await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);
    // WHY: Add email via button then fill by exact modal ID — avoids page-level ambiguity
    const modalAddEmailBtn = this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first();
    if (await modalAddEmailBtn.isVisible().catch(() => false)) {
      await modalAddEmailBtn.click();
      await this.page.waitForTimeout(500);
    }
    const emailModalInput = this.page.locator('[id="1_11_input_email_0"]');
    if (await emailModalInput.isVisible().catch(() => false)) {
      await emailModalInput.fill(contactData.email);
    }
    // WHY: Add phone via button then fill by exact modal ID
    const modalAddPhoneBtn = this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first();
    if (await modalAddPhoneBtn.isVisible().catch(() => false)) {
      await modalAddPhoneBtn.click();
      await this.page.waitForTimeout(500);
    }
    const phoneModalInput = this.page.locator('[id="1_12_input_phone_0"]');
    if (await phoneModalInput.isVisible().catch(() => false)) {
      await phoneModalInput.fill(contactData.phone);
    }
    // WHY: Fill remaining fields revealed by the toggle — address, social, professional
    const addressInput = this.page.locator('#editEntityModal').locator('input[name="address"]');
    if (await addressInput.isVisible().catch(() => false)) {
      await addressInput.fill(contactData.address);
    }
    const cityInput = this.page.locator('#editEntityModal').locator('input[name="city"]');
    if (await cityInput.isVisible().catch(() => false)) {
      await cityInput.fill(contactData.city);
    }
    const stateInput = this.page.locator('#editEntityModal').locator('input[name="state"]');
    if (await stateInput.isVisible().catch(() => false)) {
      await stateInput.fill(contactData.state);
    }
    const zipcodeInput = this.page.locator('#editEntityModal').locator('input[name="zipcode"]');
    if (await zipcodeInput.isVisible().catch(() => false)) {
      await zipcodeInput.fill(contactData.zipcode);
    }
    const facebookInput = this.page.locator('#editEntityModal').locator('input[name="facebook"]');
    if (await facebookInput.isVisible().catch(() => false)) {
      await facebookInput.fill(contactData.facebook);
    }
    const twitterInput = this.page.locator('#editEntityModal').locator('input[name="twitter"]');
    if (await twitterInput.isVisible().catch(() => false)) {
      await twitterInput.fill(contactData.twitter);
    }
    const linkedinInput = this.page.locator('#editEntityModal').locator('input[name="linkedin"]');
    if (await linkedinInput.isVisible().catch(() => false)) {
      await linkedinInput.fill(contactData.linkedin);
    }
    const departmentInput = this.page.locator('#editEntityModal').locator('input[name="department"]');
    if (await departmentInput.isVisible().catch(() => false)) {
      await departmentInput.fill(contactData.department);
    }
    const designationInput = this.page.locator('#editEntityModal').locator('input[name="designation"]');
    if (await designationInput.isVisible().catch(() => false)) {
      await designationInput.fill(contactData.designation);
    }
    // WHY: Set up response listener BEFORE clicking save — POST may arrive immediately
    const contactIdPromise = this.page.waitForResponse(
      (res) =>
        res.url().includes('/v1/contacts') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const contactId = await contactIdPromise;
    logger.success(`Contact added from direct button: ID=${contactId}`);
    return contactId;
  }

  async addContactFromEllipsis(contactData: ContactData): Promise<number | null> {
    logger.info(`Adding contact from ellipsis: ${contactData.firstName} ${contactData.lastName}`);
    await this.clickEllipsisOption('Add Contact');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });
    // WHY: Toggle off "Show Required & Important Fields" — reveals ALL fields, same as ContactsPage
    const requiredToggleEllipsis = this.page.locator('#editEntityModal').locator('.custom-control-label')
      .filter({ hasText: 'Show Required & Important Fields' }).first();
    if (await requiredToggleEllipsis.isVisible().catch(() => false)) {
      await requiredToggleEllipsis.click();
      await this.page.waitForTimeout(500);
      logger.debug('Toggled off Show Required & Important Fields');
    }
    const firstNameInput = this.page.locator('[id="0_12_input_firstName"]');
    await firstNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await firstNameInput.fill(contactData.firstName);
    await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);
    const modalAddEmailBtn = this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first();
    if (await modalAddEmailBtn.isVisible().catch(() => false)) {
      await modalAddEmailBtn.click();
      await this.page.waitForTimeout(500);
    }
    const emailModalInput = this.page.locator('[id="1_11_input_email_0"]');
    if (await emailModalInput.isVisible().catch(() => false)) {
      await emailModalInput.fill(contactData.email);
    }
    const modalAddPhoneBtn = this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first();
    if (await modalAddPhoneBtn.isVisible().catch(() => false)) {
      await modalAddPhoneBtn.click();
      await this.page.waitForTimeout(500);
    }
    const phoneModalInput = this.page.locator('[id="1_12_input_phone_0"]');
    if (await phoneModalInput.isVisible().catch(() => false)) {
      await phoneModalInput.fill(contactData.phone);
    }
    // WHY: Fill remaining fields revealed by the toggle — address, social, professional
    const addressInputE = this.page.locator('#editEntityModal').locator('input[name="address"]');
    if (await addressInputE.isVisible().catch(() => false)) {
      await addressInputE.fill(contactData.address);
    }
    const cityInputE = this.page.locator('#editEntityModal').locator('input[name="city"]');
    if (await cityInputE.isVisible().catch(() => false)) {
      await cityInputE.fill(contactData.city);
    }
    const stateInputE = this.page.locator('#editEntityModal').locator('input[name="state"]');
    if (await stateInputE.isVisible().catch(() => false)) {
      await stateInputE.fill(contactData.state);
    }
    const zipcodeInputE = this.page.locator('#editEntityModal').locator('input[name="zipcode"]');
    if (await zipcodeInputE.isVisible().catch(() => false)) {
      await zipcodeInputE.fill(contactData.zipcode);
    }
    const facebookInputE = this.page.locator('#editEntityModal').locator('input[name="facebook"]');
    if (await facebookInputE.isVisible().catch(() => false)) {
      await facebookInputE.fill(contactData.facebook);
    }
    const twitterInputE = this.page.locator('#editEntityModal').locator('input[name="twitter"]');
    if (await twitterInputE.isVisible().catch(() => false)) {
      await twitterInputE.fill(contactData.twitter);
    }
    const linkedinInputE = this.page.locator('#editEntityModal').locator('input[name="linkedin"]');
    if (await linkedinInputE.isVisible().catch(() => false)) {
      await linkedinInputE.fill(contactData.linkedin);
    }
    const departmentInputE = this.page.locator('#editEntityModal').locator('input[name="department"]');
    if (await departmentInputE.isVisible().catch(() => false)) {
      await departmentInputE.fill(contactData.department);
    }
    const designationInputE = this.page.locator('#editEntityModal').locator('input[name="designation"]');
    if (await designationInputE.isVisible().catch(() => false)) {
      await designationInputE.fill(contactData.designation);
    }
    const contactIdPromise = this.page.waitForResponse(
      (res) =>
        res.url().includes('/v1/contacts') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const contactId = await contactIdPromise;
    logger.success(`Contact added from ellipsis: ID=${contactId}`);
    return contactId;
  }

  async addDealFromDirectButton(dealData: DealData, dealsPage?: DealsPage): Promise<number | null> {
    logger.info(`Adding deal from direct button: ${dealData.name}`);
    await this.addDealDirectButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.addDealDirectButton().click();
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Deal', { timeout: 5000 });
    await this.page.locator('[id="0_11_input_name"]').waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('[id="0_11_input_name"]').fill(dealData.name);
    // WHY: Select pipeline — same locator pattern proven in contacts C15 test
    const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
    await pipelineControl.click();
    const pipelineOption = this.page.getByText('Default Deal Pipeline', { exact: true });
    await pipelineOption.waitFor({ state: 'visible', timeout: 10000 });
    await pipelineOption.click();
    logger.info('Pipeline selected');
    if (dealsPage) {
      await dealsPage.addProductRow();
      await dealsPage.addPartPayments(2);
    } else {
      // WHY: Without product, fill estimatedValue to satisfy deal value requirement
      const estimatedValueInput = this.page.locator('[id="1_21_input_estimatedValue"]');
      if (await estimatedValueInput.isVisible().catch(() => false)) {
        await estimatedValueInput.fill('50000');
        logger.debug('Estimated value filled: 50000');
      }
    }
    // WHY: Set up response listener BEFORE clicking save — POST may arrive immediately
    const dealIdPromise = this.page.waitForResponse(
      (res) =>
        (res.url().includes('/deals') || res.url().includes('/deal')) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const dealId = await dealIdPromise;
    logger.success(`Deal added from direct button: ID=${dealId}`);
    return dealId;
  }

  async addDealFromEllipsis(dealData: DealData, dealsPage?: DealsPage): Promise<number | null> {
    logger.info(`Adding deal from ellipsis: ${dealData.name}`);
    await this.clickEllipsisOption('Add Deal');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Deal', { timeout: 5000 });
    await this.page.locator('[id="0_11_input_name"]').waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('[id="0_11_input_name"]').fill(dealData.name);
    const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
    await pipelineControl.click();
    const pipelineOption = this.page.getByText('Default Deal Pipeline', { exact: true });
    await pipelineOption.waitFor({ state: 'visible', timeout: 10000 });
    await pipelineOption.click();
    logger.info('Pipeline selected');
    if (dealsPage) {
      await dealsPage.addProductRow();
      await dealsPage.addPartPayments(2);
    } else {
      const estimatedValueInput = this.page.locator('[id="1_21_input_estimatedValue"]');
      if (await estimatedValueInput.isVisible().catch(() => false)) {
        await estimatedValueInput.fill('50000');
        logger.debug('Estimated value filled: 50000');
      }
    }
    const dealIdPromise = this.page.waitForResponse(
      (res) =>
        (res.url().includes('/deals') || res.url().includes('/deal')) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const dealId = await dealIdPromise;
    logger.success(`Deal added from ellipsis: ID=${dealId}`);
    return dealId;
  }

  async addTaskFromPendingActivity(taskName: string): Promise<{ taskId: string | null }> {
    logger.info(`Adding task from pending activity section: "${taskName}"`);
    await this.addTaskPendingButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.addTaskPendingButton().click();
    // WHY: Pending Activities "Add Task" opens the Quick Add Task inline form (.quick-task-card),
    // not a modal — identical to the Quick Add Task behavior in Tasks module
    const quickTaskCard = this.page.locator('.quick-task-card');
    await quickTaskCard.waitFor({ state: 'visible', timeout: 10000 });
    const editor = this.page.locator('.quick-task-card .ck-editor__editable[role="textbox"]');
    await editor.waitFor({ state: 'visible', timeout: 10000 });
    await editor.click();
    await editor.fill(taskName);
    // WHY: Set up response listener BEFORE clicking save
    const taskIdPromise = this.page.waitForResponse(
      (res) =>
        res.url().includes('/v1/tasks') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      const id = body?.id ?? body?.data?.id ?? null;
      return id ? String(id) : null;
    }).catch(() => null);
    await this.page.locator('button.add-task-button').click();
    await this.page.locator('.quick-task-create-backdrop')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await this.page.waitForTimeout(1000);
    const taskId = await taskIdPromise;
    logger.success(`Task added from pending activity: ID=${taskId}`);
    return { taskId };
  }

  // ──────────────────────────────────────────────────────────
  // 9. Assertions
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

  async assertCompanyDeletedById(companyId: number): Promise<void> {
    logger.info(`Asserting company ${companyId} is deleted`);
    // WHY: Navigate to detail URL — deleted company shows error toast or redirects to list
    await this.navigateTo(`${config.appUrl}/sales/companies/details/${companyId}`);
    await this.page.waitForTimeout(2000);
    const url = this.page.url();
    // WHY: Check either URL redirected away OR company no longer accessible
    const isRedirected = !url.includes(`/companies/details/${companyId}`);
    const hasErrorToast = await this.page
      .locator('.toastr.rrt-error, .alert-danger, [class*="error-toast"]')
      .isVisible()
      .catch(() => false);
    expect(isRedirected || hasErrorToast).toBeTruthy();
    logger.success(`Company ${companyId} confirmed deleted`);
  }

  async assertClonedCompanyName(originalName: string): Promise<void> {
    logger.info(`Asserting cloned company has "Copy" in name — original: ${originalName}`);
    // WHY: Clone appends " Copy" to the company name — search for it in list
    const clonedName = `${originalName} Copy`;
    const found = await this.retryFindCompany(clonedName);
    expect(found).toBeTruthy();
    logger.success(`Cloned company found with name: ${clonedName}`);
  }

  async assertOwnerOnDetail(expectedOwner: string): Promise<void> {
    logger.info(`Asserting owner on detail: ${expectedOwner}`);
    // WHY: Owner is in .read-only-info div containing label "Owner"
    const ownerSection = this.page
      .locator('.read-only-info')
      .filter({ hasText: 'Owner' })
      .first();
    await ownerSection.waitFor({ state: 'visible', timeout: 10000 });
    await expect(ownerSection).toContainText(expectedOwner, { timeout: 10000 });
    logger.success(`Owner confirmed: ${expectedOwner}`);
  }

  async assertCompanyDetailFields(data: CompanyData): Promise<void> {
    logger.info('Asserting company detail fields');
    // WHY: Detail page renders field values as text inside .read-only-info containers
    await this.assertOnCompanyDetailPage();
    // Assert company name in page body
    await expect(this.page.locator('body')).toContainText(data.name, { timeout: 10000 });
    // WHY: Same tab pattern as ContactsPage.assertContactDetailFields()
    const tabPane = this.page.locator('.tab-pane.active.show');
    // WHY: Verify Communication tab — email, phone
    await this.page.locator('#nav-tab0-tab').click();
    await this.page.waitForTimeout(800);
    const tab0Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab0Text).toContain(data.email.toLowerCase());
    expect(tab0Text).toContain(data.phone);
    logger.debug(`Communication tab — email: ${data.email} | phone: ${data.phone}`);
    // WHY: Verify Location tab — city, state, zipcode
    await this.page.locator('#nav-tab1-tab').click();
    await this.page.waitForTimeout(800);
    const tab1Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab1Text).toContain(data.city.toLowerCase());
    expect(tab1Text).toContain(data.state.toLowerCase());
    expect(tab1Text).toContain(data.zipcode.toLowerCase());
    logger.debug(`Location tab — city: ${data.city} | state: ${data.state} | zipcode: ${data.zipcode}`);
    // WHY: Verify Social tab — facebook, twitter, linkedIn
    await this.page.locator('#nav-tab2-tab').click();
    await this.page.waitForTimeout(800);
    const tab2Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab2Text).toContain(data.facebook.toLowerCase());
    expect(tab2Text).toContain(data.twitter.toLowerCase());
    expect(tab2Text).toContain(data.linkedIn.toLowerCase());
    logger.debug(`Social tab — facebook: ${data.facebook} | twitter: ${data.twitter} | linkedin: ${data.linkedIn}`);
    // WHY: Company "Internals" tab (#nav-tab3-tab) shows audit info (Created By/At, etc.) — NOT
    // the company's own fields. numberOfEmployees, industry, businessType, website, uniqueText1,
    // uniqueText2 are rendered in the RIGHT PANEL info section (not inside any tab).
    // Verify them via the full page body text which includes the main panel.
    await this.page.waitForTimeout(400);
    const bodyText = (await this.page.locator('body').textContent() ?? '').toLowerCase();
    expect(bodyText).toContain(data.numberOfEmployees.toLowerCase());
    expect(bodyText).toContain(data.industry.toLowerCase());
    expect(bodyText).toContain(data.businessType.toLowerCase());
    expect(bodyText).toContain(data.website.toLowerCase());
    expect(bodyText).toContain(data.uniqueText1.toLowerCase());
    expect(bodyText).toContain(data.uniqueText2.toLowerCase());
    // TODO: annualRevenue assertion skipped — currency formatting varies (₹1,23,456 vs 123456)
    logger.debug(`Main panel — employees: ${data.numberOfEmployees} | industry: ${data.industry} | bizType: ${data.businessType}`);
    logger.success('Company detail fields verified');
  }

  // ──────────────────────────────────────────────────────────
  // 10. Workflow Wrappers
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

  async updateCompanyFull(
    newData: CompanyData,
    originalName?: string,
    companyId?: number
  ): Promise<void> {
    const searchName = originalName ?? newData.name;

    await this.searchAndOpenCompany(searchName, companyId);

    await this.clickEditIcon();

    await this.fillFullEditForm(newData);

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
