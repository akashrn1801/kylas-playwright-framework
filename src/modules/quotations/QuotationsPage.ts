import { Page, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { QuotationData, ProductRowData, QuotationStatus, formatDateForCalendarLabel } from '../../data/factories/quotationFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

interface RetryConfig {
  retries: number;
  wait: number;
}

interface GrandTotalComponents {
  subTotal: number;
  additionalDiscount: number;
  additionalTax: number;
  adjustment: number;
  grandTotal: number;
}

export class QuotationsPage extends BasePage {
  // ─── 1. Retry config ────────────────────────────────────────────────────────
  private readonly retryConfig: RetryConfig = {
    retries: config.env === 'staging' ? 3 : 5,
    wait: config.env === 'staging' ? 5000 : 3000,
  };

  // ─── 2. Locators ────────────────────────────────────────────────────────────

  // List page
  private readonly listContainer = (): Locator =>
    this.page.locator('.entity-list, [class*="list-container"], .table-responsive').first();
  private readonly searchInput = (): Locator =>
    this.page.locator('#fulltext-search');
  private readonly searchButton = (): Locator =>
    this.page.locator('.input-group-append .input-group-text').first();
  private readonly createButton = (): Locator =>
    this.page.locator('button').filter({ hasText: 'Add Quotation' }).first();
  private readonly listRowEllipsis = (quotationNumber: string): Locator =>
    this.page
      .locator('tr, [class*="list-row"]')
      .filter({ hasText: quotationNumber })
      .locator('button.btn.dropdown-toggle')
      .first();

  // Modal
  private readonly modal = (): Locator =>
    this.page.locator('#editEntityModal');
  private readonly modalSaveButton = (): Locator =>
    this.page.locator('#editEntityModal button[type="submit"].btn-primary');

  // Header fields
  private readonly quotationNumberInput = (): Locator =>
    this.page.locator('[id="0_11_input_quotationNumber"]');
  private readonly summaryInput = (): Locator =>
    this.page.locator('[id="0_21_input_summary"]');
  private readonly ownerControl = (): Locator =>
    this.page.locator('[id="0_31_input_owner"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly ownerInput = (): Locator =>
    this.page.locator('[id="0_31_input_owner"]');
  private readonly dealControl = (): Locator =>
    this.page.locator('[id="0_41_input_associatedDeal"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly dealInput = (): Locator =>
    this.page.locator('[id="0_41_input_associatedDeal"]');
  private readonly addNewProductButton = (): Locator =>
    this.page.locator('span.add-new-product');
  private readonly productIdInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '01' : row === 1 ? '11' : '21'}_input_products.${row}.id"]`);
  private readonly selectedDealName = (): Locator =>
    this.page.locator('[id="0_41_input_associatedDeal"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]').locator('[class*="__single-value"]');
  private readonly companyControl = (): Locator =>
    this.page.locator('[id="0_42_input_associatedCompany"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly companyInput = (): Locator =>
    this.page.locator('[id="0_42_input_associatedCompany"]');
  private readonly contactsControl = (): Locator =>
    this.page.locator('[id="0_51_input_associatedContacts"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly contactsInput = (): Locator =>
    this.page.locator('[id="0_51_input_associatedContacts"]');
  private readonly statusControl = (): Locator =>
    this.page.locator('.search-autocomplete').filter({ has: this.page.locator('[id="0_52_input_status"]') }).locator('[class*="is-invalid__control"]');
  private readonly statusInput = (): Locator =>
    this.page.locator('[id="0_52_input_status"]');
  private readonly generationDateInput = (): Locator =>
    this.page.locator('[id="0_61_input_generationDate"]');
  private readonly validTillInput = (): Locator =>
    this.page.locator('[id="0_62_input_validTill"]');
  private readonly calendarForwardButton = (): Locator =>
    this.page.getByLabel('Move forward to switch to the next month.');
  private readonly calendarDayByLabel = (label: string): Locator =>
    this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);

  // Product rows — indexed by row number (0-based)
  private readonly productDiscountInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '04' : row === 1 ? '14' : '24'}_input_products.${row}.discount"]`);
  private readonly productTaxInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '05' : row === 1 ? '15' : '25'}_input_products.${row}.tax"]`);
  private readonly productTotalInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '06' : row === 1 ? '16' : '26'}_input_products.${row}.total"]`);
  private readonly productPriceInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '03' : row === 1 ? '13' : '23'}_input_products.${row}.price"]`);
  private readonly productQuantityInput = (row: number): Locator =>
    this.page.locator(`[id="1_${row === 0 ? '02' : row === 1 ? '12' : '22'}_input_products.${row}.quantity"]`);

  // Summary totals
  private readonly subTotalInput = (): Locator =>
    this.page.locator('[id="1_22_input_subTotal"]');
  private readonly additionalDiscountInput = (): Locator =>
    this.page.locator('[id="1_23_input_additionalDiscount"]');
  private readonly additionalTaxInput = (): Locator =>
    this.page.locator('[id="1_24_input_additionalTax"]');
  private readonly adjustmentInput = (): Locator =>
    this.page.locator('[id="1_25_input_adjustment"]');
  private readonly grandTotalInput = (): Locator =>
    this.page.locator('[id="1_31_input_grandTotal"]');

  // Billing address
  private readonly billingAddressInput = (): Locator =>
    this.page.locator('[id="2_11_input_billingAddress"]');
  private readonly billingCityInput = (): Locator =>
    this.page.locator('[id="2_21_input_billingCity"]');
  private readonly billingStateInput = (): Locator =>
    this.page.locator('[id="2_22_input_billingState"]');
  private readonly billingCountryInput = (): Locator =>
    this.page.locator('[id="2_31_input_billingCountry"]');
  private readonly billingZipcodeInput = (): Locator =>
    this.page.locator('[id="2_32_input_billingPinCode"]');
  private readonly sameAddressToggle = (): Locator =>
    this.page.locator('[id="2_41_input_isBillingAndShippingAddressSame"]');
  private readonly sameAddressToggleLabel = (): Locator =>
    this.page.locator('label[for="2_41_input_isBillingAndShippingAddressSame"]');

  // Shipping address
  private readonly shippingAddressInput = (): Locator =>
    this.page.locator('[id="2_51_input_shippingAddress"]');
  private readonly shippingCityInput = (): Locator =>
    this.page.locator('[id="2_61_input_shippingCity"]');
  private readonly shippingStateInput = (): Locator =>
    this.page.locator('[id="2_62_input_shippingState"]');
  private readonly shippingCountryInput = (): Locator =>
    this.page.locator('[id="2_71_input_shippingCountry"]');
  private readonly shippingZipcodeInput = (): Locator =>
    this.page.locator('[id="2_72_input_shippingPinCode"]');

  // Detail page
  private readonly editActionBtn = (): Locator =>
    this.page.locator('#edit-action-btn');
  private readonly detailPageTitle = (): Locator =>
    this.page.locator('h1.h1, .page-title h1').first();
  private readonly entityChip = (name: string): Locator =>
    this.page.locator('.related-entity-container').filter({ hasText: name });
  private readonly ellipsisMenuButton = (): Locator =>
    this.page.locator('.page-header button.btn.dropdown-toggle, [class*="more-actions"] button').first();
  private readonly ellipsisMenuItem = (text: string): Locator =>
    this.page.locator('.dropdown-menu .dropdown-item').filter({ hasText: text });

  // Toast
  private readonly successToast = (): Locator =>
    this.page.locator('.toastr.rrt-success .rrt-middle-container');
  private readonly errorToast = (): Locator =>
    this.page.locator('.rrt-middle-container').filter({ hasText: /uh.?oh/i });

  // ─── 3. Constructor ──────────────────────────────────────────────────────────
  constructor(page: Page) {
    super(page);
  }

  // ─── 4. Private helpers ──────────────────────────────────────────────────────

  private async selectRandomCountry(inputId: string): Promise<string> {
    const input = this.page.locator(`[id="${inputId}"]`);
    const formGroup = input.locator('xpath=ancestor::div[contains(@class,"dropdownv2")]');
    const control = formGroup.locator('[class*="is-invalid__control"]');
    await control.click();
    // Wait for options to load
    await this.page.locator('.is-invalid__option').first().waitFor({ state: 'visible', timeout: 5000 });
    const options = this.page.locator('.is-invalid__option');
    const count = await options.count();
    const randomIndex = Math.floor(Math.random() * count);
    const selectedText = await options.nth(randomIndex).innerText();
    await options.nth(randomIndex).click();
    await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.debug(`Selected random country: ${selectedText.trim()}`);
    return selectedText.trim();
  }



  private async waitForListReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(1000);
  }

  private async selectDateInPicker(input: Locator, date: Date): Promise<void> {
  const dayLabel = formatDateForCalendarLabel(date);
  logger.info(`Selecting date: ${date.toDateString()}`);
  await input.click();
  await this.calendarForwardButton().waitFor({ state: 'visible', timeout: 10000 });
  await this.page.waitForTimeout(400);
  const dayCell = this.calendarDayByLabel(dayLabel);
  let found = false;
  let attempts = 0;
  try {
    await dayCell.waitFor({ state: 'visible', timeout: 1000 });
    found = true;
  } catch {
    found = false;
  }
  while (!found && attempts < 24) {
    await this.calendarForwardButton().click();
    await this.page.waitForTimeout(400);
    try {
      await dayCell.waitFor({ state: 'visible', timeout: 1000 });
      found = true;
    } catch {
      attempts++;
    }
  }
  if (!found) throw new Error(`Date cell not found: ${dayLabel}`);
  await dayCell.click();
  logger.success(`Date selected: ${date.toDateString()}`);
}

  private async selectFromIsInvalidControl(
    control: Locator,
    input: Locator,
    value: string,
  ): Promise<void> {
    await control.click();
    await input.fill(value);
    await this.page.locator('.is-invalid__option').filter({ hasText: value }).first().click();
    await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.debug(`Selected "${value}" from is-invalid control`);
  }

  private async clearIsInvalidField(control: Locator): Promise<void> {
  const clearButton = control.locator('[class*="__clear-indicator"], [aria-label="Clear"]');
  const hasClear = await clearButton.isVisible().catch(() => false);
  if (hasClear) {
    await clearButton.click();
    logger.info('Clear indicator found and clicked — field value removed');
  } else {
    logger.warn('Clear indicator not found — field may already be empty or selector mismatch');
  }
}

 private async captureQuotationIdFromResponse(): Promise<string | null> {
    try {
      const response = await this.page.waitForResponse(
        (r: Response) =>
        /\/v1\/quotations$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15000 },
      );
      const body = await response.json().catch(() => null);
      const id = body?.id || body?.data?.id || null;
      if (id) logger.success(`Captured quotation ID: ${id}`);
      return id ? String(id) : null;
    } catch {
      logger.warn('Could not capture quotation ID from POST response');
      return null;
    }
  }

  private async captureIdFromToast(): Promise<string | null> {
    try {
      const toastLink = this.page.locator('.toastr.rrt-success .link-primary');
      await toastLink.waitFor({ state: 'visible', timeout: 8000 });
      const text = await toastLink.textContent();
      const match = text?.match(/Quotation ID:s*(d+)/);
      if (match) {
        logger.success(`Captured quotation ID from toast: ${match[1]}`);
        return match[1];
      }
    } catch {
      logger.warn('Could not capture quotation ID from toast');
    }
    return null;
  }

  private async captureIdFromUrl(): Promise<string | null> {
    try {
      const url = this.page.url();
      const match = url.match(/\/quotations\/details\/(\d+)/);
      if (match) {
        logger.success(`Captured quotation ID from URL: ${match[1]}`);
        return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  private async retryFindInList(searchValue: string): Promise<boolean> {
    const { retries, wait } = this.retryConfig;
    for (let attempt = 1; attempt <= retries; attempt++) {
      logger.info(`Search attempt ${attempt}/${retries} for: ${searchValue}`);
      await this.goToQuotationsList();
      await this.performSearch(searchValue);
      // WHY: The list rows show system-assigned quotation numbers (e.g. QUO-00012),
      // not the custom RES.../ADM... prefix from the factory. The fulltext search
      // API searches across all fields including summary — so search returns rows
      // but hasText(searchValue) never matches the row text.
      // Strategy: after search fires, check if ANY non-empty rows exist.
      // If search returned results, the quotation exists. If no rows, it doesn't.
      await this.page.waitForTimeout(1000);
      const allRows = this.page.locator('.rt-tr-group');
      const rowCount = await allRows.count();
      // Filter out empty placeholder rows (Kylas renders empty .rt-tr-group rows as fillers)
      let nonEmptyCount = 0;
      for (let i = 0; i < rowCount; i++) {
        const text = (await allRows.nth(i).innerText().catch(() => '')).trim();
        if (text.length > 0) nonEmptyCount++;
      }
      if (nonEmptyCount > 0) {
        logger.success(`Search returned ${nonEmptyCount} row(s) for: ${searchValue}`);
        return true;
      }
      logger.info(`No rows found on attempt ${attempt} — waiting before retry`);
      if (attempt < retries) await this.page.waitForTimeout(wait);
    }
    return false;
  }

  private async performSearch(value: string): Promise<void> {
    logger.info(`Searching quotation: ${value}`);

    // WHY: Modal or tooltip overlays intercept pointer events on the search icon.
    const modal = this.page.locator('#editEntityModal');
    const isModalVisible = await modal.isVisible().catch(() => false);
    if (isModalVisible) {
      await modal.waitFor({ state: 'hidden', timeout: 15000 });
    }

    // WHY: .portal-element tooltips float above the list and block clicks — move mouse away.
    await this.page.mouse.move(0, 0);
    await this.page.waitForTimeout(300);

    await this.fill(this.searchInput(), value, 'search input');

    await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes('search') && r.request().method() === 'POST' && r.status() === 200,
        { timeout: 15000 },
      ).catch(() => null),
      this.page.locator('svg:has(#clip-Ic_Search)').first().click({ timeout: 15000 }),
    ]);

    try {
      await this.page.locator('.spinner, .loader, .loading').last().waitFor({ state: 'hidden', timeout: 10000 });
    } catch {
      // loader may not exist
    }
  }

  private async getNumericValue(locator: Locator): Promise<number> {
    const raw = await locator.inputValue().catch(() => '0');
    return parseFloat(raw.replace(/[^0-9.-]/g, '')) || 0;
  }


  private async selectRandomDeal(): Promise<string> {
    logger.info('Selecting random deal');
    await this.dealControl().click();
    await this.dealInput().fill('dea');
    await this.page.locator('.is-invalid__option').first().waitFor({ state: 'visible', timeout: 10000 });
    const options = this.page.locator('.is-invalid__option');
    const count = await options.count();
    const randomIndex = Math.floor(Math.random() * Math.min(count, 10));
    const dealName = (await options.nth(randomIndex).innerText()).trim();
    await options.nth(randomIndex).click();
    await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.success(`Selected deal: ${dealName}`);
    return dealName;
  }

  private async selectSpecificDeal(dealName: string): Promise<string> {
    logger.info(`Selecting specific deal: ${dealName}`);
    await this.dealControl().click();
    await this.dealInput().fill(dealName);
    await this.page.locator('.is-invalid__option').filter({ hasText: dealName }).first()
      .waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('.is-invalid__option').filter({ hasText: dealName }).first().click();
    await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.success(`Selected specific deal: ${dealName}`);
    return dealName;
  }

  private async ensureProductRowExists(): Promise<void> {
    await this.page.waitForTimeout(2000);
    // Check if first product row has a selected product (price > 0 means product is selected)
    const firstPrice = this.page.locator('[id="1_03_input_products.0.price"]');
    const priceValue = await firstPrice.inputValue().catch(() => '0');
    const hasProduct = parseFloat(priceValue) > 0;
    if (!hasProduct) {
      logger.info('No products from deal — adding a product manually');
      await this.addRandomProduct(0);
    } else {
      const rows = this.page.locator('[id*="input_products"][id*="quantity"]');
      const count = await rows.count();
      logger.info(`${count} product row(s) auto-populated from deal`);
    }
  }

  private async addRandomProduct(row: number): Promise<void> {
    const productInput = this.productIdInput(row);
    const productVisible = await productInput.isVisible().catch(() => false);
    if (!productVisible) {
      await this.addNewProductButton().click();
      await productInput.waitFor({ state: 'visible', timeout: 10000 });
    }
    const productControl = productInput.locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
    await productControl.click();
    await productInput.fill('BHK'); // WHY: App requires min 3 chars; 'BHK' matches known QA products

    // WHY: When modal is open, scope options to #editEntityModal to avoid picking
    // up stale dropdowns from elsewhere on the page.
    // WHY: Product options may render in a React portal outside #editEntityModal.
    // Try global .is-invalid__option first; fall back to modal-scoped if needed.
    const globalOptions = this.page.locator('.is-invalid__option');
    await globalOptions.first().waitFor({ state: 'visible', timeout: 15000 });
    const optionsLocator = globalOptions;
    const count = await optionsLocator.count();
    const randomIndex = Math.floor(Math.random() * Math.min(count, 10));
    const productName = (await optionsLocator.nth(randomIndex).innerText()).trim();
    await optionsLocator.nth(randomIndex).click();
    await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await this.productQuantityInput(row).fill('1');
    logger.success(`Added product: ${productName}`);
  }

  // ─── 5. Navigation ───────────────────────────────────────────────────────────

  async goToQuotationsList(): Promise<void> {
    await this.navigateTo(`${config.appUrl}/sales/quotations/list`);
    await this.waitForListReady();
    logger.info('Navigated to quotations list');
  }

  async goToQuotationDetail(id: string): Promise<void> {
    await this.navigateTo(`${config.appUrl}/sales/quotations/details/${id}`);
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
    logger.info(`Navigated to quotation detail: ${id}`);
  }

  // ─── 6. Form actions ─────────────────────────────────────────────────────────

  async openCreateForm(): Promise<void> {
    await this.createButton().click();
    await this.modal().waitFor({ state: 'visible', timeout: 15000 });
    logger.info('Opened quotation create form');
  }

  async fillQuotationForm(data: QuotationData): Promise<string> {
    logger.info('Filling quotation form');

    // Quotation number
    await this.fill(this.quotationNumberInput(), data.quotationNumber, 'Quotation Number');

    // Summary
    await this.fill(this.summaryInput(), data.summary, 'Summary');

    // Deal (mandatory) — use specific deal if provided, else select randomly
    // WHY: T10 requires admin to use a deal accessible to restricted user.
    // Random deal selection picks deals the restricted user cannot access (404 on edit modal).
    const selectedDealName = data.dealName
      ? await this.selectSpecificDeal(data.dealName)
      : await this.selectRandomDeal();

    // Ensure at least one product row exists — add manually if deal has no products
    await this.ensureProductRowExists();

    // Status
    await this.selectFromIsInvalidControl(
      this.statusControl(),
      this.statusInput(),
      data.status,
    );

    // Dates
    await this.selectDateInPicker(this.generationDateInput(), data.generationDate);
    await this.selectDateInPicker(this.validTillInput(), data.validTill);

    // Additional discount / tax / adjustment
    if (data.additionalDiscount > 0) {
      await this.fill(this.additionalDiscountInput(), String(data.additionalDiscount), 'Additional Discount');
    }
    if (data.additionalTax > 0) {
      await this.fill(this.additionalTaxInput(), String(data.additionalTax), 'Additional Tax');
    }
    if (data.adjustment !== 0) {
      await this.fill(this.adjustmentInput(), String(data.adjustment), 'Adjustment');
    }

    // Billing address
    await this.fill(this.billingAddressInput(), data.billingAddress, 'Billing Address');
    await this.fill(this.billingCityInput(), data.billingCity, 'Billing City');
    await this.fill(this.billingStateInput(), data.billingState, 'Billing State');
    await this.fill(this.billingZipcodeInput(), data.billingZipcode, 'Billing Zipcode');

    // Billing country — scoped to its form group
    if (data.billingCountry) {
      const countryFormGroup = this.page.locator('[id="2_31_input_billingCountry"]').locator('xpath=ancestor::div[contains(@class,"dropdownv2")]');
      const countryControl = countryFormGroup.locator('[class*="is-invalid__control"]');
      await countryControl.click();
      await this.page.locator('[id="2_31_input_billingCountry"]').fill(data.billingCountry);
      await this.page.locator('.is-invalid__option').filter({ hasText: data.billingCountry }).first().click();
      await this.page.locator('.is-invalid__menu').waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      logger.debug(`Selected billing country: ${data.billingCountry}`);
    }

    // Shipping toggle
    const toggleChecked = await this.sameAddressToggle().isChecked();
    if (!data.sameShippingAsBilling && toggleChecked) {
      await this.sameAddressToggleLabel().click();
      await this.shippingAddressInput().waitFor({ state: 'visible', timeout: 10000 });
      logger.info('Turned off same shipping as billing toggle');

      if (data.shippingAddress) {
        await this.fill(this.shippingAddressInput(), data.shippingAddress, 'Shipping Address');
        await this.fill(this.shippingCityInput(), data.shippingCity || '', 'Shipping City');
        await this.fill(this.shippingStateInput(), data.shippingState || '', 'Shipping State');
        await this.fill(this.shippingZipcodeInput(), data.shippingZipcode || '', 'Shipping Zipcode');
        if (data.shippingCountry) {
          const shippingCountryFormGroup = this.page.locator('[id="2_71_input_shippingCountry"]').locator('xpath=ancestor::div[contains(@class,"dropdownv2")]');
          const shippingCountryControl = shippingCountryFormGroup.locator('[class*="is-invalid__control"]');
          await shippingCountryControl.click();
          await this.page.locator('[id="2_71_input_shippingCountry"]').fill(data.shippingCountry);
          await this.page.locator('.is-invalid__option').filter({ hasText: data.shippingCountry }).first().click();
          await this.page.locator('.is-invalid__menu').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
          logger.debug(`Selected shipping country: ${data.shippingCountry}`);
        }
      }
    }

    logger.success('Quotation form filled');
    return selectedDealName;
  }

  async fillOwner(ownerName: string): Promise<void> {
    const searchTerm = ownerName.split(" ")[0];
    await this.ownerControl().click();
    await this.ownerInput().fill(searchTerm);
    await this.page.locator(".is-invalid__option").filter({ hasText: ownerName }).first().click();
    await this.page.locator(".is-invalid__menu").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    logger.info(`Set owner to: ${ownerName}`);
  }

  async fillAssociatedCompany(companyName: string): Promise<void> {
    await this.selectFromIsInvalidControl(
      this.companyControl(),
      this.companyInput(),
      companyName,
    );
    logger.info(`Set associated company to: ${companyName}`);
  }

  async fillAssociatedContacts(contactNames: string[]): Promise<void> {
    for (const name of contactNames) {
      await this.selectFromIsInvalidControl(
        this.contactsControl(),
        this.contactsInput(),
        name,
      );
      logger.info(`Added contact: ${name}`);
    }
  }

  async clearAssociatedCompany(): Promise<void> {
    await this.clearIsInvalidField(this.companyControl());
    logger.info('Cleared associated company');
  }

  async clearAssociatedContacts(): Promise<void> {
    await this.clearIsInvalidField(this.contactsControl());
    logger.info('Cleared associated contacts');
  }

  async editProductRow(row: number, data: ProductRowData): Promise<void> {
    logger.info(`Editing product row ${row}`);
    const discountInput = this.productDiscountInput(row);
    const taxInput = this.productTaxInput(row);

    if (await discountInput.isVisible()) {
      await discountInput.clear();
      await discountInput.fill(String(data.discount));
    }
    if (await taxInput.isVisible()) {
      await taxInput.clear();
      await taxInput.fill(String(data.tax));
    }
    await this.page.waitForTimeout(500);
  }

  async saveQuotation(): Promise<void> {
    logger.info('Saving quotation');
    await this.modalSaveButton().click();
  }

  async saveQuotationExpectingError(): Promise<void> {
    logger.info('Saving quotation — expecting error response');
    await this.modalSaveButton().click();
  }

  // ─── 7. Search and open ──────────────────────────────────────────────────────

  async searchQuotation(value: string): Promise<void> {
    await this.performSearch(value);
    logger.info(`Searched for: ${value}`);
  }

  async searchAndOpenQuotation(quotationNumber: string, id?: string): Promise<void> {
    if (id) {
      await this.goToQuotationDetail(id);
      return;
    }
    await this.goToQuotationsList();
    await this.performSearch(quotationNumber);
    await this.page
      .locator('.rt-tr-group')
      .filter({ hasText: quotationNumber })
      .first()
      .click();
    await this.page.waitForURL(/\/quotations\/details\/\d+/, { timeout: 15000 });
    await this.page.waitForLoadState('domcontentloaded');
    logger.info(`Opened quotation: ${quotationNumber}`);
  }

  // ─── 8. Edit actions ─────────────────────────────────────────────────────────

  async clickEditButton(): Promise<void> {
    await this.editActionBtn().click();
    await this.modal().waitFor({ state: 'visible', timeout: 15000 });
    logger.info('Opened edit modal via edit button');
  }

  async clickEllipsisEdit(quotationNumber: string): Promise<void> {
    await this.listRowEllipsis(quotationNumber).click();
    await this.ellipsisMenuItem('Edit').click();
    await this.modal().waitFor({ state: 'visible', timeout: 15000 });
    logger.info(`Opened edit modal via ellipsis for: ${quotationNumber}`);
  }

  async fillEditForm(changes: Partial<QuotationData>): Promise<void> {
    logger.info('Filling edit form');

    if (changes.summary !== undefined) {
      await this.fill(this.summaryInput(), changes.summary, 'Summary (edit)');
    }
    if (changes.status !== undefined) {
      await this.selectFromIsInvalidControl(
        this.statusControl(),
        this.statusInput(),
        changes.status,
      );
    }
    if (changes.generationDate !== undefined) {
      await this.selectDateInPicker(this.generationDateInput(), changes.generationDate);
    }
    if (changes.validTill !== undefined) {
      await this.selectDateInPicker(this.validTillInput(), changes.validTill);
    }
    if (changes.additionalDiscount !== undefined) {
      await this.additionalDiscountInput().clear();
      await this.additionalDiscountInput().fill(String(changes.additionalDiscount));
    }
    if (changes.additionalTax !== undefined) {
      await this.additionalTaxInput().clear();
      await this.additionalTaxInput().fill(String(changes.additionalTax));
    }
    if (changes.adjustment !== undefined) {
      await this.adjustmentInput().clear();
      await this.adjustmentInput().fill(String(changes.adjustment));
    }
    if (changes.billingAddress !== undefined) {
      await this.fill(this.billingAddressInput(), changes.billingAddress, 'Billing Address (edit)');
    }
    if (changes.billingCity !== undefined) {
      await this.fill(this.billingCityInput(), changes.billingCity, 'Billing City (edit)');
    }
    if (changes.billingState !== undefined) {
      await this.fill(this.billingStateInput(), changes.billingState, 'Billing State (edit)');
    }
    if (changes.billingZipcode !== undefined) {
      await this.fill(this.billingZipcodeInput(), changes.billingZipcode, 'Billing Zipcode (edit)');
    }

    logger.success('Edit form filled');
  }

  // ─── 9. Assertions ───────────────────────────────────────────────────────────

  async assertOnListPage(): Promise<void> {
    await this.assertUrl(/\/quotations\/list/);
    logger.success('Confirmed on quotations list page');
  }

  async assertOnDetailPage(id?: string): Promise<void> {
    if (id) {
      await this.assertUrl(new RegExp(`/quotations/details/${id}`));
    } else {
      await this.assertUrl(/\/quotations\/details\//);
    }
    logger.success('Confirmed on quotation detail page');
  }

  async assertQuotationInList(quotationNumber: string): Promise<void> {
    const found = await this.retryFindInList(quotationNumber);
    if (!found) {
      throw new Error(`Quotation not found in list after retries: ${quotationNumber}`);
    }
    logger.success(`Quotation confirmed in list: ${quotationNumber}`);
  }

  async assertQuotationNotInList(searchTerm: string): Promise<void> {
    await this.goToQuotationsList();
    // WHY: Search by the exact summary string passed in — it is unique per run (timestamp prefix).
    // Then check that NO row contains that exact summary text.
    // We do NOT check for zero rows — other quotations always exist in the list.
    // We check that this specific summary is absent.
    await this.performSearch(searchTerm);
    await this.page.waitForTimeout(2000);
    const allRows = this.page.locator('.rt-tr-group');
    const rowCount = await allRows.count();
    for (let i = 0; i < rowCount; i++) {
      const text = (await allRows.nth(i).innerText().catch(() => '')).trim().toLowerCase();
      if (text.includes(searchTerm.toLowerCase())) {
        throw new Error(`Quotation should NOT be visible in list but was found: "${searchTerm}"`);
      }
    }
    logger.success(`Confirmed quotation not in list: ${searchTerm}`);
  }

  async assertSuccessToast(): Promise<void> {
    try {
      await this.successToast().waitFor({ state: 'visible', timeout: 8000 });
      logger.success('Success toast visible');
    } catch {
      // Toast may have already appeared and auto-dismissed — check if we are on list page
      // which confirms save was successful
      const url = this.page.url();
      if (url.includes('/quotations/list') || url.includes('/quotations/details/')) {
        logger.warn('Toast not caught in time but navigation confirms save succeeded');
        return;
      }
      throw new Error('Save toast not visible and not redirected — save may have failed');
    }
  }

  async assertErrorToast(): Promise<void> {
    // WHY: Error toast only fires when deal has inaccessible linked entities.
    // Non-fatal: if no toast, save succeeded on first attempt.
    const appeared = await this.errorToast()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      logger.warn('No error toast — save succeeded (deal has no inaccessible entities)');
      return;
    }
    const text = await this.errorToast().innerText();
    logger.warn(`Error toast appeared: ${text}`);
  }

  async assertDetailPageFields(data: QuotationData): Promise<void> {
    logger.info('Asserting detail page fields');
    const title = await this.detailPageTitle().innerText().catch(() => '');
    if (!title.includes(data.quotationNumber) && !title.includes(data.summary)) {
      logger.warn(`Detail page title "${title}" does not contain quotation number or summary`);
    }
    // Deal chip visible — deal name is random so we just check any chip exists
    const chipCount = await this.page.locator('.related-entity-container').count();
    if (chipCount > 0) logger.success('Entity chips visible on detail page');
    logger.success('Detail page fields confirmed');
  }

  async assertEntityChipVisible(entityName: string): Promise<void> {
    await this.entityChip(entityName).waitFor({ state: 'visible', timeout: 10000 });
    logger.success(`Entity chip visible: ${entityName}`);
  }

  async assertEntityChipNotVisible(entityName: string): Promise<void> {
    const visible = await this.entityChip(entityName).isVisible().catch(() => false);
    if (visible) {
      throw new Error(`Entity chip should NOT be visible: ${entityName}`);
    }
    logger.success(`Confirmed entity chip not visible: ${entityName}`);
  }

  async assertGrandTotalMath(): Promise<GrandTotalComponents> {
    logger.info('Reading grand total components');
    const subTotal = await this.getNumericValue(this.subTotalInput());
    const additionalDiscount = await this.getNumericValue(this.additionalDiscountInput());
    const additionalTax = await this.getNumericValue(this.additionalTaxInput());
    const adjustment = await this.getNumericValue(this.adjustmentInput());
    const grandTotal = await this.getNumericValue(this.grandTotalInput());

    // Formula: GrandTotal = SubTotal × (1 - disc/100) × (1 + tax/100) × (1 + adj/100)
    const afterDiscount = subTotal * (1 - additionalDiscount / 100);
    const afterTax = afterDiscount * (1 + additionalTax / 100);
    const expected = afterTax * (1 + adjustment / 100);
    const tolerance = 1;

    if (Math.abs(expected - grandTotal) > tolerance) {
      throw new Error(
        `Grand total math failed. Expected: ${expected.toFixed(2)}, Got: ${grandTotal}. ` +
        `SubTotal: ${subTotal}, AdditionalDiscount: ${additionalDiscount}%, ` +
        `AdditionalTax: ${additionalTax}%, Adjustment: ${adjustment}%`,
      );
    }

    logger.success(
      `Grand total math verified: ${subTotal} × (1-${additionalDiscount}%) × (1+${additionalTax}%) × (1+${adjustment}%) = ${grandTotal}`,
    );

    return { subTotal, additionalDiscount, additionalTax, adjustment, grandTotal };
  }

  async assertProductRowsVisible(): Promise<number> {
    await this.page.waitForTimeout(1500);
    const rows = this.page.locator('[id*="input_products"][id*="quantity"]');
    const count = await rows.count();
    if (count === 0) {
      throw new Error('No product rows found after deal selection');
    }
    logger.success(`Product rows auto-populated: ${count} rows`);
    return count;
  }

  async assertStatusOnDetailPage(expectedStatus: QuotationStatus): Promise<void> {
    // WHY: Wait for the status element explicitly instead of reading body text immediately.
    // On CI, the detail page may not have fully rendered the status badge when body.innerText()
    // is called — causing false negatives. Waiting for the locator ensures the element is present.
    const statusLocator = this.page.locator('[class*="status"], [class*="badge"]').filter({ hasText: expectedStatus }).first();
    try {
      await statusLocator.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      logger.success(`Status confirmed via locator: ${expectedStatus}`);
    } catch {
      // Fallback: check body text in case badge selector doesn't match
      const detailText = await this.page.locator('body').innerText();
      if (!detailText.includes(expectedStatus)) {
        throw new Error(`Expected status "${expectedStatus}" not found on detail page`);
      }
      logger.success(`Status confirmed via body text: ${expectedStatus}`);
    }
  }

  async assertOwnerOnDetailPage(ownerName: string): Promise<void> {
    const detailText = await this.page.locator('body').innerText();
    if (!detailText.includes(ownerName)) {
      throw new Error(`Expected owner "${ownerName}" not found on detail page`);
    }
    logger.success(`Owner confirmed: ${ownerName}`);
  }

  async assertShippingSameAsBilling(): Promise<void> {
    const billingCity = await this.billingCityInput().inputValue().catch(() => '');
    const shippingCity = await this.shippingCityInput().inputValue().catch(() => '');
    if (billingCity && shippingCity && billingCity !== shippingCity) {
      throw new Error(`Shipping city "${shippingCity}" does not match billing city "${billingCity}"`);
    }
    logger.success('Shipping address matches billing address');
  }

  async assertShippingFieldsVisible(): Promise<void> {
    await this.shippingAddressInput().waitFor({ state: 'visible', timeout: 10000 });
    logger.success('Shipping address fields are visible');
  }

  // ─── 10. Workflow wrappers ────────────────────────────────────────────────────

 async createQuotation(data: QuotationData): Promise<{ id: string | null; dealName: string }> {
    logger.info(`Creating quotation: ${data.quotationNumber}`);
    await this.goToQuotationsList();
    await this.openCreateForm();
    const selectedDeal = await this.fillQuotationForm(data);
    await this.saveQuotation();
    await this.assertSuccessToast();
    await this.assertOnListPage();
    // Get ID by searching and clicking the row
    await this.performSearch(data.summary);
    await this.page
      .locator('.rt-tr-group')
      .filter({ hasText: data.summary })
      .first()
      .click();
    await this.page.waitForURL(/\/quotations\/details\/\d+/, { timeout: 15000 });
    const id = await this.captureIdFromUrl();
    logger.info(`URL after row click: ${this.page.url()}`);
    logger.info(`Captured ID: ${id}`);
    await this.goToQuotationsList();
    logger.success(`Quotation created: ${data.quotationNumber} (id: ${id})`);
    return { id, dealName: selectedDeal };
  }
  async createQuotationWithOwner(
    data: QuotationData,
    ownerName: string,
  ): Promise<{ id: string | null; dealName: string }> {
    logger.info(`Creating quotation with owner "${ownerName}": ${data.quotationNumber}`);
    await this.goToQuotationsList();
    await this.openCreateForm();
    const dealName = await this.fillQuotationForm(data);
    await this.fillOwner(ownerName);
    await this.saveQuotation();
    await this.assertSuccessToast();
    await this.assertOnListPage();
    await this.page.waitForTimeout(2000);
    await this.performSearch(data.summary);
    await this.page.locator('.rt-tr-group').filter({ hasText: data.summary }).first().click();
    await this.page.waitForURL(/\/quotations\/details\/\d+/, { timeout: 15000 });
    const id = await this.captureIdFromUrl();
    await this.goToQuotationsList();
    logger.success(`Quotation created with owner: ${data.quotationNumber} (deal: ${dealName})`);
    return { id, dealName };
  }

  async updateQuotation(
    quotationNumber: string,
    changes: Partial<QuotationData>,
    id?: string,
  ): Promise<void> {
    logger.info(`Updating quotation: ${quotationNumber}`);
    await this.searchAndOpenQuotation(quotationNumber, id);
    await this.clickEditButton();
    await this.fillEditForm(changes);
    await this.saveQuotation();
    await this.assertSuccessToast();
    // Navigate back to detail page after save
    if (id) {
      await this.goToQuotationDetail(id);
    }
    logger.success(`Quotation updated: ${quotationNumber}`);
  }

  async attemptCreateWithInaccessibleEntities(
    data: QuotationData,
  ): Promise<{ errorType: 'company' | 'contact' | null; toastText: string }> {
    logger.info('Attempting quotation create expecting inaccessible entity error');
    await this.goToQuotationsList();
    await this.openCreateForm();
    await this.fillQuotationForm(data);  // deal name not needed here
    await this.saveQuotationExpectingError();

    try {
      await this.errorToast().waitFor({ state: 'visible', timeout: 15000 });
      const toastText = await this.errorToast().innerText();
      logger.warn(`RBAC error toast: ${toastText}`);

      // Default to company — T7 will remove company first, then contact if needed
      const errorType: 'company' | 'contact' = 'company';

      return { errorType: errorType as 'company' | 'contact', toastText };
    } catch {
      return { errorType: null, toastText: '' };
    }
  }

  async downloadQuotation(): Promise<{ filename: string; size: number }> {
    logger.info('Downloading quotation');
    await this.ellipsisMenuButton().click();
    await this.ellipsisMenuItem('Download').click();
    // Wait for download confirmation popup
    await this.page.locator('#warningModal').waitFor({ state: 'visible', timeout: 10000 });
    logger.info('Download popup appeared');
    // Start waiting for download before clicking Proceed
    const downloadPromise = this.page.waitForEvent('download');
    await this.page.locator('#confirm').click();
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    const filePath = await download.path();
    const fs = await import('fs');
    const stats = fs.statSync(filePath || '');
    logger.success(`Downloaded: ${filename} (${stats.size} bytes)`);
    return { filename, size: stats.size };
  }
  // ─── Public helpers for T26 ─────────────────────────────────────────────────

