import { Page, expect, Locator, Response } from '@playwright/test';
import { faker } from '@faker-js/faker';
import { BasePage } from '../../core/BasePage';
import { ContactData, CONTACT_CUSTOM_FIELD_NAMES } from '../../data/factories/contactFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

export class ContactsPage extends BasePage {
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

  private readonly contactTable = (): Locator => this.page.locator('.rt-table');

  private readonly contactRowNameCell = (firstName: string): Locator =>
    this.page
      .locator('.rt-tr-group')
      .filter({ has: this.page.getByText(firstName, { exact: true }) })
      .first();

  private readonly showRequiredToggle = (): Locator =>
    this.page.locator('label').filter({ hasText: 'Show Required & Important Fields' });

  // WHY: the actual checkbox behind the toggle above — same xpath-sibling
  // approach as LeadsPage.showRequiredToggleCheckbox(). Confirmed live
  // (2026-07-14) this toggle's on/off state persists across modal
  // open/close within a session for Contact too (identical to Lead's
  // documented finding) — needed to check current state before deciding
  // whether to click, rather than clicking unconditionally.
  private readonly showRequiredToggleCheckbox = (): Locator =>
    this.showRequiredToggle().locator('xpath=preceding-sibling::input[@type="checkbox"]');

  private readonly firstNameInput = (): Locator => this.page.locator('input[name="firstName"]');

  private readonly lastNameInput = (): Locator => this.page.locator('input[name="lastName"]');

  private readonly addEmailButton = (): Locator =>
    this.page.getByText('Add Email', { exact: true }).first();

  private readonly emailInput = (): Locator => this.page.locator('input[name="emails[0].value"]');

  private readonly addPhoneButton = (): Locator =>
    this.page.getByText('Add Phone', { exact: true }).first();

  // WHY: exact `name` match, not a loose `id*="input_phone_0"` substring
  // (2026-07-16 fix) — that pattern is confirmed live to collide with any
  // future repeatable field whose first entry also ends in "_input_phone_0"
  // (confirmed via the identical bug in LeadsPage.ts, caused there by its
  // new Company Phones field). Contact has no such field today, but
  // `name="phoneNumbers[0]"` is the actual bound form field and is strictly
  // safer at zero cost, so it's fixed here too rather than left as a latent
  // risk for whenever Contact grows a similar field.
  private readonly phoneInput = (): Locator => this.page.locator('input[name="phoneNumbers[0]"]');

  private readonly addressInput = (): Locator => this.page.locator('input[name="address"]');

  private readonly cityInput = (): Locator => this.page.locator('input[name="city"]');

  private readonly stateInput = (): Locator => this.page.locator('input[name="state"]');

  private readonly zipcodeInput = (): Locator => this.page.locator('input[name="zipcode"]');

  private readonly facebookInput = (): Locator => this.page.locator('input[name="facebook"]');

  private readonly twitterInput = (): Locator => this.page.locator('input[name="twitter"]');

  // NOTE: contacts use 'linkedin' (all lowercase) — leads use 'linkedIn'
  private readonly linkedinInput = (): Locator => this.page.locator('input[name="linkedin"]');

  // WHY: confirmed live (2026-07-16) — same field/id as Lead's Timezone,
  // sitting at the same Communication/Location DOM boundary. Company is a
  // live async lookup (not a static picklist) against real Company records —
  // confirmed live it requires 3+ typed characters before returning results
  // ("Type atleast 3 characters..." shown below that threshold) and that
  // admin vs. restricted user see genuinely different, role-scoped result
  // sets for the identical search term.
  private readonly timezoneControl = (): Locator =>
    this.page
      .locator('[id="1_22_input_timezone"]')
      .locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly companyInput = (): Locator => this.page.locator('[id="4_11_input_company"]');

  private readonly companyControl = (): Locator =>
    this.companyInput().locator('xpath=ancestor::div[contains(@class,"__control")]');

  private readonly departmentInput = (): Locator => this.page.locator('input[name="department"]');

  private readonly designationInput = (): Locator =>
    this.page.locator('input[name="designation"]');

  // UTM / source fields — below address, require scroll on some viewports
  private readonly subSourceInput = (): Locator => this.page.locator('input[name="subSource"]');
  private readonly salutationInput = (): Locator => this.page.locator('[id="0_11_input_salutation"]');
  private readonly campaignInput = (): Locator => this.page.locator('[id="5_11_input_campaign"]');
  private readonly sourceInput = (): Locator => this.page.locator('[id="5_12_input_source"]');

  private readonly utmSourceInput = (): Locator => this.page.locator('input[name="utmSource"]');

  private readonly utmCampaignInput = (): Locator =>
    this.page.locator('input[name="utmCampaign"]');

  private readonly utmMediumInput = (): Locator => this.page.locator('input[name="utmMedium"]');

  private readonly utmContentInput = (): Locator => this.page.locator('input[name="utmContent"]');

  private readonly utmTermInput = (): Locator => this.page.locator('input[name="utmTerm"]');

  private readonly saveButton = (): Locator =>
    this.page.locator('button[type="submit"].save-button');

  // WHY: Contacts edit button uses #edit-action (NO -btn suffix) — known difference from leads
  private readonly editIconButton = (): Locator => this.page.locator('#edit-action');

  private readonly editModal = (): Locator => this.page.locator('#editEntityModal');

  // WHY: scoped to #editEntityModal, not page-wide — same confirmed root
  // cause as LeadsPage.modalCancelButton() (see that file's own comment):
  // this app has multiple modal templates that all share the generic
  // `data-dismiss="modal"` attribute on their own close buttons. An unscoped
  // `.first()` can resolve to a hidden, 0×0 button belonging to an
  // unrelated, closed modal template instead of the real, visible
  // editEntityModal close button — Playwright then retries the click
  // forever waiting for an element that can never become visible. This
  // stayed dormant because closeModalIfOpen() only runs at the start of
  // goToContactsList(), and every Contact test before C18 called
  // goToContactsList() only once per test, before any modal was ever open
  // — never triggering this click. C18's per-case loop (leave the modal
  // open after an intentionally-failed save, then call goToContactsList()
  // again for the next case) was the first real trigger — confirmed live
  // (2026-07-14) via an 805-retry, 8-minute actionability hang that burned
  // the entire test timeout.
  private readonly modalCancelButton = (): Locator =>
    this.editModal().locator('button[data-dismiss="modal"]').first();

