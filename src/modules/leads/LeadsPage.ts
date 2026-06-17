import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { LeadData } from '../../data/factories/leadFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class LeadsPage extends BasePage {
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

  private readonly leadTable = (): Locator => this.page.locator('.rt-table');

  private readonly leadRowNameCell = (firstName: string): Locator =>
    this.page
      .locator('.rt-tr-group')
      .filter({
        has: this.page.getByText(firstName, { exact: true }),
      })
      .first();

  private readonly showRequiredToggle = (): Locator =>
    this.page.locator('label').filter({
      hasText: 'Show Required & Important Fields',
    });

  private readonly firstNameInput = (): Locator => this.page.locator('input[name="firstName"]');

  private readonly lastNameInput = (): Locator => this.page.locator('input[name="lastName"]');

  private readonly addEmailButton = (): Locator =>
    this.page.getByText('Add Email', { exact: true }).first();

  private readonly emailInput = (): Locator => this.page.locator('input[name="emails[0].value"]');

  private readonly addPhoneButton = (): Locator =>
    this.page.getByText('Add Phone', { exact: true }).first();

  private readonly phoneInput = (): Locator => this.page.locator('input[id*="input_phone_0"]');

  private readonly addressInput = (): Locator => this.page.locator('input[name="address"]');

  private readonly cityInput = (): Locator => this.page.locator('input[name="city"]');

  private readonly stateInput = (): Locator => this.page.locator('input[name="state"]');

  private readonly zipcodeInput = (): Locator => this.page.locator('input[name="zipcode"]');

  private readonly facebookInput = (): Locator => this.page.locator('input[name="facebook"]');

  private readonly twitterInput = (): Locator => this.page.locator('input[name="twitter"]');

  private readonly linkedInInput = (): Locator => this.page.locator('input[name="linkedIn"]');

  private readonly companyNameInput = (): Locator => this.page.locator('input[name="companyName"]');

  private readonly departmentInput = (): Locator => this.page.locator('input[name="department"]');

  private readonly designationInput = (): Locator => this.page.locator('input[name="designation"]');

  private readonly companyAddressInput = (): Locator =>
    this.page.locator('input[name="companyAddress"]');

  private readonly companyCityInput = (): Locator => this.page.locator('input[name="companyCity"]');

  private readonly companyStateInput = (): Locator =>
    this.page.locator('input[name="companyState"]');

  private readonly companyZipcodeInput = (): Locator =>
    this.page.locator('input[name="companyZipcode"]');

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
    // than polling .rt-table which renders async after the API call completes
    await Promise.race([
      this.page
        .waitForResponse(
          (res) =>
            res.url().includes('/v1/leads') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
          { timeout: config.timeouts.navigation }
        )
        .catch(() => null),
      this.leadTable()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
    await expect(this.leadTable()).toBeVisible({ timeout: config.timeouts.navigation });
    await this.waitForLoaderToDisappear();
  }

  private async waitForLoaderToDisappear(): Promise<void> {
    try {
      await this.searchLoader().last().waitFor({
        state: 'hidden',
        timeout: 10000,
      });
    } catch {
      // loader may not exist
    }
  }

  private async waitForSearchResults(firstName: string): Promise<boolean> {
    try {
      await expect(this.leadRowNameCell(firstName)).toBeVisible({
        timeout: 5000,
      });

      return true;
    } catch {
      return false;
    }
  }

  private async waitForLeadDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/leads\/details\//, {
      timeout: 20000,
    });

    await this.page.waitForLoadState('domcontentloaded');
  }

  private async waitForLeadListPage(): Promise<void> {
    await this.waitForUrl(/leads\/list/);

    await this.waitForListReady();
  }

  private async closeModalIfOpen(): Promise<void> {
    const modal = this.editModal();

    try {
      if (await modal.isVisible()) {
        logger.info('Closing existing modal');

        await this.modalCancelButton().click();

        await modal.waitFor({
          state: 'hidden',
          timeout: 5000,
        });

        logger.success('Modal closed');
      }
    } catch (error) {
      logger.warn(`Failed to close modal: ${String(error)}`);
    }
  }

  private async disableRequiredFieldsToggle(): Promise<void> {
    try {
      const toggle = this.showRequiredToggle();

      if (await toggle.isVisible()) {
        logger.info('Disabling Show Required & Important Fields');

        await toggle.click();

        await expect(this.firstNameInput()).toBeVisible({
          timeout: 10000,
        });

        logger.success('Toggle disabled');
      }
    } catch (error) {
      logger.debug(`Toggle not available: ${String(error)}`);
    }
  }

  private async performSearch(searchText: string): Promise<void> {
    logger.info(`Searching lead: ${searchText}`);

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
        {
          timeout: 15000,
        }
      );
    } catch {
      return null;
    }
  }

  private async captureLeadIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.page.waitForResponse(
        (res) =>
          res.url().includes('/v1/leads') &&
          res.request().method() === 'POST' &&
          res.status() === 200,
        {
          timeout: config.timeouts.navigation,
        }
      );

      const body = await response.json();

      const leadId = body?.id ?? body?.data?.id ?? null;

      logger.success(`Captured lead ID: ${leadId}`);

      return leadId;
    } catch (error) {
      logger.warn(`Unable to capture lead ID: ${String(error)}`);

      return null;
    }
  }

  private async retryFindLead(firstName: string): Promise<boolean> {
    const currentConfig = this.retryConfig;

    for (let attempt = 1; attempt <= currentConfig.retries; attempt++) {
      logger.info(`Search attempt ${attempt}/${currentConfig.retries}`);

      await this.goToLeadsList();

      await this.performSearch(firstName);

      const found = await this.waitForSearchResults(firstName);

      if (found) {
        logger.success('Lead found');

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

  async goToLeadsList(): Promise<void> {
    logger.info('Navigating to Leads List');

    await this.closeModalIfOpen();

    await this.navigateTo(`${config.appUrl}/sales/leads/list`);

    await this.waitForLeadListPage();

    logger.success('On Leads List page');
  }

  async clickAddLead(): Promise<void> {
    logger.info('Clicking Add Lead');

    await this.click(this.addButton(), 'add lead button');

    await expect(this.firstNameInput()).toBeVisible({
      timeout: 10000,
    });

    logger.success('Lead form opened');
  }

  // ──────────────────────────────────────────────────────────
  // Form Actions
  // ──────────────────────────────────────────────────────────

  // Pipeline stage locators
  private readonly pipelineInput = (): Locator =>
    this.page
      .locator('[id="0_21_input_pipeline"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  private readonly pipelineStageInput = (): Locator =>
    this.page
      .locator('[id="0_22_input_pipelineStage"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  private readonly pipelineStageDropdownIndicator = (): Locator =>
    this.page
      .locator('[id="0_22_input_pipelineStage"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]')
      .locator('.is-invalid__dropdown-indicator');

  private readonly pipelineStageSingleValue = (): Locator =>
    // WHY: On details page, current stage uses .in-progress-stage .stage-name
    this.page.locator('.in-progress-stage .stage-name').first();

  async fillLeadForm(data: LeadData): Promise<void> {
    logger.info('Filling lead form');

    await this.disableRequiredFieldsToggle();

    await this.fill(this.firstNameInput(), data.firstName, 'first name');

    await this.fill(this.lastNameInput(), data.lastName, 'last name');

    // WHY: Pipeline must be selected before Pipeline Stage —
    // Stage options depend on the selected pipeline.
    logger.info('Selecting pipeline');
    const pipelineIndicator = this.pipelineInput().locator('.is-invalid__dropdown-indicator');
    try {
      await pipelineIndicator.waitFor({ state: 'visible', timeout: 5000 });
      await pipelineIndicator.click();
      const pipelineOption = this.page.locator('.is-invalid__option').first();
      await pipelineOption.waitFor({ state: 'visible', timeout: 5000 });
      await pipelineOption.click();
      logger.success('Pipeline selected');
    } catch {
      logger.info('Pipeline already selected or not available — skipping');
    }

    await this.click(
      this.addEmailButton(),
      'add email button',
      true // force: CSS overlay intercepts pointer events on GHA
    );

    await expect(this.emailInput()).toBeVisible();

    await this.fill(this.emailInput(), data.email, 'email');

    await this.click(this.addPhoneButton(), 'add phone button');

    await expect(this.phoneInput()).toBeVisible();
    // WHY: Phone input briefly detaches after React re-render on GHA — wait for stability
    await this.page.waitForTimeout(500);
    await this.fill(this.phoneInput(), data.phone, 'phone');

    await this.fill(this.addressInput(), data.address, 'address');

    await this.fill(this.cityInput(), data.city, 'city');

    await this.fill(this.stateInput(), data.state, 'state');

    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');

    await this.fill(this.facebookInput(), data.facebook, 'facebook');

    await this.fill(this.twitterInput(), data.twitter, 'twitter');

    await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');

    await this.fill(this.companyNameInput(), data.companyName, 'company name');

    await this.fill(this.departmentInput(), data.department, 'department');

    await this.fill(this.designationInput(), data.designation, 'designation');

    await this.fill(this.companyAddressInput(), data.companyAddress, 'company address');

    await this.fill(this.companyCityInput(), data.companyCity, 'company city');

    await this.fill(this.companyStateInput(), data.companyState, 'company state');

    await this.fill(this.companyZipcodeInput(), data.companyZipcode, 'company zipcode');

    // Pipeline Stage (optional)
    if (data.pipelineStage) {
      logger.info(`Selecting pipeline stage: ${data.pipelineStage}`);
      const indicator = this.pipelineStageDropdownIndicator();
      await indicator.waitFor({ state: 'visible', timeout: 10000 });
      await indicator.scrollIntoViewIfNeeded();
      await indicator.click();
      const stageOption = this.page
        .locator('.is-invalid__option')
        .filter({ hasText: data.pipelineStage })
        .first();
      await stageOption.waitFor({ state: 'visible', timeout: 10000 });
      await stageOption.click();
      logger.success(`Pipeline stage selected: ${data.pipelineStage}`);
    }
    logger.success('Lead form filled');
  }

  async assertPipelineStageOnDetails(expectedStage: string): Promise<void> {
    logger.info(`Asserting pipeline stage: ${expectedStage}`);
    const stageEl = this.pipelineStageSingleValue();
    await stageEl.waitFor({ state: 'visible', timeout: 10000 });
    const stageText = (await stageEl.textContent())?.trim() ?? '';
    // WHY: Stage text includes percentage e.g. "Open(0%)" — extract just the name
    const stageName = stageText.split('(')[0].trim();
    expect(stageName).toBe(expectedStage);
    logger.success(`Pipeline stage verified: ${stageName}`);
  }

  async changePipelineStageInEdit(newStage: string): Promise<void> {
    logger.info(`Changing pipeline stage to: ${newStage}`);
    const indicator = this.pipelineStageDropdownIndicator();
    await indicator.waitFor({ state: 'visible', timeout: 10000 });
    await indicator.scrollIntoViewIfNeeded();
    await indicator.click();
    const stageOption = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: newStage })
      .first();
    await stageOption.waitFor({ state: 'visible', timeout: 10000 });
    await stageOption.click();
    logger.success(`Pipeline stage changed to: ${newStage}`);
  }

  async saveLead(): Promise<number | null> {
    logger.info('Saving lead');

    const leadIdPromise = this.captureLeadIdFromResponse();

    await this.click(this.saveButton(), 'save button');
    await this.assertNoFormErrors('lead create form');

    const leadId = await leadIdPromise;

    await this.waitForLeadListPage();

    logger.success('Lead saved successfully');

    return leadId;
  }

  // ──────────────────────────────────────────────────────────
  // Search & Open
  // ──────────────────────────────────────────────────────────

  async searchAndOpenLead(firstName: string, leadId?: number): Promise<void> {
    logger.info(`Opening lead: ${firstName}`);

    if (leadId) {
      logger.info(`Opening lead directly via ID: ${leadId}`);

      await this.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);

      await this.waitForLeadDetailsPage();

      return;
    }

    const found = await this.retryFindLead(firstName);

    expect(found).toBeTruthy();

    await this.leadRowNameCell(firstName).click();

    await this.waitForLeadDetailsPage();

    logger.success(`Lead opened: ${firstName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Opening edit modal');

    await this.click(this.editIconButton(), 'edit icon');

    await expect(this.editModal()).toBeVisible({
      timeout: 10000,
    });

    logger.success('Edit modal opened');
  }

  async fillEditForm(data: LeadData): Promise<void> {
    logger.info('Updating lead form');

    await this.fill(this.firstNameInput(), data.firstName, 'first name');

    await this.fill(this.lastNameInput(), data.lastName, 'last name');

    logger.success('Edit form updated');
  }

  async saveEditedLead(): Promise<void> {
    logger.info('Saving updated lead');

    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('lead edit form');

    await expect(this.editModal()).toBeHidden({
      timeout: 15000,
    });

    logger.success('Lead updated');
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnLeadsListPage(): Promise<void> {
    await this.assertUrl(/leads\/list/);
  }

  async assertOnLeadDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/leads\/details\//);
  }

  async assertLeadExistsInList(firstName: string): Promise<void> {
    logger.info(`Validating lead exists: ${firstName}`);

    const found = await this.retryFindLead(firstName);

    expect(found).toBeTruthy();

    logger.success(`Lead exists: ${firstName}`);
  }

  async assertLeadNotInList(firstName: string): Promise<void> {
    logger.info(`Validating lead absent: ${firstName}`);

    await this.goToLeadsList();

    await this.performSearch(firstName);

    await expect(this.leadRowNameCell(firstName)).toBeHidden({
      timeout: 10000,
    });

    logger.success(`Lead absent confirmed: ${firstName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createLead(data: LeadData): Promise<number | null> {
    await this.clickAddLead();

    await this.fillLeadForm(data);

    return await this.saveLead();
  }

  async updateLead(newData: LeadData, originalFirstName?: string, leadId?: number): Promise<void> {
    const searchName = originalFirstName ?? newData.firstName;

    await this.searchAndOpenLead(searchName, leadId);

    await this.clickEditIcon();

    await this.fillEditForm(newData);

    await this.saveEditedLead();
  }

  async assertLeadCreated(data: LeadData, leadId?: number): Promise<void> {
    if (leadId) {
      logger.info(`Validating lead via ID: ${leadId}`);

      await this.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);

      await this.waitForLeadDetailsPage();

      await expect(this.firstNameInput()).toHaveValue(data.firstName, {
        timeout: 10000,
      });

      logger.success(`Lead verified: ${data.firstName}`);

      return;
    }

    await this.assertLeadExistsInList(data.firstName);
  }

  async assertLeadUpdated(data: LeadData): Promise<void> {
    await this.goToLeadsList();

    await this.assertLeadExistsInList(data.firstName);
  }
}
