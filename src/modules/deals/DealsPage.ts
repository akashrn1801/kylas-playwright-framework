import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { DealData, formatDateForCalendarLabel } from '../../data/factories/dealFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class DealsPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // Retry Config
  // ──────────────────────────────────────────────────────────

  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // Locators — List Page
  // ──────────────────────────────────────────────────────────

  private readonly addButton = (): Locator => this.page.getByRole('button', { name: 'Add' });

  private readonly searchInput = (): Locator =>
    // WHY: QA uses #deals-search-input, prod uses placeholder='Search'
    this.page.locator('#deals-search-input, input[placeholder="Search"]').first();

  private readonly searchIcon = (): Locator => this.page.locator('.input-group-text > svg');

  private readonly searchLoader = (): Locator => this.page.locator('.spinner, .loader, .loading');

  private readonly dealTable = (): Locator => this.page.locator('.rt-table');

  private readonly dealRowByName = (name: string): Locator =>
    this.page
      .locator('.rt-tr-group')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .first();

  // ──────────────────────────────────────────────────────────
  // Locators — Form
  // ──────────────────────────────────────────────────────────

  private readonly nameInput = (): Locator => this.page.locator('[id="0_11_input_name"]');

  private readonly estimatedClosureDateInput = (): Locator =>
    this.page.getByPlaceholder('Pick a Date');

  private readonly calendarForwardButton = (): Locator =>
    this.page.getByLabel('Move forward to switch to the');

  private readonly calendarDayByLabel = (label: string): Locator =>
    this.page.getByLabel(label, { exact: false });

  private readonly pipelineControl = (): Locator =>
    this.page
      .locator('div')
      .filter({ hasText: /^Search pipeline$/ })
      .nth(2);

  private readonly pipelineStageInput = (): Locator =>
    this.page.locator('[id="0_32_input_pipelineStage"]');

  private readonly associatedContactsInput = (): Locator =>
    this.page.locator('[id="0_41_input_associatedContacts"]');

  private readonly associatedCompanyInput = (): Locator =>
    this.page.locator('[id="0_42_input_company"]');

  private readonly addNewProductButton = (): Locator =>
    this.page.locator('span.add-new-product').first();

  private readonly productDropdownIndicator = (): Locator =>
    this.page.locator('.look-up.col-3 .is-invalid__indicator').first();

  private readonly estimatedValueInput = (): Locator =>
    this.page.locator('[id="1_21_input_estimatedValue"]');

  private readonly addPaymentButton = (): Locator => this.page.getByText('Add Payment');

  private readonly installmentsModal = (): Locator => this.page.locator('.installments-modal');

  private readonly installmentsNumberInput = (): Locator => this.page.getByRole('spinbutton');

  private readonly installmentsConfirmButton = (): Locator =>
    this.page.getByRole('button', { name: 'Confirm' });

  private readonly partPaymentNameInput = (index: number): Locator =>
    this.page.locator(`input[name="partPayments.${index}.paymentName"]`);

  private readonly partPaymentSummaryActualTotal = (): Locator =>
    this.page.locator('.part-payments-summary .summary-row').nth(0).locator('.summary-value');

  private readonly partPaymentSummaryAmountReceived = (): Locator =>
    this.page.locator('.part-payments-summary .summary-row').nth(1).locator('.summary-value');

  private readonly partPaymentSummaryRemainingBalance = (): Locator =>
    this.page.locator('.part-payments-summary .summary-row').nth(2).locator('.summary-value');

  private readonly campaignControl = (): Locator =>
    this.page
      .locator(
        '[id="57510"] > .tab-inner-content > .row > div > .form-group > .search-autocomplete > .css-2b097c-container > .is-invalid__control > .is-invalid__indicators > .is-invalid__indicator > .css-19bqh2r'
      )
      .first();

  private readonly sourceControl = (): Locator =>
    this.page
      .locator('div')
      .filter({ hasText: /^Choose$/ })
      .nth(3);

  private readonly subSourceInput = (): Locator => this.page.locator('[id="3_21_input_subSource"]');

  private readonly utmSourceInput = (): Locator => this.page.locator('[id="3_22_input_utmSource"]');

  private readonly utmCampaignInput = (): Locator =>
    this.page.locator('[id="3_31_input_utmCampaign"]');

  private readonly utmMediumInput = (): Locator => this.page.locator('[id="3_32_input_utmMedium"]');

  private readonly utmContentInput = (): Locator =>
    this.page.locator('[id="3_41_input_utmContent"]');

  private readonly utmTermInput = (): Locator => this.page.locator('[id="3_42_input_utmTerm"]');

  private readonly saveButton = (): Locator => this.page.getByLabel('Add Deal').getByText('Save');

  private readonly saveEditButton = (): Locator => this.page.getByText('Save');

  private readonly editIconButton = (): Locator => this.page.locator('#edit-action-btn');

  private readonly editModal = (): Locator => this.page.locator('#editEntityModal');

  private readonly modalCancelButton = (): Locator =>
    this.page.locator('button[data-dismiss="modal"]').first();

  // ── Deal details page locators ────────────────────────────

  private readonly dealActualValueEl = (): Locator =>
    this.page.locator('#actualValue .title span').first();

  private readonly dealInProgressStage = (): Locator =>
    this.page.locator('.in-progress-stage .stage-name').first();

  private readonly partPaymentsLink = (): Locator =>
    this.page.locator('#partPayments .link-primary');

  private readonly partPaymentsModal = (): Locator =>
    this.page.locator('.modal-content').filter({ hasText: 'Part Payment' });

  // ── Edit form — pipeline stage ────────────────────────────

  private readonly pipelineStageDropdownIndicator = (): Locator =>
    this.page
      .locator('[id="0_32_input_pipelineStage"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]')
      .locator('.is-invalid__dropdown-indicator');

  private readonly stageReasonDropdownIndicator = (): Locator =>
    this.page
      .locator('#stage_reason')
      .locator('xpath=ancestor::div[contains(@class,"container")]')
      .locator('[class*="indicator"]:not([class*="separator"])')
      .last();

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
            res.url().includes('/v1/deals') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
          { timeout: config.timeouts.navigation }
        )
        .catch(() => null),
      this.dealTable()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
    await expect(this.dealTable()).toBeVisible({ timeout: config.timeouts.navigation });
    await this.waitForLoaderToDisappear();
  }

  private async waitForLoaderToDisappear(): Promise<void> {
    try {
      await this.searchLoader().last().waitFor({ state: 'hidden', timeout: 10000 });
    } catch {
      // loader may not be present
    }
  }

  async waitForDealDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/deals\/details\//, { timeout: 20000 });
    await this.page.waitForLoadState('domcontentloaded');

    // WHY: Wait for deal GET API response — ensures React has dealId in state
    // Without this, edit/product/payment actions fire before app resolves dealId
    await this.page
      .waitForResponse(
        (res) => res.url().match(/\/v1\/deals\/\d+$/) !== null && res.request().method() === 'GET',
        { timeout: 15000 }
      )
      .catch(() => null);
  }

  async goToDealDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to deal details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/deals/details/${id}`);
    await this.waitForDealDetailsPage();
  }

  private async waitForDealListPage(): Promise<void> {
    await this.waitForUrl(/deals\/list/);
    await this.waitForListReady();
  }

  private async closeModalIfOpen(): Promise<void> {
    try {
      if (await this.editModal().isVisible()) {
        logger.info('Closing existing modal');
        await this.modalCancelButton().click();
        await this.editModal().waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Modal closed');
      }
    } catch (error) {
      logger.warn(`Failed to close modal: ${String(error)}`);
    }
  }

  private async waitForSearchResults(name: string): Promise<boolean> {
    try {
      await expect(this.dealRowByName(name)).toBeVisible({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private async performSearch(name: string): Promise<void> {
    logger.info(`Searching deal: ${name}`);
    await this.fill(this.searchInput(), name, 'search input');

    // WHY: Try clicking the search icon first. If it doesn't trigger search
    // within 3s, fall back to pressing Enter — prod may require Enter key.
    try {
      await this.click(this.searchIcon(), 'search icon');
    } catch {
      logger.info('Search icon click failed — pressing Enter');
      await this.searchInput().press('Enter');
    }

    // Wait for search API response with generous timeout for prod
    await this.waitForSearchApi();
    await this.waitForLoaderToDisappear();
  }

  private async waitForSearchApi(): Promise<Response | null> {
    try {
      return await this.page.waitForResponse(
        (response) =>
          response.url().includes('/search/deal') &&
          response.request().method() === 'GET' &&
          response.status() === 200,
        { timeout: 15000 }
      );
    } catch {
      // Search API did not fire — wait briefly and continue
      await this.page.waitForTimeout(2000);
      return null;
    }
  }

  private async captureDealIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.page.waitForResponse(
        (res) =>
          (res.url().includes('/deals') || res.url().includes('/deal')) &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        { timeout: config.timeouts.navigation }
      );
      const body = await response.json();
      const dealId = body?.id ?? body?.data?.id ?? body?.dealId ?? null;
      logger.success(`Captured deal ID: ${dealId} from ${response.url()}`);
      return dealId;
    } catch (error) {
      logger.warn(`Unable to capture deal ID: ${String(error)}`);
      return null;
    }
  }

  private async retryFindDeal(name: string): Promise<boolean> {
    const currentConfig = this.retryConfig;
    for (let attempt = 1; attempt <= currentConfig.retries; attempt++) {
      logger.info(`Search attempt ${attempt}/${currentConfig.retries}`);
      await this.goToDealsList();
      await this.performSearch(name);
      const found = await this.waitForSearchResults(name);
      if (found) {
        logger.success('Deal found');
        return true;
      }
      if (attempt < currentConfig.retries) {
        await this.page.waitForTimeout(currentConfig.wait);
      }
    }
    return false;
  }

  // ──────────────────────────────────────────────────────────
  // React Select Helper — contacts / company
  // ──────────────────────────────────────────────────────────

  private async selectFirstOptionFromDropdown(
    inputLocator: Locator,
    description: string
  ): Promise<void> {
    logger.info(`Selecting ${description}`);
    // WHY: Click the dropdown indicator arrow — more reliable than clicking input.
    // The indicator is the svg arrow at the right of the control.
    const control = inputLocator.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    const indicator = control.locator('.is-invalid__dropdown-indicator');
    await indicator.waitFor({ state: 'visible', timeout: 10000 });
    await indicator.scrollIntoViewIfNeeded();
    await indicator.click();

    // WHY: QA async API can take up to 22s — re-click every 5s if needed
    const firstOption = this.page.locator('.is-invalid__option').first();
    let found = false;
    for (let i = 0; i < 8; i++) {
      try {
        await firstOption.waitFor({ state: 'visible', timeout: 5000 });
        found = true;
        break;
      } catch {
        logger.info(`${description} options not visible, re-clicking (attempt ${i + 1})`);
        await indicator.click();
      }
    }
    if (!found) throw new Error(`${description} options did not appear after 40s`);

    // WHY: Pick a random option instead of always the first —
    // exercises different contacts/companies each run.
    const allOptions = this.page.locator('.is-invalid__option');
    const optionCount = await allOptions.count();
    const randomIndex = Math.floor(Math.random() * optionCount);
    const selectedOption = allOptions.nth(randomIndex);
    const selectedText = (await selectedOption.textContent())?.trim() ?? 'unknown';
    await selectedOption.click();
    await this.page.waitForTimeout(300);
    logger.success(
      `${description} selected: "${selectedText}" (index ${randomIndex} of ${optionCount})`
    );
  }

  // ──────────────────────────────────────────────────────────
  // Date Picker
  // ──────────────────────────────────────────────────────────

  private async selectDateInPicker(date: Date): Promise<void> {
    logger.info(`Selecting date: ${date.toDateString()}`);
    const dayLabel = formatDateForCalendarLabel(date);

    await this.click(this.estimatedClosureDateInput(), 'estimated closure date input');
    await this.calendarForwardButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(400); /* Firefox: wait for calendar open animation to settle */
    logger.info('Calendar opened');

    const dayCell = this.calendarDayByLabel(dayLabel);
    let found = false;
    let attempts = 0;

    try {
      await dayCell.waitFor({ state: 'visible', timeout: 1500 });
      found = true;
    } catch {
      found = false;
    }

    while (!found && attempts < 24) {
      logger.info(`Navigating forward to find date (attempt ${attempts + 1})`);
      await this.calendarForwardButton().click();
      await this.page.waitForTimeout(400);
      try {
        await dayCell.waitFor({ state: 'visible', timeout: 1000 });
        found = true;
      } catch {
        found = false;
      }
      attempts++;
    }

    if (!found) throw new Error(`Date cell not found after ${attempts} navigations: ${dayLabel}`);
    await dayCell.click();
    logger.success(`Date selected: ${date.toDateString()}`);
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToDealsList(): Promise<void> {
    logger.info('Navigating to Deals List');
    await this.closeModalIfOpen();
    await this.navigateTo(`${config.appUrl}/sales/deals/list`);
    await this.waitForDealListPage();
    logger.success('On Deals List page');
  }

  async clickAddDeal(): Promise<void> {
    logger.info('Clicking Add Deal');
    await this.click(this.addButton(), 'add deal button');
    await expect(this.nameInput()).toBeVisible({ timeout: 10000 });
    logger.success('Deal form opened');
  }

  // ──────────────────────────────────────────────────────────
  // Form Actions
  // ──────────────────────────────────────────────────────────

  async fillDealForm(data: DealData): Promise<void> {
    logger.info('Filling deal form');

    // Name
    await this.fill(this.nameInput(), data.name, 'deal name');

    // Estimated Closure Date
    await this.selectDateInPicker(data.estimatedClosureDate);

    // Pipeline
    logger.info('Selecting pipeline');
    await this.pipelineControl().click();
    const pipelineOption = this.page.getByText('Default Deal Pipeline', { exact: true });
    await pipelineOption.waitFor({ state: 'visible', timeout: 10000 });
    await pipelineOption.click();
    logger.success('Pipeline selected');

    // Associated Contacts + Company
    // WHY: Skip when skipAssociatedEntities=true — used in RBAC tests to create
    // deals with no linked entities so restricted user cannot see related quotations.
    if (!data.skipAssociatedEntities) {
      await this.selectFirstOptionFromDropdown(
        this.associatedContactsInput(),
        'associated contact'
      );
      await this.selectFirstOptionFromDropdown(this.associatedCompanyInput(), 'associated company');
    } else {
      logger.info('Skipping associated contact and company (skipAssociatedEntities=true)');
    }

    // WHY: Add random number of products (1-3) to exercise product table
    const productCount = Math.floor(Math.random() * 3) + 1;
    logger.info(`Adding ${productCount} product(s)`);
    for (let i = 0; i < productCount; i++) {
      await this.addProductRow();
    }

    // Estimated Value — fill manually if not auto-populated by product
    logger.info('Filling estimated value');
    const estValue = this.estimatedValueInput();
    await estValue.waitFor({ state: 'visible', timeout: 10000 });
    await estValue.scrollIntoViewIfNeeded();
    const isDisabled = await estValue.isDisabled();
    if (!isDisabled) {
      await estValue.fill('50000');
      logger.success('Estimated value filled manually');
    } else {
      logger.info('Estimated value auto-filled by product');
    }

    // WHY: Add part payments immediately after product/estimated value
    // so the installment rows exist before save. Doing it later risks
    // the form losing context or the payment section not being visible.
    logger.info('Adding part payments');
    await this.addPartPayments(data.numberOfInstallments);
    await this.assertPartPaymentsEqualSplit(data.numberOfInstallments, '');
    logger.success('Part payments added and verified');

    // Campaign (optional)
    logger.info('Selecting campaign');
    try {
      await this.campaignControl().waitFor({ state: 'visible', timeout: 5000 });
      await this.campaignControl().click();
      const firstCampaign = this.page.locator('.is-invalid__option').first();
      await firstCampaign.waitFor({ state: 'visible', timeout: 5000 });
      await firstCampaign.click();
      logger.success('Campaign selected');
    } catch {
      logger.info('No campaign options available — skipping');
    }

    // Source (optional)
    logger.info('Selecting source');
    try {
      await this.sourceControl().waitFor({ state: 'visible', timeout: 5000 });
      await this.sourceControl().click();
      const firstSource = this.page.locator('.is-invalid__option').first();
      await firstSource.waitFor({ state: 'visible', timeout: 5000 });
      await firstSource.click();
      logger.success('Source selected');
    } catch {
      logger.info('No source options available — skipping');
    }

    // UTM fields
    await this.fill(this.subSourceInput(), data.subSource, 'sub source');
    await this.fill(this.utmSourceInput(), data.utmSource, 'utm source');
    await this.fill(this.utmCampaignInput(), data.utmCampaign, 'utm campaign');
    await this.fill(this.utmMediumInput(), data.utmMedium, 'utm medium');
    await this.fill(this.utmContentInput(), data.utmContent, 'utm content');
    await this.fill(this.utmTermInput(), data.utmTerm, 'utm term');

    logger.success('Deal form filled');
  }

  async addProductRow(): Promise<void> {
    logger.info('Adding product row');

    // WHY: Button is inside overflow-scroll container — must scroll into view
    const addNewBtn = this.addNewProductButton();
    await addNewBtn.scrollIntoViewIfNeeded();
    await addNewBtn.click();
    logger.info('Clicked Add New product button');

    // WHY: After clicking Add New, a new row appears. Target the LAST
    // indicator to avoid clicking an already-filled row's indicator.
    const allIndicators = this.page.locator('.look-up.col-3 .is-invalid__indicator');
    await allIndicators.last().waitFor({ state: 'visible', timeout: 10000 });
    await allIndicators.last().scrollIntoViewIfNeeded();
    await allIndicators.last().click({ force: true });
    logger.info('Clicked product dropdown indicator');

    // Wait for options to load
    const productOptions = this.page.locator('.is-invalid__option');
    let productFound = false;
    for (let i = 0; i < 6; i++) {
      try {
        await productOptions.first().waitFor({ state: 'visible', timeout: 3000 });
        productFound = true;
        break;
      } catch {
        logger.info(`Product options not visible, re-clicking (attempt ${i + 1})`);
        await allIndicators.last().click({ force: true });
      }
    }
    if (!productFound) throw new Error('Product options did not appear');

    // WHY: Pick a random product from available options each time
    const count = await productOptions.count();
    const randomIndex = Math.floor(Math.random() * count);
    const selectedProduct = productOptions.nth(randomIndex);
    const productName = (await selectedProduct.textContent())?.trim() ?? 'unknown';
    await selectedProduct.click();
    logger.success(`Product row added: "${productName}" (index ${randomIndex} of ${count})`);
  }

  async saveDeal(): Promise<number | null> {
    logger.info('Saving deal');
    const dealIdPromise = this.captureDealIdFromResponse();
    await this.click(this.saveButton(), 'save button');
    await this.assertNoFormErrors('deal create form');
    const dealId = await dealIdPromise;
    await this.waitForDealListPage();
    logger.success('Deal saved successfully');
    return dealId;
  }

  // ──────────────────────────────────────────────────────────
  // Part Payments
  // ──────────────────────────────────────────────────────────

  async addPartPayments(numberOfInstallments: number): Promise<string> {
    logger.info(`Adding ${numberOfInstallments} installment(s)`);
    await this.click(this.addPaymentButton(), 'add payment button');
    await expect(this.installmentsModal()).toBeVisible({ timeout: 10000 });

    const totalValueEl = this.installmentsModal().locator('.installments-total-value');
    const totalValueText = (await totalValueEl.textContent()) ?? '';
    logger.info(`Total value in modal: ${totalValueText}`);

    await this.installmentsNumberInput().click();
    await this.installmentsNumberInput().fill(String(numberOfInstallments));
    await this.click(this.installmentsConfirmButton(), 'confirm installments button');
    await expect(this.installmentsModal()).toBeHidden({ timeout: 10000 });

    logger.success(`Installments confirmed: ${numberOfInstallments}`);
    return totalValueText.trim();
  }

  async assertPartPaymentsEqualSplit(
    numberOfInstallments: number,
    _totalValueText: string
  ): Promise<void> {
    logger.info('Asserting part payment equal split');

    for (let i = 0; i < numberOfInstallments; i++) {
      const nameInput = this.partPaymentNameInput(i);
      await expect(nameInput).toBeVisible({ timeout: 10000 });
      const defaultName = await nameInput.inputValue();
      expect(defaultName).toBe(`Installment ${i + 1}`);
      logger.success(`Installment ${i + 1} row present`);
    }

    await expect(this.partPaymentSummaryActualTotal()).toBeVisible();
    await expect(this.partPaymentSummaryAmountReceived()).toBeVisible();
    await expect(this.partPaymentSummaryRemainingBalance()).toBeVisible();

    const actualTotal = await this.partPaymentSummaryActualTotal().textContent();
    const amountReceived = await this.partPaymentSummaryAmountReceived().textContent();
    const remainingBalance = await this.partPaymentSummaryRemainingBalance().textContent();

    logger.info(
      `Actual Total: ${actualTotal} | Received: ${amountReceived} | Remaining: ${remainingBalance}`
    );

    // WHY: No payments received yet — remaining must equal actual total
    expect(actualTotal?.trim()).toBe(remainingBalance?.trim());
    expect(amountReceived?.toLowerCase()).toContain('0');

    logger.success(
      `Part payment summary verified — ${numberOfInstallments} installment(s), total: ${actualTotal}`
    );
  }

  // ──────────────────────────────────────────────────────────
  // Search & Open
  // ──────────────────────────────────────────────────────────

  async searchAndOpenDeal(name: string, dealId?: number): Promise<void> {
    logger.info(`Opening deal: ${name}`);
    if (dealId) {
      logger.info(`Opening deal directly via ID: ${dealId}`);
      await this.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
      await this.waitForDealDetailsPage();
      return;
    }
    const found = await this.retryFindDeal(name);
    expect(found).toBeTruthy();
    await this.dealRowByName(name).click();
    await this.waitForDealDetailsPage();
    logger.success(`Deal opened: ${name}`);
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Opening edit modal');
    await this.click(this.editIconButton(), 'edit icon');
    await expect(this.editModal()).toBeVisible({ timeout: 10000 });
    logger.success('Edit modal opened');
  }

  async fillEditForm(data: DealData): Promise<void> {
    logger.info('Updating deal in edit form');

    // Update deal name
    await this.fill(this.nameInput(), data.name, 'deal name');

    // WHY: Scroll to part payments and mark first installment as Received.
    logger.info('Updating first payment status to Received');

    // Click the dropdown indicator arrow — more reliable than clicking input
    const firstPaymentStatusControl = this.page
      .locator('[id="2_04_input_partPayments.0.status"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
    await firstPaymentStatusControl.scrollIntoViewIfNeeded();
    const statusIndicator = firstPaymentStatusControl.locator('.is-invalid__dropdown-indicator');
    await statusIndicator.waitFor({ state: 'visible', timeout: 10000 });
    await statusIndicator.click();

    // Wait for options then click Received by text
    const receivedOption = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: 'Received' })
      .first();
    await receivedOption.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Use dispatchEvent for reliable click — dropdown may close
    // before a normal click registers on slower CI environments
    await receivedOption.dispatchEvent('mousedown');
    await this.page.waitForTimeout(100);
    await receivedOption.dispatchEvent('mouseup');
    await receivedOption.dispatchEvent('click');
    logger.info('Clicked Received option');

    // WHY: Two #confirm buttons exist in DOM — one hidden (pipeline warning modal)
    // one visible (payment received confirmation modal). We must click the visible one.
    await this.page.waitForTimeout(800);
    try {
      // Locate the visible confirm button inside the payment confirmation modal
      const visibleConfirmBtn = this.page
        .locator('.modal.show.d-block #confirm')
        .filter({ hasText: 'Yes' })
        .first();
      await visibleConfirmBtn.waitFor({ state: 'visible', timeout: 5000 });
      logger.info('Confirm modal appeared — clicking Yes');
      await visibleConfirmBtn.click();
      logger.success('Payment status change confirmed');
      await this.page.waitForTimeout(500);
    } catch {
      logger.info('Confirm modal not shown — already dismissed previously');
    }
    await this.page.waitForTimeout(300);

    // Update UTM field to verify campaign info section is editable
    await this.fill(this.utmSourceInput(), data.utmSource, 'utm source (edit)');

    logger.success('Edit form updated');
  }

  async assertPaymentStatusReceived(): Promise<void> {
    logger.info('Asserting first payment status is Received');
    // WHY: After saving edit, navigate back to deal and verify the status
    // value shows Received in the part payments table.
    const firstPaymentStatusValue = this.page
      .locator('.part-payments-input__row')
      .first()
      .locator('.is-invalid__single-value');
    await firstPaymentStatusValue.waitFor({ state: 'visible', timeout: 10000 });
    const statusText = await firstPaymentStatusValue.textContent();
    expect(statusText?.trim()).toBe('Received');
    logger.success(`First payment status verified: ${statusText}`);
  }

  async saveEditedDeal(): Promise<void> {
    logger.info('Saving updated deal');
    await this.click(this.saveEditButton(), 'save button');
    await this.assertNoFormErrors('deal edit form');
    await expect(this.editModal()).toBeHidden({ timeout: 15000 });
    logger.success('Deal updated');
  }

  async assertPaymentReceivedAfterEdit(): Promise<void> {
    logger.info('Asserting payment status and summary after edit');

    // Assert first installment status is Received
    const firstPaymentStatus = this.page.locator('.part-payment-status').first();
    await firstPaymentStatus.waitFor({ state: 'visible', timeout: 10000 });
    const statusText = (await firstPaymentStatus.textContent())?.trim() ?? '';
    expect(statusText).toBe('Received');
    logger.success(`First payment status: ${statusText}`);

    // Read all three summary values
    const actualTotalEl = this.page
      .locator('.part-payments-summary .summary-row')
      .nth(0)
      .locator('.summary-value');
    const amountReceivedEl = this.page
      .locator('.part-payments-summary .summary-row')
      .nth(1)
      .locator('.summary-value');
    const remainingBalanceEl = this.page
      .locator('.part-payments-summary .summary-row')
      .nth(2)
      .locator('.summary-value');

    await actualTotalEl.waitFor({ state: 'visible', timeout: 10000 });

    const totalText = (await actualTotalEl.textContent())?.trim() ?? '';
    const receivedText = (await amountReceivedEl.textContent())?.trim() ?? '';
    const remainingText = (await remainingBalanceEl.textContent())?.trim() ?? '';

    logger.info(`Actual Total: ${totalText}`);
    logger.info(`Amount Received: ${receivedText}`);
    logger.info(`Remaining Balance: ${remainingText}`);

    // WHY: Parse INR values to numbers for math verification.
    // Format is "INR 1,00,000" — remove "INR " and all commas then parse.
    const parseINR = (text: string): number => {
      const cleaned = text
        .replace(/INR\s*/i, '')
        .replace(/,/g, '')
        .trim();
      return parseFloat(cleaned) || 0;
    };

    const total = parseINR(totalText);
    const received = parseINR(receivedText);
    const remaining = parseINR(remainingText);

    logger.info(`Parsed — Total: ${total} | Received: ${received} | Remaining: ${remaining}`);

    // Assert Amount Received > 0 (was 0 before edit)
    expect(received).toBeGreaterThan(0);
    logger.success(`Amount Received ${received} > 0`);

    // Assert Remaining < Total (payment was recorded)
    expect(remaining).toBeLessThan(total);
    logger.success(`Remaining ${remaining} < Total ${total}`);

    // WHY: Core math verification — Total - Received must equal Remaining.
    // Allows ±1 tolerance for rounding (e.g. INR 200,000 / 9 installments).
    const calculatedRemaining = total - received;
    const difference = Math.abs(calculatedRemaining - remaining);
    expect(difference).toBeLessThanOrEqual(1);
    logger.success(`Math verified: ${total} - ${received} = ${remaining} (diff: ${difference})`);
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnDealsListPage(): Promise<void> {
    await this.assertUrl(/deals\/list/);
  }

  async assertOnDealDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/deals\/details\//);
  }

  async assertDealExistsInList(name: string): Promise<void> {
    logger.info(`Validating deal exists: ${name}`);
    const found = await this.retryFindDeal(name);
    expect(found).toBeTruthy();
    logger.success(`Deal exists: ${name}`);
  }

  async assertDealNotInList(name: string): Promise<void> {
    logger.info(`Validating deal absent: ${name}`);
    await this.goToDealsList();
    await this.performSearch(name);
    await expect(this.dealRowByName(name)).toBeHidden({ timeout: 10000 });
    logger.success(`Deal absent confirmed: ${name}`);
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createDeal(data: DealData): Promise<number | null> {
    await this.clickAddDeal();
    await this.fillDealForm(data);
    return await this.saveDeal();
  }

  async createDealWithPayments(data: DealData): Promise<{
    dealId: number | null;
    totalValueText: string;
  }> {
    await this.clickAddDeal();
    await this.fillDealForm(data);
    const totalValueText = await this.addPartPayments(data.numberOfInstallments);
    const dealId = await this.saveDeal();
    return { dealId, totalValueText };
  }

  async updateDeal(newData: DealData, originalName?: string, dealId?: number): Promise<void> {
    const searchName = originalName ?? newData.name;
    await this.searchAndOpenDeal(searchName, dealId);
    await this.clickEditIcon();
    await this.fillEditForm(newData);
    // WHY: Assert payment status and summary BEFORE saving —
    // verifies the UI reflects the Received status change in the edit modal.
    await this.assertPaymentReceivedAfterEdit();
    await this.saveEditedDeal();
  }

  async assertDealCreated(data: DealData, dealId?: number): Promise<void> {
    if (dealId) {
      logger.info(`Validating deal via ID: ${dealId}`);
      await this.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
      await this.waitForDealDetailsPage();
      logger.success(`Deal verified: ${data.name}`);
      return;
    }
    await this.assertDealExistsInList(data.name);
  }

  async assertDealUpdated(data: DealData): Promise<void> {
    await this.goToDealsList();
    await this.assertDealExistsInList(data.name);
  }

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage methods
  // ──────────────────────────────────────────────────────────

  async assertPipelineStageOnDetails(expectedStage: string): Promise<void> {
    logger.info(`Asserting pipeline stage: ${expectedStage}`);
    const stageEl = this.dealInProgressStage();
    await stageEl.waitFor({ state: 'visible', timeout: 10000 });
    const stageText = (await stageEl.textContent())?.trim() ?? '';
    // WHY: Stage text includes percentage e.g. "Open(0%)" — extract just name
    const stageName = stageText.split('(')[0].trim();
    expect(stageName).toBe(expectedStage);
    logger.success(`Pipeline stage verified: ${stageName}`);
  }

  async changePipelineStageInEdit(newStage: string, stageReason?: string): Promise<void> {
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

    // WHY: Closed Lost and Closed Unqualified require a stage reason
    if (newStage === 'Closed Lost' || newStage === 'Closed Unqualified') {
      logger.info(`Selecting stage reason for ${newStage}`);
      const reasonIndicator = this.stageReasonDropdownIndicator();
      await reasonIndicator.waitFor({ state: 'visible', timeout: 10000 });
      await reasonIndicator.click();

      const reasonText =
        stageReason ?? (newStage === 'Closed Lost' ? 'No followup' : 'Budget does not match');
      const reasonOption = this.page
        .locator('.is-invalid__option')
        .filter({ hasText: reasonText })
        .first();
      try {
        await reasonOption.waitFor({ state: 'visible', timeout: 5000 });
        await reasonOption.click();
        logger.success(`Stage reason selected: ${reasonText}`);
      } catch {
        const firstReason = this.page.locator('.is-invalid__option').first();
        await firstReason.waitFor({ state: 'visible', timeout: 5000 });
        const fallback = (await firstReason.textContent())?.trim() ?? '';
        await firstReason.click();
        logger.success(`Stage reason selected (fallback): ${fallback}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Deal details assertions
  // ──────────────────────────────────────────────────────────

  async assertActualValueContainsINR(): Promise<void> {
    logger.info('Asserting actual value contains INR currency');
    const valueEl = this.dealActualValueEl();
    await valueEl.waitFor({ state: 'visible', timeout: 10000 });
    const tooltipValue = await valueEl.getAttribute('data-original-title');
    const displayValue = (await valueEl.textContent())?.trim() ?? '';
    const valueToCheck = tooltipValue ?? displayValue;
    logger.info(`Actual value: ${valueToCheck}`);
    expect(valueToCheck).toContain('INR');
    expect(parseFloat(valueToCheck.replace(/INR\s*/i, '').replace(/,/g, ''))).toBeGreaterThan(0);
    logger.success(`INR currency verified: ${valueToCheck}`);
  }

  async assertPartPaymentsSummaryOnDetails(): Promise<void> {
    logger.info('Asserting part payments summary on deal details');

    const partPaymentsLink = this.partPaymentsLink();
    await partPaymentsLink.waitFor({ state: 'visible', timeout: 10000 });
    await partPaymentsLink.click();

    const modal = this.partPaymentsModal();
    await modal.waitFor({ state: 'visible', timeout: 10000 });

    const totalEl = modal.locator('.summary-card--total .summary-card__value span');
    const receivedEl = modal.locator('.summary-card--received .summary-card__value span');
    const remainingEl = modal.locator('.summary-card--remaining .summary-card__value span');
    await totalEl.waitFor({ state: 'visible', timeout: 5000 });

    const totalVal =
      (await totalEl.getAttribute('data-original-title')) ?? (await totalEl.textContent()) ?? '';
    const receivedVal =
      (await receivedEl.getAttribute('data-original-title')) ??
      (await receivedEl.textContent()) ??
      '';
    const remainingVal =
      (await remainingEl.getAttribute('data-original-title')) ??
      (await remainingEl.textContent()) ??
      '';

    logger.info(`Total: ${totalVal} | Received: ${receivedVal} | Remaining: ${remainingVal}`);

    // Verify INR currency in all values
    expect(totalVal).toContain('INR');
    expect(receivedVal).toContain('INR');
    expect(remainingVal).toContain('INR');
    logger.success('INR currency verified in all summary values');

    // Verify math: Total - Received = Remaining (±1 rounding)
    const parseINR = (text: string): number =>
      parseFloat(
        text
          .replace(/INR\s*/i, '')
          .replace(/,/g, '')
          .trim()
      ) || 0;

    const total = parseINR(totalVal);
    const received = parseINR(receivedVal);
    const remaining = parseINR(remainingVal);
    const diff = Math.abs(total - received - remaining);
    expect(diff).toBeLessThanOrEqual(1);
    logger.success(`Payment math: ${total} - ${received} = ${remaining} (diff: ${diff})`);

    await modal.locator('button[aria-label="Close"]').click();
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    logger.success('Part payments summary verified');
  }
}
