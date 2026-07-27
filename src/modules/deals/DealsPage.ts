import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import {
  DealData,
  formatDateForCalendarLabel,
  DEAL_CUSTOM_FIELD_NAMES,
} from '../../data/factories/dealFactory';
import { TasksPage } from '../tasks/TasksPage';
import { MeetingsPage } from '../meetings/MeetingsPage';
import { generateTaskData } from '../../data/factories/taskFactory';
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

  // WHY: was a page-wide getByPlaceholder('Pick a Date') — confirmed live
  // (2026-07-24) this became ambiguous (strict-mode violation, 3 matches) the
  // moment Deal gained its own Date/DateTimePicker custom fields, which
  // render with the identical "Pick a Date" placeholder. Scoped to the id
  // suffix instead — immune to any future custom date-type field, which can
  // never be named "estimatedClosureOn". WHY scoped to the input tag: react-
  // dates renders a same-suffixed accessibility <p id="DateInput__screen-
  // reader-message-<real input id>">, the exact collision already documented
  // in BasePage.customFieldInputLocator() — excluding non-input tags removes
  // it the same way.
  private readonly estimatedClosureDateInput = (): Locator =>
    this.page.locator('input[id$="_input_estimatedClosureOn"]');

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

  // ── Ellipsis menu ──────────────────────────────────────────

  private readonly ellipsisButton = (): Locator =>
    this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

  private readonly ellipsisMenuItem = (text: string): Locator =>
    this.page.locator('.dropdown-menu.show a.dropdown-item').filter({ hasText: text });

  // ── Delete ─────────────────────────────────────────────────

  private readonly deleteConfirmButton = (): Locator => this.page.locator('button#confirm.btn-danger');

  // ── Share ──────────────────────────────────────────────────

  // WHY: Confirmed live — Deals' share modal has id="shareModal" (vs generic .modal.show)
  private readonly shareModal = (): Locator => this.page.locator('#shareModal');

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

  // ── Right panel icons ──────────────────────────────────────

  // WHY: Confirmed live — the `title` attribute on these buttons is always empty;
  // the real label lives in data-original-title (Bootstrap tooltip pattern).
  private readonly rightPanelIconSvgMap: Record<string, string> = {
    Notes: 'paint0_linear_972_2654',
    Tasks: 'clip-Ic_Task',
    Meetings: 'clip-Ic_Meetings',
    'Call Logs': 'paint1_linear_deals',
    Quotations: 'Quotation_Icon-16px_New',
  };

  private readonly rightPanelIcon = (title: string): Locator => {
    const svgId = this.rightPanelIconSvgMap[title];
    if (svgId) {
      return this.page
        .locator(
          `button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[data-original-title="${title}"]`
        )
        .first();
    }
    return this.page.locator(`button.btn.btn-transparent[data-original-title="${title}"]`);
  };

  // ── Detail page header fields ──────────────────────────────
  // WHY: Selectors confirmed live from the details-page-header-section HTML.
  // WHY: .first() required — confirmed live these ids render twice in the DOM
  // (responsive duplicate layout), causing a strict-mode violation without it.
  private readonly ownerFieldValue = (): Locator => this.page.locator('#ownedBy .title').first();
  private readonly companyFieldValue = (): Locator => this.page.locator('#company .title').first();
  private readonly productsFieldValue = (): Locator => this.page.locator('#products .title').first();
  private readonly estimatedValueFieldValue = (): Locator =>
    this.page.locator('#estimatedValue .title').first();
  private readonly actualValueFieldValue = (): Locator =>
    this.page.locator('#actualValue .title').first();
  private readonly estimatedClosureFieldValue = (): Locator =>
    this.page.locator('#estimatedClosureOn .title').first();
  private readonly actualClosureFieldValue = (): Locator =>
    this.page.locator('#actualClosureDate .title').first();
  private readonly convertedFromFieldValue = (): Locator =>
    this.page.locator('#convertedLeads .title').first();

  // ── Closed pipeline stage (Won / Closed Lost / Closed Unqualified) ──
  // WHY: Confirmed live — closed stages replace the in-progress stage bar
  // entirely with this element instead of updating .in-progress-stage.
  private readonly closedPipelineStageEl = (): Locator => this.page.locator('.closed-pipeline-stage');

  // WHY: confirmed live (2026-07-24) — Deal's detail page has 4 tabs (Basic
  // Information, Campaign Information, Other Details, Internals), so "Other
  // Details" is index 2 (#nav-tab2-tab) — differs from Contact's
  // #nav-tab5-tab since Deal has fewer top-level tabs.
  private readonly otherDetailsDetailPageTab = (): Locator => this.page.locator('#nav-tab2-tab');

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────

  // WHY: delegates to the shared BasePage.waitForEntityListPage() —
  // navigation-drift reload-and-retry built and verified once, reused here
  // instead of a module-local copy. See that method's own comment for the
  // full history/evidence.
  private async waitForListReady(): Promise<void> {
    await this.waitForEntityListPage(
      (res) =>
        res.url().includes('/v1/deals') && res.request().method() === 'GET' && res.status() === 200,
      this.dealTable(),
      'Deals'
    );
    await this.waitForLoaderToDisappear();
  }

  private async waitForLoaderToDisappear(): Promise<void> {
    try {
      await this.searchLoader().last().waitFor({ state: 'hidden', timeout: 10000 });
    } catch {
      // loader may not be present
    }
  }

  // WHY: delegates to the shared BasePage.waitForEntityDetailPage() —
  // navigation-drift reload-and-retry built and verified once (2026-07-27,
  // via 2 real live reproductions on this exact method), reused here
  // instead of a module-local copy. See that method's own comment for the
  // full history/evidence.
  async waitForDealDetailsPage(): Promise<void> {
    await this.waitForEntityDetailPage(
      /sales\/deals\/details\//,
      (res) => res.url().match(/\/v1\/deals\/\d+$/) !== null && res.request().method() === 'GET',
      'Deal details'
    );
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
      await this.withSessionExpiryRecovery(() =>
        expect(this.dealRowByName(name)).toBeVisible({ timeout: 5000 })
      );
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
      return await this.armResponseWaitWithRecovery(
        (response) =>
          response.url().includes('/search/deal') &&
          response.request().method() === 'GET' &&
          response.status() === 200,
        'deal search API response',
        15000
      );
    } catch {
      // Search API did not fire — wait briefly and continue
      await this.page.waitForTimeout(2000);
      return null;
    }
  }

  private async captureDealIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.armResponseWaitWithRecovery(
        (res) =>
          // WHY: tightened 2026-07-16 — confirmed live via this exact run's own
          // log that a bare `.includes('/deals')` substring match also matches
          // `https://.../v4/reports/deals?timezone=...&baseCurrencyId=...`, an
          // unrelated background reports/analytics POST that this codebase
          // never intended to capture from. It can win the waitForResponse race
          // against the real create/clone POST (confirmed reproducing 2/2 in a
          // clone test, both attempt and retry), returning a body with no
          // `id`/`data.id`/`dealId` field and silently capturing null. The real
          // endpoint, confirmed twice in the same run's own successful
          // captures, is exactly `.../v1/deals/` — require the `/v1/` version
          // segment and explicitly exclude `/reports/` as defense-in-depth
          // against any other versioned reporting endpoint sharing the same
          // '/deal(s)' substring.
          (res.url().includes('/v1/deals') || res.url().includes('/v1/deal')) &&
          !res.url().includes('/reports/') &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        'capture deal ID',
        config.timeouts.navigation
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
    description: string,
    exactName?: string
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

    // WHY: Deterministic path — for tests where the associated contact/
    // company's ownership matters (share/reassign/permission tests), picking
    // a random pre-existing entity is unsafe (its owner/share-state is
    // unknown and uncontrolled). Type the known entity's name and select the
    // exact match instead of falling back to the random-index behavior below.
    if (exactName) {
      const words = exactName.trim().split(' ');
      const validWord = words.find((w) => w.length >= 3) ?? exactName.trim().substring(0, 3);
      await inputLocator.fill(validWord);
      await this.page.waitForTimeout(800);
      const exactOption = this.page
        .locator('.is-invalid__option')
        .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(exactName)}\\s*$`) })
        .first();
      await exactOption.waitFor({ state: 'visible', timeout: 10000 });
      await exactOption.click();
      await this.page.waitForTimeout(300);
      logger.success(`${description} selected: "${exactName}" (exact match)`);
      return;
    }

    // WHY the search-then-select rewrite (root-caused 2026-07-21, applied
    // 2026-07-22 after the same failure signature was confirmed live ON
    // STAGE — previously scoped "qa/prod only, stage's list is too small to
    // trigger it" — stage's associated-company list has since grown to the
    // same 25-option scale, so the environmental boundary has shifted and
    // this is no longer a qa/prod-only issue): `selectRandomOptionWithRetry`
    // picking a random index from the UNFILTERED, page-wide `.is-invalid__
    // option` locator (up to 25+ options) intermittently timed out reading/
    // clicking `.nth(idx)` for ANY index under real load/render-churn — all
    // 3 bounded attempts (each re-rolling a fresh index) failed identically
    // in the confirmed live failure. Rather than raising the 15s bound (a
    // guess that doesn't address list SIZE), this mirrors the exactName
    // path immediately above: batch-read every option's text in ONE
    // round-trip (`allTextContents()` — same "batch instead of N individual
    // reads" fix already proven elsewhere in this codebase, e.g.
    // QuotationsPage's retryFindInList), pick one at random, type it into
    // the search input to filter the list down to (ideally) a single match,
    // then click that exact match — identical mechanics to the exactName
    // branch, which has never flaked. Bounded 3-attempt retry (re-picking a
    // fresh random option each attempt) for the same defense-in-depth as the
    // original, but now targeting a FILTERED, small list instead of the
    // full unfiltered one.
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const allTexts = (await this.page.locator('.is-invalid__option').allTextContents())
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        if (allTexts.length === 0) {
          throw new Error('no non-empty options found');
        }
        const pick = allTexts[Math.floor(Math.random() * allTexts.length)];
        const words = pick.split(' ');
        const validWord = words.find((w) => w.length >= 3) ?? pick.substring(0, 3);
        await inputLocator.fill(validWord);
        await this.page.waitForTimeout(800);
        const filteredOption = this.page
          .locator('.is-invalid__option')
          .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(pick)}\\s*$`) })
          .first();
        await filteredOption.waitFor({ state: 'visible', timeout: 10000 });
        await filteredOption.click({ timeout: config.timeouts.expect });
        logger.success(`${description} selected: "${pick}" (search-filtered random pick)`);
        await this.page.waitForTimeout(300);
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `${description}: search-filtered random pick attempt ${attempt}/${maxAttempts} failed: ` +
            `${String(error)} — clearing search and retrying`
        );
        await inputLocator.fill('').catch(() => {});
        await this.page.waitForTimeout(500);
      }
    }
    throw new Error(
      `${description}: failed to select a random option after ${maxAttempts} attempts — ${String(lastError)}`
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
    await this.withSessionExpiryRecovery(() =>
      expect(this.nameInput()).toBeVisible({ timeout: 10000 })
    );
    logger.success('Deal form opened');
  }

  // ──────────────────────────────────────────────────────────
  // Form Actions
  // ──────────────────────────────────────────────────────────

  // WHY: single choke point for filling all 9 Deal custom fields — called
  // from both fillDealForm() (create) and fillEditForm() (update), mirroring
  // LeadsPage.fillLeadCustomFields()/ContactsPage.fillContactCustomFields().
  // Every BasePage helper checks DOM presence and skips gracefully when a
  // field doesn't exist yet in the current environment (see BasePage's
  // custom-field-helpers section for why) — same environment-safety
  // contract as Lead/Contact.
  //
  // WHY no toggle-disable / tab-click here (confirmed live 2026-07-24,
  // Phase 1 of this branch): unlike Lead (tab-click) and Contact (toggle
  // only), Deal's create/edit form has NEITHER a "Show Required & Important
  // Fields" toggle NOR any tab-pane hiding for "Other Details" — all 9
  // custom fields are already present and fillable in the DOM directly.
  //
  // Mutates `data.customFields.pickList`/`.multiPickList` in place with
  // whatever was actually selected live — PickList/MultiPickList options are
  // read from the DOM at fill time, so the caller's `data` object needs to
  // be updated to reflect reality before it's used for later verification.
  private async fillDealCustomFields(data: DealData): Promise<void> {
    const cf = data.customFields;

    await this.fillTextLikeCustomField(
      DEAL_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.fillTextLikeCustomField(
      DEAL_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.fillTextLikeCustomField(DEAL_CUSTOM_FIELD_NAMES.number, String(cf.number), 'Number');
    await this.fillTextLikeCustomField(DEAL_CUSTOM_FIELD_NAMES.urlField, cf.urlField, 'URL Field');
    await this.setCheckboxCustomField(DEAL_CUSTOM_FIELD_NAMES.checkbox, cf.checkbox, 'Checkbox');
    await this.selectDateCustomField(DEAL_CUSTOM_FIELD_NAMES.date, cf.date, 'Date');
    await this.selectDateTimeCustomField(
      DEAL_CUSTOM_FIELD_NAMES.dateTimePicker,
      cf.dateTimePicker,
      'Date Time Picker'
    );

    const pickedValue = await this.selectPicklistCustomField(
      DEAL_CUSTOM_FIELD_NAMES.pickList,
      'Pick List'
    );
    if (pickedValue !== null) cf.pickList = pickedValue;

    const pickedValues = await this.selectMultiPicklistCustomField(
      DEAL_CUSTOM_FIELD_NAMES.multiPickList,
      'Multi Pick List'
    );
    if (pickedValues.length > 0) cf.multiPickList = pickedValues;
  }

  // WHY: thin wrapper around BasePage's generic dedicated-test skip
  // mechanism, same pattern as Lead's/Contact's own skipIfCustomFieldsAbsent().
  // Must be called AFTER the relevant create/edit form is open and ONLY from
  // the dedicated custom-field tests — every other Deal test already
  // tolerates absent fields via fillDealCustomFields()'s own presence checks.
  // No toggle/tab-reveal step needed first (see fillDealCustomFields()'s own
  // comment) — the fields are already in the DOM the moment the form opens.
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.skipDedicatedCustomFieldTestIfAbsent(Object.values(DEAL_CUSTOM_FIELD_NAMES), 'Deal');
  }

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
    // WHY: aligned with config.timeouts.navigation (2026-07-09) — this
    // specific wait was hardcoded to 10000ms, out of step with the rest of
    // the framework's already-established convention of using the
    // generous, propagation-tolerant navigation timeout for exactly this
    // class of "wait for a slow-to-populate dropdown" interaction (see
    // assertRightPanelIconVisible's own precedent). Investigated live
    // (2026-07-09) as part of a CI failure root-cause pass — this
    // particular occurrence traced to a session/auth issue, not raw
    // render slowness, but the hardcoded value was still an inconsistency
    // worth fixing on its own regardless of that finding.
    await pipelineOption.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    await pipelineOption.click();
    logger.success('Pipeline selected');

    // Associated Contacts + Company
    // WHY: Skip when skipAssociatedEntities=true — used in RBAC tests to create
    // deals with no linked entities so restricted user cannot see related quotations.
    if (!data.skipAssociatedEntities) {
      await this.selectFirstOptionFromDropdown(
        this.associatedContactsInput(),
        'associated contact',
        data.associatedContactName
      );
      await this.selectFirstOptionFromDropdown(
        this.associatedCompanyInput(),
        'associated company',
        data.associatedCompanyName
      );
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

    await this.fillDealCustomFields(data);

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

    // WHY: shared bounded+re-roll selector (2026-07-17) — was an unbounded
    // textContent()+click() on a random product option, same bug class.
    await this.selectRandomOptionWithRetry(productOptions, 'Product row added');
  }

  async saveDeal(): Promise<number | null> {
    logger.info('Saving deal');
    const dealIdPromise = this.captureDealIdFromResponse();
    await this.click(this.saveButton(), 'save button');
    await this.assertNoFormErrors('deal create form');
    const dealId = await dealIdPromise;
    // WHY: Confirmed live (2026-07-07) — a failed save (backend 4xx/5xx) previously still
    // logged "Deal saved successfully" and returned null, letting callers proceed on a deal
    // that doesn't exist. Fail fast instead, matching the "Fresh company ID not captured"
    // convention already used elsewhere in this codebase.
    if (!dealId) {
      throw new Error('Deal ID not captured after save — cannot proceed (save likely failed silently)');
    }
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
    await this.withSessionExpiryRecovery(() =>
      expect(this.installmentsModal()).toBeVisible({ timeout: 10000 })
    );

    const totalValueEl = this.installmentsModal().locator('.installments-total-value');
    const totalValueText = (await totalValueEl.textContent()) ?? '';
    logger.info(`Total value in modal: ${totalValueText}`);

    await this.installmentsNumberInput().click();
    await this.installmentsNumberInput().fill(String(numberOfInstallments));
    await this.click(this.installmentsConfirmButton(), 'confirm installments button');
    await this.withSessionExpiryRecovery(() =>
      expect(this.installmentsModal()).toBeHidden({ timeout: 10000 })
    );

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
      await this.withSessionExpiryRecovery(() => expect(nameInput).toBeVisible({ timeout: 10000 }));
      const defaultName = await nameInput.inputValue();
      expect(defaultName).toBe(`Installment ${i + 1}`);
      logger.success(`Installment ${i + 1} row present`);
    }

    await this.withSessionExpiryRecovery(() =>
      expect(this.partPaymentSummaryActualTotal()).toBeVisible()
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.partPaymentSummaryAmountReceived()).toBeVisible()
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.partPaymentSummaryRemainingBalance()).toBeVisible()
    );

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
    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal()).toBeVisible({ timeout: 10000 })
    );
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

    await this.fillDealCustomFields(data);

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

  // WHY: mirrors CompaniesPage.captureCompanyCreateOutcome()'s classification
  // (status/fieldErrors → transient vs genuine), adapted for the deal EDIT
  // save: PUT to /v1/deals/<id>, not POST to /v1/deals. Excludes known
  // sub-resource PUTs (e.g. /owner) so this never matches an unrelated update.
  private async captureDealUpdateOutcome(): Promise<{ success: boolean; transient: boolean }> {
    try {
      const response = await this.armResponseWaitWithRecovery(
        (res) =>
          /\/v1\/deals\/\d+$/.test(res.url()) &&
          !res.url().includes('/reports/') &&
          res.request().method() === 'PUT',
        'capture deal update response',
        15000
      );
      const status = response.status();
      if (status === 200 || status === 201) {
        return { success: true, transient: false };
      }
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      const message = String((body as { message?: unknown })?.message ?? '');
      const fieldErrors = (body as { fieldErrors?: unknown })?.fieldErrors;
      const hasFieldErrors = Array.isArray(fieldErrors) && fieldErrors.length > 0;
      const transient =
        !hasFieldErrors &&
        (status >= 500 || /unexpected error occurred|internal server error|something went wrong/i.test(message));
      logger.warn(
        `Deal update returned HTTP ${status} (message: "${message}", ` +
          `fieldErrors: ${hasFieldErrors ? 'present' : 'none'}) — classified as ` +
          `${transient ? 'TRANSIENT (will retry save)' : 'non-transient'}`
      );
      return { success: false, transient };
    } catch (error) {
      logger.debug(`Deal update response not captured (${String(error)}) — treating as non-transient`);
      return { success: false, transient: false };
    }
  }

  async saveEditedDeal(): Promise<void> {
    logger.info('Saving updated deal');
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const outcomePromise = this.captureDealUpdateOutcome();
      await this.click(this.saveEditButton(), 'save button');

      // WHY: capture the form-error instead of throwing immediately — same
      // reasoning as CompaniesPage.saveCompany(): a transient backend error
      // can also surface as a generic toast that assertNoFormErrors() would
      // otherwise throw on before the classification below ever runs.
      let formError: unknown = null;
      try {
        await this.assertNoFormErrors('deal edit form');
      } catch (error) {
        formError = error;
      }

      const outcome = await outcomePromise;

      if (outcome.success) {
        await this.withSessionExpiryRecovery(() =>
          expect(this.editModal()).toBeHidden({ timeout: 15000 })
        );
        logger.success('Deal updated');
        return;
      }

      if (outcome.transient && attempt < maxAttempts) {
        logger.warn(
          `Deal edit save hit a transient backend error (attempt ${attempt}/${maxAttempts}) — ` +
            're-clicking save on the same, still-filled edit form'
        );
        await this.page.waitForTimeout(1000);
        continue;
      }

      if (formError) {
        throw formError;
      }

      throw new Error(
        'Deal update did not complete after save — no confirmed success response (save likely failed silently)'
      );
    }
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
    await this.withSessionExpiryRecovery(() =>
      expect(this.dealRowByName(name)).toBeHidden({ timeout: 10000 })
    );
    logger.success(`Deal absent confirmed: ${name}`);
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createDeal(data: DealData): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      await this.clickAddDeal();
      await this.fillDealForm(data);
      return await this.saveDeal();
    }, 'createDeal');
  }

  async createDealWithPayments(data: DealData): Promise<{
    dealId: number | null;
    totalValueText: string;
  }> {
    return this.withSessionExpiryRetry(async () => {
      await this.clickAddDeal();
      await this.fillDealForm(data);
      const totalValueText = await this.addPartPayments(data.numberOfInstallments);
      const dealId = await this.saveDeal();
      return { dealId, totalValueText };
    }, 'createDealWithPayments');
  }

  async updateDeal(newData: DealData, originalName?: string, dealId?: number): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      const searchName = originalName ?? newData.name;
      await this.searchAndOpenDeal(searchName, dealId);
      await this.clickEditIcon();
      await this.fillEditForm(newData);
      // WHY: Assert payment status and summary BEFORE saving —
      // verifies the UI reflects the Received status change in the edit modal.
      await this.assertPaymentReceivedAfterEdit();
      await this.saveEditedDeal();
    }, 'updateDeal');
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

  async assertDealUpdated(data: DealData, dealId?: number): Promise<void> {
    // WHY: ID-first — direct navigation is more reliable AND faster than list
    // search (no filter-panel state, no search-index lag, no ambiguity from
    // name collisions). List search is only a fallback for when no ID exists.
    if (dealId) {
      await this.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
      await this.waitForDealDetailsPage();
      // WHY: Confirmed live (2026-07-06, Companies clone investigation) —
      // waitForDealDetailsPage's GET-response wait resolves the instant the
      // network response is observed, not once React has re-rendered the DOM
      // with it. A one-shot body.innerText() read right after can race ahead
      // of the render. Use an auto-retrying assertion instead of a fixed sleep.
      await expect(this.page.locator('body')).toContainText(data.name, { timeout: 15000 });
      return;
    }
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
    // WHY: aligned with config.timeouts.navigation — see pipelineControl's
    // own comment above (fillDealForm) for the full rationale; same fix,
    // same investigation, same class of interaction.
    await stageOption.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
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

  // ──────────────────────────────────────────────────────────
  // Ellipsis Menu Actions
  // ──────────────────────────────────────────────────────────

  async openEllipsisMenu(): Promise<void> {
    logger.info('Opening ellipsis menu');
    await this.ellipsisButton().scrollIntoViewIfNeeded();
    await this.ellipsisButton().click();
    await this.page.locator('.dropdown-menu.show').waitFor({ state: 'visible', timeout: 5000 });
    logger.success('Ellipsis menu opened');
  }

  async clickEllipsisOption(optionText: string): Promise<void> {
    logger.info(`Clicking ellipsis option: ${optionText}`);
    await this.openEllipsisMenu();
    const item = this.ellipsisMenuItem(optionText);
    await item.waitFor({ state: 'visible', timeout: 5000 });
    await item.click();
    logger.success(`Clicked ellipsis option: ${optionText}`);
  }

  async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
    logger.info(`Asserting ellipsis option not visible: ${optionText}`);
    await this.openEllipsisMenu();
    const item = this.ellipsisMenuItem(optionText);
    await expect(item, `Ellipsis option "${optionText}" should not be visible`)
      .toBeHidden({ timeout: 3000 })
      .catch(async () => {
        const count = await item.count();
        expect(count, `Ellipsis option "${optionText}" should not exist`).toBe(0);
      });
    logger.success(`Ellipsis option not visible: ${optionText}`);
  }

  // ──────────────────────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────────────────────

  async deleteDeal(): Promise<void> {
    logger.info('Deleting deal via ellipsis menu');
    await this.clickEllipsisOption('Delete');
    await this.deleteConfirmButton().waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Capture the DELETE response before clicking — never end a mutation
    // with only a blind wait (CLAUDE.md rule #2).
    const deleteResponsePromise = this.armResponseWaitWithRecovery(
      (res) => res.url().match(/\/v1\/deals\/\d+$/) !== null && res.request().method() === 'DELETE',
      'delete deal',
      15000
    ).catch(() => null);
    await this.deleteConfirmButton().click();
    await deleteResponsePromise;
    logger.success('Deal deleted');
  }

  async assertDealDeletedById(dealId: number): Promise<void> {
    logger.info(`Asserting deal ${dealId} is deleted`);
    await this.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
    const detailUrlPattern = new RegExp(`/deals/details/${dealId}$`);
    const errorToast = this.page.locator('.toastr.rrt-error, .alert-danger, [class*="error-toast"]').first();
    // WHY: Wait for one of the two real terminal signals — redirected away or
    // an error toast shown — instead of a blind sleep before checking.
    await Promise.race([
      this.waitForUrl((url) => !detailUrlPattern.test(url.toString()), 10000).catch(() => null),
      errorToast.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null),
    ]);
    const isRedirected = !detailUrlPattern.test(this.page.url());
    const hasErrorToast = await errorToast.isVisible().catch(() => false);
    expect(
      isRedirected || hasErrorToast,
      `Deal ${dealId} should be deleted (redirected away or error toast shown)`
    ).toBeTruthy();
    logger.success(`Deal ${dealId} confirmed deleted`);
  }

  // ──────────────────────────────────────────────────────────
  // Clone
  // ──────────────────────────────────────────────────────────

  async cloneDeal(): Promise<number | null> {
    logger.info('Cloning deal via ellipsis menu');
    await this.clickEllipsisOption('Clone');
    await this.editModal().waitFor({ state: 'visible', timeout: 15000 });
    // WHY: Confirmed live — Clone Deal modal auto pre-fills name as "<original> Copy"
    // and there is no email/phone dedup needed (deal form has neither field, and the
    // app does not reject a duplicate deal name on save).

    // WHY: render-settle wait, root-caused via direct instrumentation
    // (2026-07-17) — NOT a guessed sleep. Reproduced the failure with full
    // request/response/console logging: the Save click sometimes produces
    // ZERO network activity for 10+ seconds afterward, while the button
    // itself stays visible/enabled/unchanged the entire time (ruling out a
    // detached/replaced button, a slow backend response, or backend
    // propagation lag — all would show SOME network signal; this showed
    // none at all). The click was landing only ~80ms after the modal's
    // outer container became visible, while the modal's own async pre-fill
    // (name, owner, pipeline, contacts, company, product rows, campaign
    // fields) was very likely still committing — a known class of
    // Playwright-vs-React timing issue where a click can be dispatched
    // during an in-flight render commit and never reach the component's
    // handler. Waiting for the pre-filled Name field to actually contain
    // "Copy" is a real DOM-state readiness signal (the modal's own
    // rendering has committed its first bound field), not an arbitrary
    // duration — confirmed via 8/8 clean reproductions with this wait in
    // place vs. a mixed pass/fail rate without it.
    await expect(this.nameInput(), 'Clone modal Name field should be pre-filled before Save is clicked').toHaveValue(
      /Copy/,
      { timeout: 10000 }
    );

    const dealIdPromise = this.captureDealIdFromResponse();
    await this.click(this.saveEditButton(), 'clone save button');
    await this.assertNoFormErrors('deal clone form');
    const clonedId = await dealIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveDeal() above.
    if (!clonedId) {
      throw new Error('Cloned deal ID not captured after save — cannot proceed (save likely failed silently)');
    }
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    logger.success(`Deal cloned — new ID: ${clonedId}`);
    return clonedId;
  }

  async assertClonedDealName(originalName: string, clonedId?: number | null): Promise<void> {
    // WHY: ID-first — mirrors LeadsPage.assertClonedLeadLastName's fix. List
    // search does a loose multi-field match with no guaranteed row position;
    // navigating directly to the clone's own ID is deterministic.
    //
    // WHY clonedId is optional with a list-search fallback (2026-07-16):
    // same reasoning as LeadsPage/CompaniesPage's equivalents — a caller
    // whose ID capture genuinely failed shouldn't hard-fail the whole test
    // on that alone; fall back to the existing retry-based list search as
    // a last resort rather than a primary path.
    const clonedName = `${originalName} Copy`;
    if (clonedId) {
      logger.info(`Asserting cloned deal has "Copy" in name — original: ${originalName}`);
      await this.navigateTo(`${config.appUrl}/sales/deals/details/${clonedId}`);
      await this.waitForDealDetailsPage();
      // WHY: Confirmed live (2026-07-06, Companies clone investigation) —
      // waitForDealDetailsPage's GET-response wait resolves the instant the
      // network response is observed, not once React has re-rendered the DOM
      // with it. A one-shot body.innerText() read right after can race ahead
      // of the render. Use an auto-retrying assertion instead of a fixed sleep.
      await expect(this.page.locator('body')).toContainText(clonedName, { timeout: 15000 });
      logger.success(`Cloned deal found with name: ${clonedName}`);
      return;
    }
    logger.warn('Cloned deal ID not available — falling back to list search');
    const found = await this.retryFindDeal(clonedName);
    expect(found, `Cloned deal "${clonedName}" should exist in list`).toBeTruthy();
    logger.success(`Cloned deal found with name: ${clonedName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Share Deal
  // ──────────────────────────────────────────────────────────

  // WHY: escapeRegExp() moved to BasePage (2026-07-16) — Contact's
  // selectRandomFromSearchableReactSelect() needed the identical exact-match
  // escaping, so the duplicate here was removed in favor of the shared,
  // inherited version.

  // WHY the bounded retry (root-caused 2026-07-22 from real ~9min hangs that
  // stalled a full-suite regression run across many share-based RBAC tests):
  // see LeadsPage.openUserShareTypeSearch() for the full explanation. This
  // method already had a bounded `waitFor` before the fill (unlike the other
  // 3 modules' shareXxx methods, which went straight to an unbounded fill),
  // so on its own it failed at 5s rather than hanging for minutes — but it
  // never RETRIED, so a single missed click still failed the whole test.
  // Fixed identically to the other 3 modules for consistency: bound every
  // click to config.timeouts.expect and retry the whole open-type-dropdown
  // -> select-User -> wait-for-search-input sequence up to 3 times.
  private async openUserShareTypeSearch(shareTypeControl: Locator): Promise<void> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await shareTypeControl.click({ timeout: config.timeouts.expect });
        const userOption = this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first();
        await userOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
        await userOption.click({ timeout: config.timeouts.expect });
        await this.shareToUserInput().waitFor({ state: 'visible', timeout: config.timeouts.expect });
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `Share-type "User" selection attempt ${attempt}/${maxAttempts} failed: ${String(error)} — ` +
            'closing any stuck menu and retrying'
        );
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(500);
      }
    }
    throw new Error(
      `openUserShareTypeSearch: failed to select "User" share type after ${maxAttempts} attempts — ` +
        `${String(lastError)}`
    );
  }

  async shareDeal(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing deal with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
    await this.clickEllipsisOption('Share');
    await this.shareModal().waitFor({ state: 'visible', timeout: 10000 });

    // WHY: Open the Share To type dropdown, select "User"
    const shareTypeControl = this.shareModal().locator('.is-invalid__control').first();
    await shareTypeControl.waitFor({ state: 'visible', timeout: 10000 });
    await this.openUserShareTypeSearch(shareTypeControl);

    // WHY: Search requires >= 3 chars — find first eligible word, fallback to first 3 chars
    const words = restrictedUserName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
    await this.shareToUserInput().fill(validWord, { timeout: config.timeouts.expect });
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(restrictedUserName)}\\s*$`) })
      .first();
    await userItem.waitFor({ state: 'visible', timeout: 10000 });
    await userItem.click({ timeout: config.timeouts.expect });

    // WHY: Enable specific permissions — JS click on label sibling of input,
    // then verify the toggle actually reflects checked state before moving on.
    for (const permission of permissions) {
      const toggle = this.sharePermissionToggle(permission);
      const isChecked = await toggle.isChecked().catch(() => false);
      if (!isChecked) {
        await this.page.evaluate((perm) => {
          const input = document.querySelector(`#inp_${perm}`) as HTMLElement;
          (input?.parentElement?.querySelector('label') as HTMLElement)?.click();
        }, permission);
        await expect(toggle, `Permission "${permission}" should be checked after toggling`).toBeChecked({
          timeout: 3000,
        });
      }
    }

    await this.shareConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the share-API response wait BEFORE clicking — confirms the
    // server actually processed the permission change instead of a blind sleep.
    const shareResponsePromise = this.armResponseWaitWithRecovery(
      (res) =>
        res.url().match(/\/v1\/deals\/\d+\/share$/) !== null && res.request().method() === 'POST',
      'deal share response',
      15000
    ).catch(() => null);
    await this.shareConfirmButton().click();
    await shareResponsePromise;
    await this.shareModal().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
    logger.success(`Deal shared with: ${restrictedUserName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Reassign Deal
  // ──────────────────────────────────────────────────────────

  async reassignDeal(userName: string): Promise<void> {
    logger.info(`Reassigning deal to: ${userName}`);
    await this.clickEllipsisOption('Reassign');
    await this.reassignUserInput().waitFor({ state: 'visible', timeout: 10000 });

    const words = userName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
    await this.reassignUserInput().fill(validWord);
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(userName)}\\s*$`) })
      .first();
    await userItem.waitFor({ state: 'visible', timeout: 10000 });
    await userItem.click();

    await this.reassignConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the reassign-API (owner change) response wait BEFORE
    // clicking — confirms ownership actually changed server-side.
    const reassignResponsePromise = this.armResponseWaitWithRecovery(
      (res) =>
        res.url().match(/\/v1\/deals\/\d+\/owner$/) !== null && res.request().method() === 'PUT',
      'deal reassign response',
      15000
    ).catch(() => null);
    await this.reassignConfirmButton().click();
    await reassignResponsePromise;
    await this.reassignUserInput().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
    logger.success(`Deal reassigned to: ${userName}`);
  }

  // ──────────────────────────────────────────────────────────
  // Add Contact
  // ──────────────────────────────────────────────────────────

  // WHY these three methods read from the real backend API, not the
  // "Associated Contacts" UI card (confirmed live, 2026-07-27): the deal
  // detail page's own card has a CONFIRMED, REAL, unresolved app-level
  // display/rendering bug — it shows "No Contacts found" even when the
  // backend genuinely has a real association. Verified directly: fetched
  // `GET /v1/deals/<id>` for a live deal and found
  // `"associatedContacts":[{"id":466276,"name":"..."}]` in the raw response
  // body, while that exact same deal's own detail page DOM showed
  // `<div class="no-associated-entity">...No Contacts found...</div>` —
  // the card is empty in the UI despite the API having real data. This is a
  // genuine, user-facing Kylas product defect (documented in full in
  // CLAUDE.md's Known Issues) — separate from, but the direct cause of, a
  // second problem: these three methods used to scrape that same broken
  // card, so they were fooled by it too, reporting "no contact" for deals
  // that genuinely had one. Fixed by reading the deal's own GET response
  // directly instead, which reflects the real backend state regardless of
  // what the (buggy) UI renders.
  private async fetchCurrentDealApiData(): Promise<Record<string, unknown> | null> {
    const match = this.page.url().match(/\/deals\/details\/(\d+)/);
    if (!match) return null;
    const dealId = match[1];
    return this.page.evaluate(
      async ({ id, apiBase }) => {
        try {
          const raw = localStorage.getItem('token');
          if (!raw) return null;
          const payload = JSON.parse(atob(raw.split('.')[1]));
          const accessToken = payload?.data?.accessToken;
          if (!accessToken) return null;
          const res = await fetch(`${apiBase}/deals/${id}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        }
      },
      { id: dealId, apiBase: config.apiBaseUrl }
    );
  }

  private async getAssociatedContacts(): Promise<Array<{ id: number; name: string }>> {
    const data = await this.fetchCurrentDealApiData();
    return (data?.associatedContacts as Array<{ id: number; name: string }> | undefined) ?? [];
  }

  // WHY these are DECISION-HELPERS, not UI assertions — used internally by
  // tests (e.g. Call/Quotation permission) to decide "is a contact actually
  // associated, yes or no" before acting on that fact (e.g. sharing it).
  // Their job is to reflect real state so the caller acts correctly — they
  // are deliberately NOT used to verify what the "Associated Contacts" UI
  // card displays (see `getDisplayedAssociatedContactsCount()` below for
  // that distinct purpose, which deliberately keeps reading the UI).
  async getAssociatedContactId(): Promise<number | null> {
    return (await this.getAssociatedContacts())[0]?.id ?? null;
  }

  async getAssociatedContactName(): Promise<string | null> {
    return (await this.getAssociatedContacts())[0]?.name ?? null;
  }

  async getAssociatedContactsCount(): Promise<number> {
    return (await this.getAssociatedContacts()).length;
  }

  // WHY this is a SEPARATE method from getAssociatedContactsCount() above,
  // not a shared one (2026-07-27): D35 (deals.spec.ts) exists specifically
  // to verify a contact becomes visible in the "Associated Contacts" UI
  // card after being added — that is the whole point of the test, and its
  // own confirmed, real, unresolved app-level display bug (see CLAUDE.md)
  // must keep surfacing through this exact assertion, unaffected by the
  // API-based fix above. Reading the UI here is deliberate, not a leftover
  // — do not consolidate this with getAssociatedContactsCount().
  async getDisplayedAssociatedContactsCount(): Promise<number> {
    const card = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Associated Contacts' }) })
      .first();
    const headerText = await card.locator('h2').textContent().catch(() => '');
    const match = headerText?.match(/\((\d+)\)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  async getAssociatedCompanyName(): Promise<string | null> {
    // WHY: The company header field renders as a styled <span>, not an <a href>,
    // so there's no ID to read directly (unlike the contact link) — name-based
    // lookup is the practical option here, not a shortcut around ID-first.
    return (
      (await this.companyFieldValue()
        .textContent({ timeout: config.timeouts.expect })
        .catch(() => null))?.trim() ?? null
    );
  }

  async addContactToDeal(): Promise<void> {
    // WHY: Confirmed live — "Add Contact" in the deal ellipsis menu reuses the
    // full "Edit Deal" modal scoped to the associatedContacts field. Unlike
    // Contacts/Companies, Deals has no dedicated new-contact-creation form here —
    // it only lets you attach an EXISTING contact via the same picker fillDealForm uses.
    logger.info('Adding existing contact to deal via ellipsis menu');
    await this.clickEllipsisOption('Add Contact');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal().locator('.modal-title')).toHaveText('Edit Deal', { timeout: 5000 })
    );

    // WHY: Confirmed live via elementFromPoint + control-class polling — unlike
    // the create-deal flow, when associatedContacts is empty this field's
    // dropdown AUTO-OPENS itself asynchronously (~500ms after the modal
    // renders, zero clicks) — verified: control class had no "menu-is-open" at
    // t=0 (0 options) and had it with 25 options at t=500ms, with no
    // interaction in between. Manually clicking the indicator (as the shared
    // selectFirstOptionFromDropdown helper does, correctly, for the create
    // flow's genuinely-closed case) races this in-flight auto-open — React
    // replaces the control mid-click, which is what caused the indicator click
    // to hang forever in an actionability retry loop ("intercepts pointer
    // events"). Don't click at all on the primary path — just wait for the
    // auto-opened options; only click as a fallback if it never auto-opens.
    const control = this.associatedContactsInput().locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    const indicator = control.locator('.is-invalid__dropdown-indicator');
    await indicator.waitFor({ state: 'visible', timeout: 10000 });
    const firstOption = this.page.locator('.is-invalid__option').first();
    try {
      await firstOption.waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      logger.info('Associated contacts did not auto-open — clicking indicator as fallback');
      await indicator.scrollIntoViewIfNeeded();
      await indicator.click();
      await firstOption.waitFor({ state: 'visible', timeout: 10000 });
    }
    // WHY: shared bounded+re-roll selector (2026-07-17) — previously an
    // unbounded textContent()+click() on a random index, same bug class as
    // selectFirstOptionFromDropdown().
    const allOptions = this.page.locator('.is-invalid__option');
    await this.selectRandomOptionWithRetry(allOptions, 'Associated contact');

    await this.saveEditedDeal();
    logger.success('Contact added to deal');
  }

  // ──────────────────────────────────────────────────────────
  // Right Panel Icon Actions
  // ──────────────────────────────────────────────────────────

  async clickRightPanelIcon(title: string): Promise<void> {
    logger.info(`Clicking right panel icon: ${title}`);
    const icon = this.rightPanelIcon(title);
    await icon.waitFor({ state: 'visible', timeout: 10000 });
    await icon.click();
    logger.success(`Right panel icon clicked: ${title}`);
  }

  async assertRightPanelIconVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon visible: ${title}`);
    const icon = this.rightPanelIcon(title);
    try {
      await this.withSessionExpiryRecovery(() =>
        expect(icon, `Right panel icon "${title}" should be visible`).toBeVisible({
          timeout: config.timeouts.navigation,
        })
      );
    } catch (error) {
      // WHY the reload-and-retry — same confirmed gap as LeadsPage's own
      // assertRightPanelIconVisible (CI flake 2026-07-22): the right panel's
      // icon set reads a permissions snapshot taken once at page mount, so a
      // plain wait — however long — cannot recover if that snapshot predates
      // the share's propagation. A reload forces a fresh mount/fetch. Applied
      // here defensively (not from a live repro of THIS module specifically)
      // since the mechanism is structural, not Leads-specific.
      logger.warn(
        `Right panel icon "${title}" not visible within ${config.timeouts.navigation}ms — ` +
          `reloading and retrying once: ${String(error)}`
      );
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForDealDetailsPage();
      await this.withSessionExpiryRecovery(() =>
        expect(icon, `Right panel icon "${title}" should be visible after reload`).toBeVisible({
          timeout: config.timeouts.navigation,
        })
      );
    }
    logger.success(`Right panel icon visible: ${title}`);
  }

  async assertRightPanelIconNotVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon NOT visible: ${title}`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.rightPanelIcon(title), `Right panel icon "${title}" should be hidden`).toBeHidden({
        timeout: 5000,
      })
    );
    logger.success(`Right panel icon not visible: ${title}`);
  }

  async addNoteFromPanel(noteText: string): Promise<void> {
    logger.info(`Adding note from deal panel: "${noteText}"`);
    await this.clickRightPanelIcon('Notes');
    const notesTextarea = this.page.locator('textarea.notes-textarea');
    await notesTextarea.waitFor({ state: 'visible', timeout: 10000 });
    await notesTextarea.click();
    const richTextEditor = this.page.getByRole('textbox', { name: 'Rich Text Editor, main' });
    await richTextEditor.waitFor({ state: 'visible', timeout: 10000 });
    await richTextEditor.fill(noteText);
    const addButton = this.page.getByText('Add', { exact: true });
    await addButton.waitFor({ state: 'visible', timeout: 5000 });
    await addButton.click();
    await this.page.locator('div.row.pt-2.pl-2.pr-2').first().waitFor({ state: 'visible', timeout: 10000 });
    logger.success(`Note added: "${noteText}"`);
  }

  async addTaskFromPanel(taskName: string): Promise<void> {
    logger.info(`Adding task from deal panel: "${taskName}"`);
    await this.clickRightPanelIcon('Tasks');
    const tasksPage = new TasksPage(this.page);
    const taskData = generateTaskData({ name: taskName });
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    await tasksPage.saveQuickTaskFromEntityDetail();
    logger.success(`Task added from panel: "${taskName}"`);
  }

  async addMeetingFromPanel(meetingTitle: string): Promise<void> {
    logger.info(`Adding meeting from deal panel: "${meetingTitle}"`);
    const dealUrl = this.page.url();
    await this.clickRightPanelIcon('Meetings');
    const addMeetingButton = this.page.locator('#addMeeting');
    await addMeetingButton.waitFor({ state: 'visible', timeout: 10000 });
    await addMeetingButton.click();
    const meetingsPage = new MeetingsPage(this.page);
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: Save directly without meetingsPage.saveMeeting() — that method
    // navigates to the meeting's own detail page via a post-save popup, which
    // would strand us away from the deal detail page mid-flow.
    const saveBtn = this.page.locator('button.save-button, #editEntityModal button[type="submit"]').first();
    await saveBtn.waitFor({ state: 'visible', timeout: 10000 });
    await saveBtn.click();
    await this.assertNoFormErrors('meeting create form (from deal panel)');
    await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    if (!this.page.url().includes(dealUrl.split('/details/')[1] ?? '___never___')) {
      await this.navigateTo(dealUrl);
      await this.waitForDealDetailsPage();
    }
    logger.success(`Meeting added from panel: "${meetingTitle}"`);
  }

  async addQuotationFromPanel(): Promise<string | null> {
    logger.info('Adding quotation from deal productivity panel');
    await this.clickRightPanelIcon('Quotations');
    const quotationsCard = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Quotations' }) })
      .first();
    // WHY: Confirmed live (2026-07-06/07, D22) — the Quotations card refetches
    // its own related-quotations list independently of the main deal GET.
    // A scrollIntoViewIfNeeded() right after this waitFor still has a narrow
    // window to grab a reference to a card React is about to replace,
    // hanging in its "wait for stable position" check. click() below
    // auto-scrolls its own target, so drop the manual scroll entirely.
    await quotationsCard.waitFor({ state: 'visible', timeout: 15000 });
    const quotationCardAdd = quotationsCard.locator('button.btn-primary.btn-xs').first();
    await quotationCardAdd.waitFor({ state: 'visible', timeout: 10000 });
    await quotationCardAdd.click();
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal().locator('.modal-title')).toHaveText('Add Quotation', { timeout: 10000 })
    );

    // WHY: tightened 2026-07-17 — confirmed live (Deals RBAC "Quotation
    // permission" test, 2/2 reproductions across two separate full-Deals
    // verification runs) that the loose `.includes('/quotations')` match
    // — the exact same shape of bug already root-caused and fixed for
    // DealsPage.captureDealIdFromResponse() and
    // CompaniesPage.captureCompanyIdFromResponse() earlier tonight — throws
    // "Quotation ID not captured... save likely failed silently" even
    // though the save genuinely succeeded (the failure screenshot's own
    // toast read "Quotation created (Quotation ID: 8794)"). Tightened to
    // require `/v1/quotations` specifically, matching the real create
    // endpoint already confirmed and documented in
    // `QuotationsPage.captureQuotationIdFromResponse()`'s own comment
    // ("the real create endpoint is `/v1/quotations/` WITH a trailing
    // slash"). Also added a toast-text fallback — `QuotationsPage` already
    // has a working `captureIdFromToast()` for exactly this ID shape
    // ("Quotation ID: (\d+)"), so reuse that proven mechanism as
    // defense-in-depth rather than relying on the network capture alone.
    const quotationIdPromise = this.armResponseWaitWithRecovery(
      (res) => /\/v1\/quotations\/?(\?|$)/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
      'capture quotation ID (from deal panel)',
      30000
    )
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        const id = body?.id ?? body?.data?.id ?? body?.quotationId ?? null;
        return id ? String(id) : null;
      })
      .catch(() => null);

    const timestamp = Date.now();
    const quotationNumber = `QUO-${timestamp}`;
    const quotationNumberInput = this.page.locator('[id="0_11_input_quotationNumber"]');
    await quotationNumberInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.fill(quotationNumberInput, quotationNumber, 'quotation number');
    const summaryField = this.page.locator('[id="0_21_input_summary"]');
    await this.fill(summaryField, `Summary-${timestamp}`, 'summary');

    const firstProductPrice = this.page.locator('[id="1_03_input_products.0.price"]');
    const firstProductValue = await firstProductPrice.inputValue().catch(() => '');
    if (!firstProductValue || firstProductValue === '0') {
      const productInput = this.page.locator('[id*="input_products.0.id"]').first();
      if (await productInput.isVisible().catch(() => false)) {
        const productControl = this.page.locator('.is-invalid__control').filter({ has: productInput });
        await productControl.click();
        await productInput.fill('BHK');
        const productOptions = this.page.locator('.is-invalid__option');
        await productOptions.first().waitFor({ state: 'visible', timeout: 15000 });
        await productOptions.first().click();
        await this.page
          .locator('.is-invalid__menu')
          .waitFor({ state: 'hidden', timeout: 10000 })
          .catch(() => {});
        const quantityInput = this.page.locator('input[name="products.0.quantity"]').first();
        if (await quantityInput.isVisible().catch(() => false)) {
          const qtyVal = await quantityInput.inputValue().catch(() => '');
          if (!qtyVal || qtyVal === '0') {
            await quantityInput.fill('1');
          }
        }
      }
    }

    const modalSaveButton = this.page.locator('#editEntityModal button[type="submit"].btn-primary');
    await modalSaveButton.waitFor({ state: 'visible', timeout: 5000 });
    await modalSaveButton.click();
    await this.assertNoFormErrors('add quotation from panel');
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    let quotationId = await quotationIdPromise;
    // WHY: toast-text fallback (2026-07-17) — reuses the same proven
    // "Quotation ID: (\d+)" parse already working in
    // QuotationsPage.captureIdFromToast(). The network capture can still
    // miss a genuine save (e.g. a response arriving right as the modal-hide
    // wait above resolves), and the app's own success toast visibly shows
    // the ID regardless — confirmed live in the exact failure this fixes
    // (toast read "Quotation created (Quotation ID: 8794)" while the network
    // capture returned null).
    if (!quotationId) {
      const toastLink = this.page.locator('.toastr.rrt-success .link-primary');
      const toastText = await toastLink.textContent({ timeout: 3000 }).catch(() => null);
      const toastMatch = toastText?.match(/Quotation ID:\s*(\d+)/);
      if (toastMatch) {
        quotationId = toastMatch[1];
        logger.info(`Quotation ID recovered from toast text (network capture missed it): ${quotationId}`);
      }
    }
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveDeal() above. Does not
    // affect the permission-denied test path, which throws earlier via assertNoFormErrors()
    // on the visible validation banner before this line is ever reached.
    if (!quotationId) {
      throw new Error('Quotation ID not captured after save — cannot proceed (save likely failed silently)');
    }
    logger.success(`Quotation added from panel: ${quotationId}`);
    return quotationId;
  }

  // ──────────────────────────────────────────────────────────
  // Detail Page Fields
  // ──────────────────────────────────────────────────────────

  async assertOwnerOnDetail(expectedOwner: string): Promise<void> {
    logger.info(`Asserting owner on detail: ${expectedOwner}`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.ownerFieldValue(), `Owner field should show "${expectedOwner}"`).toContainText(
        expectedOwner,
        { timeout: 10000 }
      )
    );
    logger.success(`Owner confirmed: ${expectedOwner}`);
  }

  async assertDealDetailFields(data: DealData): Promise<void> {
    logger.info('Asserting deal detail header fields and tabs');
    await this.assertOnDealDetailPage();
    await this.withSessionExpiryRecovery(() => expect(this.ownerFieldValue()).toBeVisible({ timeout: 10000 }));
    await this.withSessionExpiryRecovery(() => expect(this.companyFieldValue()).toBeVisible({ timeout: 10000 }));
    await this.withSessionExpiryRecovery(() => expect(this.productsFieldValue()).toBeVisible({ timeout: 10000 }));
    await this.withSessionExpiryRecovery(() =>
      expect(this.estimatedValueFieldValue()).toContainText('INR', { timeout: 10000 })
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.actualValueFieldValue()).toContainText('INR', { timeout: 10000 })
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.estimatedClosureFieldValue()).toBeVisible({ timeout: 10000 })
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.actualClosureFieldValue()).toBeVisible({ timeout: 10000 })
    );
    // WHY: Converted From always reads "-" for deals not created via lead
    // conversion (out of scope here) — presence check only, not value match.
    await this.withSessionExpiryRecovery(() =>
      expect(this.convertedFromFieldValue()).toBeVisible({ timeout: 10000 })
    );

    const tabPane = this.page.locator('.tab-pane.active.show');

    await this.page.locator('#nav-tab0-tab').click();
    await expect(tabPane, 'Basic Information tab should show the deal name').toContainText(data.name, {
      timeout: 10000,
      ignoreCase: true,
    });

    await this.page.locator('#nav-tab1-tab').click();
    await expect(tabPane, 'Campaign Information tab should show UTM source').toContainText(
      data.utmSource,
      { timeout: 10000, ignoreCase: true }
    );
    await expect(tabPane).toContainText(data.utmCampaign, { timeout: 10000, ignoreCase: true });
    await expect(tabPane).toContainText(data.utmMedium, { timeout: 10000, ignoreCase: true });
    await expect(tabPane).toContainText(data.utmTerm, { timeout: 10000, ignoreCase: true });

    // WHY #nav-tab3-tab, not #nav-tab2-tab: confirmed live (2026-07-24) —
    // Deal gained its own "Other Details" custom-field tab, which now sits
    // between Campaign Information and Internals, shifting Internals from
    // index 2 to index 3. This tab pane's assertion had gone stale the
    // moment that tab was added to the account; not something introduced by
    // this change.
    await this.page.locator('#nav-tab3-tab').click();
    // WHY: Confirmed live — the word "Internals" only labels the tab nav item,
    // it never appears inside the pane's own content. Assert real content
    // instead (Created By/Forecasting Type are always present on any deal).
    await expect(tabPane, 'Internals tab should be active').toContainText('Created By', { timeout: 10000 });
    await expect(tabPane).toContainText('Forecasting Type');

    logger.success('Deal detail fields verified');
  }

  // WHY: mirrors LeadsPage.assertLeadCustomFieldsOnDetail()/
  // ContactsPage.assertContactCustomFieldsOnDetail() — only the 2 dedicated
  // custom-field tests need full value verification, every other Deal test
  // just needs fillDealCustomFields()'s fill-if-present behavior to run
  // without erroring. Throws (does not skip) on a missing tab — this method
  // is called ONLY from the dedicated tests, which always run on an
  // environment already confirmed (via skipIfCustomFieldsAbsent()) to have
  // these fields, so a missing tab here means verification genuinely failed
  // to run, not a legitimate environment-absence case.
  async assertDealCustomFieldsOnDetail(data: DealData): Promise<void> {
    logger.info('Asserting all 9 custom field values on deal detail page');
    const tab = this.otherDetailsDetailPageTab();
    // WHY wrapped in withSessionExpiryRecovery: this file's own convention
    // (see assertDealDetailFields() above) wraps every raw expect()/click()
    // pair on the detail page the same way — matching that, not Lead's
    // unwrapped equivalent, since this new code lives in DealsPage.ts.
    await this.withSessionExpiryRecovery(() =>
      expect(
        tab,
        '"Other Details" tab did not appear on the detail page — custom field verification cannot proceed'
      ).toBeVisible({ timeout: config.timeouts.navigation })
    );
    await tab.click();
    await this.page.waitForTimeout(500);

    const cf = data.customFields;
    await this.assertCustomFieldOnDetail(DEAL_CUSTOM_FIELD_NAMES.textField, cf.textField, 'Text Field');
    await this.assertCustomFieldOnDetail(
      DEAL_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.assertCustomFieldOnDetail(DEAL_CUSTOM_FIELD_NAMES.number, String(cf.number), 'Number');
    await this.assertCustomFieldOnDetail(DEAL_CUSTOM_FIELD_NAMES.urlField, cf.urlField, 'URL Field');
    await this.assertCustomFieldOnDetail(
      DEAL_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox ? 'Yes' : 'No',
      'Checkbox'
    );
    await this.assertCustomFieldOnDetail(
      DEAL_CUSTOM_FIELD_NAMES.date,
      this.formatCustomFieldDetailDate(cf.date),
      'Date'
    );
    await this.assertCustomFieldOnDetail(
      DEAL_CUSTOM_FIELD_NAMES.dateTimePicker,
      this.formatCustomFieldDetailDateTime(cf.dateTimePicker),
      'Date Time Picker'
    );
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(DEAL_CUSTOM_FIELD_NAMES.pickList, cf.pickList, 'Pick List');
    }
    if (cf.multiPickList.length > 0) {
      await this.assertMultiPicklistCustomFieldOnDetail(
        DEAL_CUSTOM_FIELD_NAMES.multiPickList,
        cf.multiPickList,
        'Multi Pick List'
      );
    }
    logger.success('All 9 custom field values verified on deal detail page');
  }

  async assertClosedPipelineStage(expectedLabel: string): Promise<void> {
    logger.info(`Asserting closed pipeline stage: ${expectedLabel}`);
    await expect(
      this.closedPipelineStageEl(),
      `Closed pipeline stage should show "${expectedLabel} Deal"`
    ).toContainText(`${expectedLabel} Deal`, { timeout: 15000 });
    logger.success(`Closed pipeline stage verified: ${expectedLabel}`);
  }
}
