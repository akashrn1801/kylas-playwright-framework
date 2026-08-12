import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import {
  ProductsAndServicesData,
  ProductsCustomFieldData,
  PRODUCTS_CUSTOM_FIELD_NAMES,
} from '../../data/factories/productsAndServicesFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

// WHY this page object doesn't follow the standard Sales-page/detail-page
// shape every other module uses: this is a deliberate, documented deviation
// — see PRODUCTS_AND_SERVICES_DESIGN.md section 1 and
// .claude/architecture.md's own deviation note. Key structural facts, all
// confirmed LIVE (2026-08-10), not assumed from the design doc alone:
//   - Lives on the SETTINGS page (`/setup/products-services/...`), not Sales.
//   - Create and Edit are FULL-PAGE navigations, NOT a modal
//     (`#editEntityModal` does not apply here at all) — `/create` and
//     `/edit/{id}` are real, separate URLs. This is why this file has no
//     modal-visible/modal-hidden waiting logic anywhere, unlike every other
//     module's create/edit flow.
//   - There is no edit icon/button — clicking a list row IS the edit action,
//     and `/edit/{id}` also works as a direct navigation target.
//   - No delete action exists anywhere in the UI (list or edit page).
export class ProductsAndServicesPage extends BasePage {
  // ─── 1. Retry config ────────────────────────────────────────────────────────
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ─── 2. Locators ────────────────────────────────────────────────────────────

  // List page
  private readonly listTable = (): Locator => this.page.locator('.rt-table').first();
  private readonly searchInput = (): Locator => this.page.locator('#fulltext-search');
  // WHY this exact selector: confirmed live to be byte-identical to
  // QuotationsPage's own `searchButton()` — the same shared search-icon
  // component, same SVG clipPath id, reused across modules.
  private readonly searchIcon = (): Locator =>
    this.page.locator('svg:has(#clip-Ic_Search)').first();
  private readonly addButton = (): Locator => this.page.locator('button:has-text("Add")').first();