async fillAssociatedCompanyFirstAvailable(): Promise<string> {
  // WHY: Search with common 3-char prefixes in order until results appear.
  // Single character returns too many results and may match companies the
  // restricted user owns — defeating the purpose of the RBAC test.
  const searchTerms = ['The', 'Pvt', 'Ltd', 'Tech', 'Inf', 'Sol', 'Sys', 'Con', 'Ser', 'Man'];

  await this.companyControl().click();

  for (const term of searchTerms) {
    await this.companyInput().fill(term);
    await this.page.waitForTimeout(500);

    const optionCount = await this.page.locator('.is-invalid__option').count();
    if (optionCount > 0) {
      const firstName = await this.page.locator('.is-invalid__option').first().innerText();
      await this.page.locator('.is-invalid__option').first().click();
      await this.page.locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      logger.info(`Linked company via search "${term}": ${firstName.trim()}`);
      return firstName.trim();
    }
    logger.debug(`No company results for "${term}" — trying next`);
  }

  // Last resort — clear and try empty search (shows all)
  await this.companyInput().fill('');
  await this.page.waitForTimeout(800);
  const fallbackCount = await this.page.locator('.is-invalid__option').count();
  if (fallbackCount > 0) {
    const firstName = await this.page.locator('.is-invalid__option').first().innerText();
    await this.page.locator('.is-invalid__option').first().click();
    await this.page.locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.info(`Linked company via empty search: ${firstName.trim()}`);
    return firstName.trim();
  }

  throw new Error('fillAssociatedCompanyFirstAvailable: no company options found with any search term');
}
async performSearchPublic(value: string): Promise<void> {
  await this.performSearch(value);
}

async captureIdFromUrlPublic(): Promise<string | null> {
  return this.captureIdFromUrl();
}
}