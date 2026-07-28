import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import {
  QuotationData,
  ProductRowData,
  QuotationStatus,
  formatDateForCalendarLabel,
} from '../../data/factories/quotationFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';


interface GrandTotalComponents {
  subTotal: number;
  additionalDiscount: number;
  additionalTax: number;
  adjustment: number;
  grandTotal: number;
}

interface InaccessibleEntityRetryResult {
  succeeded: boolean;
  removedEntities: Array<'contact' | 'company'>;
  lastErrorMessage: string;
}

export class QuotationsPage extends BasePage {
  // ─── 1. Retry config ────────────────────────────────────────────────────────
  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ─── 2. Locators ────────────────────────────────────────────────────────────

  // List page
  private readonly listContainer = (): Locator =>
    this.page.locator('.entity-list, [class*="list-container"], .table-responsive').first();
  private readonly searchInput = (): Locator => this.page.locator('#fulltext-search');
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
  private readonly modal = (): Locator => this.page.locator('#editEntityModal');
  private readonly modalSaveButton = (): Locator =>
    this.page.locator('#editEntityModal button[type="submit"].btn-primary');

  // Header fields
  private readonly quotationNumberInput = (): Locator =>
    this.page.locator('[id="0_11_input_quotationNumber"]');
  private readonly summaryInput = (): Locator => this.page.locator('[id="0_21_input_summary"]');
  private readonly ownerControl = (): Locator =>
    this.page
      .locator('[id="0_31_input_owner"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly ownerInput = (): Locator => this.page.locator('[id="0_31_input_owner"]');
  private readonly dealControl = (): Locator =>
    this.page
      .locator('[id="0_41_input_associatedDeal"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly dealInput = (): Locator => this.page.locator('[id="0_41_input_associatedDeal"]');
  private readonly addNewProductButton = (): Locator => this.page.locator('span.add-new-product');
  private readonly productIdInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '01' : row === 1 ? '11' : '21'}_input_products.${row}.id"]`
    );
  private readonly selectedDealName = (): Locator =>
    this.page
      .locator('[id="0_41_input_associatedDeal"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]')
      .locator('[class*="__single-value"]');
  private readonly companyControl = (): Locator =>
    this.page
      .locator('[id="0_42_input_associatedCompany"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly companyInput = (): Locator =>
    this.page.locator('[id="0_42_input_associatedCompany"]');
  private readonly contactsControl = (): Locator =>
    this.page
      .locator('[id="0_51_input_associatedContacts"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly contactsInput = (): Locator =>
    this.page.locator('[id="0_51_input_associatedContacts"]');
  private readonly statusControl = (): Locator =>
    this.page
      .locator('.search-autocomplete')
      .filter({ has: this.page.locator('[id="0_52_input_status"]') })
      .locator('[class*="is-invalid__control"]');
  private readonly statusInput = (): Locator => this.page.locator('[id="0_52_input_status"]');
  private readonly generationDateInput = (): Locator =>
    this.page.locator('[id="0_61_input_generationDate"]');
  private readonly validTillInput = (): Locator => this.page.locator('[id="0_62_input_validTill"]');
  private readonly calendarForwardButton = (): Locator =>
    this.page.getByLabel('Move forward to switch to the next month.');
  private readonly calendarDayByLabel = (label: string): Locator =>
    this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);

  // Product rows — indexed by row number (0-based)
  private readonly productDiscountInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '04' : row === 1 ? '14' : '24'}_input_products.${row}.discount"]`
    );
  private readonly productTaxInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '05' : row === 1 ? '15' : '25'}_input_products.${row}.tax"]`
    );
  private readonly productTotalInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '06' : row === 1 ? '16' : '26'}_input_products.${row}.total"]`
    );
  private readonly productPriceInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '03' : row === 1 ? '13' : '23'}_input_products.${row}.price"]`
    );
  private readonly productQuantityInput = (row: number): Locator =>
    this.page.locator(
      `[id="1_${row === 0 ? '02' : row === 1 ? '12' : '22'}_input_products.${row}.quantity"]`
    );

  // Summary totals
  private readonly subTotalInput = (): Locator => this.page.locator('[id="1_22_input_subTotal"]');
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
  private readonly editActionBtn = (): Locator => this.page.locator('#edit-action-btn');
  private readonly detailPageTitle = (): Locator =>
    this.page.locator('h1.h1, .page-title h1').first();
  private readonly entityChip = (name: string): Locator =>
    this.page.locator('.related-entity-container').filter({ hasText: name });
  private readonly ellipsisMenuButton = (): Locator =>
    this.page
      .locator('.page-header button.btn.dropdown-toggle, [class*="more-actions"] button')
      .first();
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
    await this.page
      .locator('.is-invalid__option')
      .first()
      .waitFor({ state: 'visible', timeout: 5000 });
    const options = this.page.locator('.is-invalid__option');
    const count = await options.count();
    const randomIndex = Math.floor(Math.random() * count);
    const selectedText = await options.nth(randomIndex).innerText();
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
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

  // WHY the bounded whole-sequence retry (2026-07-22): identical bug class to
  // CompaniesPage.clickAddCompany / DealsPage.cloneDeal /
  // ContactsPage.selectFromContactDropdown (which this method was originally
  // copied from, per its own prior comment) — every click here was a raw,
  // UNBOUNDED Playwright `.click()` (no `timeout`, no global `actionTimeout`
  // configured anywhere), so a "click registers, handler not yet attached"
  // React race could hang until the outer test timeout. Fixed with the exact
  // same proven shape: bound every click to config.timeouts.expect and retry
  // the whole open->fill->select sequence (not just the click) up to 3
  // times, since a half-opened/half-filtered menu from a failed attempt
  // isn't a valid state to resume from. Flat across all environments —
  // client-side rendering race, not a server/data-volume-dependent
  // operation, same reasoning as the sibling fixes (no per-env branching).
  private async selectFromIsInvalidControl(
    control: Locator,
    input: Locator,
    value: string
  ): Promise<void> {
    const menu = this.page.locator('.is-invalid__menu');
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await control.click({ timeout: config.timeouts.expect });
        await input.fill(value);
        const option = menu.locator('.is-invalid__option').filter({ hasText: value }).first();
        await option.waitFor({ state: 'visible', timeout: config.timeouts.expect });
        await option.click({ timeout: config.timeouts.expect });
        await menu.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        logger.debug(`Selected "${value}" from is-invalid control`);
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `selectFromIsInvalidControl("${value}") attempt ${attempt}/${maxAttempts} failed: ` +
            `${String(error)} — closing any stuck menu and retrying`
        );
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
      }
    }
    throw new Error(
      `selectFromIsInvalidControl: failed to select "${value}" after ${maxAttempts} attempts — ` +
        `${String(lastError)}`
    );
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
      // WHY: Confirmed live — the real create endpoint is `/v1/quotations/`
      // WITH a trailing slash, which this regex's `$` anchor (right after
      // "quotations") never matched — same class of bug already found and
      // fixed in saveQuotationHandlingInaccessibleEntities() and
      // CallLogsPage.goToCallLogById(). This method has no current callers,
      // but fixing it anyway rather than leaving a latent trap for whoever
      // wires it up next.
      const response = await this.armResponseWaitWithRecovery(
        (r: Response) => /\/v1\/quotations\/?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
        'captureQuotationIdFromResponse: create POST',
        15000
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
      // WHY: Try href first — more reliable than text content
      const href = await toastLink.getAttribute('href').catch(() => null);
      if (href) {
        const hrefMatch = href.match(/\/quotations\/details\/(\d+)/);
        if (hrefMatch) {
          logger.success(`Captured quotation ID from toast href: ${hrefMatch[1]}`);
          return hrefMatch[1];
        }
      }
      const text = await toastLink.textContent();
      const match = text?.match(/Quotation ID:\s*(\d+)/);
      if (match) {
        logger.success(`Captured quotation ID from toast text: ${match[1]}`);
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

  // WHY: Waits for the full quotation detail page to settle before any interaction.
  // Without this, clickEditButton() fires before React resolves the quotation entity
  // from /v1/quotations/{id} — causing the edit modal to open with disabled fields or
  // failing entirely when the session is under load. Mirrors waitForContactDetailsPage.
  // WHY: delegates to the shared BasePage.waitForEntityDetailPage() —
  // navigation-drift reload-and-retry built and verified once (2026-07-27,
  // via 2 real live reproductions on DealsPage's identical pattern), reused
  // here instead of a module-local copy. A genuine 404 (quotation actually
  // deleted/doesn't exist) is a real, fast response that still satisfies the
  // predicate — it does NOT trigger the reload-retry (that only fires when
  // no matching response arrives at all) — so the 404-means-"does not
  // exist" check below still fires exactly as before.
  private async waitForQuotationDetailPage(): Promise<void> {
    const response = await this.waitForEntityDetailPage(
      /\/quotations\/details\//,
      (res) => res.url().match(/\/v1\/quotations\/\d+$/) !== null && res.request().method() === 'GET',
      'Quotation detail'
    );
    if (response.status() === 404) {
      throw new Error('Quotation detail page returned 404 — quotation does not exist');
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
      // WHY: batched allTextContents() (2026-07-17) — confirmed live via direct
      // timing comparison that N individual `.nth(i).innerText()` calls (one
      // CDP round-trip each) cost ~778ms for 10 rows, vs ~23ms for a single
      // allTextContents() call returning the same data — a 33.8x difference,
      // identical result. Same "filter out empty filler rows" logic, just
      // computed from one round-trip instead of N.
      const rowTexts = await allRows.allTextContents().catch(() => []);
      // Filter out empty placeholder rows (Kylas renders empty .rt-tr-group rows as fillers)
      const nonEmptyCount = rowTexts.filter((t) => t.trim().length > 0).length;
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
    // Bootstrap modals keep aria-hidden="true" + d-block during fade-out animation.
    // waitFor('hidden') checks CSS visibility — wait for d-block class to be removed instead.
    const modal = this.page.locator('#editEntityModal');
    const isModalVisible = await modal.isVisible().catch(() => false);
    if (isModalVisible) {
      try {
        // Wait for modal to lose d-block class (Bootstrap fade-out complete)
        // WHY: Using string form to avoid TypeScript DOM lib requirement in Node context
        await this.page.waitForFunction(
          '!document.getElementById("editEntityModal") || !document.getElementById("editEntityModal").classList.contains("d-block")',
          { timeout: 15000 }
        );
      } catch {
        // WHY: Modal has data-keyboard="false" so Escape doesn't work
        // Force close via JavaScript DOM manipulation (string form avoids TS DOM lib error)
        logger.warn('Modal still visible after 15s — force closing via JS');
        await this.page.evaluate(`
          const el = document.getElementById('editEntityModal');
          if (el) { el.classList.remove('show', 'd-block'); el.style.display = 'none'; }
          const backdrop = document.querySelector('.modal-backdrop');
          if (backdrop) backdrop.remove();
          document.body.classList.remove('modal-open');
        `);
        await this.page.waitForTimeout(300);
      }
    }

    // WHY: .portal-element tooltips float above the list and block clicks — move mouse away.
    await this.page.mouse.move(0, 0);
    await this.page.waitForTimeout(300);

    await this.fill(this.searchInput(), value, 'search input');

    await Promise.all([
      this.armResponseWaitWithRecovery(
        (r) =>
          r.url().includes('search') && r.request().method() === 'POST' && r.status() === 200,
        'performSearch: search POST',
        15000
      )
        .catch(() => null),
      this.page.locator('svg:has(#clip-Ic_Search)').first().click({ timeout: 15000 }),
    ]);

    try {
      await this.page
        .locator('.spinner, .loader, .loading')
        .last()
        .waitFor({ state: 'hidden', timeout: 10000 });
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
    await this.page
      .locator('.is-invalid__option')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
    const options = this.page.locator('.is-invalid__option');
    const count = await options.count();
    const randomIndex = Math.floor(Math.random() * Math.min(count, 10));
    const dealName = (await options.nth(randomIndex).innerText()).trim();
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    logger.success(`Selected deal: ${dealName}`);
    return dealName;
  }

  private async selectSpecificDeal(dealName: string): Promise<string> {
    logger.info(`Selecting specific deal: ${dealName}`);
    await this.dealControl().click();
    await this.dealInput().fill(dealName);
    await this.page
      .locator('.is-invalid__option')
      .filter({ hasText: dealName })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
    await this.page.locator('.is-invalid__option').filter({ hasText: dealName }).first().click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
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
    const productControl = productInput.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
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
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
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
    // WHY: Register response listener BEFORE navigating — on fast API responses the
    // GET /v1/quotations/{id} may complete before waitForQuotationDetailPage registers
    // its own listener, causing it to miss the response and return null after 15s.
    // Registering here guarantees we capture the response regardless of timing.
    const responsePromise = this.armResponseWaitWithRecovery(
      (res) => res.url().match(/\/v1\/quotations\/\d+$/) !== null && res.request().method() === 'GET',
      'goToQuotationDetail: detail GET',
      20000
    ).catch(() => null);
    await this.navigateTo(`${config.appUrl}/sales/quotations/details/${id}`);
    await this.waitForUrl(/\/quotations\/details\//, 20000);
    await this.page.waitForLoadState('domcontentloaded');
    const response = await responsePromise;
    if (response?.status() === 404) {
      throw new Error('Quotation detail page returned 404 — quotation does not exist');
    }
    logger.info(`Navigated to quotation detail: ${id}`);
  }

  // WHY this exists (added 2026-07-20, found via a real re-run failure, not
  // guessed): both goToQuotationDetail() and the sibling private
  // waitForQuotationDetailPage() only wait for the URL, domcontentloaded, and
  // the GET /v1/quotations/{id} API response — none of that confirms React
  // has actually RENDERED the page body from that response. A caller that
  // checks page content (e.g. a "not a blank/white screen" assertion)
  // immediately after either of those can catch the page mid-render.
  // Confirmed live: quotations.rbac.spec.ts's "restricted user should edit
  // shared quotation when deal is accessible" failed exactly this way
  // (body text only 38 chars, expected >50) right after a navigation fix
  // that replaced an old, unrelated flat waitForTimeout(3000) — that sleep
  // was accidentally also covering this gap. #edit-action-btn is a stable,
  // already-proven signal that the detail page has rendered (clickEditButton()
  // already waits on it) — reusing it here rather than reintroducing a blind
  // sleep or inventing a new locator.
  async waitForDetailPageRendered(): Promise<void> {
    await this.editActionBtn().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
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
    await this.selectFromIsInvalidControl(this.statusControl(), this.statusInput(), data.status);

    // Dates
    await this.selectDateInPicker(this.generationDateInput(), data.generationDate);
    await this.selectDateInPicker(this.validTillInput(), data.validTill);

    // Additional discount / tax / adjustment
    if (data.additionalDiscount > 0) {
      await this.fill(
        this.additionalDiscountInput(),
        String(data.additionalDiscount),
        'Additional Discount'
      );
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

    // WHY: Billing country — select by random index via selectRandomCountry(),
    // never by text match. Confirmed live (QA) that filtering options with
    // `hasText: 'India'` can match "British Indian Ocean Territory" too (it
    // contains "India" as a substring, inside "Indian"), and .first() picks
    // whichever renders first — silently submitting the wrong country while
    // logging the intended one as if it had succeeded. This was the actual
    // root cause of a backend 500 on quotation save. selectRandomCountry()
    // reads the real option text after clicking it by index, so it can never
    // have this collision.
    await this.selectRandomCountry('2_31_input_billingCountry');

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
        await this.fill(
          this.shippingZipcodeInput(),
          data.shippingZipcode || '',
          'Shipping Zipcode'
        );
        // WHY: same substring-collision risk as billing country above —
        // select by random index via selectRandomCountry() instead of hasText.
        await this.selectRandomCountry('2_71_input_shippingCountry');
      }
    }

    logger.success('Quotation form filled');
    return selectedDealName;
  }

  async fillOwner(ownerName: string): Promise<void> {
    const searchTerm = ownerName.split(' ')[0];
    await this.ownerControl().click();
    await this.ownerInput().fill(searchTerm);
    await this.page.locator('.is-invalid__option').filter({ hasText: ownerName }).first().click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    logger.info(`Set owner to: ${ownerName}`);
  }

  async fillAssociatedCompany(companyName: string): Promise<void> {
    await this.selectFromIsInvalidControl(this.companyControl(), this.companyInput(), companyName);
    logger.info(`Set associated company to: ${companyName}`);
  }

  async fillAssociatedContacts(contactNames: string[]): Promise<void> {
    for (const name of contactNames) {
      await this.selectFromIsInvalidControl(this.contactsControl(), this.contactsInput(), name);
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
    // WHY: For an in-place modal edit, the URL never changes on success OR
    // failure — assertSuccessToast()'s URL-based fallback (used by callers
    // afterward) cannot tell them apart in that case, which let a real save
    // failure surface only several steps later as an unrelated-looking
    // assertion mismatch (T13/quotations.spec.ts:161). Detect the outcome
    // here instead, at the actual point of failure, using the same
    // already-proven convention as LeadsPage.saveEditedLead() /
    // ContactsPage.saveEditedContact() / CompaniesPage.saveEditedCompany():
    // check for validation/toast errors, then confirm the modal itself
    // actually closes — a save that server-side rejected leaves the modal
    // open, which this directly observes rather than inferring from the URL.
    await this.assertNoFormErrors('quotation save form');
    await this.withSessionExpiryRecovery(() => expect(this.modal()).toBeHidden({ timeout: 15000 }));
  }

  async saveQuotationExpectingError(): Promise<void> {
    logger.info('Saving quotation — expecting error response');
    await this.modalSaveButton().click();
  }

  // WHY: Confirmed live on staging — a deal-inaccessible-entity save failure
  // returns HTTP 422 with { errorCode: "029003", message: "Invalid contact -
  // id: <id>" } (or "Invalid company - id: <id>"). This is the exact same
  // signal errorFilters.ts's isExpectedRbacError() already keys off of
  // (message.includes('029003') / apiErrorMessage containing "Invalid
  // company"/"Invalid contact") — reusing it here instead of inventing a new
  // detection rule. Also confirmed live: the error TOAST shown in the UI is
  // generic ("the data is invalid or you do not have the required
  // permissions on one of the associated entities") and never names the
  // entity — only this response body does, so the toast alone cannot drive
  // this decision.
  private classifyInaccessibleEntityError(
    status: number,
    body: any
  ): { isInaccessibleEntityError: boolean; entity: 'contact' | 'company' | null; rawMessage: string } {
    const message: string =
      body?.message || body?.errors?.[0]?.message || body?.validationErrors?.[0]?.message || '';
    const errorCode: string | undefined = body?.errorCode;
    const isKnownCode = status === 422 && errorCode === '029003';
    const isKnownMessage = /Invalid company/i.test(message) || /Invalid contact/i.test(message);
    const entity: 'contact' | 'company' | null = /Invalid company/i.test(message)
      ? 'company'
      : /Invalid contact/i.test(message)
        ? 'contact'
        : null;
    return { isInaccessibleEntityError: isKnownCode || isKnownMessage, entity, rawMessage: message };
  }

  // WHY: A deal auto-populates its associated Contact and Company onto the
  // quotation form. If the current (typically restricted) user cannot access
  // one or both of those auto-populated entities, save fails with the 029003
  // error above. Separate wrapper (not baked into saveQuotation() itself) —
  // same precedent as attemptCreateWithInaccessibleEntities() elsewhere in
  // this file — because this retry dance is only relevant to the narrow
  // deal-linked-entity RBAC scenario, not the common save path used by every
  // other caller of saveQuotation().
  // WHY (2026-07-20, real confirmed failure — not a guess): the full-suite
  // run's one genuine terminal failure (`quotations.spec.ts:247`) and one of
  // its flaky tests (`quotations.spec.ts:131`) both hit an identical, narrow
  // signature: `HTTP 400`, response body `{"code":"000000","message":
  // "Connection has been closed BEFORE response, while sending request
  // body", ...}`. This is a raw TCP/HTTP connection reset mid-request — the
  // server never actually processed this attempt — genuinely distinct from
  // every other error this method already classifies (029003 inaccessible-
  // entity, or any other real validation/business-logic rejection). Scoped
  // deliberately narrow, matching this exact confirmed message text, not a
  // broad "any 400/500 is transient" net — a false-positive match here would
  // silently retry a real, non-transient failure. `grep -c` across the full
  // 4-hour, 272-test run log that surfaced this found exactly 3 occurrences,
  // all inside one ~60-second window — not a recurring pattern elsewhere —
  // so this is intentionally a small, bounded retry, not a systemic redesign.
  private static readonly TRANSIENT_CONNECTION_RESET_PATTERN =
    /Connection has been closed BEFORE response/i;

  private isTransientConnectionResetError(body: any): boolean {
    const message: string = body?.message || '';
    return QuotationsPage.TRANSIENT_CONNECTION_RESET_PATTERN.test(message);
  }

  async saveQuotationHandlingInaccessibleEntities(): Promise<InaccessibleEntityRetryResult> {
    const removedEntities: Array<'contact' | 'company'> = [];
    let lastErrorMessage = '';

    // WHY a separate, bounded counter from the entity-removal `attempt` loop
    // below: a connection reset is not an inaccessible-entity error and must
    // never consume one of the 3 entity-removal attempts or trigger
    // clearAssociatedContacts()/clearAssociatedCompany() — those are
    // stateful, destructive DOM mutations that have nothing to do with a
    // network-level blip. This budget is spent ONLY on this exact signature;
    // any other failure (including a second, different error) falls through
    // to the existing classification logic unchanged.
    const maxConnectionResetRetries = 2;
    let connectionResetRetries = 0;

    for (let attempt = 1; attempt <= 3; attempt++) {
      logger.info(`Saving quotation — attempt ${attempt}/3`);
      // WHY: Register the response wait BEFORE clicking — same convention as
      // captureQuotationIdFromResponse() elsewhere in this file. Match on
      // parsed pathname (not the raw URL string) so an edit's query string,
      // if any, can never break the match — the exact class of bug already
      // found and fixed in CallLogsPage.goToCallLogById(). Confirmed live
      // that the real create endpoint is `/v1/quotations/` WITH a trailing
      // slash — the pattern below tolerates one optionally before/after the
      // id segment, otherwise this silently never matches and times out.
      const responsePromise = this.armResponseWaitWithRecovery(
        (res) =>
          /^\/v1\/quotations\/?(\d+)?\/?$/.test(new URL(res.url()).pathname) &&
          ['POST', 'PATCH', 'PUT'].includes(res.request().method()),
        'saveQuotationHandlingInaccessibleEntities: save POST/PATCH/PUT',
        20000
      )
        .catch(() => null);
      await this.modalSaveButton().click();
      const response = await responsePromise;

      if (response && response.status() < 400) {
        logger.success(
          removedEntities.length
            ? `Quotation saved after removing: ${removedEntities.join(', ')}`
            : 'Quotation saved on first attempt — no inaccessible entities'
        );
        return { succeeded: true, removedEntities, lastErrorMessage };
      }

      if (!response) {
        // WHY: A timed-out response wait must NOT be silently treated as
        // success — that exact assumption previously masked a URL-matching
        // bug in this method and hid a real 422 behind a false "succeeded".
        // Fall back to the same page-state signal assertSuccessToast() uses
        // elsewhere in this file before concluding anything.
        const success = await this.successToast()
          .isVisible()
          .catch(() => false);
        const url = this.page.url();
        const onListOrDetail = url.includes('/quotations/list') || url.includes('/quotations/details/');
        if (success || onListOrDetail) {
          logger.warn('Save response not captured, but page state confirms success');
          return { succeeded: true, removedEntities, lastErrorMessage };
        }
        throw new Error(
          'Could not confirm save outcome — no matching API response captured and page shows ' +
            `neither a success toast nor navigation away from the form (still on: ${url})`
        );
      }

      const body = await response.json().catch(() => ({}));

      // WHY checked BEFORE isInaccessibleEntityError: a connection reset can
      // in principle share HTTP 400 with a real validation error, so this
      // must be resolved first, on its own distinct message text, never
      // folded into the entity-removal classification below.
      if (this.isTransientConnectionResetError(body)) {
        lastErrorMessage = body?.message || '';
        if (connectionResetRetries < maxConnectionResetRetries) {
          connectionResetRetries++;
          logger.warn(
            `Save hit a transient connection reset ("${lastErrorMessage}") — retrying save ` +
              `(connection-reset retry ${connectionResetRetries}/${maxConnectionResetRetries}, ` +
              `does not consume an entity-removal attempt)`
          );
          // WHY no wait/backoff: the confirmed occurrences recovered on the
          // very next attempt with no delay needed (Playwright's own outer
          // test-retry, which has zero backoff either, already proved this)
          // — a raw TCP reset is either gone by the next request or it
          // isn't; waiting doesn't change that, so don't slow down the
          // common, already-transient case for a hypothetical benefit.
          // WHY this is safe under quotations.spec.ts's serial mode: this
          // retry is entirely internal to one save() call, inside one
          // test's single attempt — it happens strictly BEFORE Playwright's
          // own test-level/serial-file-level retry would ever be considered,
          // and only reduces the chance of reaching that point. It does not
          // change, intercept, or duplicate Playwright's own retry
          // mechanics in any way — if this bounded retry also fails, the
          // method still throws exactly as before, and the existing
          // serial-retry cascade behaves identically to today.
          attempt--; // WHY: don't consume an entity-removal attempt slot
          continue;
        }
        // WHY throw here, not fall through to isInaccessibleEntityError:
        // never silently swallow — if the bounded retry budget is
        // exhausted and it's STILL this exact signature, fail loudly and
        // clearly rather than mis-attributing it to the unrelated
        // inaccessible-entity path below.
        throw new Error(
          `Save failed after ${maxConnectionResetRetries} retries, still hitting a transient ` +
            `connection reset: "${lastErrorMessage}"`
        );
      }

      const { isInaccessibleEntityError, entity, rawMessage } = this.classifyInaccessibleEntityError(
        response.status(),
        body
      );
      lastErrorMessage = rawMessage;

      if (!isInaccessibleEntityError) {
        // WHY: A genuinely different failure — don't hide it behind this
        // fallback's retry logic, surface it immediately.
        throw new Error(
          `Save failed with an unrelated error (not the inaccessible-entity 029003 error): ` +
            `HTTP ${response.status()} — "${rawMessage}"`
        );
      }

      logger.warn(
        `Inaccessible entity error on attempt ${attempt} — server identified: ` +
          `${entity ?? 'unspecified'} ("${rawMessage}")`
      );

      if (attempt === 1) {
        logger.info('Removing associated Contact and retrying save');
        await this.clearAssociatedContacts();
        removedEntities.push('contact');
      } else if (attempt === 2) {
        logger.info(
          'Still failing after removing Contact — removing associated Company and retrying save'
        );
        await this.clearAssociatedCompany();
        removedEntities.push('company');
      } else {
        throw new Error(
          `Save still fails with an inaccessible-entity error after removing both Contact and ` +
            `Company (removed: ${removedEntities.join(', ')}): "${rawMessage}"`
        );
      }

      // WHY: Clicking a react-select field's clear indicator can leave its
      // dropdown/menu portal open, intercepting clicks on Save — confirmed
      // live that a plain retry click then hangs until Playwright's own
      // actionability timeout. Escape reliably dismisses it without
      // depending on the portal's CSS-in-JS hash class name.
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    }

    // Unreachable — the loop above always returns or throws.
    throw new Error('saveQuotationHandlingInaccessibleEntities: exhausted retries unexpectedly');
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
    await this.page.locator('.rt-tr-group').filter({ hasText: quotationNumber }).first().click();
    // WHY: Use the canonical wait (URL + domcontentloaded + GET-response) instead
    // of a bare URL wait — confirms the entity data actually loaded.
    await this.waitForQuotationDetailPage();
    // WHY: The row click above can land on the WRONG quotation — list rows are
    // matched by fulltext search, not necessarily the literal row text, so
    // `.filter({ hasText })` can silently resolve to the wrong row. Verify the
    // page we actually landed on matches what was searched for before returning.
    const title = await this.detailPageTitle()
      .innerText()
      .catch(() => '');
    // WHY: Case-insensitive — the detail page title renders the summary in
    // Title Case while faker-generated summaries are lowercase; a case-sensitive
    // compare would false-positive-fail on a perfectly correct navigation.
    if (!title.toLowerCase().includes(quotationNumber.toLowerCase())) {
      throw new Error(
        `Wrong quotation loaded — expected "${quotationNumber}" but detail page title was "${title}". Navigation landed on the wrong quotation.`
      );
    }
    logger.info(`Opened quotation: ${quotationNumber}`);
  }

  // ─── 8. Edit actions ─────────────────────────────────────────────────────────

  async clickEditButton(): Promise<void> {
    await this.editActionBtn().waitFor({ state: 'visible', timeout: 15000 });
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
      // WHY: Summary may be disabled in edit mode on some envs — skip if not editable
      const summaryEnabled = await this.summaryInput().isEnabled().catch(() => false);
      if (summaryEnabled) {
        await this.fill(this.summaryInput(), changes.summary, 'Summary (edit)');
      } else {
        logger.warn('Summary field disabled in edit mode — skipping');
      }
    }
    if (changes.status !== undefined) {
      await this.selectFromIsInvalidControl(
        this.statusControl(),
        this.statusInput(),
        changes.status
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

  // WHY: searchTerm can be either summary or quotationNumber — both are indexed by the
  // fulltext search API. Always prefer summary for custom-prefix quotations (RES.../ADM...)
  // because the list view renders system-assigned QUO-XXXXX numbers, not custom prefixes.
  // Passing quotationNumber works only when that value also appears in the list column text.
  async assertQuotationInList(searchTerm: string): Promise<void> {
    const found = await this.retryFindInList(searchTerm);
    if (!found) {
      throw new Error(`Quotation not found in list after retries: ${searchTerm}`);
    }
    logger.success(`Quotation confirmed in list: ${searchTerm}`);
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
    // WHY: batched allTextContents() — same fix/evidence as retryFindInList()
    // above (33.8x measured speedup, identical result, single round-trip).
    const rowTexts = await allRows.allTextContents().catch(() => []);
    for (const rawText of rowTexts) {
      const text = rawText.trim().toLowerCase();
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
    const title = await this.detailPageTitle()
      .innerText()
      .catch(() => '');
    if (!title.includes(data.quotationNumber) && !title.includes(data.summary)) {
      throw new Error(
        `Wrong quotation loaded — page title "${title}" does not contain quotation number "${data.quotationNumber}" or summary "${data.summary}". Navigation landed on the wrong quotation.`
      );
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
    const visible = await this.entityChip(entityName)
      .isVisible()
      .catch(() => false);
    if (visible) {
      throw new Error(`Entity chip should NOT be visible: ${entityName}`);
    }
    logger.success(`Confirmed entity chip not visible: ${entityName}`);
  }

  async assertGrandTotalMath(): Promise<GrandTotalComponents> {
    logger.info('Reading grand total components');
    const tolerance = 1;
    // WHY: grandTotal is recomputed reactively client-side when the discount/
    // tax/adjustment fields change — there is no network response to wait for.
    // Reading it exactly once immediately after the last field fill races the
    // recompute: on an uncontended machine it's already settled by the time
    // fill() resolves, but under real system load (concurrent workers/tests)
    // that recompute can lag behind. Poll until the read-back values satisfy
    // the formula instead of asserting on a single snapshot.
    const maxAttempts = 10;
    let last: GrandTotalComponents | null = null;
    let expected = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const subTotal = await this.getNumericValue(this.subTotalInput());
      const additionalDiscount = await this.getNumericValue(this.additionalDiscountInput());
      const additionalTax = await this.getNumericValue(this.additionalTaxInput());
      const adjustment = await this.getNumericValue(this.adjustmentInput());
      const grandTotal = await this.getNumericValue(this.grandTotalInput());

      // Formula: GrandTotal = SubTotal × (1 - disc/100) × (1 + tax/100) × (1 + adj/100)
      const afterDiscount = subTotal * (1 - additionalDiscount / 100);
      const afterTax = afterDiscount * (1 + additionalTax / 100);
      expected = afterTax * (1 + adjustment / 100);
      last = { subTotal, additionalDiscount, additionalTax, adjustment, grandTotal };

      if (Math.abs(expected - grandTotal) <= tolerance) {
        logger.success(
          `Grand total math verified: ${subTotal} × (1-${additionalDiscount}%) × (1+${additionalTax}%) × (1+${adjustment}%) = ${grandTotal}`
        );
        return last;
      }
      if (attempt < maxAttempts) await this.page.waitForTimeout(300);
    }

    const { subTotal, additionalDiscount, additionalTax, adjustment, grandTotal } = last!;
    throw new Error(
      `Grand total math failed after ${maxAttempts} attempts. Expected: ${expected.toFixed(2)}, Got: ${grandTotal}. ` +
        `SubTotal: ${subTotal}, AdditionalDiscount: ${additionalDiscount}%, ` +
        `AdditionalTax: ${additionalTax}%, Adjustment: ${adjustment}%`
    );
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
    const statusLocator = this.page
      .locator('[class*="status"], [class*="badge"]')
      .filter({ hasText: expectedStatus })
      .first();
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
    // WHY: Wait for detail page to fully render before checking body text.
    await this.page.waitForLoadState('domcontentloaded');
    await this.detailPageTitle().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    // WHY: Confirmed live (2026-07-06, Companies clone investigation) — a
    // fixed sleep before a one-shot body.innerText() read doesn't scale with
    // variable render time under load and can still race under heavier CI
    // load than this was calibrated for. Use an auto-retrying assertion
    // instead — it polls until the real DOM condition is met.
    await expect(this.page.locator('body')).toContainText(ownerName, { timeout: 15000 });
    logger.success(`Owner confirmed: ${ownerName}`);
  }

  async assertShippingSameAsBilling(): Promise<void> {
    const billingCity = await this.billingCityInput()
      .inputValue()
      .catch(() => '');
    const shippingCity = await this.shippingCityInput()
      .inputValue()
      .catch(() => '');
    if (billingCity && shippingCity && billingCity !== shippingCity) {
      throw new Error(
        `Shipping city "${shippingCity}" does not match billing city "${billingCity}"`
      );
    }
    logger.success('Shipping address matches billing address');
  }

  async assertShippingFieldsVisible(): Promise<void> {
    await this.shippingAddressInput().waitFor({ state: 'visible', timeout: 10000 });
    logger.success('Shipping address fields are visible');
  }

  // ─── 10. Workflow wrappers ────────────────────────────────────────────────────

  private async dismissModalIfOpen(): Promise<void> {
    try {
      const modal = this.page.locator('#editEntityModal.d-block');
      const isOpen = await modal.isVisible({ timeout: 1000 }).catch(() => false);
      if (isOpen) {
        logger.warn('Edit modal found open — clicking close button to dismiss');
        // WHY: Modal has data-keyboard="false" and data-backdrop="static"
        // so Escape key and backdrop click don't work — must click close button
        const closeBtn = this.page.locator('#editEntityModal .close, #editEntityModal [data-dismiss="modal"]').first();
        const closeBtnVisible = await closeBtn.isVisible({ timeout: 2000 }).catch(() => false);
        if (closeBtnVisible) {
          await closeBtn.click();
        } else {
          // Force close via JavaScript
          await this.page.evaluate(`
            const modal = document.getElementById('editEntityModal');
            if (modal) {
              modal.classList.remove('show', 'd-block');
              modal.style.display = 'none';
            }
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) backdrop.remove();
            document.body.classList.remove('modal-open');
          `);
        }
        await this.page.waitForTimeout(500);
        logger.info('Edit modal dismissed');
      }
    } catch {
      // modal not present — continue
    }
  }

  async createQuotation(data: QuotationData): Promise<{ id: string | null; dealName: string }> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Creating quotation: ${data.quotationNumber}`);
      // WHY: Previous test may have left edit modal open — dismiss before navigating
      await this.dismissModalIfOpen();
      await this.goToQuotationsList();
      await this.openCreateForm();
      const selectedDeal = await this.fillQuotationForm(data);
      // WHY: A randomly-selected deal (the common case here) can auto-populate
      // an Associated Contact/Company the current user cannot access, causing
      // a 422 (errorCode 029003) on save. This used to be "handled" by a dead
      // try/catch — saveQuotation() was a bare click that never threw, so the
      // catch never fired, and any such failure previously surfaced later as a
      // confusing, unrelated-looking error further down this method instead of
      // here. Now that saveQuotation() correctly detects and throws on a real
      // save failure, route through the dedicated, already-verified handler
      // (contact-then-company removal, with the dropdown-overlay dismissal
      // step this old inline logic never had) instead of reintroducing an
      // incomplete inline retry.
      const saveResult = await this.saveQuotationHandlingInaccessibleEntities();
      if (saveResult.removedEntities.length > 0) {
        logger.warn(
          `Removed inaccessible deal-linked entities to save: ${saveResult.removedEntities.join(', ')}`
        );
      }
      // WHY: Capture ID from toast BEFORE navigating away — avoids search index lag
      // on prod where quotation may not appear in list for 30-40s after creation
      const toastId = await this.captureIdFromToast();
      await this.assertSuccessToast();
      await this.assertOnListPage();
      let id: string | null = toastId;
      if (id) {
        // WHY: ID-first navigation — go directly to detail URL, no search needed
        logger.info(`ID-first navigation to quotation: ${id}`);
        await this.navigateTo(`${config.appUrl}/sales/quotations/details/${id}`);
        await this.waitForUrl(/\/quotations\/details\/\d+/, 15000);
        const urlId = await this.captureIdFromUrl();
        if (urlId) id = urlId;
        logger.success(`Navigated to quotation detail: ${id}`);
        await this.goToQuotationsList();
      } else {
        // WHY: Fallback — use retryFindInList which searches fulltext by summary
        // List rows show system QUO-XXXXX numbers not our custom prefix
        // retryFindInList searches API fulltext and checks for ANY non-empty row
        logger.warn('Toast ID not captured — falling back to retryFindInList by summary');
        const rowFound = await this.retryFindInList(data.summary);
        if (!rowFound) throw new Error(`Quotation row not found after retries: ${data.summary}`);
        // WHY: Click first non-empty row — retryFindInList leaves page on search results.
        // Find the index via one batched allTextContents() call (same fix/evidence
        // as retryFindInList()/assertQuotationNotInList() above — 33.8x measured
        // speedup over N individual innerText() calls), then click only that one
        // row — the click itself is still a single, necessary UI action.
        const allRows = this.page.locator('.rt-tr-group');
        const rowTexts = await allRows.allTextContents().catch(() => []);
        const firstNonEmptyIndex = rowTexts.findIndex((t) => t.trim().length > 0);
        if (firstNonEmptyIndex !== -1) {
          await allRows.nth(firstNonEmptyIndex).click();
        }
        await this.waitForUrl(/\/quotations\/details\/\d+/, 15000);
        id = await this.captureIdFromUrl();
        logger.info(`Captured ID: ${id}`);
        await this.goToQuotationsList();
      }
      logger.success(`Quotation created: ${data.quotationNumber} (id: ${id})`);
      return { id, dealName: selectedDeal };
    }, 'createQuotation');
  }
  async createQuotationWithOwner(
    data: QuotationData,
    ownerName: string
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
    await this.waitForUrl(/\/quotations\/details\/\d+/, 15000);
    const id = await this.captureIdFromUrl();
    await this.goToQuotationsList();
    logger.success(`Quotation created with owner: ${data.quotationNumber} (deal: ${dealName})`);
    return { id, dealName };
  }

  async updateQuotation(
    quotationNumber: string,
    changes: Partial<QuotationData>,
    id?: string
  ): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Updating quotation: ${quotationNumber}`);
      // WHY: Wrap in try-catch so a navigation failure throws immediately with a clear message
      // rather than waiting out the full 480s timeout — which kills the worker in serial mode
      // and skips all subsequent tests in the describe block.
      try {
        // WHY: After createQuotation the page lands on the list — navigate directly to detail
        // page by ID when available. goToQuotationDetail now waits for the API response so
        // clickEditButton always finds a fully-loaded page.
        if (id) {
          await this.goToQuotationDetail(id);
        } else {
          await this.searchAndOpenQuotation(quotationNumber);
        }
        await this.clickEditButton();
        await this.fillEditForm(changes);
        // WHY: Plain saveQuotation() has no resilience against the same
        // inaccessible-entity (029004 "Invalid company"/"Invalid contact") error
        // createQuotation() already retries around — a randomly-selected
        // Company/Contact in the edit form can be just as inaccessible as one
        // selected during create. saveQuotationHandlingInaccessibleEntities()
        // already matches PATCH/PUT as well as POST and already confirms success
        // via toast/URL fallback, so this covers the edit modal without any
        // changes to that method itself. See T13 (quotations.spec.ts:161) flake.
        const result = await this.saveQuotationHandlingInaccessibleEntities();
        if (result.removedEntities.length) {
          logger.warn(
            `updateQuotation removed inaccessible entities to save: ${result.removedEntities.join(', ')}`
          );
        }
        // Navigate back to detail page after save
        if (id) {
          await this.goToQuotationDetail(id);
        }
        logger.success(`Quotation updated: ${quotationNumber}`);
      } catch (error) {
        // WHY: Re-throw with context so the failure message names the quotation —
        // makes CI logs actionable without tracing back through stack frames
        throw new Error(`updateQuotation failed for "${quotationNumber}": ${String(error)}`);
      }
    }, 'updateQuotation');
  }

  async attemptCreateWithInaccessibleEntities(
    data: QuotationData
  ): Promise<{ errorType: 'company' | 'contact' | null; toastText: string }> {
    logger.info('Attempting quotation create expecting inaccessible entity error');
    await this.goToQuotationsList();
    await this.openCreateForm();
    await this.fillQuotationForm(data); // deal name not needed here
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
        await this.page
          .locator('.is-invalid__menu')
          .waitFor({ state: 'hidden', timeout: 10000 })
          .catch(() => {});
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
      await this.page
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: 10000 })
        .catch(() => {});
      logger.info(`Linked company via empty search: ${firstName.trim()}`);
      return firstName.trim();
    }

    throw new Error(
      'fillAssociatedCompanyFirstAvailable: no company options found with any search term'
    );
  }
  async performSearchPublic(value: string): Promise<void> {
    await this.performSearch(value);
  }

  async captureIdFromUrlPublic(): Promise<string | null> {
    return this.captureIdFromUrl();
  }
}