  // WHY scoped to listTable() + the Name cell specifically (nth-child(3):
  // checkbox, ID, Name in column order — confirmed live 2026-08-10 via
  // direct DOM inspection), not a whole-row substring match: a whole-row
  // `hasText` filter matches the row's ENTIRE concatenated text (ID +
  // Description + Price + ... all together), so a substring collision with
  // an unrelated field's text is a real risk on data that accumulates
  // indefinitely (rule 5/17). Anchored exact-match against the Name cell
  // alone avoids this. Single shared helper (flagged by locator-reviewer,
  // 2026-08-10 — this exact logic was previously duplicated 3 times across
  // listRow()/retryFindInList()/assertProductNotInList()) — every list-row
  // name lookup in this file now goes through this one locator.
  private readonly nameCell = (name: string): Locator =>
    this.listTable()
      .locator('.rt-tr')
      .locator('.rt-td:nth-child(3)', {
        hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`),
      });

  // WHY an xpath-ancestor walk from the matched cell, not a `.filter({has:})`
  // on `.rt-tr`: avoids any ambiguity over whether a `has:` locator that
  // itself re-chains through listTable()/.rt-tr (as nameCell() does) could
  // be misinterpreted as requiring a nested table structure — walking UP
  // from the cell we already unambiguously matched is simpler and mirrors
  // this same file's own nameFieldError() pattern (also an xpath-ancestor
  // walk).
  private readonly listRow = (name: string): Locator =>
    this.nameCell(name).locator('xpath=ancestor::div[contains(@class,"rt-tr")]').first();

  // Create/Edit form (a real page, never a modal — see class-level comment)
  private readonly nameInput = (): Locator => this.page.locator('input[id="0_00_input_name"]');
  private readonly nameFieldError = (): Locator =>
    this.nameInput()
      .locator('xpath=ancestor::div[contains(@class,"form-group")]')
      .locator('.invalid-feedback');
  private readonly priceInput = (): Locator => this.page.locator('input[id="0_11_input_price"]');
  private readonly descriptionWrapper = (): Locator =>
    this.page.locator('div[id="0_22_input_description"]');
  private readonly hsnSacInput = (): Locator =>
    this.page.locator('input[id="0_33_input_hsnSacCode"]');
  private readonly countryOfOriginAnchor = (): Locator =>
    this.page.locator('input[id="0_44_input_countryOfOrigin"]');
  private readonly categoryAnchor = (): Locator =>
    this.page.locator('input[id="0_55_input_category"]');
  private readonly unitsAnchor = (): Locator => this.page.locator('input[id="0_66_input_units"]');
  private readonly isActiveToggle = (): Locator =>
    this.page.locator('input[id="0_88_input_isActive"]');
  // WHY a separate label locator: confirmed live (2026-08-10, real test
  // failure during Batch 7) — this Bootstrap `.custom-control-label`
  // visually overlays the underlying checkbox input and intercepts pointer
  // events on a direct click, the exact same component shape
  // `CompaniesPage`/`TasksPage` already click via their own
  // `.custom-control-label` locator rather than the raw input, for this
  // reason. `setIsActive()`'s own original comment ("a direct click on the
  // input has always worked") was disproven by live evidence for THIS
  // specific toggle — `BasePage.setCheckboxCustomField()`'s identical-
  // looking direct-input click continues to work fine for the Checkbox
  // custom field elsewhere in this same file, confirming this is a
  // DOM-instance-specific difference (rule 17), not a wrong claim about
  // the component family in general.
  private readonly isActiveLabel = (): Locator =>
    this.page.locator('label[for="0_88_input_isActive"]');
  private readonly saveButton = (): Locator =>
    this.page.locator('button.btn.btn-primary:has-text("Save")').first();

  // ─── 3. Constructor ─────────────────────────────────────────────────────────
  constructor(page: Page) {
    super(page);
  }

  // ─── 4. Private helpers ─────────────────────────────────────────────────────

  /**
   * Sets the Description field via CKEditor 5's own internal data model.
   *
   * WHY plain DOM approaches (Playwright's `.fill()`/`.type()`, or a raw
   * `textContent` assignment) do NOT work: CKEditor 5 maintains its own
   * internal virtual data model, separate from the rendered DOM. A plain
   * `textContent` assignment or a Playwright `.fill()`/`.type()` against the
   * contenteditable region only mutates the visible DOM — it does not
   * update that internal model. It's the internal model, not the DOM, that
   * gets serialized into the actual save payload. CKEditor 5 attaches its
   * live editor instance directly to the `.ck-editor__editable` DOM node as
   * `.ckeditorInstance`; calling `.setData(text)` on it is the method that
   * actually reaches the editor's internal data model. Exact implementation
   * provided by the user (2026-08-10) — used verbatim, not re-derived.
   */
  private async setDescriptionViaCkEditor(text: string): Promise<void> {
    // WHY locator.evaluate() (resolving via descriptionWrapper()) rather
    // than page.evaluate() + a raw document.getElementById() string
    // (flagged by locator-reviewer, 2026-08-10): the id was previously
    // duplicated in two places (this method's own string literal, and the
    // otherwise-unused descriptionWrapper() locator) — a single source of
    // truth now. The CKEditor mechanism itself (querySelector the editable
    // region, check .ckeditorInstance, call .setData()) is unchanged from
    // the user's exact given implementation (Entry 4).
    await this.descriptionWrapper().evaluate((wrapper, innerText) => {
      const editable = wrapper.querySelector('.ck-editor__editable') as unknown as
        | { ckeditorInstance?: { setData: (value: string) => void } }
        | undefined;
      if (editable?.ckeditorInstance) {
        editable.ckeditorInstance.setData(innerText);
      }
    }, text);
    logger.info(
      `Description set via CKEditor: ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}`
    );
  }

  /**
   * Selects an option from Country of Origin / Category / Units — the 3
   * static (layout-embedded, not live-server-searched), single-value-or-
   * multi-value react-select controls sharing this app's standard
   * `is-invalid__` classNamePrefix convention.
   *
   * WHY a single shared method for all 3, despite Units being a true
   * multi-select in the DOM: confirmed live (2026-08-10) — Units renders a
   * genuine multi-value control (`is-invalid__value-container--is-multi`,
   * real removable chips, an array-valued saved field). This module
   * deliberately selects only ONE option regardless, by design choice (see
   * PRODUCTS_AND_SERVICES_DESIGN.md section 6) — not because the field is
   * single-select. Do not "fix" this into a multi-select helper without a
   * deliberate decision to test multi-select behavior for Units specifically.
   *
   * @param anchorInput Field's own `<input>` — control derived internally.
   * @param exactTextOrRandom Exact live option text to select, or `'random'`
   *                    to delegate to the existing, proven
   *                    `selectRandomFromSingleReactSelect()` primitive.
   * @param description Human-readable label for logs.
   */
  private async selectFromReactSelect(
    anchorInput: Locator,
    exactTextOrRandom: string | 'random',
    description: string
  ): Promise<string> {
    const control = anchorInput.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );

    if (exactTextOrRandom === 'random') {
      return this.selectRandomFromSingleReactSelect(control, description);
    }

    // WHY clear any existing chip(s) FIRST (added 2026-08-10, CRITICAL
    // INCIDENT — see PRODUCTS_AND_SERVICES_PROGRESS.md): Units is a genuine
    // multi-select (confirmed live) — selecting an option ADDS a chip, it
    // never replaces an already-selected one. Once an option is already
    // selected, react-select removes it from the OPEN menu's available list
    // entirely, so a second call targeting that same option finds nothing to
    // click and times out. This corrupted the permanent `adminActive`
    // fixture (accumulated an extra Units chip across an update-then-restore
    // cycle) before this fix existed. Harmless no-op for single-value fields
    // (Country/Category render no `.is-invalid__multi-value__remove` chips
    // at all, so this loop simply finds zero and skips) — this mirrors the
    // module's own documented design intent that every call here should end
    // with EXACTLY the one option specified, never an accumulation.
    //
    // WHY this mirrors BasePage.selectRandomFromMultiValueReactSelect()'s
    // proven clearing shape (bounded count, isVisible()-poll rather than a
    // re-resolving waitFor('hidden'), explicit menu-reopen Escape, a
    // defense-in-depth final-count check) instead of a leaner ad-hoc loop:
    // that method's own comment documents a LIVE-CONFIRMED failure mode on
    // this exact locator — an unbounded clear loop can hang for the entire
    // test timeout if a chip's remove button doesn't actually detach it
    // (stale reference/re-render race) — caught by `locator-reviewer`
    // reviewing this exact fix. No blind fixed-delay sleep call (unlike that
    // proven method, which predates this file and is grandfathered): this
    // file's own pre-commit anti-pattern check scans every line of a
    // brand-new file, not just the diff (see Entry 19) — the `isVisible()`
    // poll's own internal timeout already provides real settling time.
    const maxChipsToClear = 50;
    let clearedChipCount = 0;
    let existingChip = control.locator('.is-invalid__multi-value__remove').first();
    while (
      (await existingChip.isVisible({ timeout: 1000 }).catch(() => false)) &&
      clearedChipCount < maxChipsToClear
    ) {
      await this.click(existingChip, `${description}: clearing existing chip before re-select`);
      const menuOpen = await this.page
        .locator('.is-invalid__menu')
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (menuOpen) {
        await this.page.keyboard.press('Escape');
      }
      existingChip = control.locator('.is-invalid__multi-value__remove').first();
      clearedChipCount++;
    }
    if (clearedChipCount >= maxChipsToClear) {
      throw new Error(
        `${description}: still had chips to clear after ${maxChipsToClear} removal attempts — a chip's remove button may not be detaching it`
      );
    }
    const remainingChipCount = await control.locator('.is-invalid__multi-value__remove').count();
    if (remainingChipCount > 0) {
      throw new Error(
        `${description}: ${remainingChipCount} chip(s) still present after the clear loop reported done — clearing is unreliable`
      );
    }

    // WHY click the control div, not the input: confirmed live (2026-08-10)
    // — the "Choose" placeholder overlays the input and intercepts pointer
    // events on first open, the identical race already documented for
    // BasePage.selectLookupCustomField() and this module's own Batch 2
    // helpers.
    await this.click(control, `react-select control: ${description}`);
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    const opened = await options
      .first()
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      // WHY an ArrowDown fallback: observed live (2026-08-10) that this
      // module's Units control did not reliably show its options from a
      // plain control click alone in every attempt — pressing ArrowDown
      // after focus reliably opened it. Harmless no-op if the menu already
      // opened from the click above; defensive rather than asserting one
      // single confirmed mechanism given the inconsistency observed.
      await anchorInput.press('ArrowDown');
      await options.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    }

    await anchorInput.fill(exactTextOrRandom);
    const exactOption = options
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(exactTextOrRandom)}\\s*$`) })
      .first();
    await exactOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    // WHY this.click(), not a raw exactOption.click(): every other click in
    // this file goes through the bounded, session-expiry-covered helper —
    // this was the one option-click left unrouted (flagged by
    // locator-reviewer, 2026-08-10).
    await this.click(exactOption, `${description}: option "${exactTextOrRandom}"`);
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    // WHY confirm the CONTROL's rendered text, not the anchor input's own
    // value, before logging success (flagged by locator-reviewer,
    // 2026-08-10): confirmed live — react-select clears/reuses the filter
    // input after a selection and renders the chosen value separately
    // (`.is-invalid__single-value` for Country/Category,
    // `.is-invalid__multi-value__label` chips for Units) — the input's own
    // `inputValue()` does NOT reflect the selection, so that would be the
    // wrong thing to check here. A click that "registers" but doesn't
    // actually commit react-select's state is the exact root cause already
    // documented elsewhere in this codebase (the Share-modal 9-minute hang,
    // DealsPage.cloneDeal()'s React-timing race) — logging success
    // unconditionally would hide that same failure mode here.
    await this.withSessionExpiryRecovery(() =>
      expect(
        control,
        `${description}: expected "${exactTextOrRandom}" to render as the selected value after selection`
      ).toContainText(exactTextOrRandom, { timeout: config.timeouts.expect })
    );
    logger.success(`${description} set to: ${exactTextOrRandom}`);
    return exactTextOrRandom;
  }

  private async setIsActive(active: boolean): Promise<void> {
    // WHY the LABEL is clicked, not the checkbox input directly (fixed
    // 2026-08-10 — see PRODUCTS_AND_SERVICES_PROGRESS.md's Batch 7
    // investigation): a real test run confirmed this toggle's
    // `.custom-control-label` overlays the input and intercepts a direct
    // click every time this path is actually exercised — matching the
    // already-proven `CompaniesPage`/`TasksPage` convention of clicking the
    // label for this exact Bootstrap component, not the input underneath it.
    const checked = await this.isActiveToggle()
      .isChecked()
      .catch(() => false);
    if (checked !== active) {
      await this.click(this.isActiveLabel(), 'Active toggle');
    }
  }

  // WHY this exact search mechanism (fill + click the search icon, not
  // Enter): confirmed live (2026-08-10) — `#fulltext-search` and the
  // `svg:has(#clip-Ic_Search)` icon are byte-identical to
  // QuotationsPage.performSearch()'s own proven pattern; this module reuses
  // it rather than guessing a different trigger.
  private async performSearch(value: string): Promise<void> {
    await this.fill(this.searchInput(), value, 'search input');
    await Promise.all([
      this.armResponseWaitWithRecovery(
        (r) => /\/v1\/products\/search/.test(r.url()) && r.request().method() === 'POST',
        'performSearch: search POST',
        15000
      ).catch(() => null),
      this.searchIcon().click({ timeout: 15000 }),
    ]);
  }

  // WHY this reuses the shared, already-hardened BasePage.waitForEntityListPage()
  // rather than a module-local copy: mirrors CallLogsPage/QuotationsPage's own
  // migration to this shared method (see BasePage's own comment for the
  // navigation-drift history this fixes). The list's real data source is the
  // confirmed live `POST /v1/products/search` endpoint.
  private async waitForListReady(): Promise<void> {
    await this.waitForEntityListPage(
      (res) => /\/v1\/products\/search/.test(res.url()) && res.request().method() === 'POST',
      this.listTable(),
      'Products & Services'
    );
  }

  // WHY a bounded retry here even though no index-lag was observed live
  // (confirmed instant search results immediately after creation, see
  // PRODUCTS_AND_SERVICES_PROGRESS.md's investigation notes): per this
  // codebase's own rule 20 (environment-scoping conclusions decay, never
  // assumed permanent) — a defensive retry on the common case (found on
  // attempt 1) protects against a scenario this session's QA-only testing
  // could not observe (heavier load, a different environment).
  //
  // WHY no fixed-delay backoff BETWEEN attempts (unlike
  // QuotationsPage.retryFindInList()'s otherwise-identical shape, which
  // does sleep between attempts): this file is brand new, so this repo's
  // pre-commit anti-pattern check (which scans the staged diff for a
  // certain banned blind-sleep call) would flag any newly-added instance of
  // it here, unlike Quotations' pre-existing, already-committed copy of
  // this pattern. Since this endpoint has no observed lag, each retry
  // attempt re-runs the real search immediately (already network-awaited
  // inside performSearch()) rather than sleeping first — the
  // row-visibility `waitFor()` below still gives each attempt a real,
  // bounded, condition-based chance to catch a slightly-delayed
  // render without any blind sleep.
  private async retryFindInList(name: string): Promise<boolean> {
    const { retries } = this.retryConfig;
    for (let attempt = 1; attempt <= retries; attempt++) {
      await this.goToProductsAndServicesList();
      await this.performSearch(name);
      const found = await this.nameCell(name)
        .first()
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (found) {
        logger.success(`Product found in list: ${name} (attempt ${attempt}/${retries})`);
        return true;
      }
      logger.info(`Product not found on attempt ${attempt}/${retries}: ${name}`);
    }
    return false;
  }

  // ─── 5. Navigation ──────────────────────────────────────────────────────────

  async goToProductsAndServicesList(): Promise<void> {
    await this.navigateTo(`${config.appUrl}/setup/products-services/list`);
    await this.waitForListReady();
    logger.info('Navigated to Products & Services list');
  }

  async goToCreateProductForm(): Promise<void> {
    await this.click(this.addButton(), 'Add button (Products & Services list)');
    await this.waitForUrl(/\/products-services\/create/, config.timeouts.navigation);
    // WHY wait for a real form field too, not just the URL (fixed
    // 2026-08-10 — Batch 7 investigation, PRODUCTS_AND_SERVICES_PROGRESS.md):
    // a real test run confirmed `skipIfCustomFieldsAbsent()`'s instant,
    // zero-wait DOM-presence check can run before the create form's fields
    // (including the custom ones) have actually rendered, producing a false
    // "absent" skip on an environment where they demonstrably exist (live-
    // reproduced and disproven the same session). The URL matching first
    // does not guarantee the form's own content has painted yet.
    await this.withSessionExpiryRecovery(() =>
      expect(this.nameInput(), 'Products & Services create form should be visible').toBeVisible({
        timeout: config.timeouts.expect,
      })
    );
    logger.info('Opened Products & Services create form');
  }

  // ─── 6. Form actions ────────────────────────────────────────────────────────

  // WHY `customFields` is an OPTIONAL 2nd parameter, not baked into
  // `ProductsAndServicesData` itself: additive-only — every existing
  // Batch 1-5 caller of this method continues to work completely
  // unmodified (they never pass this param, so it stays `undefined` and
  // `fillProductsCustomFields()` is never called). Only a dedicated
  // custom-field test supplies it. Mirrors
  // `QuotationsPage.fillAndSaveQuotationFromPanel()`'s identical
  // additive-optional-param precedent.
  async fillProductsAndServicesForm(
    data: ProductsAndServicesData,
    customFields?: ProductsCustomFieldData
  ): Promise<void> {
    await this.fill(this.nameInput(), data.name, 'product name');
    await this.fill(this.priceInput(), String(data.price), 'price');
    await this.setDescriptionViaCkEditor(data.description);
    if (data.hsnSacCode) {
      await this.fill(this.hsnSacInput(), data.hsnSacCode, 'HSN/SAC code');
    }
    if (data.countryOfOrigin) {
      await this.selectFromReactSelect(
        this.countryOfOriginAnchor(),
        data.countryOfOrigin,
        'Country of Origin'
      );
    }
    if (data.category) {
      await this.selectFromReactSelect(this.categoryAnchor(), data.category, 'Category');
    }
    if (data.units) {
      await this.selectFromReactSelect(this.unitsAnchor(), data.units, 'Units');
    }
    await this.setIsActive(data.isActive);
    if (customFields) {
      await this.fillProductsCustomFields(customFields);
    }
    logger.success('Products & Services form filled');
  }

  /**
   * Fills the 8 Products & Services custom fields.
   *
   * WHY `suffixStyle: 'plain'` on every single call, not the default
   * `'legacy'`: confirmed live (2026-08-10) via direct DOM inspection on the
   * real create form — the actual rendered ids are `_input_cfTextField`
   * etc. (the shorter "plain" convention Meeting/Call Log use), NOT
   * `_input_customFieldValues.cfTextField` (the "legacy" convention Lead/
   * Deal/Contact/Company/Quotation/Task use). Passing the default here
   * would make every one of these calls silently no-op via
   * `isCustomFieldPresent()`'s own graceful-skip behavior — never erroring,
   * but never actually testing anything either. Confirmed identical on QA
   * AND staging (both live-checked); PROD confirmed to have none of these
   * fields yet (see `skipIfCustomFieldsAbsent()` below for the
   * environment-aware handling this makes necessary).
   *
   * WHY no lookup/MultiPickList handling: confirmed live — Products has
   * exactly 8 custom fields, the same shape as Company/Deal MINUS
   * MultiPickList and MINUS any Lookup field. Mirrors
   * `CompaniesPage.fillCompanyCustomFields()`'s structure exactly, adjusted
   * for the 2 fields Products doesn't have.
   */
  private async fillProductsCustomFields(cf: ProductsCustomFieldData): Promise<void> {
    await this.fillTextLikeCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field',
      'plain'
    );
    await this.fillTextLikeCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text',
      'plain'
    );
    await this.fillTextLikeCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number',
      'plain'
    );
    await this.fillTextLikeCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field',
      'plain'
    );
    await this.setCheckboxCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox,
      'Checkbox',
      'plain'
    );
    await this.selectDateCustomField(PRODUCTS_CUSTOM_FIELD_NAMES.date, cf.date, 'Date', 'plain');
    await this.selectDateTimeCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.dateTimePicker,
      cf.dateTimePicker,
      'Date Time Picker',
      'plain'
    );
    const pickedValue = await this.selectPicklistCustomField(
      PRODUCTS_CUSTOM_FIELD_NAMES.pickList,
      'Pick List',
      'plain'
    );
    if (pickedValue !== null) cf.pickList = pickedValue;
  }

  /**
   * Whole-test-level skip for dedicated Products custom-field tests, on an
   * environment where these fields don't exist yet.
   *
   * WHY this exists at all (2026-08-10, explicit user requirement): custom
   * fields were added to Products on QA and staging but NOT yet on
   * production — confirmed live via a direct, read-only API check (login +
   * `GET /v1/products/layout?view=create`, zero `cf`-prefixed fields
   * returned). Any dedicated custom-field test for Products must skip
   * cleanly here rather than fail, so the exact same suite runs
   * unmodified against prod today (skipping this one test) and
   * automatically starts exercising it there too, with zero code changes,
   * once custom fields are added to prod later. Mirrors
   * `CompaniesPage.skipIfCustomFieldsAbsent()`'s exact structure, with
   * `'plain'` passed through (see `fillProductsCustomFields()`'s own
   * comment for why).
   *
   * WHY called with the CREATE form open, not an existing product's edit
   * form: field presence only requires an open form to inspect DOM
   * presence — no product needs to exist or be touched. This keeps the
   * check itself completely read-only/non-mutating regardless of which
   * environment it runs against.
   */
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.skipDedicatedCustomFieldTestIfAbsent(
      Object.values(PRODUCTS_CUSTOM_FIELD_NAMES),
      'Products & Services',
      'plain'
    );
  }

  /**
   * Saves the create form. Confirmed live: on success, the app navigates to
   * the list page (identical behavior to the edit form's own save — see
   * saveEditedProduct()) and the create response body is simply `{id}`.
   */
  async saveProduct(): Promise<{ id: string | null }> {
    // WHY this exact path pattern (`/v1/products/?$`), never a bare
    // substring: per rule 15 — confirmed live the real create endpoint is
    // `/v1/products` (optionally trailing slash), anchored so this can never
    // match `/v1/products/search` or `/v1/products/{id}`.
    const idPromise = this.armResponseWaitWithRecovery(
      (res) =>
        /\/v1\/products\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
      'saveProduct: create POST',
      20000
    )
      .then(async (res) => {
        const body = await res.json().catch(() => ({}) as { id?: number | string });
        return body?.id ? String(body.id) : null;
      })
      .catch(() => null);

    await this.click(this.saveButton(), 'Save (product create)');
    const id = await idPromise;
    await this.assertNoFormErrors('product create form');
    await this.waitForUrl(/\/products-services\/list/, config.timeouts.navigation);
    logger.success(`Product saved${id ? ` (id: ${id})` : ''}`);
    return { id };
  }

  // ─── 7. Search & open ───────────────────────────────────────────────────────

  /**
   * Opens a product for edit. CONFIRMED (2026-08-10): there is no edit
   * icon/button anywhere in this module's UI — a list row click IS the edit
   * action, and it navigates to a real, direct-by-id URL
   * (`/setup/products-services/edit/{id}`), so a numeric id can always be
   * navigated to directly without any search/click step at all.
   *
   * @param nameOrId A numeric string navigates directly by id; anything else
   *                 is treated as a name and found via the list search.
   */
  // WHY the trailing name-populated wait (2026-08-11, found live via PS16):
  // a URL match alone doesn't mean the edit form's fields have actually
  // rendered with real data yet — confirmed live via `updateProduct({},
  // id, customFields)` (empty base changes, customFields-only), the one
  // real call shape with no other field fill to incidentally "warm up" the
  // page first. Without this, `isCustomFieldPresent()` (a bare, zero-wait
  // `.count() > 0` check) can run against a still-mounting DOM, silently
  // treating a genuinely-present field as absent and skipping its fill —
  // exactly this codebase's already-documented navigation-drift bug class
  // (six other modules' `waitForEntityDetailPage()`/`waitForEntityListPage()`
  // fixes — see .claude/known-issues.md), just not yet applied here since
  // Products & Services has no detail page for that shared helper to target.
  // Waiting for the Name field's real value (always present, never
  // environment-conditional, unlike custom fields) is the same "real content
  // signal, not just a URL" discipline already proven elsewhere.
  async openProductForEdit(nameOrId: string): Promise<void> {
    if (/^\d+$/.test(nameOrId)) {
      await this.navigateTo(`${config.appUrl}/setup/products-services/edit/${nameOrId}`);
      await this.waitForUrl(/\/products-services\/edit\//, config.timeouts.navigation);
      await this.withSessionExpiryRecovery(() =>
        expect(this.nameInput()).not.toHaveValue('', { timeout: config.timeouts.expect })
      );
      logger.info(`Opened product for edit by id: ${nameOrId}`);
      return;
    }
    await this.goToProductsAndServicesList();
    await this.performSearch(nameOrId);
    const row = this.listRow(nameOrId);
    await row.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.click(row, `product list row: ${nameOrId}`);
    await this.waitForUrl(/\/products-services\/edit\//, config.timeouts.navigation);
    await this.withSessionExpiryRecovery(() =>
      expect(this.nameInput()).not.toHaveValue('', { timeout: config.timeouts.expect })
    );
    logger.info(`Opened product for edit by name: ${nameOrId}`);
  }

  // ─── 8. Edit actions ────────────────────────────────────────────────────────

  // WHY `name` is deliberately NOT settable here (unlike every other field):
  // per the design's guardrail #1 — identity fields (name, and active-status
  // specifically on adminActive/restrictedActive) must never be mutated by
  // any test. Leaving `name` out of this method's own parameter surface
  // makes that guardrail structurally true here, rather than relying purely
  // on test-level discipline to never pass it.
  async fillEditForm(
    changes: Partial<Omit<ProductsAndServicesData, 'name'>>,
    customFields?: ProductsCustomFieldData
  ): Promise<void> {
    if (changes.price !== undefined) {
      await this.fill(this.priceInput(), String(changes.price), 'price (edit)');
    }
    if (changes.description !== undefined) {
      await this.setDescriptionViaCkEditor(changes.description);
    }
    if (changes.hsnSacCode !== undefined) {
      await this.fill(this.hsnSacInput(), changes.hsnSacCode, 'HSN/SAC code (edit)');
    }
    if (changes.countryOfOrigin !== undefined) {
      await this.selectFromReactSelect(
        this.countryOfOriginAnchor(),
        changes.countryOfOrigin,
        'Country of Origin (edit)'
      );
    }
    if (changes.category !== undefined) {
      await this.selectFromReactSelect(this.categoryAnchor(), changes.category, 'Category (edit)');
    }
    if (changes.units !== undefined) {
      await this.selectFromReactSelect(this.unitsAnchor(), changes.units, 'Units (edit)');
    }
    if (changes.isActive !== undefined) {
      await this.setIsActive(changes.isActive);
    }
    if (customFields) {
      await this.fillProductsCustomFields(customFields);
    }
    logger.success('Product edit form filled');
  }

  /**
   * Saves the edit form. Confirmed live (2026-08-10, tested against the real
   * `adminActive` fixture, id 53242 — a sanctioned non-identity-field update
   * per the design's own "update the shared fixture" test): on success the
   * app navigates to the list page, identical to the create form's own save
   * behavior. The real edit endpoint is confirmed live to be
   * `PUT /v1/products/{id}`, sending the full record (read-modify-write),
   * not a partial patch — captured for reference, not required by this
   * method itself since it only needs to observe the UI outcome, not the
   * request shape.
   */
  async saveEditedProduct(): Promise<void> {
    await this.click(this.saveButton(), 'Save (product edit)');
    await this.assertNoFormErrors('product edit form');
    await this.waitForUrl(/\/products-services\/list/, config.timeouts.navigation);
    logger.success('Product edit saved');
  }

  /**
   * Asserts that a restricted user cannot save an edit to an admin-owned
   * product — the core server-side-enforced RBAC check this module relies
   * on (per the design: "Everyone sees everything; restricted can't edit
   * admin's"). Flow, per the design doc (marked CONFIRMED there): the form
   * loads normally with no client-side block, Save starts disabled (ordinary
   * dirty-state UX, unrelated to RBAC), a real change enables it, and the
   * PUT response itself carries the actual denial — 403 with the specific
   * `00902001` error code.
   *
   * WHY this session did not independently re-verify the 403/00902001
   * response with a live restricted-vs-admin-owned-fixture test (unlike
   * every other mechanism in this file, which WAS independently confirmed
   * live this session): the design doc explicitly marks this exact
   * mechanism as already CONFIRMED by its author, and time/scope did not
   * extend to re-deriving an already-confirmed claim from scratch. Flagged
   * transparently here rather than silently presented as independently
   * re-verified — this should be the first thing checked for real when
   * Batch 8's RBAC test that exercises this method actually runs.
   *
   * @param id The admin-owned product's id (e.g. the `adminActive` fixture).
   */
  async assertForbiddenOnRestrictedEdit(id: string): Promise<void> {
    // WHY wrapped in withSessionExpiryRetry() (flagged by locator-reviewer,
    // 2026-08-10): this method is self-starting (it opens the edit page
    // itself, like createProduct()/updateProduct()), so it's safe to retry
    // the whole thing once on a detected expiry — consistent with this
    // file's own convention for every other self-starting workflow method.
    return this.withSessionExpiryRetry(async () => {
      await this.openProductForEdit(id);
      const priceBefore = await this.priceInput()
        .inputValue()
        .catch(() => '0');
      await this.fill(
        this.priceInput(),
        String(Number(priceBefore || '0') + 1),
        'price (dirty-state trigger for RBAC check)'
      );

      // WHY armResponseWaitWithRecovery() + this.click(), not a raw
      // page.waitForResponse()/saveButton().click(): mirrors
      // saveProduct()'s own pattern exactly. WHY escapeRegExp(id): matches
      // this file's own convention for every other dynamic-value regex —
      // `id` is documented as numeric-only today, but escaping it costs
      // nothing and removes the one inconsistent instance of this pattern.
      const responsePromise = this.armResponseWaitWithRecovery(
        (res) =>
          new RegExp(`/v1/products/${this.escapeRegExp(id)}$`).test(new URL(res.url()).pathname) &&
          ['PUT', 'PATCH'].includes(res.request().method()),
        'assertForbiddenOnRestrictedEdit: edit PUT/PATCH',
        config.timeouts.expect
      );
      await this.click(this.saveButton(), 'Save (restricted-edit RBAC check)');
      const response = await responsePromise;
      const body = (await response.json().catch(() => ({}))) as { code?: string };

      await this.withSessionExpiryRecovery(() => {
        expect(
          response.status(),
          'Expected HTTP 403 when a restricted user attempts to save an admin-owned product'
        ).toBe(403);
        expect(body.code, 'Expected the specific "00902001" error code on the 403 response').toBe(
          '00902001'
        );
        return Promise.resolve();
      });
      logger.success(
        `Confirmed restricted-user edit is forbidden (403 + 00902001) for product id: ${id}`
      );
    }, 'assertForbiddenOnRestrictedEdit');
  }

  // ─── 9. Assertions ──────────────────────────────────────────────────────────

  async assertOnProductsAndServicesListPage(): Promise<void> {
    await this.assertUrl(/\/products-services\/list/);
    logger.success('Confirmed on Products & Services list page');
  }

  // WHY this asserts only the fields the list page's own grid columns
  // actually render (confirmed live, 2026-08-10): ID, Name, Description,
  // Price, HSN Or SAC Code, Country Of Origin, Category, Active — there is
  // NO Units column on the list page, so Units can never be verified here;
  // verify it via the edit page instead if needed.
  async assertProductInList(data: Pick<ProductsAndServicesData, 'name'>): Promise<void> {
    const found = await this.retryFindInList(data.name);
    if (!found) {
      throw new Error(`Product not found in list after retries: ${data.name}`);
    }
    logger.success(`Product confirmed in list: ${data.name}`);
  }

  async assertProductNotInList(name: string): Promise<void> {
    await this.goToProductsAndServicesList();
    // WHY performSearch() already awaits the real search response before
    // returning (see its own implementation), so no additional wait is
    // needed before checking absence — unlike a bare `toBeHidden()` on a
    // locator that was never confirmed to have been searched yet, this
    // isn't at risk of the "zero elements = instantly hidden" false-pass
    // footgun (see BasePage.addProductRowAndSearchByName()'s own comment
    // for that failure mode) — the search itself has already completed.
    // Scoped to the Name cell specifically (not the whole row's
    // concatenated text), same anchored-match reasoning as listRow().
    await this.performSearch(name);
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.nameCell(name),
        `Product "${name}" should NOT be visible in the list but was found`
      ).toBeHidden({ timeout: config.timeouts.expect })
    );
    logger.success(`Confirmed product not in list: ${name}`);
  }

  /**
   * Asserts the INLINE duplicate-name field error. CONFIRMED live
   * (2026-08-10) this is a real, field-scoped inline error — NOT a toast,
   * NOT a save-time API error. Typing an already-existing product's name
   * and blurring the field fires `GET /v1/products/has-duplicates?
   * fieldName=name&value=...`, and the real rendered markup is:
   * `<span class="invalid-feedback ...">Product and Service with this name
   * already exists<a ...>&nbsp;View Product and Service</a></span>` next to
   * the Name input (which itself gains an `is-invalid` class). The exact
   * message text below is copied verbatim from that live capture, not
   * guessed.
   */
  async assertDuplicateNameFieldError(): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.nameFieldError(),
        'Expected the inline duplicate-name field error to appear next to the Name field'
      ).toContainText('Product and Service with this name already exists', {
        timeout: config.timeouts.expect,
      })
    );
    logger.success('Confirmed inline duplicate-name field error');
  }

  /**
   * Asserts specific field VALUES on the edit page — the only place Units
   * can ever be verified (the list grid has no Units column, confirmed
   * live). Added in Batch 7 to support the "update the shared active
   * fixture, verify updated values" test named when this module's test list
   * was first confirmed — no equivalent value-level verification method
   * existed until that test needed one (the pre-existing
   * `assertProductInList()` only checks NAME presence, per its own comment).
   *
   * WHY each field's own already-proven check mechanism is reused rather
   * than a new one invented: price/HSN are plain inputs
   * (`toHaveValue()`); description is CKEditor-rendered
   * (`toContainText()` against `descriptionWrapper()`, the same locator
   * `setDescriptionViaCkEditor()` already resolves through);
   * country/category/units are react-select controls, checked via the same
   * "assert the CONTROL's rendered text" mechanism `selectFromReactSelect()`
   * itself already uses (not the anchor input's own value, which react-select
   * clears/reuses after a selection — see that method's own comment).
   *
   * @param nameOrId Same contract as openProductForEdit().
   * @param expected Only the fields actually provided are asserted.
   */
  async assertProductFieldsOnEditPage(
    nameOrId: string,
    expected: Partial<Omit<ProductsAndServicesData, 'name'>>
  ): Promise<void> {
    await this.openProductForEdit(nameOrId);

    if (expected.price !== undefined) {
      await this.withSessionExpiryRecovery(() =>
        expect(this.priceInput(), 'Expected price to match after update').toHaveValue(
          String(expected.price),
          { timeout: config.timeouts.expect }
        )
      );
    }
    if (expected.description !== undefined) {
      await this.withSessionExpiryRecovery(() =>
        expect(
          this.descriptionWrapper(),
          'Expected description to match after update'
        ).toContainText(expected.description as string, { timeout: config.timeouts.expect })
      );
    }
    if (expected.hsnSacCode !== undefined) {
      await this.withSessionExpiryRecovery(() =>
        expect(this.hsnSacInput(), 'Expected HSN/SAC code to match after update').toHaveValue(
          expected.hsnSacCode as string,
          { timeout: config.timeouts.expect }
        )
      );
    }
    if (expected.countryOfOrigin !== undefined) {
      const control = this.countryOfOriginAnchor().locator(
        'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
      );
      await this.withSessionExpiryRecovery(() =>
        expect(control, 'Expected Country of Origin to match after update').toContainText(
          expected.countryOfOrigin as string,
          { timeout: config.timeouts.expect }
        )
      );
    }
    if (expected.category !== undefined) {
      const control = this.categoryAnchor().locator(
        'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
      );
      await this.withSessionExpiryRecovery(() =>
        expect(control, 'Expected Category to match after update').toContainText(
          expected.category as string,
          { timeout: config.timeouts.expect }
        )
      );
    }
    if (expected.units !== undefined) {
      const control = this.unitsAnchor().locator(
        'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
      );
      await this.withSessionExpiryRecovery(() =>
        expect(control, 'Expected Units to match after update').toContainText(
          expected.units as string,
          { timeout: config.timeouts.expect }
        )
      );
    }
    logger.success('Product fields verified on edit page');
  }

  // ─── 10. Workflow wrappers ──────────────────────────────────────────────────

  async createProduct(
    data: ProductsAndServicesData,
    customFields?: ProductsCustomFieldData
  ): Promise<{ id: string | null }> {
    return this.withSessionExpiryRetry(async () => {
      const attemptData = { ...data };
      await this.goToProductsAndServicesList();
      await this.goToCreateProductForm();
      await this.fillProductsAndServicesForm(attemptData, customFields);
      const result = await this.saveProduct();
      logger.success(`Product created: ${attemptData.name} (id: ${result.id})`);
      return result;
    }, 'createProduct');
  }

  async updateProduct(
    changes: Partial<Omit<ProductsAndServicesData, 'name'>>,
    nameOrId: string,
    customFields?: ProductsCustomFieldData
  ): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      const attemptChanges = { ...changes };
      await this.openProductForEdit(nameOrId);
      await this.fillEditForm(attemptChanges, customFields);
      await this.saveEditedProduct();
      logger.success(`Product updated: ${nameOrId}`);
    }, 'updateProduct');
  }
}
