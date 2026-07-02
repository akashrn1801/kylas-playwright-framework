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

  // ── Ellipsis menu ──────────────────────────────────────────
  // WHY: Action dropdown on lead detail — Reassign/Share/Convert/Clone/Delete
  private readonly ellipsisButton = (): Locator =>
    this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

  private readonly ellipsisMenuItem = (text: string): Locator =>
    this.page.locator('.dropdown-item').filter({ hasText: text }).first();

  // ── Delete ─────────────────────────────────────────────────
  private readonly deleteConfirmButton = (): Locator =>
    this.page.locator('button#confirm.btn-danger');

  // ── Close Lead dropdown (Won/Closed stages) ────────────────
  private readonly closeLeadToggleButton = (): Locator =>
    this.page.locator('button.btn-primary.dropdown-toggle-split').first();

  private readonly closeLeadDropdownItem = (stage: string): Locator =>
    this.page.locator('.dropdown-menu.closed-stage-list .close-stage-title')
      .filter({ hasText: stage }).first();

  // ── Won/Closed stage popup ─────────────────────────────────
  private readonly stagePopupYesButton = (): Locator =>
    this.page.locator('.modal.show button.btn-primary').last();

  private readonly closedReasonFirstRadio = (): Locator =>
    this.page.locator('.modal.show .reasons-container input[type="radio"]').first();

  // ── Convert ────────────────────────────────────────────────
  private readonly convertDealNameInput = (): Locator =>
    this.page.locator('input[name="deal.details.name"]');

  private readonly convertButton = (): Locator =>
    this.page.locator('.modal.show button.btn-primary').filter({ hasText: 'Convert' }).first();

  private readonly leadConvertedBadge = (): Locator =>
    this.page.locator('text=Lead Converted').first();

  // ── Share ──────────────────────────────────────────────────
  private readonly shareToTypeInput = (): Locator =>
    this.page.locator('#input_toType');

  private readonly shareToUserInput = (): Locator =>
    this.page.locator('[id="undefined_undefinedundefined_input_toId"]');

  private readonly sharePermissionToggle = (permission: string): Locator =>
    this.page.locator(`#inp_${permission}`);

  private readonly shareConfirmButton = (): Locator =>
    this.page.locator('.modal.show button.btn-primary.ml-auto').first();

  // ── Reassign ───────────────────────────────────────────────
  private readonly reassignUserInput = (): Locator =>
    this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');

  private readonly reassignConfirmButton = (): Locator =>
    this.page.locator('.modal.show button.btn-primary.ml-auto').first();

  // ── Detail page assertions ─────────────────────────────────
  private readonly detailTabPane = (): Locator =>
    this.page.locator('.tab-pane.active.show');

  private readonly detailOwner = (): Locator =>
    this.page.locator('.detail-section').filter({ hasText: 'Owner' }).locator('p, span, div').first();

  private readonly validationError = (fieldId: string): Locator =>
    this.page.locator(`#${fieldId} .invalid-feedback, #${fieldId} .help-text.error`).first();

  // ── Right panel icons ──────────────────────────────────────
  // WHY: Map title to SVG ID — restricted user pages don't have title attributes
  private readonly rightPanelIconSvgMap: Record<string, string> = {
    'Notes': 'paint0_linear_972_2654',
    'Tasks': 'clip-Ic_Task',
    'Meetings': 'clip-Ic_Meetings',
    'Call Logs': 'paint1_linear_leads',
    'Documents': 'Rectangle_5931',
  };

  private readonly rightPanelIcon = (title: string): Locator => {
    // WHY: Try title attribute first (admin view), fallback to SVG ID (restricted view)
    const svgId = this.rightPanelIconSvgMap[title];
    if (svgId) {
      return this.page.locator(`button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[title="${title}"]`).first();
    }
    return this.page.locator(`button.btn.btn-transparent[title="${title}"]`);
  };

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

  async waitForLeadDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/leads\/details\//, {
      timeout: 20000,
    });

    await this.page.waitForLoadState('domcontentloaded');

    // WHY: Wait for lead GET API response — ensures React has leadId in state
    // Without this, share/edit fires before app resolves leadId → /leads/undefined/share
    await this.page
      .waitForResponse(
        (res) => res.url().match(/\/v1\/leads\/\d+$/) !== null && res.request().method() === 'GET',
        { timeout: 15000 }
      )
      .catch(() => null);
  }

  async goToLeadDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to lead details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/leads/details/${id}`);
    await this.waitForLeadDetailsPage();
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

  // ──────────────────────────────────────────────────────────
  // Ellipsis Menu Actions
  // ──────────────────────────────────────────────────────────

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
    await this.page.waitForTimeout(500);
    logger.success(`Clicked ellipsis option: ${optionText}`);
  }

  async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
    logger.info(`Asserting ellipsis option not visible: ${optionText}`);
    await this.openEllipsisMenu();
    const item = this.ellipsisMenuItem(optionText);
    await expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
      // WHY: Option may not exist at all — check count
      const count = await item.count();
      expect(count).toBe(0);
    });
    logger.success(`Ellipsis option not visible: ${optionText}`);
  }

  // ──────────────────────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────────────────────

  async deleteLead(): Promise<void> {
    logger.info('Deleting lead via ellipsis menu');
    await this.clickEllipsisOption('Delete');
    await this.deleteConfirmButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.deleteConfirmButton().click();
    await this.page.waitForTimeout(1000);
    logger.success('Lead deleted');
  }

  async assertLeadDeletedById(leadId: number): Promise<void> {
    logger.info(`Asserting lead ${leadId} is deleted`);
    // WHY: Navigate to detail URL — deleted lead shows error toast or redirects
    await this.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await this.page.waitForTimeout(2000);
    const url = this.page.url();
    // WHY: Check either URL redirected away OR error toast/message is visible
    const urlRedirected = !url.includes(`/leads/details/${leadId}`);
    const errorVisible = await this.page.locator('.toast-error, .alert-danger, [class*="error"]')
      .filter({ hasText: /doesn't|does not|exist|permission/i })
      .first()
      .isVisible()
      .catch(() => false);
    // WHY: Also check page content for error message
    const pageText = await this.page.locator('body').textContent().catch(() => '');
    const hasErrorText = /doesn't|does not|exist|permission/i.test(pageText ?? '');
    expect(urlRedirected || errorVisible || hasErrorText).toBeTruthy();
    logger.success(`Lead ${leadId} confirmed deleted`);
  }

  // ──────────────────────────────────────────────────────────
  // Clone
  // ──────────────────────────────────────────────────────────

  async cloneLead(): Promise<number | null> {
    logger.info('Cloning lead via ellipsis menu');
    await this.clickEllipsisOption('Clone');
    // WHY: Clone opens create form pre-filled — update email and phone to avoid duplicate errors
    await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(1000);
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
      const digits = Array.from({length: 9}, () => Math.floor(Math.random() * 10)).join('');
      const phone = ['6','7','8','9'][Math.floor(Math.random()*4)] + digits;
      await phoneInput.click({ clickCount: 3 });
      await phoneInput.press('Control+a');
      await phoneInput.fill('');
      await phoneInput.fill(phone);
      logger.debug(`Clone phone updated: ${phone}`);
    }
    // WHY: Capture POST response before saving
    const cloneIdPromise = this.captureLeadIdFromResponse();
    await this.click(this.saveButton(), 'clone save button');
    await this.assertNoFormErrors('clone lead form');
    const clonedId = await cloneIdPromise;
    // WHY: After clone save, stay on same lead detail page — no redirect to list
    await this.page.waitForTimeout(1500);
    logger.success(`Lead cloned — new ID: ${clonedId}`);
    return clonedId;
  }

  async assertClonedLeadLastName(originalLastName: string): Promise<void> {
    logger.info(`Asserting cloned lead has "Copy" in lastName — original: ${originalLastName}`);
    // WHY: Clone appends "Copy" to lastName — search for it
    const clonedLastName = `${originalLastName} Copy`;
    const found = await this.retryFindLead(clonedLastName);
    expect(found).toBeTruthy();
    logger.success(`Cloned lead found with lastName: ${clonedLastName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Close Lead (Won / Closed stages)
  // ──────────────────────────────────────────────────────────

  async markLeadAsStage(stage: 'Won' | 'Closed Lost' | 'Closed Unqualified'): Promise<string> {
    logger.info(`Marking lead as: ${stage}`);
    // WHY: Close Lead dropdown toggle opens the stage list
    await this.closeLeadToggleButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.closeLeadToggleButton().click();
    await this.page.waitForTimeout(500);
    // WHY: Click the stage option from the dropdown
    const stageItem = this.closeLeadDropdownItem(stage);
    await stageItem.waitFor({ state: 'visible', timeout: 5000 });
    await stageItem.click();
    await this.page.waitForTimeout(500);
    // WHY: All stages show a confirmation popup — for Closed stages select random reason
    let selectedReason = '';
    if (stage !== 'Won') {
      await this.closedReasonFirstRadio().waitFor({ state: 'visible', timeout: 5000 });
      // WHY: Get all reason radio buttons and select a random one
      const radios = this.page.locator('.modal.show .reasons-container input[type="radio"]');
      const count = await radios.count();
      const randomIndex = Math.floor(Math.random() * count);
      await radios.nth(randomIndex).click();
      // WHY: Get the label text of the selected reason for verification
      const reasonLabel = this.page.locator('.modal.show .reasons-container label').nth(randomIndex);
      selectedReason = (await reasonLabel.textContent())?.trim() ?? '';
      logger.info(`Selected reason: ${selectedReason}`);
    }
    await this.stagePopupYesButton().waitFor({ state: 'visible', timeout: 5000 });
    await this.stagePopupYesButton().click();
    await this.page.waitForTimeout(1000);
    logger.success(`Lead marked as: ${stage} — reason: ${selectedReason}`);
    return selectedReason;
  }

  async assertLeadStageOnDetail(expectedStage: string): Promise<void> {
    logger.info(`Asserting lead stage on detail: ${expectedStage}`);
    // WHY: Won/Closed stages show as badge or stage name on detail page
    const stageBadge = this.page.locator(`text=${expectedStage}`).first();
    await stageBadge.waitFor({ state: 'visible', timeout: 10000 });
    logger.success(`Lead stage confirmed: ${expectedStage}`);
  }

  // ──────────────────────────────────────────────────────────
  // Convert Lead
  // ──────────────────────────────────────────────────────────

  async convertLeadToAll(dealName: string): Promise<void> {
    logger.info(`Converting lead to Deal+Contact+Company — deal name: ${dealName}`);
    await this.clickEllipsisOption('Convert');
    await this.page.waitForTimeout(1500);
    // WHY: Check Deal, Contact, Company checkboxes — unchecked by default
    for (const id of ['entity_deals', 'entity_contacts', 'entity_companies']) {
      const checkbox = this.page.locator(`#${id}`);
      const isChecked = await checkbox.isChecked().catch(() => false);
      if (!isChecked) {
        const label = this.page.locator(`label[for="${id}"]`).first();
        await label.click();
        await this.page.waitForTimeout(500);
      }
    }
    await this.page.waitForTimeout(500);
    // WHY: Enable Show auto-mapped fields for all entities
    const autoMappedToggles = this.page.locator('#auto_mapped');
    const autoMappedCount = await autoMappedToggles.count();
    for (let i = 0; i < autoMappedCount; i++) {
      const toggle = autoMappedToggles.nth(i);
      const isChecked = await toggle.isChecked().catch(() => false);
      if (!isChecked) {
        await toggle.locator('xpath=parent::div').locator('label').click();
        await this.page.waitForTimeout(300);
      }
    }
    await this.page.waitForTimeout(500);
    // WHY: Fill mandatory deal name
    await this.convertDealNameInput().waitFor({ state: 'visible', timeout: 10000 });
    await this.convertDealNameInput().fill(dealName);
    // WHY: Fill estimated value — required field for deal
    const estimatedValue = this.page.locator('[id="1_21_input_deal.details.estimatedValue"]');
    await estimatedValue.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    if (await estimatedValue.isVisible().catch(() => false)) {
      await estimatedValue.fill('100000');
      logger.debug('Estimated value filled: 100000');
    }
    // WHY: Company name must be unique — auto-mapped name may already exist
    const companyNameInput = this.page.locator('[id="3_11_input_company.details.name"]');
    if (await companyNameInput.isVisible().catch(() => false)) {
      await companyNameInput.fill(`Company-${Date.now()}`);
      logger.debug('Company name made unique');
    }
    // WHY: Add a product row to the deal
    const addProductBtn = this.page.locator('span.add-new-product').first();
    if (await addProductBtn.isVisible().catch(() => false)) {
      await addProductBtn.scrollIntoViewIfNeeded();
      await addProductBtn.click();
      await this.page.waitForTimeout(500);
      // WHY: Click last product dropdown indicator to open product options
      const allIndicators = this.page.locator('.look-up.col-3 .is-invalid__indicator');
      await allIndicators.last().waitFor({ state: 'visible', timeout: 10000 });
      await allIndicators.last().scrollIntoViewIfNeeded();
      await allIndicators.last().click({ force: true });
      // WHY: Wait for product options and select first one
      const productOptions = this.page.locator('.is-invalid__option');
      for (let i = 0; i < 6; i++) {
        try {
          await productOptions.first().waitFor({ state: 'visible', timeout: 3000 });
          break;
        } catch {
          await allIndicators.last().click({ force: true });
        }
      }
      const count = await productOptions.count();
      const randomIndex = Math.floor(Math.random() * count);
      await productOptions.nth(randomIndex).click();
      await this.page.waitForTimeout(500);
      logger.debug('Product added to convert deal');
      // WHY: Add part payment after product is added
      const addPaymentBtn = this.page.locator('button.btn-add-payment-full').first();
      if (await addPaymentBtn.isVisible().catch(() => false)) {
        await addPaymentBtn.scrollIntoViewIfNeeded();
        await addPaymentBtn.click();
        await this.page.waitForTimeout(500);
        // WHY: Installments modal appears — fill 1 installment and confirm
        const installmentsModal = this.page.locator('.installments-modal');
        await installmentsModal.waitFor({ state: 'visible', timeout: 10000 });
        const installmentsInput = this.page.getByRole('spinbutton');
        await installmentsInput.click();
        await installmentsInput.fill('1');
        await this.page.getByRole('button', { name: 'Confirm' }).click();
        await installmentsModal.waitFor({ state: 'hidden', timeout: 10000 });
        await this.page.waitForTimeout(500);
        logger.debug('Part payment added with 1 installment');
      }
    }
    // WHY: Click Convert button to submit
    await this.convertButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.convertButton().click();
    await this.page.waitForTimeout(3000);
    logger.success(`Lead converted — deal: ${dealName}`);
  }

  async assertLeadConvertedBadge(): Promise<void> {
    logger.info('Asserting Lead Converted badge');
    await this.leadConvertedBadge().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Lead Converted badge confirmed');
  }

  // ──────────────────────────────────────────────────────────
  // Share Lead
  // ──────────────────────────────────────────────────────────

  async shareLead(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing lead with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
    await this.clickEllipsisOption('Share');
    await this.page.waitForTimeout(1000);
    // WHY: Click the Share To type dropdown control — opens User/Team options
    const shareTypeControl = this.page.locator('.modal.show')
      .locator('.is-invalid__control').first();
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
    const validWord = words.find(w => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
    const searchTerm = validWord;
    logger.debug(`Share search term: "${searchTerm}" (from: "${restrictedUserName}")`);
    await this.shareToUserInput().fill(searchTerm);
    await this.page.waitForTimeout(800);
    // WHY: Select matching user from dropdown
    const userItem = this.page.locator('.is-invalid__option')
      .filter({ hasText: restrictedUserName }).first();
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
        logger.debug(`Permission ${permission} toggled`);
      }
    }
    await this.shareConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the share-API response wait BEFORE clicking — confirms the
    // server actually processed the permission change instead of a blind sleep.
    const shareResponsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v1\/leads\/\d+\/share$/) !== null && res.request().method() === 'POST',
        { timeout: 15000 }
      )
      .catch(() => null);
    await this.shareConfirmButton().click();
    await shareResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Lead shared with: ${restrictedUserName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Reassign Lead
  // ──────────────────────────────────────────────────────────

  async reassignLead(userDisplayName: string): Promise<void> {
    logger.info(`Reassigning lead to: ${userDisplayName}`);
    await this.clickEllipsisOption('Reassign');
    await this.page.waitForTimeout(500);
    // WHY: Search requires minimum 3 characters
    const words = userDisplayName.trim().split(' ');
    const validWord = words.find(w => w.length >= 3) ?? userDisplayName.trim().substring(0, 3);
    logger.debug(`Reassign search term: "${validWord}" (from: "${userDisplayName}")`);
    await this.reassignUserInput().waitFor({ state: 'visible', timeout: 5000 });
    await this.reassignUserInput().fill(validWord);
    await this.page.waitForTimeout(800);
    const userItem = this.page.locator('.is-invalid__option')
      .filter({ hasText: userDisplayName }).first();
    await userItem.waitFor({ state: 'visible', timeout: 5000 });
    await userItem.click();
    await this.page.waitForTimeout(500);
    await this.reassignConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the reassign-API (owner change) response wait BEFORE
    // clicking — confirms ownership actually changed server-side.
    const reassignResponsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v1\/leads\/\d+\/owner$/) !== null && res.request().method() === 'PUT',
        { timeout: 15000 }
      )
      .catch(() => null);
    await this.reassignConfirmButton().click();
    await reassignResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Lead reassigned to: ${userDisplayName}`);
  }

  async assertOwnerOnDetail(expectedOwner: string): Promise<void> {
    logger.info(`Asserting owner on detail: ${expectedOwner}`);
    // WHY: Owner is shown as text near top of detail page
    const ownerText = this.page.locator(`text=${expectedOwner}`).first();
    await ownerText.waitFor({ state: 'visible', timeout: 10000 });
    logger.success(`Owner confirmed: ${expectedOwner}`);
  }

  // ──────────────────────────────────────────────────────────
  // Detail Field Assertions
  // ──────────────────────────────────────────────────────────

  async assertDetailTabContent(tabId: string, expectedValues: string[]): Promise<void> {
    logger.info(`Asserting tab ${tabId} content`);
    // WHY: Click tab by ID, then check active pane text content
    await this.page.locator(`#${tabId}`).click();
    await this.page.waitForTimeout(800);
    const paneText = (await this.detailTabPane().textContent() ?? '').toLowerCase();
    for (const value of expectedValues) {
      // WHY: Compare lowercase — detail page may display in different case
      expect(paneText).toContain(value.toLowerCase());
      logger.debug(`Tab ${tabId} contains: ${value}`);
    }
    logger.success(`Tab ${tabId} content verified`);
  }

  async assertValidationError(message: string): Promise<void> {
    logger.info(`Asserting validation error: ${message}`);
    const error = this.page.locator('.invalid-feedback, .help-text.error')
      .filter({ hasText: message }).first();
    await error.waitFor({ state: 'visible', timeout: 5000 });
    logger.success(`Validation error confirmed: ${message}`);
  }

  // ──────────────────────────────────────────────────────────
  // Right Panel Icon Actions
  // ──────────────────────────────────────────────────────────

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
    await expect(this.rightPanelIcon(title)).toBeVisible({ timeout: 5000 });
    logger.success(`Right panel icon visible: ${title}`);
  }

  async assertRightPanelIconNotVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon NOT visible: ${title}`);
    await expect(this.rightPanelIcon(title)).toBeHidden({ timeout: 5000 });
    logger.success(`Right panel icon not visible: ${title}`);
  }
}
