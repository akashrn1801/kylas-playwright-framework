import { Page, expect, Locator, Response } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { LeadData, LEAD_CUSTOM_FIELD_NAMES } from '../../data/factories/leadFactory';
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

  // WHY: the actual checkbox behind the toggle above — confirmed live
  // (2026-07-08) as id="00_input_important_field". Needed to check its
  // current checked state rather than blindly clicking the label every time.
  // WHY xpath sibling, not `#00_input_important_field`: confirmed live
  // (2026-07-08 custom-fields regression investigation) — an id selector
  // whose value starts with a digit is invalid, unescaped CSS syntax; every
  // call threw a SyntaxError that was silently swallowed by this method's
  // own `.catch(() => true)` fallback, defaulting to "checked" and therefore
  // clicking the toggle UNCONDITIONALLY every time — the exact bug this
  // idempotency check was written to prevent. Harmless on create (the toggle
  // genuinely starts checked there), but on edit it clicked an
  // already-unchecked toggle back on, hiding "Other Details" and silently
  // no-opping every custom-field fill for the whole update path. Locating by
  // DOM relationship instead of a raw id sidesteps the escaping problem
  // entirely.
  private readonly showRequiredToggleCheckbox = (): Locator =>
    this.showRequiredToggle().locator('xpath=preceding-sibling::input[@type="checkbox"]');

  // ── Custom fields ("Other Details" section) ─────────────────
  // WHY: scoped to the modal — the background page behind an edit modal can
  // render its own element with the exact same "Other Details" text (its
  // read-only detail tab), and an unscoped locator can resolve to that one
  // instead, then hang waiting for the modal covering it. Confirmed live
  // (2026-07-08) as the root cause of a stuck edit-form custom-field fill.
  private readonly otherDetailsFormSectionNav = (): Locator =>
    this.editModal().locator('a.nav-link').filter({ hasText: 'Other Details' });

  private readonly otherDetailsDetailPageTab = (): Locator =>
    this.page.locator('a[data-targetid="Other Details"]');

  private readonly requirementDetailPageTab = (): Locator =>
    this.page.locator('a[data-targetid="Requirement"]');

  // WHY: confirmed live (2026-07-08) — same id as Contact's own Salutation
  // field (`0_11_input_salutation`), but Lead's fill strategy differs: this
  // codebase selects a random LIVE option (never a hardcoded value), unlike
  // Contact's selectFromContactDropdown() which types a specific value.
  private readonly salutationControl = (): Locator =>
    this.page
      .locator('[id="0_11_input_salutation"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

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

  // ── Campaign Information ────────────────────────────────────
  // WHY: confirmed live (2026-07-08) — Campaign and Source are react-select
  // dropdowns (Lead has both; Contact/Deal's equivalent section only has
  // Campaign, no standalone Source — verified live, not assumed identical).
  // The rest are plain text inputs, located by `name` like every other base
  // Lead field in this file — no numeric-prefix dependency for those.
  private readonly campaignControl = (): Locator =>
    this.page
      .locator('[id="6_11_input_campaign"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly sourceControl = (): Locator =>
    this.page
      .locator('[id="6_12_input_source"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly subSourceInput = (): Locator => this.page.locator('input[name="subSource"]');

  private readonly utmSourceInput = (): Locator => this.page.locator('input[name="utmSource"]');

  private readonly utmCampaignInput = (): Locator => this.page.locator('input[name="utmCampaign"]');

  private readonly utmMediumInput = (): Locator => this.page.locator('input[name="utmMedium"]');

  private readonly utmContentInput = (): Locator => this.page.locator('input[name="utmContent"]');

  private readonly utmTermInput = (): Locator => this.page.locator('input[name="utmTerm"]');

  // ── Requirement (Products or Services, Currency, Budget) ─────
  // WHY: confirmed live (2026-07-08) — "Products or Services" is technically
  // a lookup field against real Product records (class="look-up
  // multi-lookup", placeholder "Search..." not "Choose"), not a static
  // picklist. Confirmed it still behaves identically to a plain multi-select
  // for this codebase's purposes: opening it without typing anything shows a
  // default option list, and clearing existing chips reliably repopulates
  // the menu with whatever was just freed up — so the same generic
  // selectRandomFromMultiValueReactSelect() helper applies unmodified.
  private readonly productsControl = (): Locator =>
    this.page
      .locator('[id="5_21_input_products"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly currencyControl = (): Locator =>
    this.page
      .locator('[id="5_22_input_requirementCurrency"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly budgetInput = (): Locator =>
    this.page.locator('[id="5_23_input_requirementBudget"]');

  private readonly saveButton = (): Locator =>
    this.page.locator('button[type="submit"].save-button');

  private readonly editIconButton = (): Locator => this.page.locator('#edit-action-btn');

  private readonly editModal = (): Locator => this.page.locator('#editEntityModal');

  // WHY: scoped to #editEntityModal, not page-wide — confirmed live
  // (2026-07-08) that this app has at least 6 different modal templates
  // (filterModal, createSmartListModal, editEntityModal, confirmModal, and
  // 2 others) that all share the generic `data-dismiss="modal"` attribute
  // on their own close/cancel buttons. An unscoped `.first()` resolved to a
  // hidden, 0×0 button belonging to an unrelated, closed "filterModal"
  // template instead of the real, visible editEntityModal close button —
  // Playwright then waited forever for an element that could never become
  // visible, since it belongs to a modal that was never open. This stayed
  // dormant for months because closeModalIfOpen() only runs at the start of
  // goToLeadsList(), and every existing Lead test calls goToLeadsList() only
  // once, before any modal is ever open — never triggering this click.
  private readonly modalCancelButton = (): Locator =>
    this.editModal().locator('button[data-dismiss="modal"]').first();

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
    this.page
      .locator('.dropdown-menu.closed-stage-list .close-stage-title')
      .filter({ hasText: stage })
      .first();

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
  private readonly shareToTypeInput = (): Locator => this.page.locator('#input_toType');

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
  private readonly detailTabPane = (): Locator => this.page.locator('.tab-pane.active.show');

  private readonly detailOwner = (): Locator =>
    this.page
      .locator('.detail-section')
      .filter({ hasText: 'Owner' })
      .locator('p, span, div')
      .first();

  private readonly validationError = (fieldId: string): Locator =>
    this.page.locator(`#${fieldId} .invalid-feedback, #${fieldId} .help-text.error`).first();

  // ── Right panel icons ──────────────────────────────────────
  // WHY: Map title to SVG ID — restricted user pages don't have title attributes
  private readonly rightPanelIconSvgMap: Record<string, string> = {
    Notes: 'paint0_linear_972_2654',
    Tasks: 'clip-Ic_Task',
    Meetings: 'clip-Ic_Meetings',
    'Call Logs': 'paint1_linear_leads',
    Documents: 'Rectangle_5931',
  };

  private readonly rightPanelIcon = (title: string): Locator => {
    // WHY: Try title attribute first (admin view), fallback to SVG ID (restricted view)
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

        // WHY: explicit timeout — a raw, unbounded click() here previously
        // inherited the whole test's timeout (up to 8 minutes) on failure
        // instead of failing fast into this method's own try/catch.
        await this.modalCancelButton().click({ timeout: 10000 });

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
        // WHY: confirmed live (2026-07-08) — this toggle's on/off state is
        // NOT re-initialized per form open; it can already be off from a
        // prior action in the same session. A blind, unconditional click
        // here would flip an already-off toggle back ON — hiding the "Other
        // Details" section (and its custom fields) right when a caller
        // needs it visible. Only click when it's actually checked.
        const isChecked = await this.showRequiredToggleCheckbox()
          .isChecked()
          .catch(() => true);
        if (!isChecked) {
          logger.debug('Show Required & Important Fields already disabled — skipping click');
          return;
        }

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

  // WHY: the 9 custom fields live in the "Other Details" section, which only
  // renders once disableRequiredFieldsToggle() has run — shared by both the
  // create form (fillLeadForm) and the edit form (fillEditForm) so custom
  // fields are reachable from either path.
  private async openOtherDetailsFormSection(): Promise<void> {
    const nav = this.otherDetailsFormSectionNav();
    if (!(await nav.isVisible({ timeout: 5000 }).catch(() => false))) {
      logger.debug(
        '"Other Details" nav item not visible — custom fields section unavailable on this form'
      );
      return;
    }
    await nav.click();
    await this.page.waitForTimeout(500);
  }

  // WHY: fills the Campaign Information section — Campaign and Source are
  // react-select dropdowns with account-configured, live-read options
  // (never hardcode a value); the rest are plain text inputs. Mutates
  // `data.campaignInfo.campaign`/`.source` in place with whatever was
  // actually selected live, same reasoning as fillLeadCustomFields()'s
  // PickList/MultiPickList handling below — the caller's `data` object
  // needs to reflect reality for later verification.
  //
  // WHY this exists as its own method rather than folded into
  // fillLeadCustomFields(): Campaign Information and "Other Details" are two
  // entirely separate form sections with no shared fields — keeping them
  // separate avoids the exact class of ordering/insertion bug this method
  // was added to investigate (a section's fill logic getting silently lost
  // by being interleaved into an unrelated section's routine).
  private async fillLeadCampaignInfo(data: LeadData): Promise<void> {
    const info = data.campaignInfo;

    const campaign = await this.selectRandomFromSingleReactSelect(
      this.campaignControl(),
      'Campaign'
    );
    info.campaign = campaign;

    const source = await this.selectRandomFromSingleReactSelect(this.sourceControl(), 'Source');
    info.source = source;

    await this.fill(this.subSourceInput(), info.subSource, 'sub source');
    await this.fill(this.utmSourceInput(), info.utmSource, 'utm source');
    await this.fill(this.utmCampaignInput(), info.utmCampaign, 'utm campaign');
    await this.fill(this.utmMediumInput(), info.utmMedium, 'utm medium');
    await this.fill(this.utmContentInput(), info.utmContent, 'utm content');
    await this.fill(this.utmTermInput(), info.utmTerm, 'utm term');

    logger.success('Campaign Information filled');
  }

  // WHY: Salutation is a General Information field (react-select, live
  // options read at fill time, never hardcoded — confirmed live 2026-07-08
  // options are ["Mr","Mrs","Miss"], identical for admin and restricted
  // user). Mutates `data.salutation` in place with whatever was actually
  // selected, same reasoning as every other live-selected field above.
  private async fillLeadSalutation(data: LeadData): Promise<void> {
    data.salutation = await this.selectRandomFromSingleReactSelect(
      this.salutationControl(),
      'Salutation'
    );
  }

  // WHY: fills the Requirement section's 3 standard fields. Products or
  // Services and Currency are react-select fields whose live options are
  // read at fill time — Products is technically a lookup against real
  // Product records, confirmed live (2026-07-08) to behave identically to a
  // plain multi-select for fill/clear purposes (see productsControl's own
  // comment). Mutates `data.requirement.productsOrServices`/`.currency` in
  // place with whatever was actually selected.
  //
  // WHY the currency value is stripped of its parenthetical suffix: confirmed
  // live — the dropdown option reads "India Rupees (INR)" but the detail
  // page displays only "India Rupees". Storing the stripped form here means
  // the same `data.requirement.currency` value is directly comparable to the
  // detail page later, instead of every caller needing to know about this
  // display transform.
  private async fillLeadRequirement(data: LeadData): Promise<void> {
    const req = data.requirement;

    const products = await this.selectRandomFromMultiValueReactSelect(
      this.productsControl(),
      'Products or Services'
    );
    req.productsOrServices = products;

    const rawCurrency = await this.selectRandomFromSingleReactSelect(
      this.currencyControl(),
      'Currency'
    );
    req.currency = rawCurrency.replace(/\s*\([^)]*\)\s*$/, '');

    await this.fill(this.budgetInput(), String(req.budget), 'budget');

    logger.success('Requirement fields filled');
  }

  // WHY: single choke point for filling all 9 Lead custom fields — called
  // from both fillLeadForm() (create) and fillEditForm() (update) so every
  // Lead creation/update path in the codebase attempts these fields, per the
  // environment-safety contract: each BasePage helper checks DOM presence
  // and skips gracefully when a field doesn't exist yet in the current
  // environment (see BasePage's custom-field-helpers section for why).
  //
  // Mutates `data.customFields.pickList`/`.multiPickList` in place with
  // whatever was actually selected live — PickList/MultiPickList options are
  // read from the DOM at fill time, so the caller's `data` object needs to
  // be updated to reflect reality before it's used for later verification.
  private async fillLeadCustomFields(data: LeadData): Promise<void> {
    await this.openOtherDetailsFormSection();
    const cf = data.customFields;

    await this.fillTextLikeCustomField(
      LEAD_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.fillTextLikeCustomField(
      LEAD_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.fillTextLikeCustomField(LEAD_CUSTOM_FIELD_NAMES.number, String(cf.number), 'Number');
    await this.fillTextLikeCustomField(LEAD_CUSTOM_FIELD_NAMES.urlField, cf.urlField, 'URL Field');
    await this.setCheckboxCustomField(LEAD_CUSTOM_FIELD_NAMES.checkbox, cf.checkbox, 'Checkbox');
    await this.selectDateCustomField(LEAD_CUSTOM_FIELD_NAMES.date, cf.date, 'Date');
    await this.selectDateTimeCustomField(
      LEAD_CUSTOM_FIELD_NAMES.dateTimePicker,
      cf.dateTimePicker,
      'Date Time Picker'
    );

    const pickedValue = await this.selectPicklistCustomField(
      LEAD_CUSTOM_FIELD_NAMES.pickList,
      'Pick List'
    );
    if (pickedValue !== null) cf.pickList = pickedValue;

    const pickedValues = await this.selectMultiPicklistCustomField(
      LEAD_CUSTOM_FIELD_NAMES.multiPickList,
      'Multi Pick List'
    );
    if (pickedValues.length > 0) cf.multiPickList = pickedValues;
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

    // WHY: Salutation is part of the default General Information section —
    // visible without needing disableRequiredFieldsToggle(), unlike Campaign
    // Information/Other Details below.
    await this.fillLeadSalutation(data);

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
    // WHY: Confirmed live (2026-07-07) — 'Open' is the app's own default
    // pipeline stage on a new lead (same auto-populate-on-create behavior
    // already confirmed live for Deals' pipelineStage). Every current
    // create-time caller only ever requests 'Open', so this manual
    // click-the-indicator-then-click-the-option interaction was always
    // redundant work reselecting a value already there — and the proven
    // source of a severe flake: one run saw the indicator's click blocked by
    // an intercepting `.search-autocomplete` overlay for 755 retries before
    // the whole 8-minute test timeout fired. Skip the interaction entirely
    // when the target is the default; still supports a genuine non-default
    // stage if a caller ever needs one at creation time.
    if (data.pipelineStage && data.pipelineStage !== 'Open') {
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
    } else if (data.pipelineStage === 'Open') {
      logger.info("Pipeline stage 'Open' is already the default — skipping redundant selection");
    }

    // WHY: fill order matches the form's own top-to-bottom DOM order —
    // Requirement, then Campaign Information, then Other Details (confirmed
    // live 2026-07-08). Keeping fill order aligned with visual order avoids
    // any risk of one section's interaction (scrolling, focus, react-select
    // menu portals) landing on the wrong section's fields.
    await this.fillLeadRequirement(data);

    await this.fillLeadCampaignInfo(data);

    await this.fillLeadCustomFields(data);

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

    // WHY: Confirmed live (2026-07-07) — a failed save (backend 4xx/5xx) previously still
    // logged "Lead saved successfully" and returned null, letting callers proceed on a lead
    // that doesn't exist. Fail fast instead, matching the "Fresh company ID not captured"
    // convention already used elsewhere in this codebase.
    if (!leadId) {
      throw new Error(
        'Lead ID not captured after save — cannot proceed (save likely failed silently)'
      );
    }

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

    // WHY: Salutation is part of the default General Information section —
    // visible on edit without needing disableRequiredFieldsToggle(), same as
    // on create.
    await this.fillLeadSalutation(data);

    // WHY: the "Other Details"/Requirement sections (and their fields) are
    // hidden behind the same toggle as the create form — reveal it here too
    // so the update path can reach them, not just create.
    await this.disableRequiredFieldsToggle();

    // WHY: Salutation/Products/Currency/Budget must work on both create and
    // update (unlike Campaign Information, which is create-only per its own
    // explicit scope) — fill order still matches DOM order (Requirement
    // before Other Details).
    await this.fillLeadRequirement(data);

    await this.fillLeadCustomFields(data);

    logger.success('Edit form updated');
  }

  async saveEditedLead(): Promise<void> {
    logger.info('Saving updated lead');

    // WHY: confirmed live (2026-07-15) via a real root-cause investigation —
    // this method previously had NO network wait at all, only a client-side
    // "no error toast" check and a modal-hidden check, both satisfiable
    // before the actual PUT /v1/leads/{id} request finishes persisting
    // server-side. A caller's immediately-following search (assertLeadExistsInList
    // → retryFindLead) could race the real database write and exhaust all
    // configured search retries despite the update having genuinely
    // succeeded moments later — reproduced live: "admin shares lead with
    // Update permission and restricted user can edit lead" failed this way
    // twice in one session. Live network capture confirmed the actual
    // endpoint: PUT https://.../v1/leads/{id} -> 200. Capture and await it
    // BEFORE declaring success, mirroring saveLead()'s
    // captureLeadIdFromResponse() fail-fast pattern.
    const updateResponsePromise = this.page
      .waitForResponse(
        (res) => res.url().match(/\/v1\/leads\/\d+$/) !== null && res.request().method() === 'PUT',
        { timeout: config.timeouts.navigation }
      )
      .catch(() => null);

    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('lead edit form');

    const updateResponse = await updateResponsePromise;

    // WHY: same fail-fast convention as saveLead() — a failed/slow update
    // that never persisted server-side must not be silently reported as
    // success, letting callers proceed as if the edit took effect.
    if (!updateResponse) {
      throw new Error(
        'Lead update (PUT /v1/leads/{id}) response not captured after save — cannot proceed (update likely failed silently or did not persist in time)'
      );
    }

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

  async assertLeadUpdated(data: LeadData, leadId?: number): Promise<void> {
    // WHY: ID-first — mirrors ContactsPage.assertContactUpdated(). Confirmed
    // live (2026-07-15, 3/3 consistent reproductions) that assertLeadExistsInList()'s
    // list-search path can fail even after the underlying PUT /v1/leads/{id}
    // update genuinely completed and returned 200 — the search/list index
    // itself lags the write by more than the current 5-retry budget under
    // this environment's accumulated data volume. Direct navigation to the
    // known ID reads the record's own detail page, which is not subject to
    // that lag. List search remains the fallback for callers with no ID.
    //
    // WHY body-text-contains, not an input-value check: confirmed live
    // (2026-07-15) that input[name="firstName"] does NOT exist on the
    // lead DETAIL page at all (count() === 0) — only on the create/edit
    // FORM. assertLeadCreated()'s existing ID-first branch has this same
    // latent bug (never triggered — both its current callers omit leadId),
    // left as-is here since fixing unrelated dead code is out of scope for
    // this fix; noted for whoever touches it next.
    if (leadId) {
      logger.info(`Validating updated lead via ID: ${leadId}`);
      await this.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
      await this.waitForLeadDetailsPage();
      await expect(this.page.locator('body')).toContainText(data.firstName, {
        timeout: 15000,
      });
      logger.success(`Lead update verified via ID: ${data.firstName}`);
      return;
    }
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
    await expect(item)
      .toBeHidden({ timeout: 3000 })
      .catch(async () => {
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
    const errorVisible = await this.page
      .locator('.toast-error, .alert-danger, [class*="error"]')
      .filter({ hasText: /doesn't|does not|exist|permission/i })
      .first()
      .isVisible()
      .catch(() => false);
    // WHY: Also check page content for error message
    const pageText = await this.page
      .locator('body')
      .textContent()
      .catch(() => '');
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
    // WHY: Clone opens create form pre-filled — update email and phone to avoid duplicate errors.
    // WHY no extra wait after saveButton becomes visible (2026-07-16 fix,
    // removed a hardcoded waitForTimeout(1000)): confirmed live — the
    // pre-filled email/phone values are already fully populated the instant
    // the save button itself becomes visible (checked at 0ms/300ms/1000ms,
    // identical every time), so saveButton().waitFor() is already the
    // correct, sufficient condition. No settling period exists to wait out.
    await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
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
      const digits = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
      const phone = ['6', '7', '8', '9'][Math.floor(Math.random() * 4)] + digits;
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
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveLead() above.
    if (!clonedId) {
      throw new Error(
        'Cloned lead ID not captured after save — cannot proceed (save likely failed silently)'
      );
    }
    // WHY: After clone save, stay on same lead detail page — no redirect to
    // list. No trailing wait needed here (2026-07-16 fix, removed a
    // hardcoded waitForTimeout(1500)): assertNoFormErrors() and the ID
    // capture above already confirm the save genuinely completed
    // server-side, and every real caller's very next action is a fresh
    // navigation to the CLONE's own detail page (assertClonedLeadLastName's
    // ID-direct-nav), which has its own proper GET-response wait — whatever
    // state the current (original) page is still settling into is
    // irrelevant once that navigation fires.
    logger.success(`Lead cloned — new ID: ${clonedId}`);
    return clonedId;
  }

  async assertClonedLeadLastName(originalLastName: string, clonedId?: number | null): Promise<void> {
    const clonedLastName = `${originalLastName} Copy`;
    // WHY: Confirmed live on both staging and QA — searching the leads list
    // for "<lastName> Copy" is unreliable. The list search does a loose,
    // multi-field OR-match (matches on company name substrings, other
    // unrelated leads containing "Copy" from other clone tests, etc.),
    // returning up to 50-80 rows with no guaranteed sort position for the
    // freshly-cloned lead. Whether the exact-match locator finds it depends
    // on whether it lands within the page of rows actually rendered — this
    // is what caused the intermittent "fails once, passes on retry" flake,
    // not search-index lag. Navigate directly to the cloned lead by ID
    // instead and read its own detail page — deterministic, no list search.
    //
    // WHY clonedId is optional with a list-search fallback (2026-07-16):
    // a caller whose ID capture genuinely failed (e.g. a slow/odd POST
    // response) shouldn't hard-fail the whole test on that alone — fall
    // back to the same retry-based list search every other "exists in
    // list" assertion in this codebase already uses, accepting its
    // documented unreliability as a last resort rather than a primary path.
    if (clonedId) {
      logger.info(
        `Asserting cloned lead (ID: ${clonedId}) has "Copy" in lastName — original: ${originalLastName}`
      );
      await this.navigateTo(`${config.appUrl}/sales/leads/details/${clonedId}`);
      await this.waitForLeadDetailsPage();
      // WHY: Confirmed live (2026-07-06, Companies clone investigation) —
      // waitForLeadDetailsPage's GET-response wait resolves the instant the
      // network response is observed, not once React has re-rendered the DOM
      // with it. A one-shot body.innerText() read right after can race ahead
      // of the render. Use an auto-retrying assertion instead of a fixed sleep.
      await expect(this.page.locator('body')).toContainText(clonedLastName, { timeout: 15000 });
      logger.success(`Cloned lead found with lastName: ${clonedLastName}`);
      return;
    }
    logger.warn('Cloned lead ID not available — falling back to list search');
    const found = await this.retryFindLead(clonedLastName);
    expect(found, `Cloned lead "${clonedLastName}" should exist in list`).toBeTruthy();
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
      const reasonLabel = this.page
        .locator('.modal.show .reasons-container label')
        .nth(randomIndex);
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
    // WHY: Fill estimated value — required field for deal. Confirmed live
    // (2026-07-09) — the app now pre-populates this field with a server-
    // computed value and disables it once Deal auto-mapping is available
    // (class="... auto-mapped", value already set, e.g. "400000") — a QA-
    // environment/app-side change, not something this framework's Lead
    // field additions caused (git blame on this block predates that work,
    // and the pre-filled value never matches any Lead-side data this suite
    // controls). isVisible() alone doesn't reflect fillability — an element
    // can be visible and disabled at the same time — so check isEnabled()
    // too. When disabled, skip: the field already carries a valid non-empty
    // value, so the deal's own "required" validation is satisfied without
    // us touching it. Filling a disabled field previously caused
    // Playwright's actionability retry loop to hammer this locator for the
    // test's entire timeout (~800 retries over ~7-8 minutes).
    const estimatedValue = this.page.locator('[id="1_21_input_deal.details.estimatedValue"]');
    await estimatedValue.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    const estimatedValueVisible = await estimatedValue.isVisible().catch(() => false);
    const estimatedValueEnabled = estimatedValueVisible
      ? await estimatedValue.isEnabled().catch(() => false)
      : false;
    if (estimatedValueEnabled) {
      await estimatedValue.fill('100000');
      logger.debug('Estimated value filled: 100000');
    } else if (estimatedValueVisible) {
      const existingValue = await estimatedValue.inputValue().catch(() => '');
      logger.info(
        `Estimated value field is disabled (auto-populated by the app with "${existingValue}") — skipping fill`
      );
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

  // WHY: A substring `hasText` match against the user-selection dropdown can
  // select the wrong entry whenever one user's display name is a substring
  // of another's — confirmed live root cause of a similar bug in
  // ContactsPage/DealsPage share/reassign. Match exact text via anchored regex.
  private escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async shareLead(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing lead with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
    await this.clickEllipsisOption('Share');
    await this.page.waitForTimeout(1000);
    // WHY: Click the Share To type dropdown control — opens User/Team options
    const shareTypeControl = this.page
      .locator('.modal.show')
      .locator('.is-invalid__control')
      .first();
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
    const searchTerm = validWord;
    logger.debug(`Share search term: "${searchTerm}" (from: "${restrictedUserName}")`);
    await this.shareToUserInput().fill(searchTerm);
    await this.page.waitForTimeout(800);
    // WHY: Select matching user from dropdown
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(restrictedUserName)}\\s*$`) })
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
    const validWord = words.find((w) => w.length >= 3) ?? userDisplayName.trim().substring(0, 3);
    logger.debug(`Reassign search term: "${validWord}" (from: "${userDisplayName}")`);
    await this.reassignUserInput().waitFor({ state: 'visible', timeout: 5000 });
    await this.reassignUserInput().fill(validWord);
    await this.page.waitForTimeout(800);
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(userDisplayName)}\\s*$`) })
      .first();
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
    const paneText = ((await this.detailTabPane().textContent()) ?? '').toLowerCase();
    for (const value of expectedValues) {
      // WHY: Compare lowercase — detail page may display in different case
      expect(paneText).toContain(value.toLowerCase());
      logger.debug(`Tab ${tabId} contains: ${value}`);
    }
    logger.success(`Tab ${tabId} content verified`);
  }

  async assertValidationError(message: string): Promise<void> {
    logger.info(`Asserting validation error: ${message}`);
    const error = this.page
      .locator('.invalid-feedback, .help-text.error')
      .filter({ hasText: message })
      .first();
    await error.waitFor({ state: 'visible', timeout: 5000 });
    logger.success(`Validation error confirmed: ${message}`);
  }

  // WHY: full per-field verification against the Lead detail page's "Other
  // Details" tab — only used by the 3 dedicated custom-field tests (per
  // scope: every other Lead test only needs the fill-if-present behavior to
  // run without erroring, not a full value-by-value assertion here).
  // WHY: PART C — thin, module-owned wrapper around BasePage's generic
  // dedicated-test skip mechanism, same pattern as fillLeadCustomFields()/
  // assertLeadCustomFieldsOnDetail() above. Must be called AFTER the
  // relevant create/edit form is open and ONLY from the dedicated
  // custom-field tests — every other Lead test already tolerates absent
  // fields via the generic fill methods' own presence checks.
  //
  // WHY disableRequiredFieldsToggle() is called here too: confirmed live
  // (2026-07-15) — a custom field input does not exist in the DOM AT ALL
  // (count() === 0, not merely hidden) until the "Show Required & Important
  // Fields" toggle is switched off; count becomes 1 immediately after,
  // with no "Other Details" tab click needed for mere presence (that click
  // is a scroll-to convenience, confirmed live it doesn't hide/reveal
  // anything — firstName stays visible throughout). Calling it here is
  // safe and non-duplicative in effect: it's the same idempotent method
  // fillLeadForm()/fillEditForm() call themselves right after, and a
  // second call on an already-disabled toggle is a documented no-op.
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.disableRequiredFieldsToggle();
    await this.skipDedicatedCustomFieldTestIfAbsent(
      Object.values(LEAD_CUSTOM_FIELD_NAMES),
      'Lead'
    );
  }

  async assertLeadCustomFieldsOnDetail(data: LeadData): Promise<void> {
    logger.info('Asserting all 9 custom field values on lead detail page');
    const tab = this.otherDetailsDetailPageTab();
    // WHY: confirmed live (2026-07-08) — a 5s timeout here was too short for
    // the restricted user's detail page to finish rendering the tab bar,
    // causing this to silently skip ALL verification and report the calling
    // test as passed without having checked a single value. Direct DOM
    // inspection confirmed the tab genuinely exists for restricted user —
    // this was a render-timing gap, not a real absence. Uses
    // config.timeouts.navigation, the same generous, propagation-tolerant
    // window already established for cross-role detail-page reads elsewhere
    // (see assertRightPanelIconVisible's own comment for the precedent).
    //
    // WHY throw instead of skip-and-return: unlike the fill-path helpers
    // (which run from every generic Lead test across the codebase and must
    // tolerate genuinely not having these fields on Stage/Prod yet), this
    // method is called ONLY from the 3 dedicated custom-field tests, which
    // always run on an environment where these fields are confirmed to
    // exist. A silent skip here can never be "correct environment-safety
    // behavior" for this method's actual callers — it can only mean the
    // verification didn't happen, which must fail loudly, not report a
    // false pass.
    await expect(
      tab,
      '"Other Details" tab did not appear on the detail page — custom field verification cannot proceed'
    ).toBeVisible({ timeout: config.timeouts.navigation });
    await tab.click();
    await this.page.waitForTimeout(500);

    const cf = data.customFields;
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox ? 'Yes' : 'No',
      'Checkbox'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.date,
      this.formatCustomFieldDetailDate(cf.date),
      'Date'
    );
    await this.assertCustomFieldOnDetail(
      LEAD_CUSTOM_FIELD_NAMES.dateTimePicker,
      this.formatCustomFieldDetailDateTime(cf.dateTimePicker),
      'Date Time Picker'
    );
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.pickList,
        cf.pickList,
        'Pick List'
      );
    }
    if (cf.multiPickList.length > 0) {
      await this.assertMultiPicklistCustomFieldOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.multiPickList,
        cf.multiPickList,
        'Multi Pick List'
      );
    }
    logger.success('All 9 custom field values verified on lead detail page');
  }

  // WHY: verifies the 4 standard fields (Salutation, Products or Services,
  // Currency, Budget) alongside the 9 custom fields — same scope rule as
  // assertLeadCustomFieldsOnDetail() above: only the 3 dedicated tests need
  // full value verification, every other Lead test just needs the
  // fill-if-present behavior to run without erroring.
  //
  // WHY Salutation is verified differently: confirmed live (2026-07-08) it
  // displays as a prefix in the page HEADER ("Mr. LastName(#id)"), not under
  // any tab — same mechanism already established for Contact
  // (ContactsPage.ts's own "Salutation appears in page header/name area"
  // comment). Verify via body-text-contains instead of a tab/container id.
  async assertLeadStandardFieldsOnDetail(data: LeadData): Promise<void> {
    logger.info(
      'Asserting Salutation, Products or Services, Currency, and Budget on lead detail page'
    );

    if (data.salutation) {
      await expect(
        this.page.locator('body'),
        `Expected Salutation "${data.salutation}" to appear on the lead detail page header, but it never appeared`
      ).toContainText(data.salutation, { timeout: config.timeouts.expect });
      logger.success(`Salutation verified on detail page: "${data.salutation}"`);
    }

    const tab = this.requirementDetailPageTab();
    await expect(
      tab,
      '"Requirement" tab did not appear on the detail page — standard field verification cannot proceed'
    ).toBeVisible({ timeout: config.timeouts.navigation });
    await tab.click();
    await this.page.waitForTimeout(500);

    const req = data.requirement;
    if (req.productsOrServices.length > 0) {
      await this.assertMultiValueFieldOnDetailByContainerId(
        'products',
        req.productsOrServices,
        'Products or Services'
      );
    }
    await this.assertFieldOnDetailByContainerId('requirementCurrency', req.currency, 'Currency');
    await this.assertFieldOnDetailByContainerId('requirementBudget', String(req.budget), 'Budget');

    logger.success(
      'Salutation, Products or Services, Currency, and Budget verified on lead detail page'
    );
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
    // WHY: This is called right after an admin share grants the permission
    // controlling this icon — the write is on the admin's session, but this
    // read is on the restricted user's separate session, so it can lag behind
    // the share response by more than a few seconds under load. A short fixed
    // timeout here (previously 5000ms, on top of a flat pre-sleep in the test)
    // has no way to recover from that lag. Use the same generous, propagation-
    // tolerant window already used for cross-role reads elsewhere (e.g.
    // CallLogsPage.openCallLogsProductivitySection) instead of a short one —
    // Playwright's expect() already polls internally, so this only costs time
    // when the icon is genuinely slow to appear, not on the common fast path.
    await expect(this.rightPanelIcon(title)).toBeVisible({ timeout: config.timeouts.navigation });
    logger.success(`Right panel icon visible: ${title}`);
  }

  async assertRightPanelIconNotVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon NOT visible: ${title}`);
    await expect(this.rightPanelIcon(title)).toBeHidden({ timeout: 5000 });
    logger.success(`Right panel icon not visible: ${title}`);
  }
}