  // ── Ellipsis menu ─────────────────────────────────────────
  // WHY: Contacts uses same btn-down-arrow btn-primary as Leads
  // Confirmed from DOM: btn[6] class="btn dropdown-toggle btn-down-arrow btn-primary"
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
  // WHY: SVG IDs differ between contacts and leads for Call Logs
  // Contacts: paint1_linear_contacts | Leads: paint1_linear_leads
  private readonly rightPanelIconSvgMap: Record<string, string> = {
    'Notes': 'paint0_linear_972_2654',
    'Tasks': 'clip-Ic_Task',
    'Meetings': 'clip-Ic_Meetings',
    'Call Logs': 'paint1_linear_contacts',
    'Quotations': 'Quotation_Icon-16px_New',
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

  // ── Quotation panel ───────────────────────────────────────
  private readonly quotationPanelAddButton = (): Locator =>
    this.page.locator('.quotation').locator('button.btn-primary.btn-xs').first();

  private readonly quotationAddModalTitle = (): Locator =>
    this.page.locator('#editEntityModal .modal-title');

  // ── Detail page ───────────────────────────────────────────
  private readonly pageTitle = (): Locator => this.page.locator('.page-title');

  // WHY: confirmed live (2026-07-14) — same "Other Details" tab convention
  // as the other detail-page tabs already used in assertContactDetailFields()
  // (#nav-tab0-tab through #nav-tab4-tab), one index further along.
  private readonly otherDetailsDetailPageTab = (): Locator => this.page.locator('#nav-tab5-tab');

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
            res.url().includes('/v1/contacts') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
          { timeout: config.timeouts.navigation }
        )
        .catch(() => null),
      this.contactTable()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
    await expect(this.contactTable()).toBeVisible({ timeout: config.timeouts.navigation });
    await this.waitForLoaderToDisappear();
  }

  private async waitForLoaderToDisappear(): Promise<void> {
    try {
      await this.searchLoader().last().waitFor({ state: 'hidden', timeout: 10000 });
    } catch {
      // loader may not exist — continue
    }
  }

  private async waitForSearchResults(firstName: string): Promise<boolean> {
    try {
      await expect(this.contactRowNameCell(firstName)).toBeVisible({ timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async waitForContactDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/contacts\/details\//, { timeout: 20000 });
    await this.page.waitForLoadState('domcontentloaded');
    // WHY: Wait for contact GET API response — ensures React has contactId in state
    // Without this, share/edit fires before app resolves contactId → /contacts/undefined/share
    await this.page.waitForResponse(
      (res) => res.url().match(/\/v1\/contacts\/\d+$/) !== null && res.request().method() === 'GET',
      { timeout: 15000 }
    ).catch(() => null);
  }

  async goToContactDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to contact details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/contacts/details/${id}`);
    await this.waitForContactDetailsPage();
  }

  private async waitForContactListPage(): Promise<void> {
    await this.waitForUrl(/contacts\/list/);
    await this.waitForListReady();
  }

  private async closeModalIfOpen(): Promise<void> {
    const modal = this.editModal();
    try {
      if (await modal.isVisible()) {
        logger.info('Closing existing modal');
        // WHY: explicit timeout — a raw, unbounded click() here previously
        // inherited the whole test's timeout (up to 8 minutes) on failure
        // instead of failing fast into this method's own try/catch. Same
        // fix as LeadsPage.closeModalIfOpen().
        await this.modalCancelButton().click({ timeout: 10000 });
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
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
        // WHY: confirmed live (2026-07-14) — same bug as LeadsPage's toggle,
        // and same fix. This toggle's on/off state is NOT re-initialized per
        // form open; it persists across modal open/close within a session
        // (confirmed: reopening the edit modal a second time in the same
        // session kept the toggle's prior state). A blind, unconditional
        // click here would flip an already-off toggle back ON — hiding
        // "Other Details" (and its custom fields) right when a caller needs
        // it visible. Only click when it's actually checked.
        const isChecked = await this.showRequiredToggleCheckbox()
          .isChecked()
          .catch(() => true);
        if (!isChecked) {
          logger.debug('Show Required & Important Fields already disabled — skipping click');
          return;
        }
        logger.info('Disabling Show Required & Important Fields');
        await toggle.click();
        await expect(this.firstNameInput()).toBeVisible({ timeout: 20000 });
        logger.success('Toggle disabled');
      }
    } catch (error) {
      logger.debug(`Toggle not available: ${String(error)}`);
    }
  }

  // WHY: single choke point for filling all 9 Contact custom fields — called
  // from both fillContactForm() (create) and fillEditForm() (update) so
  // every Contact creation/update path attempts these fields, per the
  // environment-safety contract: each BasePage helper checks DOM presence
  // and skips gracefully when a field doesn't exist yet in the current
  // environment (see BasePage's Custom Field Helpers section for why).
  //
  // WHY no tab-click step (unlike LeadsPage.fillLeadCustomFields(), which
  // calls openOtherDetailsFormSection() first): confirmed live (2026-07-14,
  // both create and edit forms) — Contact's form renders all 7 sections
  // (Basic Information, Communication, Location, Social, Professional,
  // Campaign Information, Other Details) in one continuous scrollable page;
  // the "Other Details" nav-link only scrolls to that section, it does not
  // toggle a hidden tab-pane the way Lead's modal does. The custom field
  // inputs are already visible and fillable as soon as
  // disableRequiredFieldsToggle() has run — matching how this file's
  // existing Campaign Information fields (campaign/source) are already
  // filled today with no tab click at all. Do not port
  // openOtherDetailsFormSection() here — it would be dead code for this
  // entity's actual DOM structure.
  //
  // Mutates `data.customFields.pickList`/`.multiPickList` in place with
  // whatever was actually selected live — PickList/MultiPickList options
  // are read from the DOM at fill time, so the caller's `data` object needs
  // to be updated to reflect reality before it's used for later
  // verification.
  private async fillContactCustomFields(data: ContactData): Promise<void> {
    const cf = data.customFields;

    await this.fillTextLikeCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.fillTextLikeCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.fillTextLikeCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number'
    );
    await this.fillTextLikeCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field'
    );
    await this.setCheckboxCustomField(CONTACT_CUSTOM_FIELD_NAMES.checkbox, cf.checkbox, 'Checkbox');
    await this.selectDateCustomField(CONTACT_CUSTOM_FIELD_NAMES.date, cf.date, 'Date');
    await this.selectDateTimeCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.dateTimePicker,
      cf.dateTimePicker,
      'Date Time Picker'
    );

    const pickedValue = await this.selectPicklistCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.pickList,
      'Pick List'
    );
    if (pickedValue !== null) cf.pickList = pickedValue;

    const pickedValues = await this.selectMultiPicklistCustomField(
      CONTACT_CUSTOM_FIELD_NAMES.multiPickList,
      'Multi Pick List'
    );
    if (pickedValues.length > 0) cf.multiPickList = pickedValues;
  }

  private async performSearch(searchText: string): Promise<void> {
    logger.info(`Searching contact: ${searchText}`);
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

  private async captureContactIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.page.waitForResponse(
        (res) =>
          // WHY: hardened 2026-07-19 — same ID-capture bug class already fixed
          // in DealsPage/CompaniesPage/Deals' quotation-panel flow: a bare
          // `.includes('/v1/contacts')` substring with no `/reports/`
          // exclusion and no 201 acceptance. Found via a codebase-wide re-audit
          // of every waitForResponse call after the same class turned up in
          // LeadsPage — not independently live-reproduced for Contacts, but
          // fixed as defense-in-depth since it shares the identical shape.
          res.url().includes('/v1/contacts') &&
          !res.url().includes('/reports/') &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        { timeout: 30000 }
      );
      const body = await response.json();
      const contactId = body?.id ?? body?.data?.id ?? null;
      logger.success(`Captured contact ID: ${contactId}`);
      return contactId;
    } catch (error) {
      logger.warn(`Unable to capture contact ID: ${String(error)}`);
      return null;
    }
  }

  // WHY: React Select dropdowns in contacts render options in a React portal OUTSIDE
  // the control container. Scoping options to the visible .is-invalid__menu (the portal
  // root) prevents accidentally clicking stale options from a simultaneously-open dropdown.
  // Steps mirror selectFromIsInvalidControl in QuotationsPage but add the menu-visible gate.
  private async selectFromContactDropdown(inputId: string, optionText: string): Promise<void> {
    const input = this.page.locator(`[id="${inputId}"]`);
    await input.scrollIntoViewIfNeeded();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Click the ancestor .is-invalid__control wrapper — clicking the input alone
    // does not reliably trigger the React Select open handler on portalled dropdowns
    const control = input.locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
    const menu = this.page.locator('.is-invalid__menu');
    await control.click();
    // WHY: Confirmed live — a control click can occasionally fail to register (e.g.
    // scroll/animation still settling right after a modal opens), which previously
    // just burned the full menu-visible timeout for a click that never landed. Check
    // for the menu portal being ATTACHED (React mounts it immediately on open, well
    // before any visible-state CSS transition finishes) as a fast, safe signal the
    // click worked. Only re-click if it's genuinely not attached — re-clicking an
    // already-open dropdown would just toggle it closed.
    const opened = await menu
      .waitFor({ state: 'attached', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) {
      logger.warn(`Dropdown did not open on first click for ${inputId} — retrying click`);
      await control.click();
    }
    // WHY: Fill to filter the option list before clicking — reduces noise and speeds up selection
    await input.fill(optionText);
    // WHY: Wait for .is-invalid__menu to appear — confirms THIS dropdown opened and its
    // options are rendered in the portal. Prevents racing against another open dropdown.
    await menu.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Scope the option click to the visible menu container — avoids clicking options
    // from a simultaneously-visible dropdown elsewhere on the page (portal conflict)
    const option = menu.locator('.is-invalid__option').filter({ hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    // WHY: Wait for menu to collapse — confirms React Select registered the selection
    await menu.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    logger.debug(`Selected "${optionText}" from contact dropdown: ${inputId}`);
  }

  private async retryFindContact(firstName: string): Promise<boolean> {
    const currentConfig = this.retryConfig;
    for (let attempt = 1; attempt <= currentConfig.retries; attempt++) {
      logger.info(`Search attempt ${attempt}/${currentConfig.retries}`);
      await this.goToContactsList();
      await this.performSearch(firstName);
      const found = await this.waitForSearchResults(firstName);
      if (found) {
        logger.success('Contact found');
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

  async goToContactsList(): Promise<void> {
    logger.info('Navigating to Contacts List');
    await this.closeModalIfOpen();
    await this.navigateTo(`${config.appUrl}/sales/contacts/list`);
    await this.waitForContactListPage();
    logger.success('On Contacts List page');
  }

  async clickAddContact(): Promise<void> {
    logger.info('Clicking Add Contact');
    await this.click(this.addButton(), 'add contact button');
    await expect(this.firstNameInput()).toBeVisible({ timeout: 10000 });
    logger.success('Contact form opened');
  }

  // ──────────────────────────────────────────────────────────
  // 6. Form Actions
  // ──────────────────────────────────────────────────────────

  async fillContactForm(data: ContactData): Promise<void> {
    logger.info('Filling contact form');
    await this.disableRequiredFieldsToggle();
    if (data.salutation) {
      await this.selectFromContactDropdown('0_11_input_salutation', data.salutation);
    }
    await this.fill(this.firstNameInput(), data.firstName, 'first name');
    await this.fill(this.lastNameInput(), data.lastName, 'last name');
    await this.click(this.addEmailButton(), 'add email button');
    await expect(this.emailInput()).toBeVisible();
    await this.fill(this.emailInput(), data.email, 'email');
    await this.click(this.addPhoneButton(), 'add phone button');
    await expect(this.phoneInput()).toBeVisible();
    await this.fill(this.phoneInput(), data.phone, 'phone');
    // WHY: Timezone sits at the same Communication/Location DOM boundary as
    // Lead's, filled here to match top-to-bottom form order. Mutated in
    // place with whatever was actually selected, same reasoning as
    // salutation/campaign/source.
    data.timezone = await this.selectRandomFromSingleReactSelect(this.timezoneControl(), 'Timezone');
    // WHY: mutate data.address in place with whatever actually ended up in
    // the field — a live GPS/autocomplete lookup when available, the
    // manual value otherwise — so later detail-page verification checks
    // reality, not the pre-fill guess. Same reasoning as PickList/Campaign
    // fields elsewhere in this method.
    //
    // WHY pass the Location section container explicitly (2026-07-16
    // hardening): Contact only has one "Get GPS Address" trigger today, but
    // scoping to its own section keeps this robust even if a second
    // GPS-enabled field is ever added to this form — the same helper Lead
    // now depends on for its two triggers.
    data.address = await this.fillAddressViaGpsOrManual(
      this.addressInput(),
      data.address,
      'address',
      this.getFormSectionContainer('Location')
    );
    await this.fill(this.cityInput(), data.city, 'city');
    await this.fill(this.stateInput(), data.state, 'state');
    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');
    await this.fill(this.facebookInput(), data.facebook, 'facebook');
    await this.fill(this.twitterInput(), data.twitter, 'twitter');
    await this.fill(this.linkedinInput(), data.linkedin, 'linkedin');
    // WHY: Company sits right after LinkedIn and before Department (confirmed
    // live DOM order). A live async lookup, not a static picklist — searched
    // and selected within THIS page's own current role/session, so the
    // result set is naturally role-scoped without any explicit branching.
    // WHY: exactValue passthrough (2026-07-16) — a caller that pre-populates
    // data.company with a known, freshly-created company name (e.g. so it
    // can independently share that exact company too) gets that exact
    // company selected instead of a random pick; passing '' (the default
    // placeholder) preserves the original random-pick behavior unchanged.
    data.company = await this.selectRandomFromSearchableReactSelect(
      this.companyControl(),
      this.companyInput(),
      'com',
      'Company',
      data.company || undefined
    );
    await this.fill(this.departmentInput(), data.department, 'department');
    await this.fill(this.designationInput(), data.designation, 'designation');
    // WHY: UTM fields sit below address and may be off-screen.
    // scrollIntoViewIfNeeded ensures fill doesn't silently fail
    await this.utmSourceInput().scrollIntoViewIfNeeded();
    await this.fill(this.subSourceInput(), data.subSource, 'sub source');
    if (data.campaign) {
      await this.selectFromContactDropdown('5_11_input_campaign', data.campaign);
    }
    if (data.source) {
      await this.selectFromContactDropdown('5_12_input_source', data.source);
    }
    await this.fill(this.utmSourceInput(), data.utmSource, 'utm source');
    await this.fill(this.utmCampaignInput(), data.utmCampaign, 'utm campaign');
    await this.fill(this.utmMediumInput(), data.utmMedium, 'utm medium');
    await this.fill(this.utmContentInput(), data.utmContent, 'utm content');
    await this.fill(this.utmTermInput(), data.utmTerm, 'utm term');
    await this.fillContactCustomFields(data);
    logger.success('Contact form filled');
  }

  async saveContact(): Promise<number | null> {
    logger.info('Saving contact');
    const contactIdPromise = this.captureContactIdFromResponse();
    await this.click(this.saveButton(), 'save button');
    await this.assertNoFormErrors('contact create form');
    const contactId = await contactIdPromise;
    // WHY: Confirmed live (2026-07-07) — a failed save (backend 4xx/5xx) previously still
    // logged "Contact saved successfully" and returned null, letting callers proceed on a
    // contact that doesn't exist. Fail fast instead, matching the "Fresh company ID not
    // captured" convention already used elsewhere in this codebase.
    if (!contactId) {
      throw new Error('Contact ID not captured after save — cannot proceed (save likely failed silently)');
    }
    await this.waitForContactListPage();
    logger.success('Contact saved successfully');
    return contactId;
  }

  // ──────────────────────────────────────────────────────────
  // 7. Search & Open
  // ──────────────────────────────────────────────────────────

  async searchAndOpenContact(firstName: string, contactId?: number): Promise<void> {
    logger.info(`Opening contact: ${firstName}`);
    if (contactId) {
      logger.info(`Opening contact directly via ID: ${contactId}`);
      await this.navigateTo(`${config.appUrl}/sales/contacts/details/${contactId}`);
      await this.waitForContactDetailsPage();
      return;
    }
    const found = await this.retryFindContact(firstName);
    expect(found).toBeTruthy();
    await this.contactRowNameCell(firstName).click();
    await this.waitForContactDetailsPage();
    logger.success(`Contact opened: ${firstName}`);
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
    // WHY: Wait for firstName input — modal animation on GHA is slow
    await this.firstNameInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    logger.success('Edit modal opened');
  }

  async fillEditForm(data: ContactData): Promise<void> {
    logger.info('Updating contact form');
    if (data.salutation) {
      await this.selectFromContactDropdown('0_11_input_salutation', data.salutation);
    }
    await this.fill(this.firstNameInput(), data.firstName, 'first name');
    await this.fill(this.lastNameInput(), data.lastName, 'last name');
    // WHY: Update email — id="1_11_input_email_0"
    await this.fill(this.page.locator('[id="1_11_input_email_0"]'), data.email, 'email');
    // WHY: Update phone — id="1_12_input_phone_0"
    await this.fill(this.page.locator('[id="1_12_input_phone_0"]'), data.phone, 'phone');
    // WHY: Update timezone — same field/mutate-in-place reasoning as create
    data.timezone = await this.selectRandomFromSingleReactSelect(this.timezoneControl(), 'Timezone');
    // WHY: Update address fields — same GPS-or-manual mutate-in-place
    // reasoning as fillContactForm() above, including the section-scoped
    // GPS trigger (2026-07-16 hardening).
    data.address = await this.fillAddressViaGpsOrManual(
      this.addressInput(),
      data.address,
      'address',
      this.getFormSectionContainer('Location')
    );
    await this.fill(this.cityInput(), data.city, 'city');
    await this.fill(this.stateInput(), data.state, 'state');
    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');
    // WHY: Update social fields
    await this.fill(this.facebookInput(), data.facebook, 'facebook');
    await this.fill(this.twitterInput(), data.twitter, 'twitter');
    await this.fill(this.linkedinInput(), data.linkedin, 'linkedin');
    // WHY: Update company — same live, role-scoped lookup reasoning as create
    // WHY: exactValue passthrough (2026-07-16) — a caller that pre-populates
    // data.company with a known, freshly-created company name (e.g. so it
    // can independently share that exact company too) gets that exact
    // company selected instead of a random pick; passing '' (the default
    // placeholder) preserves the original random-pick behavior unchanged.
    data.company = await this.selectRandomFromSearchableReactSelect(
      this.companyControl(),
      this.companyInput(),
      'com',
      'Company',
      data.company || undefined
    );
    // WHY: Update professional fields
    await this.fill(this.departmentInput(), data.department, 'department');
    await this.fill(this.designationInput(), data.designation, 'designation');
    if (data.campaign) {
      await this.selectFromContactDropdown('5_11_input_campaign', data.campaign);
    }
    if (data.source) {
      await this.selectFromContactDropdown('5_12_input_source', data.source);
    }
    // WHY: Update campaign fields
    await this.fill(this.page.locator('[id="5_21_input_subSource"]'), data.subSource, 'subSource');
    await this.fill(this.page.locator('[id="5_22_input_utmSource"]'), data.utmSource, 'utmSource');
    await this.fill(this.page.locator('[id="5_31_input_utmCampaign"]'), data.utmCampaign, 'utmCampaign');
    await this.fill(this.page.locator('[id="5_32_input_utmMedium"]'), data.utmMedium, 'utmMedium');
    await this.fill(this.page.locator('[id="5_41_input_utmContent"]'), data.utmContent, 'utmContent');
    await this.fill(this.page.locator('[id="5_42_input_utmTerm"]'), data.utmTerm, 'utmTerm');
    // WHY: Bug fix (2026-07-14) — fillEditForm() never called this at all
    // before, unlike LeadsPage's edit path, so "Other Details"/custom fields
    // were unreachable on update. disableRequiredFieldsToggle() is now
    // idempotent (see its own comment) so calling it here is safe even if a
    // prior action in this session already turned the toggle off.
    await this.disableRequiredFieldsToggle();
    await this.fillContactCustomFields(data);
    logger.success('Edit form updated');
  }

  async saveEditedContact(): Promise<void> {
    logger.info('Saving updated contact');
    await this.click(this.saveButton(), 'save button');
    await this.assertNoFormErrors('contact edit form');
    await expect(this.editModal()).toBeHidden({ timeout: 15000 });
    logger.success('Contact updated');
  }

  async deleteContact(): Promise<void> {
    logger.info('Deleting contact via ellipsis menu');
    await this.clickEllipsisOption('Delete');
    await this.deleteConfirmButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.deleteConfirmButton().click();
    await this.page.waitForTimeout(1000);
    logger.success('Contact deleted');
  }

  async cloneContact(): Promise<number | null> {
    logger.info('Cloning contact via ellipsis menu');
    await this.clickEllipsisOption('Clone');
    // WHY: Clone opens create form pre-filled — update email and phone to avoid duplicate errors.
    // WHY no extra wait after saveButton becomes visible (2026-07-16 fix,
    // removed a hardcoded waitForTimeout(1000)): confirmed live (same
    // investigation as LeadsPage.cloneLead()) — the pre-filled email/phone
    // values are already fully populated the instant the save button
    // itself becomes visible, so saveButton().waitFor() is already the
    // correct, sufficient condition.
    await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
    // WHY: Change email to unique value — same email as original causes duplicate error
    const emailInput = this.emailInput();
    if (await emailInput.isVisible().catch(() => false)) {
      const timestamp = Date.now();
      await emailInput.fill(`clone${timestamp}@testkylas.com`);
      logger.debug('Clone email updated to unique value');
    }
    // WHY: Ensure lastName is not empty after email fill — clone pre-fills it but fill() may clear it
    const lastNameInput = this.lastNameInput();
    const lastNameValue = await lastNameInput.inputValue().catch(() => '');
    if (!lastNameValue) {
      logger.warn('lastName was cleared during clone — re-filling with Copy suffix');
      await lastNameInput.fill('Contact Copy');
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
    const contactIdPromise = this.captureContactIdFromResponse();
    await this.click(this.saveButton(), 'save cloned contact');
    await this.assertNoFormErrors('contact clone form');
    const contactId = await contactIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveContact() above.
    if (!contactId) {
      throw new Error('Cloned contact ID not captured after save — cannot proceed (save likely failed silently)');
    }
    // WHY: After clone save, app stays on original contact detail — no
    // redirect to list. No trailing wait needed here (2026-07-16 fix,
    // removed a hardcoded waitForTimeout(1500)): assertNoFormErrors() and
    // the ID capture above already confirm the save genuinely completed
    // server-side, and the caller's very next action is always a fresh
    // navigation to the CLONE's own detail page (assertClonedContactLastName's
    // ID-direct-nav), which has its own proper GET-response wait.
    logger.success('Contact cloned successfully');
    return contactId;
  }

  // WHY: escapeRegExp() moved to BasePage (2026-07-16) — was duplicated
  // privately across Tasks/Companies/Contacts/Leads/Deals; now inherited.

  async shareContact(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing contact with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
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
    // WHY: Select matching user from dropdown — exact match, not substring
    // (a substring match can select the wrong, similarly-named entity)
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
      }
    }
    await this.shareConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Register the share-API response wait BEFORE clicking — confirms the
    // server actually processed the permission change instead of a blind sleep.
    const shareResponsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v1\/contacts\/\d+\/share$/) !== null && res.request().method() === 'POST',
        { timeout: 15000 }
      )
      .catch(() => null);
    await this.shareConfirmButton().click();
    await shareResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Contact shared with: ${restrictedUserName}`);
  }

  async reassignContact(userName: string): Promise<void> {
    logger.info(`Reassigning contact to: ${userName}`);
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
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(userName)}\\s*$`) }).first();
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
          res.url().match(/\/v1\/contacts\/\d+\/owner$/) !== null && res.request().method() === 'PUT',
        { timeout: 15000 }
      )
      .catch(() => null);
    await reassignConfirmButton.click();
    await reassignResponsePromise;
    await this.page.waitForTimeout(300);
    logger.success(`Contact reassigned to: ${userName}`);
  }

  async clickRightPanelIcon(title: string): Promise<void> {
    logger.info(`Clicking right panel icon: ${title}`);
    const icon = this.rightPanelIcon(title);
    await icon.waitFor({ state: 'visible', timeout: 10000 });
    await icon.click();
    await this.page.waitForTimeout(500);
    logger.success(`Right panel icon clicked: ${title}`);
  }

  async addQuotationFromPanel(): Promise<string | null> {
    logger.info('Adding quotation from contact productivity panel');
    // WHY: Click Quotations right panel icon to open quotations section
    await this.clickRightPanelIcon('Quotations');
    await this.page.waitForTimeout(2000);
    // WHY: Add button is button.btn-primary.btn-xs inside Quotations card
    const quotationsCard = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Quotations' }) })
      .first();
    // WHY: Confirmed live (2026-07-06/07) — the Quotations card refetches its
    // own related-quotations list independently of the main entity GET.
    // scrollIntoViewIfNeeded() right after the panel opens can grab a
    // reference to a card mid-refetch that React then replaces, hanging in
    // its "wait for stable position" check. An auto-retrying expect()
    // re-queries the locator on every poll; click() below auto-scrolls its
    // own target, so no manual scroll is needed.
    await expect(quotationsCard, 'Quotations card should be visible').toBeVisible({ timeout: 15000 });
    const quotationCardAdd = quotationsCard.locator('button.btn-primary.btn-xs').first();
    await quotationCardAdd.waitFor({ state: 'visible', timeout: 10000 });
    await quotationCardAdd.click();
    // WHY: Wait for modal to open with "Add Quotation" title
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.quotationAddModalTitle()).toHaveText('Add Quotation', { timeout: 10000 });
    logger.success('Add Quotation modal opened');
    // WHY: Capture quotation ID from POST response before saving
    // WHY: hardened 2026-07-19 — bare '/quotations'/'/quotation' substring had
    // no /reports/ exclusion, same bug class as LeadsPage/ContactsPage's other
    // capture methods; fixed as defense-in-depth (not independently
    // live-reproduced for this specific flow).
    const quotationIdPromise = this.page.waitForResponse(
      (res) =>
        (res.url().includes('/quotations') || res.url().includes('/quotation')) &&
        !res.url().includes('/reports/') &&
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
    // WHY: Fill existing empty product row (row 0) — don't add new row
    // The quotation modal always opens with one empty product row
    // Check price field — if empty, fill the product selector
    const firstProductPrice = this.page.locator('[id="1_03_input_products.0.price"]');
    const firstProductValue = await firstProductPrice.inputValue().catch(() => '');
    logger.debug(`First product price value: "${firstProductValue}"`);
    if (!firstProductValue || firstProductValue === '0' || firstProductValue === '') {
      // WHY: Fill existing row 0 product selector — do NOT click Add New
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
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveContact() above.
    if (!quotationId) {
      throw new Error('Quotation ID not captured after save — cannot proceed (save likely failed silently)');
    }
    logger.success(`Quotation added from panel: ${quotationId}`);
    return quotationId;
  }

  // ──────────────────────────────────────────────────────────
  // 9. Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnContactsListPage(): Promise<void> {
    await this.assertUrl(/contacts\/list/);
  }

  async assertOnContactDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/contacts\/details\//);
  }

  async assertContactExistsInList(firstName: string): Promise<void> {
    logger.info(`Validating contact exists: ${firstName}`);
    const found = await this.retryFindContact(firstName);
    expect(found).toBeTruthy();
    logger.success(`Contact exists: ${firstName}`);
  }

  async assertContactNotInList(firstName: string): Promise<void> {
    logger.info(`Validating contact absent: ${firstName}`);
    await this.goToContactsList();
    await this.performSearch(firstName);
    await expect(this.contactRowNameCell(firstName)).toBeHidden({ timeout: 10000 });
    logger.success(`Contact absent confirmed: ${firstName}`);
  }

  async assertContactDeletedById(contactId: number): Promise<void> {
    logger.info(`Asserting contact ${contactId} is deleted`);
    // WHY: Navigate to detail URL — deleted contact shows error toast or redirects to list
    await this.navigateTo(`${config.appUrl}/sales/contacts/details/${contactId}`);
    await this.page.waitForTimeout(2000);
    const url = this.page.url();
    // WHY: Check either URL redirected away OR contact no longer accessible
    const isRedirected = !url.includes(`/contacts/details/${contactId}`);
    const hasErrorToast = await this.page
      .locator('.toastr.rrt-error, .alert-danger, [class*="error-toast"]')
      .isVisible()
      .catch(() => false);
    expect(isRedirected || hasErrorToast).toBeTruthy();
    logger.success(`Contact ${contactId} confirmed deleted`);
  }

  async assertClonedContactLastName(originalLastName: string, clonedId?: number | null): Promise<void> {
    const clonedLastName = `${originalLastName} Copy`;
    // WHY: fixed 2026-07-16 — this method previously took an optional
    // clonedId that was never referenced in the body at all; verification
    // fell through entirely to retryFindContact(), the same flaky list-
    // search-with-retry pattern already root-caused for Lead's update
    // verification (search-index/list-refresh lag racing a fresh write).
    // Mirrors LeadsPage.assertClonedLeadLastName() exactly: ID-direct-nav
    // as the primary, deterministic path, with clonedId optional and a
    // list-search fallback for the (currently unreachable in practice,
    // since cloneContact() itself fails fast on a missing ID) case where a
    // caller genuinely has no ID to give.
    if (clonedId) {
      logger.info(
        `Asserting cloned contact (ID: ${clonedId}) has "Copy" in lastName — original: ${originalLastName}`
      );
      await this.goToContactDetailsById(clonedId);
      await expect(this.page.locator('body')).toContainText(clonedLastName, { timeout: 15000 });
      logger.success(`Cloned contact found with lastName: ${clonedLastName}`);
      return;
    }
    logger.warn('Cloned contact ID not available — falling back to list search');
    const found = await this.retryFindContact(clonedLastName);
    expect(found, `Cloned contact "${clonedLastName}" should exist in list`).toBeTruthy();
    logger.success(`Cloned contact found with lastName: ${clonedLastName}`);
  }

  async assertOwnerOnDetail(expectedOwner: string): Promise<void> {
    logger.info(`Asserting owner on detail: ${expectedOwner}`);
    // WHY: Owner is in .read-only-info div containing label "Owner"
    // The value is in the sibling span after the label span
    const ownerSection = this.page
      .locator('.read-only-info')
      .filter({ hasText: 'Owner' })
      .first();
    await ownerSection.waitFor({ state: 'visible', timeout: 10000 });
    await expect(ownerSection).toContainText(expectedOwner, { timeout: 10000 });
    logger.success(`Owner confirmed: ${expectedOwner}`);
  }

  async assertContactDetailFields(data: ContactData): Promise<void> {
    logger.info('Asserting contact detail fields');
    // WHY: Detail page renders field values as text inside .read-only-info containers
    // Each container has a label span and a value span as siblings
    // We assert the page contains the expected values visibly
    await this.assertOnContactDetailPage();
    // Assert firstName and lastName in page body
    await expect(this.page.locator('body')).toContainText(data.firstName, { timeout: 10000 });
    await expect(this.page.locator('body')).toContainText(data.lastName, { timeout: 5000 });
    // WHY: Same tab pattern as LeadsPage.assertDetailTabContent()
    const tabPane = this.page.locator('.tab-pane.active.show');
    // WHY: Verify Communication tab — email, phone, timezone
    await this.page.locator('#nav-tab0-tab').click();
    await this.page.waitForTimeout(800);
    const tab0Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab0Text).toContain(data.email.toLowerCase());
    expect(tab0Text).toContain(data.phone);
    // WHY: confirmed live (2026-07-17) via direct DOM inspection of a fresh
    // contact's detail page — Timezone renders on this same Communication
    // tab, container id "timezone", same as Lead's equivalent field.
    if (data.timezone) {
      expect(tab0Text).toContain(data.timezone.toLowerCase());
    }
    logger.debug(`Communication tab — email: ${data.email} | phone: ${data.phone} | timezone: ${data.timezone}`);
    // WHY: Verify Location tab — address, city, state, zipcode
    await this.page.locator('#nav-tab1-tab').click();
    await this.page.waitForTimeout(800);
    const tab1Text = (await tabPane.textContent() ?? '').toLowerCase();
    // WHY: this line was missing despite the comment above claiming address
    // was already checked (2026-07-15 fix) — added now because PART B's
    // GPS-address work needs the detail page to genuinely verify whatever
    // address text ended up in the field (GPS-selected or manual), and every
    // other Contact test benefits from the same real coverage this comment
    // always claimed to provide.
    expect(tab1Text).toContain(data.address.toLowerCase());
    expect(tab1Text).toContain(data.city.toLowerCase());
    expect(tab1Text).toContain(data.state.toLowerCase());
    expect(tab1Text).toContain(data.zipcode.toLowerCase());
    logger.debug(`Location tab — address: ${data.address} | city: ${data.city} | state: ${data.state} | zipcode: ${data.zipcode}`);
    // WHY: Verify Social tab — facebook, twitter, linkedin
    await this.page.locator('#nav-tab2-tab').click();
    await this.page.waitForTimeout(800);
    const tab2Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab2Text).toContain(data.facebook.toLowerCase());
    expect(tab2Text).toContain(data.twitter.toLowerCase());
    expect(tab2Text).toContain(data.linkedin.toLowerCase());
    logger.debug(`Social tab — facebook: ${data.facebook} | twitter: ${data.twitter} | linkedin: ${data.linkedin}`);
    // WHY: Verify Professional tab — department, designation, company
    await this.page.locator('#nav-tab3-tab').click();
    await this.page.waitForTimeout(800);
    const tab3Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab3Text).toContain(data.department.toLowerCase());
    expect(tab3Text).toContain(data.designation.toLowerCase());
    // WHY: confirmed live (2026-07-17) via direct DOM inspection — Company
    // renders on this same Professional tab, container id "company".
    if (data.company) {
      expect(tab3Text).toContain(data.company.toLowerCase());
    }
    logger.debug(`Professional tab — department: ${data.department} | designation: ${data.designation} | company: ${data.company}`);
    // WHY: Salutation appears in page header/name area — assert in body text
    if (data.salutation) {
      await expect(this.page.locator('body')).toContainText(data.salutation, { timeout: 5000 });
      logger.debug(`Salutation verified: ${data.salutation}`);
    }
    // WHY: Verify Campaign Information tab — subSource, campaign, source, utmSource etc.
    await this.page.locator('#nav-tab4-tab').click();
    await this.page.waitForTimeout(800);
    const tab4Text = (await tabPane.textContent() ?? '').toLowerCase();
    expect(tab4Text).toContain(data.subSource.toLowerCase());
    if (data.campaign) expect(tab4Text).toContain(data.campaign.toLowerCase());
    if (data.source) expect(tab4Text).toContain(data.source.toLowerCase());
    expect(tab4Text).toContain(data.utmSource.toLowerCase());
    expect(tab4Text).toContain(data.utmCampaign.toLowerCase());
    expect(tab4Text).toContain(data.utmMedium.toLowerCase());
    expect(tab4Text).toContain(data.utmContent.toLowerCase());
    expect(tab4Text).toContain(data.utmTerm.toLowerCase());
    logger.debug(`Campaign tab — subSource: ${data.subSource} | campaign: ${data.campaign} | source: ${data.source} | utmSource: ${data.utmSource}`);
    logger.success('Contact detail fields verified');
  }

  // WHY: full per-field verification against the Contact detail page's
  // "Other Details" tab (#nav-tab5-tab, confirmed live 2026-07-14) — only
  // used by the dedicated custom-field tests, same scope rule as
  // LeadsPage.assertLeadCustomFieldsOnDetail(): every other Contact test
  // only needs the fill-if-present behavior to run without erroring, not a
  // full value-by-value assertion here.
  //
  // WHY throw instead of skip-and-return if the tab never appears: this
  // method is called only from the dedicated custom-field tests, which
  // always run on an environment already confirmed to have these fields —
  // a missing tab here can only mean verification didn't happen, which
  // must fail loudly, not report a false pass.
  // WHY: PART C — thin, module-owned wrapper around BasePage's generic
  // dedicated-test skip mechanism, same pattern as LeadsPage's equivalent.
  // Must be called AFTER the relevant create/edit form is open and ONLY
  // from the dedicated custom-field tests.
  //
  // WHY disableRequiredFieldsToggle() is called here too: confirmed live
  // (2026-07-15) — same finding as Lead's equivalent method: a custom
  // field input does not exist in the DOM at all (count() === 0) until
  // this toggle is switched off; count becomes 1 immediately after. Safe
  // and non-duplicative in effect — the same idempotent method
  // fillContactForm()/fillEditForm() call themselves right after.
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.disableRequiredFieldsToggle();
    await this.skipDedicatedCustomFieldTestIfAbsent(
      Object.values(CONTACT_CUSTOM_FIELD_NAMES),
      'Contact'
    );
  }

  async assertContactCustomFieldsOnDetail(data: ContactData): Promise<void> {
    logger.info('Asserting all 9 custom field values on contact detail page');
    const tab = this.otherDetailsDetailPageTab();
    await expect(
      tab,
      '"Other Details" tab did not appear on the detail page — custom field verification cannot proceed'
    ).toBeVisible({ timeout: config.timeouts.navigation });
    await tab.click();
    await this.page.waitForTimeout(500);

    const cf = data.customFields;
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox ? 'Yes' : 'No',
      'Checkbox'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.date,
      this.formatCustomFieldDetailDate(cf.date),
      'Date'
    );
    await this.assertCustomFieldOnDetail(
      CONTACT_CUSTOM_FIELD_NAMES.dateTimePicker,
      this.formatCustomFieldDetailDateTime(cf.dateTimePicker),
      'Date Time Picker'
    );
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(
        CONTACT_CUSTOM_FIELD_NAMES.pickList,
        cf.pickList,
        'Pick List'
      );
    }
    if (cf.multiPickList.length > 0) {
      await this.assertMultiPicklistCustomFieldOnDetail(
        CONTACT_CUSTOM_FIELD_NAMES.multiPickList,
        cf.multiPickList,
        'Multi Pick List'
      );
    }
    logger.success('All 9 custom field values verified on contact detail page');
  }

  async assertDetailTabContent(iconTitle: string): Promise<void> {
    logger.info(`Asserting detail tab content for: ${iconTitle}`);
    // WHY: Click the right panel icon to open that section
    await this.clickRightPanelIcon(iconTitle);
    await this.page.waitForTimeout(800);
    // WHY: After clicking the icon, the corresponding card section appears
    // Cards have h2.h2 inside .card-header with matching text
    const cardHeader = this.page
      .locator('.card-header')
      .filter({ has: this.page.locator('h2').filter({ hasText: iconTitle }) })
      .first();
    await expect(cardHeader).toBeVisible({ timeout: 10000 });
    logger.success(`Detail tab content visible: ${iconTitle}`);
  }

  async assertValidationError(message: string): Promise<void> {
    logger.info(`Asserting validation error: ${message}`);
    // WHY: Validation errors appear as inline field errors or toast messages
    const errorLocator = this.page
      .locator('.invalid-feedback, .error-message, .toastr.rrt-error, [class*="error"]')
      .filter({ hasText: message })
      .first();
    await expect(errorLocator).toBeVisible({ timeout: 10000 });
    logger.success(`Validation error confirmed: ${message}`);
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

  async assertQuotationInPanel(quotationNumber: string): Promise<void> {
    logger.info(`Asserting quotation in panel: ${quotationNumber}`);
    await this.clickRightPanelIcon('Quotations');
    await this.page.waitForTimeout(1000);
    await expect(this.page.locator('.quotation').filter({ hasText: quotationNumber })).toBeVisible({
      timeout: 10000,
    });
    logger.success(`Quotation visible in panel: ${quotationNumber}`);
  }

  // ──────────────────────────────────────────────────────────
  // 10. Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createContact(data: ContactData): Promise<number | null> {
    await this.clickAddContact();
    await this.fillContactForm(data);
    return await this.saveContact();
  }

  async updateContact(
    newData: ContactData,
    originalFirstName?: string,
    contactId?: number
  ): Promise<void> {
    const searchName = originalFirstName ?? newData.firstName;
    await this.searchAndOpenContact(searchName, contactId);
    await this.clickEditIcon();
    await this.fillEditForm(newData);
    await this.saveEditedContact();
  }

  async assertContactUpdated(data: ContactData, contactId?: number): Promise<void> {
    // WHY: ID-first — mirrors DealsPage.assertDealUpdated. List search via
    // retryFindContact is subject to search-index/list-refresh lag under
    // load; direct navigation to the known ID is deterministic. List search
    // remains the fallback for callers with no ID.
    if (contactId) {
      await this.goToContactDetailsById(contactId);
      await expect(this.page.locator('body')).toContainText(data.firstName, { timeout: 15000 });
      return;
    }
    await this.goToContactsList();
    await this.assertContactExistsInList(data.firstName);
  }

  async assertContactCreated(data: ContactData, contactId?: number): Promise<void> {
    if (contactId) {
      logger.info(`Validating contact via ID: ${contactId}`);
      await this.navigateTo(`${config.appUrl}/sales/contacts/details/${contactId}`);
      await this.waitForContactDetailsPage();
      // WHY: contact details page renders fields as read-only text, not inputs.
      // Asserting the URL contains the ID is sufficient proof the contact
      // was created and is accessible — no input[name="firstName"] exists here.
      await this.assertUrl(new RegExp(`contacts/details/${contactId}`));
      logger.success(`Contact verified: ${data.firstName}`);
      return;
    }
    await this.assertContactExistsInList(data.firstName);
  }
}


