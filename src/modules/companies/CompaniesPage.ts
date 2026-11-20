import { Page, expect, Locator } from '@playwright/test';
import { isRetryableHttpStatus } from '../../utils/retryableStatus';
import { uniqueEmail, uniquePhone } from '../../data/factories/uniqueValues';
import { BasePage } from '../../core/BasePage';
import {
  CompanyData,
  COMPANY_CUSTOM_FIELD_NAMES,
  CompanyCustomFieldKey,
} from '../../data/factories/companyFactory';
import { ContactData } from '../../data/factories/contactFactory';
import { DealData } from '../../data/factories/dealFactory';
import { DealsPage } from '../deals/DealsPage';
import { TasksPage } from '../tasks/TasksPage';
import { MeetingsPage } from '../meetings/MeetingsPage';
import { QuotationsPage } from '../quotations/QuotationsPage';
import { QuotationCustomFieldData } from '../../data/factories/quotationFactory';
import { generateTaskData } from '../../data/factories/taskFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

// WHY: a distinct, catchable error for a TRANSIENT backend rejection of the
// company-create POST (generic "Unexpected error occurred"/"Internal server
// error" with no field-level validation), as opposed to a genuine validation
// rejection (which surfaces earlier via assertNoFormErrors) or a real "save
// silently failed". createCompany() catches ONLY this to retry the whole
// create — see saveCompany()/captureCompanyCreateOutcome() for how it's
// classified, and createCompany() for the bounded, duplicate-safe retry.
class TransientCompanySaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientCompanySaveError';
  }
}

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

  // WHY: same idempotency-check locator as ContactsPage/LeadsPage's
  // showRequiredToggleCheckbox() — added 2026-07-28 while wiring in custom
  // fields (see disableRequiredFieldsToggle()'s own comment for why this
  // matters).
  private readonly showRequiredToggleCheckbox = (): Locator =>
    this.showRequiredToggle().locator('xpath=preceding-sibling::input[@type="checkbox"]');

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

  // WHY: exact `name` match, not a loose `id*="input_phone_0"` substring
  // (2026-07-16 fix) — that pattern is confirmed live to collide with any
  // future repeatable field whose first entry also ends in "_input_phone_0"
  // (confirmed via the identical bug in LeadsPage.ts, caused there by its
  // new Company Phones field). Companies has no such field today, but
  // `name="phoneNumbers[0]"` is the actual bound form field and is strictly
  // safer at zero cost, so it's fixed here too rather than left as a latent
  // risk for whenever this module grows a similar field.
  private readonly phoneInput = (): Locator => this.page.locator('input[name="phoneNumbers[0]"]');

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

  // WHY data-original-title + :not([data-original-title]) exclusion — see
  // LeadsPage's identical rightPanelIcon() for the full explanation
  // (2026-07-30, found live while building Call Log panel entry points):
  // every button's `title` attribute is confirmed always empty (the real
  // label is in `data-original-title`), and confirmed-colliding svg ids
  // elsewhere (Leads' Emails/Call Logs) show a plain comma-OR + .first() can
  // silently select the wrong button. Mirrored here defensively for the
  // same reason, even though no collision has been independently confirmed
  // for Companies specifically.
  private readonly rightPanelIcon = (title: string): Locator => {
    const svgId = this.rightPanelIconSvgMap[title];
    if (svgId) {
      return this.page
        .locator(
          `button.btn.btn-transparent[data-original-title="${title}"], ` +
            `button.btn.btn-transparent:has(svg #${svgId}):not([data-original-title])`
        )
        .first();
    }
    return this.page.locator(`button.btn.btn-transparent[data-original-title="${title}"]`);
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

  // WHY #nav-tab3-tab, not #nav-tab2-tab: confirmed live (2026-07-28) — Company
  // gained its own "Other Details" custom-field tab, which now sits between
  // Social and Internals, shifting Internals from index 3 to index 4 — the
  // exact same drift already documented for DealsPage.otherDetailsDetailPageTab().
  // Tab order confirmed live: Communication(0), Location(1), Social(2), Other
  // Details(3), Internals(4).
  private readonly otherDetailsDetailPageTab = (): Locator => this.page.locator('#nav-tab3-tab');

  // ──────────────────────────────────────────────────────────
  // 3. Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // 4. Private Helpers
  // ──────────────────────────────────────────────────────────

  // WHY: delegates to the shared BasePage.waitForEntityListPage() —
  // navigation-drift reload-and-retry built and verified once (2026-07-27,
  // via 2 real live reproductions on DealsPage's identical pattern), reused
  // here instead of a module-local copy. See that method's own comment for
  // the full history/evidence.
  private async waitForListReady(): Promise<void> {
    await this.waitForEntityListPage(
      (res) =>
        res.url().includes('/v1/companies') &&
        res.request().method() === 'GET' &&
        res.status() === 200,
      this.companyTable(),
      'Companies'
    );
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
      await this.withSessionExpiryRecovery(() =>
        expect(this.companyRowNameCell(name)).toBeVisible({
          timeout: 5000,
        })
      );

      return true;
    } catch {
      return false;
    }
  }

  // WHY: delegates to the shared BasePage.waitForEntityDetailPage() —
  // navigation-drift reload-and-retry built and verified once (2026-07-27,
  // via 2 real live reproductions on DealsPage's identical pattern), reused
  // here instead of a module-local copy. See that method's own comment for
  // the full history/evidence.
  async waitForCompanyDetailsPage(): Promise<void> {
    await this.waitForEntityDetailPage(
      /sales\/companies\/details\//,
      (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'GET',
      'Company details'
    );
  }

  async goToCompanyDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to company details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/companies/details/${id}`);
    await this.waitForCompanyDetailsPage();
  }

  private async waitForCompanyListPage(): Promise<void> {
    // WHY waitForUrlWithNavigationRetry, not a bare waitForUrl (2026-09-07):
    // see BasePage.waitForUrlWithNavigationRetry()'s own comment — a
    // genuine navigation stall to this URL previously had zero recovery.
    await this.waitForUrlWithNavigationRetry(`${config.appUrl}/sales/companies/list`, /companies\/list/);

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
        // WHY: same idempotency bug already found and fixed in
        // ContactsPage/LeadsPage's equivalent (2026-07-28, found while wiring
        // in custom fields here) — this toggle's on/off state persists
        // across sessions rather than resetting per form open. A blind,
        // unconditional click on an already-off toggle flips it back ON,
        // hiding "Other Details" (and its custom fields) right when a caller
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

        await this.withSessionExpiryRecovery(() =>
          expect(this.nameInput()).toBeVisible({ timeout: 10000 })
        );

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

    await this.ensureReactSelectMenuClosed('company option pick');

    logger.success(`Selected ${description}: ${optionText}`);
  }

  private async performSearch(searchText: string): Promise<void> {
    logger.info(`Searching company: ${searchText}`);

    await this.fill(this.searchInput(), searchText, 'search input');

    // B6 (staging probe 2026-11-17): the list search is `POST /v1/search/company?...` -> 200. The old wait matched a
    // `GET` on any URL containing "search", which never occurs: every search waited its full 15 s, its miss
    // was swallowed and a failed search went unnoticed. Armed before the click and strict (status, code and
    // message when the answer is not 2xx).
    await this.saveAndAwait(() => this.click(this.searchIcon(), 'search icon'), {
      method: 'POST',
      urlRe: /^\/v1\/search\/company\/?$/,
      description: 'company search (POST /v1/search/company)',
      timeout: 15000,
    });

    await this.waitForLoaderToDisappear();
  }

  private async captureCompanyIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.armResponseWaitWithRecovery(
        (res) =>
          res.url().includes('companies') &&
          // WHY: defensive exclusion added 2026-07-16 — DealsPage's identical
          // `.includes('/deals')` predicate was confirmed live (this same run)
          // to also match an unrelated `/v4/reports/deals?...` background
          // analytics POST, winning the response race against the real create/
          // clone POST and silently capturing a null id (2/2 reproductions).
          // This method's bare `.includes('companies')` is even less specific
          // (no version-prefix requirement at all) and is the same shape of
          // bug, just not yet observed failing here — excluding `/reports/`
          // only, not adding a `/v1/` requirement, since (unlike Deals) the
          // exact real company create/clone endpoint hasn't been directly
          // confirmed in this run's own logs; narrower and lower-risk than
          // guessing the full path.
          !res.url().includes('/reports/') &&
          res.request().method() === 'POST' &&
          (res.status() === 200 || res.status() === 201),
        'capture company ID',
        30000
      );

      const body = await response.json();

      const companyId = body?.id ?? body?.data?.id ?? null;

      logger.success(`Captured company ID: ${companyId} from ${response.url()}`);

      return companyId;
    } catch (_error) {
      logger.debug(`Company ID not captured via response (fast server) — will use search fallback`);

      return null;
    }
  }

  private async retryFindCompany(name: string): Promise<boolean> {
    const { retries } = this.retryConfig;
    // B6: the real condition is the company's row in the search results after a fresh list + search (a new
    // company can lag in the search index); retryAttempts repeats that with its own backoff inside the budget the
    // fixed retries x (5 s results wait + pause) took, instead of a fixed pause between attempts. Same shape
    // as LeadsPage.retryFindLead().
    await this.withSessionExpiryRecovery(() =>
      this.retryAttempts(retries, `Company "${name}" search`, async () => {
        logger.info(`Searching company: ${name}`);
        await this.goToCompaniesList();
        await this.performSearch(name);
        if (!(await this.waitForSearchResults(name))) {
          throw new Error(`Company "${name}" is not in the search results yet`);
        }
      })
    );
    logger.success('Company found');
    return true;
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

    // WHY the bounded re-click retry (root-caused 2026-07-21 from a real
    // failure): a single click on the page's "Add" button intermittently does
    // NOT open the modal. Confirmed via the failure DOM — the companies LIST
    // was still on screen (no modal) after the click completed with no error,
    // and exactly one "Add" button matched (no strict-mode violation), ruling
    // out a wrong-target click. This is the same "click lands but nothing
    // happens" React click-handler race already documented in this codebase
    // (DealsPage.cloneDeal, the Meetings Add button). There was no recovery —
    // a single click + single visibility check. Re-clicking until the name
    // input actually appears is BACKWARD-COMPATIBLE: when the modal opens on
    // the first click (the norm for every existing caller — L20/L21/Companies/
    // RBAC suites), the loop exits after one attempt with identical behavior.
    // The modal-open guard ensures a re-attempt can never click the list's Add
    // button through an already-open modal's backdrop.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!(await this.editModal().isVisible().catch(() => false))) {
        await this.click(this.addButton(), 'add company button');
      }
      const opened = await this.nameInput()
        .waitFor({ state: 'visible', timeout: config.timeouts.expect })
        .then(() => true)
        .catch(() => false);
      if (opened) {
        logger.success('Company form opened');
        return;
      }
      logger.info(
        `"Add Company" modal did not open (attempt ${attempt}/${maxAttempts}) — re-clicking`
      );
    }

    // Never opened after all attempts — surface the original loud, actionable failure.
    await this.withSessionExpiryRecovery(() =>
      expect(this.nameInput()).toBeVisible({ timeout: config.timeouts.expect })
    );
    logger.success('Company form opened');
  }

  // ──────────────────────────────────────────────────────────
  // 6. Form Actions
  // ──────────────────────────────────────────────────────────

  // WHY: single choke point for filling all 9 Company custom fields — called
  // from both fillCompanyForm() (create) and fillEditForm() (update),
  // mirroring LeadsPage.fillLeadCustomFields()/ContactsPage.fillContactCustomFields()/
  // DealsPage.fillDealCustomFields(). Every BasePage helper checks DOM
  // presence and skips gracefully when a field doesn't exist yet in the
  // current environment (see BasePage's custom-field-helpers section for
  // why) — same environment-safety contract as Lead/Contact/Deal.
  //
  // WHY no tab-click step (unlike LeadsPage.fillLeadCustomFields(), which
  // calls openOtherDetailsFormSection() first): confirmed live (2026-07-28,
  // Phase 1 of this branch) — Company's create/edit form renders all 5
  // sections (General Information, Communication, Location, Social, Other
  // Details) in one continuous scrollable page, same as Contact; the "Other
  // Details" sidebar nav-link only scrolls to that section, it does not
  // toggle a hidden tab-pane. The custom field inputs are already visible
  // and fillable as soon as disableRequiredFieldsToggle() has run.
  //
  // Mutates `data.customFields.pickList`/`.multiPickList` in place with
  // whatever was actually selected live — PickList/MultiPickList options are
  // read from the DOM at fill time, so the caller's `data` object needs to
  // be updated to reflect reality before it's used for later verification.
  // WHY the optional `onlyField` param (2026-09-22, Form Field Limit
  // feature, Company rollout — reusing the exact reusable architecture
  // proven for Lead/Contact, see docs/known-issues/form-fields.md
  // and docs/known-issues/form-fields.md): fills ONLY the one field under
  // test and skips the other 8 entirely when provided — every existing
  // caller omits it and gets byte-for-byte the same fill-everything
  // behavior as before.
  // WHY the optional `fieldNameOverride` param (2026-09-28, Form Field Limit
  // feature's cross-shard-collision fix — see COMPANY_FORM_FIELD_LIMIT_NAMES's
  // own comment in companyFactory.ts for the full incident): lets a caller
  // fill the ONE field `onlyField` selects using a DIFFERENT real internal
  // name than COMPANY_CUSTOM_FIELD_NAMES's own hardcoded value below, without
  // touching that shared constant (still used, unchanged, by every other
  // Company test). Every existing caller omits this and gets byte-for-byte
  // the original behavior.
  private async fillCompanyCustomFields(
    data: CompanyData,
    onlyField?: CompanyCustomFieldKey,
    fieldNameOverride?: string
  ): Promise<void> {
    const cf = data.customFields;
    const wants = (key: CompanyCustomFieldKey): boolean => onlyField === undefined || onlyField === key;

    if (wants('textField')) {
      await this.fillTextLikeCustomField(
        fieldNameOverride ?? COMPANY_CUSTOM_FIELD_NAMES.textField,
        cf.textField,
        'Text Field'
      );
    }
    if (wants('paragraphText')) {
      await this.fillTextLikeCustomField(
        fieldNameOverride ?? COMPANY_CUSTOM_FIELD_NAMES.paragraphText,
        cf.paragraphText,
        'Paragraph Text'
      );
    }
    if (wants('number')) {
      await this.fillTextLikeCustomField(
        fieldNameOverride ?? COMPANY_CUSTOM_FIELD_NAMES.number,
        String(cf.number),
        'Number'
      );
    }
    if (wants('urlField')) {
      await this.fillTextLikeCustomField(
        COMPANY_CUSTOM_FIELD_NAMES.urlField,
        cf.urlField,
        'URL Field'
      );
    }
    if (wants('checkbox')) {
      await this.setCheckboxCustomField(COMPANY_CUSTOM_FIELD_NAMES.checkbox, cf.checkbox, 'Checkbox');
    }
    if (wants('date')) {
      await this.selectDateCustomField(COMPANY_CUSTOM_FIELD_NAMES.date, cf.date, 'Date');
    }
    if (wants('dateTimePicker')) {
      await this.selectDateTimeCustomField(
        COMPANY_CUSTOM_FIELD_NAMES.dateTimePicker,
        cf.dateTimePicker,
        'Date Time Picker'
      );
    }
    if (wants('pickList')) {
      const pickedValue = await this.selectPicklistCustomField(
        COMPANY_CUSTOM_FIELD_NAMES.pickList,
        'Pick List'
      );
      if (pickedValue !== null) cf.pickList = pickedValue;
    }
    if (wants('multiPickList')) {
      const pickedValues = await this.selectMultiPicklistCustomField(
        COMPANY_CUSTOM_FIELD_NAMES.multiPickList,
        'Multi Pick List'
      );
      if (pickedValues.length > 0) cf.multiPickList = pickedValues;
    }

    // WHY document.activeElement.blur() here, NOT a Tab keypress — mirrors
    // LeadsPage.fillLeadCustomFields()'s/ContactsPage.fillContactCustomFields()'s
    // identical, incident-driven fix (docs/known-issues/form-fields.md).
    if (onlyField !== undefined) {
      await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }
  }

  // WHY: thin wrapper around BasePage's generic dedicated-test skip
  // mechanism, same pattern as Lead's/Contact's/Deal's own
  // skipIfCustomFieldsAbsent(). Must be called AFTER the relevant create/edit
  // form is open and ONLY from the dedicated custom-field tests — every
  // other Company test already tolerates absent fields via
  // fillCompanyCustomFields()'s own presence checks.
  //
  // WHY disableRequiredFieldsToggle() is called here too: same reasoning as
  // ContactsPage's equivalent — a custom field input may not exist in the
  // DOM at all until this toggle is switched off. Safe and non-duplicative
  // (idempotent) even if a prior action in this session already turned it
  // off.
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.disableRequiredFieldsToggle();
    await this.skipDedicatedCustomFieldTestIfAbsent(
      Object.values(COMPANY_CUSTOM_FIELD_NAMES),
      'Company'
    );
  }

  // WHY this exists as its own public method (2026-09-22, Form Field Limit
  // feature, Company rollout): confirmed live that Company's Name field is
  // `[id="0_11_input_name"]`, NOT `input[name="name"]` — BasePage's generic
  // `fillStandardField()` (keyed on the real HTML `name` attribute) hangs
  // indefinitely against this field, confirmed via a live 120s timeout
  // reproduction. Extracted from fillCompanyForm()'s own inline call so a
  // caller needing to fill/re-fill ONLY the Name field directly (e.g. the
  // Form Field Limit feature's own live-in-form-correction test, mirroring
  // Lead's FFL22/Contact's FFC22) has a correct, working alternative to the
  // generic helper — never use fillStandardField('name', ...) for this
  // entity.
  async fillCompanyName(name: string): Promise<void> {
    await this.fill(this.nameInput(), name, 'company name');
  }

  // WHY the optional `options` param — mirrors ContactsPage.fillContactForm()'s
  // own, more-detailed WHY comment (docs/known-issues/form-fields.md
  // §5): `options.minimal` skips every field except Name (confirmed live to
  // be the true save-required minimum for Company — no Pipeline-equivalent
  // dependency, no toggle needed). Every existing caller omits `options` and
  // gets byte-for-byte the original full-form-fill behavior.
  async fillCompanyForm(
    data: CompanyData,
    options?: { minimal?: boolean; onlyCustomField?: CompanyCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<void> {
    logger.info('Filling company form');
    const minimal = options?.minimal === true;

    await this.disableRequiredFieldsToggle();

    await this.fillCompanyName(data.name);

    if (!minimal) {
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

      await this.withSessionExpiryRecovery(() => expect(this.emailInput()).toBeVisible());

      await this.fill(this.emailInput(), data.email, 'email');

      await this.click(this.addPhoneButton(), 'add phone button');

      await this.withSessionExpiryRecovery(() => expect(this.phoneInput()).toBeVisible());

      await this.fill(this.phoneInput(), data.phone, 'phone');

      await this.fill(this.addressInput(), data.address, 'address');

      await this.fill(this.cityInput(), data.city, 'city');

      await this.fill(this.stateInput(), data.state, 'state');

      await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');

      await this.fill(this.facebookInput(), data.facebook, 'facebook');

      await this.fill(this.twitterInput(), data.twitter, 'twitter');

      await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');
    }

    // WHY conditional, not unconditional: mirrors ContactsPage.fillContactForm()'s
    // identical, more-detailed WHY comment on its own equivalent call site.
    if (!minimal || options?.onlyCustomField) {
      await this.fillCompanyCustomFields(data, options?.onlyCustomField, options?.onlyCustomFieldName);
    }

    logger.success('Company form filled');
  }

  // WHY (2026-07-21): captures the create POST's actual status + body so a
  // TRANSIENT backend rejection can be told apart from a real one. The existing
  // captureCompanyIdFromResponse() only matches 200/201, so on a 400 it just
  // times out into a null id — indistinguishable from a genuine silent failure.
  // This matches the create POST at ANY status, then classifies: 2xx -> id;
  // non-2xx with a generic message ("Unexpected error occurred"/"Internal
  // server error") and NO fieldErrors, or any 5xx -> transient (safe to retry:
  // the POST was rejected before any DB write); populated fieldErrors -> a
  // genuine rejection (NOT transient — and already surfaced to the user, so
  // assertNoFormErrors catches it first). Scoped to POST /v1/companies/ —
  // excludes the has-duplicates GETs and /reports/ analytics that also contain
  // the "companies" substring (the same false-match class already documented
  // for captureXxxIdFromResponse elsewhere).
  private async captureCompanyCreateOutcome(): Promise<{
    id: number | null;
    transient: boolean;
    detail: string;
  }> {
    // WHY (KI-71, 2026-11-19): a timeout could not say "sent, no answer" from "never sent". The watcher records the
    // create request itself; diagnostics only, the classification below is unchanged.
    const createWatch = this.watchRequests(
      (r) =>
        r.method() === 'POST' &&
        /\/v1\/companies\/?(?:\?|$)/.test(r.url()) &&
        !r.url().includes('/reports/') &&
        !r.url().includes('has-duplicates')
    );
    try {
      const response = await this.armResponseWaitWithRecovery(
        (res) =>
          /\/v1\/companies\/?(?:\?|$)/.test(res.url()) &&
          !res.url().includes('/reports/') &&
          !res.url().includes('has-duplicates') &&
          res.request().method() === 'POST',
        'capture company create response',
        // WHY 45000, not 30000 (2026-07-30, found via a real CI failure with
        // precise evidence): confirmed live that the exact transient backend
        // error this method exists to classify (`{"message":"Unexpected
        // error occurred!!","fieldErrors":null}`) can itself take right
        // around 29.5-30.5s to arrive — the response landed only 384ms
        // AFTER the old 30000ms wait had already given up and fallen
        // through to the generic, non-retried "ID not captured" error
        // (confirmed via the passive MiscError listener's own timestamp on
        // the real response). createCompany()'s retry wrapper only catches
        // TransientCompanySaveError, so a response arriving just past this
        // wait was never retried at all — purely a timing-margin gap, not a
        // classification-logic bug. Widened with real headroom so the
        // classification logic gets a genuine chance to see the true
        // response body before this safety net gives up.
        45000
      );
      const status = response.status();
      const body = await response.json().catch(() => ({}) as Record<string, unknown>);
      if (status === 200 || status === 201) {
        const data = body?.data as { id?: number } | undefined;
        const id = ((body?.id as number | undefined) ?? data?.id ?? null) as number | null;
        logger.success(`Captured company ID: ${id} from ${response.url()}`);
        return {
          id,
          transient: false,
          detail: id ? '' : `${await this.describeMatchedResponse(response)} (2xx but no id in the body)`,
        };
      }
      const message = String((body as { message?: unknown })?.message ?? '');
      const fieldErrors = (body as { fieldErrors?: unknown })?.fieldErrors;
      const hasFieldErrors = Array.isArray(fieldErrors) && fieldErrors.length > 0;
      const transient = !hasFieldErrors && isRetryableHttpStatus(status);
      logger.warn(
        `Company create returned HTTP ${status} (message: "${message}", ` +
          `fieldErrors: ${hasFieldErrors ? 'present' : 'none'}) — classified as ` +
          `${transient ? 'TRANSIENT (will retry whole create)' : 'non-transient'}`
      );
      return { id: null, transient, detail: await this.describeMatchedResponse(response) };
    } catch (error) {
      // No matching create response (genuinely fast server, or a timeout) —
      // ambiguous; deliberately NOT classified transient so we never blindly
      // recreate a company that may actually have been created. Logging the
      // actual error (added 2026-07-22, same diagnostic gap found while
      // porting this pattern to Leads/Contacts) — a bare "not captured"
      // debug line gave no way to tell a real 30s timeout apart from some
      // other rejection when this path fires.
      logger.debug(`Company create response not captured (${String(error)}) — treating as non-transient`);
      return { id: null, transient: false, detail: this.describeMissedResponse(error, 45000, createWatch) };
    } finally {
      createWatch.stop();
    }
  }

  async saveCompany(): Promise<number | null> {
    logger.info('Saving company');

    const outcomePromise = this.captureCompanyCreateOutcome();

    await this.saveButton().scrollIntoViewIfNeeded();
    await this.click(this.saveButton(), 'save button');

    // WHY capture the form-error instead of throwing immediately (confirmed via
    // deliberate reproduction 2026-07-21): a TRANSIENT backend error can also
    // surface as a generic form-error toast ("Unexpected error occurred"/
    // "Internal server error"/"Invalid access token") that assertNoFormErrors()
    // throws on. If that throw pre-empted the classification below, a transient
    // blip would fail the test instead of being retried. The response BODY
    // (status + fieldErrors), captured in the outcome, is the source of truth
    // for transient-vs-genuine; the form-error toast is only used to surface a
    // GENUINE validation error when the body was NOT classified transient.
    let formError: unknown = null;
    try {
      await this.assertNoFormErrors('company create form');
    } catch (error) {
      formError = error;
    }

    const outcome = await outcomePromise;

    if (outcome.id) {
      await this.waitForCompanyListPage();
      logger.success('Company saved successfully');
      return outcome.id;
    }

    // Transient backend rejection (generic error, no field-level validation) →
    // distinct, catchable error so createCompany() retries the whole create
    // (duplicate-safe — a transient rejection blocked any DB write). Takes
    // priority over the form-error toast, which for a transient is itself just
    // a generic message.
    if (outcome.transient) {
      throw new TransientCompanySaveError(
        `Company create hit a transient backend error (no field-level validation) — retryable: ${outcome.detail}`
      );
    }

    // Genuine, user-facing validation error (e.g. duplicate name) → surface it
    // unchanged so it fails loudly and is never retried into a false pass.
    if (formError) {
      throw this.appendCreateDetail(formError, outcome.detail);
    }

    // WHY: a failed save with no captured id and no classified cause must still
    // fail fast, not proceed on a company that doesn't exist (confirmed live
    // 2026-07-07).
    // WHY the cause is in the message: see ContactsPage.saveContact().
    throw new Error(`Company ID not captured after save — cannot proceed (${outcome.detail})`);
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
    // WHY check-before-click, idempotent open (2026-09-09 — see
    // LeadsPage.openEllipsisMenu()'s own WHY comment for the full evidence
    // and reasoning; identical fix applied here, same repo-wide pattern):
    // ellipsisButton() is a Bootstrap `dropdown-toggle` — clicking it while
    // its OWN menu is already open CLOSES it instead of reopening it. Uses
    // this button's own aria-expanded, not a page-wide `.dropdown-menu.show`
    // search — see LeadsPage's own WHY comment for why that broader
    // selector is a confirmed real collision risk on at least one of these
    // 4 modules' pages, standardized here for consistency even though no
    // second dropdown was found on this page today.
    const alreadyOpen = (await this.ellipsisButton().getAttribute('aria-expanded')) === 'true';
    if (!alreadyOpen) {
      await this.ellipsisButton().scrollIntoViewIfNeeded();
      await this.ellipsisButton().click();
    }
    // WHY (2026-09-07, PROD Build #4): a blind fixed-duration sleep (500ms) gave zero
    // guarantee the menu container had actually rendered before a caller
    // went looking for a specific item inside it. Replaced with a real
    // condition-based wait, matching DealsPage.openEllipsisMenu()'s already-
    // correct pattern.
    await this.page
      .locator('.dropdown-menu.show')
      .waitFor({ state: 'visible', timeout: config.dropdownMenuItem[config.env].timeout });
    logger.success('Ellipsis menu opened');
  }

  async clickEllipsisOption(optionText: string): Promise<void> {
    logger.info(`Clicking ellipsis option: ${optionText}`);
    await this.clickDropdownMenuItemBounded(
      () => this.openEllipsisMenu(),
      (text) => this.ellipsisMenuItem(text),
      optionText,
      'Companies ellipsis menu'
    );
  }

  async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
    logger.info(`Asserting ellipsis option NOT visible: ${optionText}`);
    const item = this.ellipsisMenuItem(optionText);
    await this.withSessionExpiryRecovery(() =>
      expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
        // WHY: Option may not exist at all — check count as fallback
        const count = await item.count();
        expect(count).toBe(0);
      })
    );
    logger.success(`Ellipsis option not visible confirmed: ${optionText}`);
  }

  // ──────────────────────────────────────────────────────────
  // 8. Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Opening edit modal');

    await this.click(this.editIconButton(), 'edit icon');
    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal()).toBeVisible({ timeout: config.timeouts.navigation })
    );
    // WHY: Wait for name input to be ready — modal animation on GHA is slow
    await this.page
      .locator('[id="0_11_input_name"]')
      .waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    logger.success('Edit modal opened');
  }

  // WHY the optional `options` param — mirrors fillCompanyForm()'s own,
  // more-detailed WHY comment, and ContactsPage.fillEditForm()'s identical
  // shape: `options.minimal` skips every field except Name. Every existing
  // caller omits `options` and is unaffected.
  async fillEditForm(
    data: CompanyData,
    options?: { minimal?: boolean; onlyCustomField?: CompanyCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<void> {
    logger.info('Updating company form');
    const minimal = options?.minimal === true;

    await this.fillCompanyName(data.name);

    if (!minimal) {
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
    }

    // WHY: mirrors ContactsPage.fillEditForm()'s own fix (2026-07-14) for the
    // identical gap — without this, "Other Details"/custom fields would be
    // unreachable on update whenever the toggle happens to be in its ON
    // state. disableRequiredFieldsToggle() is idempotent (see its own
    // comment) so calling it here is safe even if a prior action in this
    // session already turned the toggle off. Always called, even in minimal
    // mode — custom fields live behind this same toggle.
    await this.disableRequiredFieldsToggle();
    // WHY conditional — see fillCompanyForm()'s identical, more-detailed
    // WHY comment on its own equivalent call site.
    if (!minimal || options?.onlyCustomField) {
      await this.fillCompanyCustomFields(data, options?.onlyCustomField, options?.onlyCustomFieldName);
    }

    logger.success('Edit form updated')
  }

  async saveEditedCompany(): Promise<void> {
    logger.info('Saving updated company');

    // WHY: same class of gap as LeadsPage.saveEditedLead() (fixed 2026-07-15,
    // see that method's own WHY comment for the original root-cause writeup)
    // — never applied here (rule 18: a bug class fixed in one place is not
    // fixed everywhere). This method previously had no network wait at all,
    // only a client-side "no error toast" check and a modal-hidden check,
    // both satisfiable before the actual PUT /v1/companies/{id} request
    // finishes persisting server-side. A caller's immediately-following
    // search (assertCompanyExistsInList → retryFindCompany) can race the
    // real database write — confirmed live 2026-08-25 (sandbox run
    // 32748451285): "admin shares company Update permission restricted user
    // sees edit button and can edit company" failed with
    // `assertCompanyExistsInList`'s `expect(found).toBeTruthy()` returning
    // false immediately after this method returned. Capture and await the
    // real update response BEFORE declaring success, mirroring
    // saveEditedLead()'s exact pattern.
    const updateResponsePromise = this.armResponseWaitWithRecovery(
      (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'PUT',
      'company update response',
      config.timeouts.navigation
    ).catch(() => null);

    await this.click(this.saveButton(), 'save button');

    await this.assertNoFormErrors('company edit form');

    const updateResponse = await updateResponsePromise;

    // WHY: same fail-fast convention as saveEditedLead() — a failed/slow
    // update that never persisted server-side must not be silently reported
    // as success, letting callers proceed as if the edit took effect.
    if (!updateResponse) {
      throw new Error(
        'Company update (PUT /v1/companies/{id}) response not captured after save — cannot proceed (update likely failed silently or did not persist in time)'
      );
    }

    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal()).toBeHidden({ timeout: 30000 })
    );

    logger.success('Company updated');
  }

  async deleteCompany(): Promise<void> {
    logger.info('Deleting company via ellipsis menu');
    await this.clickEllipsisOption('Delete');
    await this.deleteConfirmButton().waitFor({ state: 'visible', timeout: 10000 });
    // B6 (ADR 0017 save confirmation): the DELETE's own answer, armed before the click; it replaces a bare
    // 1 s pause and fails by name when the answer is missing or not 2xx.
    await this.saveAndAwait(() => this.deleteConfirmButton().click(), {
      method: 'DELETE',
      urlRe: /^\/v1\/companies\/\d+\/?$/,
      description: 'Company delete (DELETE /v1/companies/{id})',
    });
    logger.success('Company deleted');
  }

  async cloneCompany(originalName: string): Promise<{ companyId: number | null; clonedName: string }> {
    logger.info('Cloning company via ellipsis menu');
    await this.clickEllipsisOption('Clone');
    // WHY: Clone opens create form pre-filled — update email/phone to avoid duplicate errors.
    // WHY no extra wait after saveButton becomes visible (2026-07-16 fix,
    // removed a hardcoded waitForTimeout(1000)): confirmed live on this same
    // clone modal (LeadsPage.cloneLead()/ContactsPage.cloneContact()
    // investigation, identical widget) — pre-filled values are already
    // fully populated the instant the save button becomes visible, so
    // saveButton().waitFor() is already the correct, sufficient condition.
    await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
    // WHY: Confirmed live (2026-07-06) — the clone form's name field arrives
    // PRE-FILLED by the app as "<name> Copy". Earlier code read that
    // already-suffixed value back off the DOM and labeled it "originalName"
    // before appending another " Copy <timestamp>" — producing a real,
    // saved "<name> Copy Copy <timestamp>" instead of the intended single
    // suffix. Take the true original name from the caller (already known —
    // it's the name used to create the company) instead of re-reading the
    // DOM, so there's exactly one " Copy" suffix regardless of what the app
    // pre-fills. Company name also has real uniqueness validation ("Company
    // with this name already exists"), so the timestamp suffix is still
    // required to avoid colliding with pre-existing data in this long-lived
    // shared environment.
    const clonedName = `${originalName || 'Company'} Copy ${Date.now()}`;
    await this.nameInput().clear();
    await this.nameInput().fill(clonedName);
    // WHY: Change email to unique value — same email as original causes duplicate error
    const emailInput = this.emailInput();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(uniqueEmail('clone'));
      logger.debug('Clone email updated to unique value');
    }
    // WHY: Change phone to unique value — same phone as original causes duplicate error
    const phoneInput = this.phoneInput();
    if (await phoneInput.isVisible().catch(() => false)) {
      // WHY: Indian mobile numbers must start with 6/7/8/9 and be exactly 10 digits
      const newPhone = uniquePhone();
      await phoneInput.clear();
      await phoneInput.fill(newPhone);
      logger.debug(`Clone phone updated to: ${newPhone}`);
    }
    const companyIdPromise = this.captureCompanyIdFromResponse();
    await this.click(this.saveButton(), 'save cloned company');
    // WHY the server's answer first (2026-10-30, root cause proven by simulation): the clone succeeds when the
    // create POST answers 200/201 with an id. assertNoFormErrors() reads ANY error toast on the page, and the
    // Related Deals widget of the original company can raise its own ("Uhoh! Something didn't work as
    // expected", `POST /v4/reports/deals` 400 000000) at the same moment — the clone had been saved ("Company
    // cloned (Company ID: …)") and the test still failed. So the form-error check now only runs when no id came
    // back, where it explains why the save was refused.
    const companyId = await companyIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!companyId) {
      await this.assertNoFormErrors('company clone form');
      throw new Error('Cloned company ID not captured after save — cannot proceed (save likely failed silently)');
    }
    // WHY: After clone save, app stays on original company detail — no
    // redirect to list. No trailing wait needed here (2026-07-16 fix,
    // removed a hardcoded waitForTimeout(1500)): assertNoFormErrors() and
    // the ID capture above already confirm the save genuinely completed
    // server-side, and the caller's very next action is always a fresh
    // navigation to the CLONE's own detail page (assertClonedCompanyName's
    // ID-direct-nav), which has its own proper GET-response wait.
    logger.success(`Company cloned successfully: "${clonedName}"`);
    return { companyId, clonedName };
  }

  // WHY: escapeRegExp() moved to BasePage (2026-07-16) — was duplicated
  // privately across Tasks/Companies/Contacts/Leads/Deals; now inherited.

  // WHY one bounded pass and no retry loop (B6, owner decision 2026-11-17): the missed click is prevented by waiting
  // (menu open, option visible and enabled, one click, then the control must show "User"), not retried. The earlier loop (root-caused
  // 2026-07-22 from ~9 min hangs: a "User" pick whose click did not register left shareToUserInput() unmounted
  // and a raw fill() hung to the test timeout) is replaced by labelled, bounded waits that fail by name if the
  // pick does not take, and by ensureReactSelectMenuClosed() so no menu is open when the search input is used.
  private async openUserShareTypeSearch(shareTypeControl: Locator): Promise<void> {
    await shareTypeControl.click({ timeout: config.timeouts.expect });
    const userOption = this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first();
    await expect(userOption, 'Share dialog: the "User" share-type option should be visible (menu open)').toBeVisible({
      timeout: config.timeouts.expect,
    });
    await expect(userOption, 'Share dialog: the "User" share-type option should be enabled').toBeEnabled({
      timeout: config.timeouts.expect,
    });
    await userOption.click({ timeout: config.timeouts.expect });
    await this.ensureReactSelectMenuClosed('Share-type "User" selection', shareTypeControl);
    await expect(
      shareTypeControl.locator('.is-invalid__single-value'),
      'Share dialog: the share-type control should show "User" after the pick'
    ).toHaveText('User', { timeout: config.timeouts.expect });
    await expect(
      this.shareToUserInput(),
      'Share dialog: the user search input should appear after picking "User"'
    ).toBeVisible({ timeout: config.timeouts.expect });
  }

  async shareCompany(restrictedUserName: string, permissions: string[] = []): Promise<void> {
    logger.info(`Sharing company with: ${restrictedUserName}, permissions: ${permissions.join(',')}`);
    await this.clickEllipsisOption('Share');
    // WHY: Click the Share To type dropdown control (waited for just below) — opens User/Team options
    const shareTypeControl = this.page.locator('.modal.show').locator('.is-invalid__control').first();
    await shareTypeControl.waitFor({ state: 'visible', timeout: 10000 });
    await this.openUserShareTypeSearch(shareTypeControl);
    // WHY: Search requires minimum 3 characters
    // Strategy: find first word with >= 3 chars, fallback to first 3 chars of full name
    const words = restrictedUserName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
    logger.debug(`Share search term: "${validWord}" (from: "${restrictedUserName}")`);
    await this.shareToUserInput().fill(validWord, { timeout: config.timeouts.expect });
    // B6: no pause: selectUserOptionWithRetry() waits for the matching user option
    // WHY selectUserOptionWithRetry(), not a bare fill+wait (2026-07-30,
    // found via a real CI failure — see BasePage's own comment on this
    // method for the full evidence): retries the search up to 3x for a
    // genuinely-just-created user's search-index propagation lag.
    await this.selectUserOptionWithRetry(this.shareToUserInput(), validWord, restrictedUserName);
    // B6: the pick is applied when the user menu closes
    await this.page.locator('.is-invalid__menu').first().waitFor({ state: 'hidden', timeout: 5000 });
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
        await this.withSessionExpiryRecovery(() =>
          expect(toggle, `Share: permission "${permission}" should be on`).toBeChecked({
            timeout: config.timeouts.expect,
          })
        );
      }
    }
    await this.shareConfirmButton().waitFor({ state: 'visible', timeout: 5000 });
    // B6 (ADR 0017 save confirmation): the share's own answer, armed before the click. It used to end in
    // `.catch(() => null)`, so a missed or refused share carried on and broke the RBAC steps that follow;
    // now it fails by name when the answer is missing or not 2xx. Then the share dialog must close.
    await this.saveAndAwait(() => this.shareConfirmButton().click(), {
      method: 'POST',
      urlRe: /^\/v1\/companies\/\d+\/share\/?$/,
      description: 'Company share (POST /v1/companies/{id}/share)',
    });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('.modal.show'), 'The share dialog should close after Share').toHaveCount(0, {
        timeout: config.timeouts.expect,
      })
    );
    logger.success(`Company shared with: ${restrictedUserName}`);
  }

  async reassignCompany(userName: string): Promise<void> {
    logger.info(`Reassigning company to: ${userName}`);
    await this.clickEllipsisOption('Reassign');
    // WHY: Search requires minimum 3 characters (the dialog input is waited for just below)
    const words = userName.trim().split(' ');
    const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
    logger.debug(`Reassign search term: "${validWord}" (from: "${userName}")`);
    const reassignUserInput = this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');
    await reassignUserInput.waitFor({ state: 'visible', timeout: 5000 });
    await reassignUserInput.fill(validWord);
    // B6: no pause: selectUserOptionWithRetry() waits for the matching user option
    // WHY selectUserOptionWithRetry() — see shareCompany()'s identical
    // comment for the full evidence (2026-07-30).
    await this.selectUserOptionWithRetry(reassignUserInput, validWord, userName);
    // B6: the pick is applied when the user menu closes
    await this.page.locator('.is-invalid__menu').first().waitFor({ state: 'hidden', timeout: 5000 });
    const reassignConfirmButton = this.page.locator('.modal.show button.btn-primary.ml-auto').first();
    await reassignConfirmButton.waitFor({ state: 'visible', timeout: 5000 });
    // B6 (ADR 0017 save confirmation): the owner change's own answer (PUT /v1/companies/{id}/owner), armed
    // before the click; it used to be awaited with its result ignored (`.catch(() => null)`). Fails by name
    // when missing or not 2xx; then the dialog must close.
    await this.saveAndAwait(() => reassignConfirmButton.click(), {
      method: 'PUT',
      urlRe: /^\/v1\/companies\/\d+\/owner\/?$/,
      description: 'Company reassign (PUT /v1/companies/{id}/owner)',
    });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('.modal.show'), 'The reassign dialog should close after Reassign').toHaveCount(0, {
        timeout: config.timeouts.expect,
      })
    );
    logger.success(`Company reassigned to: ${userName}`);
  }

  async clickRightPanelIcon(title: string): Promise<void> {
    logger.info(`Clicking right panel icon: ${title}`);
    const icon = this.rightPanelIcon(title);
    await icon.waitFor({ state: 'visible', timeout: 10000 });
    await icon.click();
    // B6: no pause: every caller goes on with an auto-waiting step for its own panel content
    logger.success(`Right panel icon clicked: ${title}`);
  }

  async assertRightPanelIconVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon visible: ${title}`);
    const icon = this.rightPanelIcon(title);
    try {
      // WHY: Wait for icon to be attached first — SVG icons load after React renders
      await icon.waitFor({ state: 'attached', timeout: 15000 });
      await this.withSessionExpiryRecovery(() => expect(icon).toBeVisible({ timeout: 15000 }));
    } catch (error) {
      // WHY the reload-and-retry — same confirmed gap as LeadsPage's own
      // assertRightPanelIconVisible (CI flake 2026-07-22, right after an
      // admin share): the right panel's icon set reads a permissions
      // snapshot taken once at page mount, so a plain wait cannot recover if
      // that snapshot predates the share's propagation. A reload forces a
      // fresh mount/fetch. Applied here defensively (not from a live repro of
      // THIS module specifically) since the mechanism is structural.
      logger.warn(
        `Right panel icon "${title}" not visible — reloading and retrying once: ${String(error)}`
      );
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForCompanyDetailsPage();
      await icon.waitFor({ state: 'attached', timeout: 15000 });
      await this.withSessionExpiryRecovery(() => expect(icon).toBeVisible({ timeout: 15000 }));
    }
    logger.success(`Right panel icon visible: ${title}`);
  }

  async assertRightPanelIconNotVisible(title: string): Promise<void> {
    logger.info(`Asserting right panel icon NOT visible: ${title}`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.rightPanelIcon(title)).toBeHidden({ timeout: 5000 })
    );
    logger.success(`Right panel icon not visible: ${title}`);
  }

  // WHY delegates to QuotationsPage.fillAndSaveQuotationFromPanel() (2026-07-29
  // refactor) instead of hand-duplicating the fill+save+capture sequence
  // inline: this exact logic had already drifted out of sync with Deals' own
  // copy (that one had a tightened ID-capture regex + a toast fallback; this
  // one didn't) — see that method's own comment for the full rationale. The
  // panel-open sequence below (icon → card → Add button → modal-title check)
  // stays here since it's genuinely Company-specific.
  async addQuotationFromPanel(
    customFields?: QuotationCustomFieldData,
    checkCustomFieldsAbsent = false,
    awaitCardRefresh = false
  ): Promise<string | null> {
    logger.info('Adding quotation from company productivity panel');
    // WHY the armed search wait replaces a fixed 2 s sleep (CO12, ADR 0016): opening the panel makes the
    // Quotations card load its own list (POST /v1/quotations/search, seen in the trace right after the icon
    // click). That response is the card's ready signal; armed before the click so a fast answer is not missed.
    const cardListLoaded = this.armResponseWaitWithRecovery(
      (res) => res.request().method() === 'POST' && /^\/v1\/quotations\/search\/?$/.test(new URL(res.url()).pathname),
      'Quotations card list (POST /v1/quotations/search) after opening the panel',
      30000
    );
    cardListLoaded.catch(() => undefined);
    await this.clickRightPanelIcon('Quotations');
    await cardListLoaded;
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
    await this.withSessionExpiryRecovery(() =>
      expect(quotationsCard, 'Quotations card should be visible').toBeVisible({ timeout: 15000 })
    );
    const quotationCardAdd = quotationsCard.locator('button.btn-primary.btn-xs').first();
    await quotationCardAdd.waitFor({ state: 'visible', timeout: 10000 });
    await quotationCardAdd.click();
    // WHY: Wait for modal to open with "Add Quotation" title
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.quotationAddModalTitle()).toHaveText('Add Quotation', { timeout: 10000 })
    );
    logger.success('Add Quotation modal opened');

    const quotationsPage = new QuotationsPage(this.page);
    return await quotationsPage.fillAndSaveQuotationFromPanel(customFields, checkCustomFieldsAbsent, awaitCardRefresh);
  }

  // B6: re-open the Quotations panel and require the card's own list answer (POST /v1/quotations/search) to
  // contain the created quotation by id, then the card to be visible. The response is armed before the click.
  async assertQuotationInPanelById(quotationId: string | number): Promise<void> {
    const listed = this.armResponseWaitWithRecovery(
      (res) => res.request().method() === 'POST' && /^\/v1\/quotations\/search\/?$/.test(new URL(res.url()).pathname),
      'Quotations card list (POST /v1/quotations/search) after re-opening the panel',
      30000
    );
    listed.catch(() => undefined);
    await this.clickRightPanelIcon('Quotations');
    const response = await listed;
    const body = (await response.json().catch(() => null)) as { content?: { id?: number | string }[] } | null;
    const ids = (body?.content ?? []).map((q) => String(q.id));
    expect(ids, `Quotations card list (HTTP ${response.status()}) should contain quotation ${quotationId}`).toContain(
      String(quotationId)
    );
    const quotationsCard = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Quotations' }) })
      .first();
    await this.expectVisibleFailingOnPageError(quotationsCard, 'Quotations card should be visible', 15000);
  }

  // WHY in place, no reload (CO12, plan §8): after the save the app refreshes the Quotations card itself
  // (POST /v1/quotations/search, awaited by fillAndSaveQuotationFromPanel when awaitCardRefresh is set). A user
  // reads the card where they are; reloading the company by URL is what rendered the card on a fresh page and
  // triggered the app's uncaught render error. If that error happens anyway the wait stops and names it.
  async assertQuotationListedInCard(): Promise<void> {
    const quotationsCard = this.page
      .locator('.card')
      .filter({ has: this.page.locator('h2').filter({ hasText: 'Quotations' }) })
      .first();
    await this.expectVisibleFailingOnPageError(quotationsCard, 'Quotations card should be visible after the save refresh', 15000);
    await this.expectVisibleFailingOnPageError(
      quotationsCard.locator('ul.card-list li, .list-item, a').first(),
      'Newly created quotation should appear in the Quotations card',
      15000
    );
  }

  // Opens the Notes panel and adds the note with the shared BasePage flow (baseline + exactly one more note).
  async addNoteFromPanel(noteText: string): Promise<void> {
    await this.clickRightPanelIcon('Notes');
    await this.addNoteInOpenPanel(noteText);
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

  async addMeetingFromPanel(meetingTitle: string): Promise<number> {
    logger.info(`Adding meeting from company panel: "${meetingTitle}"`);
    const companyUrl = this.page.url();
    await this.clickRightPanelIcon('Meetings');
    // WHY: #addMeeting button opens the meeting creation form from entity detail panel
    const meetingsPage = new MeetingsPage(this.page);
    await meetingsPage.openAddFormFromEntityDetailPanel();
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: Save directly without using saveMeeting() — that method clicks a post-save
    // popup which navigates AWAY to the meeting's own detail page. When adding from a
    // parent entity's panel, we need to stay on (or return to) the parent's detail page
    // so subsequent panel actions (e.g. quotation, task) can continue on the same page.
    // B6: the created meeting's id is required (fails by name when not captured) and the form must close.
    const meetingId = await meetingsPage.saveMeetingFromEntityPanel();
    await this.withSessionExpiryRecovery(() =>
      expect(this.editModal(), 'The meeting form should close after Save').toBeHidden({
        timeout: config.timeouts.expect,
      })
    );
    // WHY: Ensure we are back on the company detail page — meeting save may show a popup
    // toast/modal that auto-redirects; force navigation back if URL changed
    if (!this.page.url().includes(companyUrl.split('/details/')[1] ?? '___never___')) {
      await this.navigateTo(companyUrl);
      await this.waitForCompanyDetailsPage();
    }
    logger.success(`Meeting added from panel: "${meetingTitle}" (ID: ${meetingId})`);
    return meetingId;
  }

  // B6: the one fill for the "Add Contact" modal opened from a company (direct button and ellipsis). Staging
  // trace 2026-11-17: after the "Show Required & Important Fields" toggle the form shows the Add Email and Add
  // Phone buttons; once the names are filled one click on each adds `1_11_input_email_0` / `1_12_input_phone_0`
  // (a click made with nothing yet touched in the form did nothing, so the names are filled first, as here).
  // Email and Phone are standard fields: a missing button or input FAILS by name instead of being skipped. The
  // other revealed fields are presence-checked and a missing one is logged, never skipped silently.
  private async fillContactFormInModal(contactData: ContactData): Promise<void> {
    const modal = this.page.locator('#editEntityModal');
    // WHY: Toggle off "Show Required & Important Fields" — reveals ALL fields, same as ContactsPage
    const requiredToggle = modal
      .locator('.custom-control-label')
      .filter({ hasText: 'Show Required & Important Fields' })
      .first();
    if (await requiredToggle.isVisible().catch(() => false)) {
      await requiredToggle.click();
      logger.debug('Toggled off Show Required & Important Fields');
    }
    // the form is fully revealed when the address input (hidden while the toggle is on) is there
    await expect(
      modal.locator('input[name="address"]'),
      'Add Contact form: the full field set (address) should be shown after the toggle'
    ).toBeVisible({ timeout: config.timeouts.expect });
    const firstNameInput = this.page.locator('[id="0_12_input_firstName"]');
    await firstNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await firstNameInput.fill(contactData.firstName);
    await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);
    // WHY: Add email/phone via the button, then fill by exact modal ID — avoids page-level ambiguity
    const addAndFill = async (button: string, inputId: string, value: string): Promise<void> => {
      const addButton = modal.locator('button').filter({ hasText: button }).first();
      await expect(addButton, `Add Contact form: the "${button}" button should be visible`).toBeVisible({
        timeout: config.timeouts.expect,
      });
      await addButton.click({ timeout: config.timeouts.expect });
      const input = this.page.locator(`[id="${inputId}"]`);
      await expect(input, `Add Contact form: ${inputId} should appear after "${button}"`).toBeVisible({
        timeout: config.timeouts.expect,
      });
      await input.fill(value, { timeout: config.timeouts.expect });
    };
    await addAndFill('Add Email', '1_11_input_email_0', contactData.email);
    await addAndFill('Add Phone', '1_12_input_phone_0', contactData.phone);
    // WHY: Fill remaining fields revealed by the toggle — address, social, professional
    const optionalFields: [string, string][] = [
      ['address', contactData.address],
      ['city', contactData.city],
      ['state', contactData.state],
      ['zipcode', contactData.zipcode],
      ['facebook', contactData.facebook],
      ['twitter', contactData.twitter],
      ['linkedin', contactData.linkedin],
      ['department', contactData.department],
      ['designation', contactData.designation],
    ];
    for (const [name, value] of optionalFields) {
      const input = modal.locator(`input[name="${name}"]`);
      if (await input.isVisible().catch(() => false)) {
        await input.fill(value);
      } else {
        logger.warn(`Add Contact form: field "${name}" is not shown on this environment — left empty`);
      }
    }
  }

  async addContactFromDirectButton(contactData: ContactData): Promise<number | null> {
    logger.info(`Adding contact from direct button: ${contactData.firstName} ${contactData.lastName}`);
    await this.addContactDirectButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.addContactDirectButton().click();
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 })
    );
    await this.fillContactFormInModal(contactData);
    // WHY: Set up response listener BEFORE clicking save — POST may arrive immediately
    // WHY: hardened 2026-07-19 — bare '/v1/contacts' substring had no
    // /reports/ exclusion, same bug class found across the codebase's other
    // ID-capture methods; fixed as defense-in-depth.
    const contactIdPromise = this.armResponseWaitWithRecovery(
      (res) =>
        res.url().includes('/v1/contacts') &&
        !res.url().includes('/reports/') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      'capture contact ID (direct button)',
      30000
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const contactId = await contactIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!contactId) {
      throw new Error('Contact ID not captured after save — cannot proceed (save likely failed silently)');
    }
    logger.success(`Contact added from direct button: ID=${contactId}`);
    return contactId;
  }

  async addContactFromEllipsis(contactData: ContactData): Promise<number | null> {
    logger.info(`Adding contact from ellipsis: ${contactData.firstName} ${contactData.lastName}`);
    await this.clickEllipsisOption('Add Contact');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 })
    );
    await this.fillContactFormInModal(contactData);
    // WHY: hardened 2026-07-19 — bare '/v1/contacts' substring had no
    // /reports/ exclusion, same bug class found across the codebase's other
    // ID-capture methods; fixed as defense-in-depth.
    const contactIdPromise = this.armResponseWaitWithRecovery(
      (res) =>
        res.url().includes('/v1/contacts') &&
        !res.url().includes('/reports/') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      'capture contact ID (ellipsis)',
      30000
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const contactId = await contactIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!contactId) {
      throw new Error('Contact ID not captured after save — cannot proceed (save likely failed silently)');
    }
    logger.success(`Contact added from ellipsis: ID=${contactId}`);
    return contactId;
  }

  async addDealFromDirectButton(dealData: DealData, dealsPage?: DealsPage): Promise<number | null> {
    logger.info(`Adding deal from direct button: ${dealData.name}`);
    await this.addDealDirectButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.addDealDirectButton().click();
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Deal', { timeout: 5000 })
    );
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
    // WHY (2026-09-07, PROD Build #4): the previous `.includes('/deals')`
    // substring only excluded the one previously-found `/v4/reports/deals`
    // collision — narrower than the fully-versioned pattern rule 15/
    // docs/PATTERNS.md P17 actually requires (confirmed via DealsPage.ts's own
    // captureDealIdFromResponse(), which already uses the versioned form).
    // Tightened to match that standard rather than leaving this call site
    // (flagged as "highest-risk, not independently re-reproduced" on
    // 2026-07-19) permanently narrower than its own sibling.
    const dealIdPromise = this.armResponseWaitWithRecovery(
      (res) =>
        (res.url().includes('/v1/deals') || res.url().includes('/v1/deal')) &&
        !res.url().includes('/reports/') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      'capture deal ID (direct button)',
      30000
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const dealId = await dealIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!dealId) {
      throw new Error('Deal ID not captured after save — cannot proceed (save likely failed silently)');
    }
    logger.success(`Deal added from direct button: ID=${dealId}`);
    return dealId;
  }

  async addDealFromEllipsis(dealData: DealData, dealsPage?: DealsPage): Promise<number | null> {
    logger.info(`Adding deal from ellipsis: ${dealData.name}`);
    await this.clickEllipsisOption('Add Deal');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Deal', { timeout: 5000 })
    );
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
    // WHY (2026-09-07, PROD Build #4): tightened to the fully-versioned
    // pattern — same fix and same rationale as the sibling dealIdPromise
    // above (this occurrence is CompaniesPage.addDealFromEllipsis(), which
    // hit a real "Deal ID not captured after save" flake on PROD Build #4;
    // the narrower `.includes('/deals')` predicate was demonstrably weaker
    // than this repo's own documented versioned-path standard).
    const dealIdPromise = this.armResponseWaitWithRecovery(
      (res) =>
        (res.url().includes('/v1/deals') || res.url().includes('/v1/deal')) &&
        !res.url().includes('/reports/') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      'capture deal ID (ellipsis)',
      30000
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
    }).catch(() => null);
    await this.page.locator('#editEntityModal button.save-button').click();
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const dealId = await dealIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!dealId) {
      throw new Error('Deal ID not captured after save — cannot proceed (save likely failed silently)');
    }
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
    // WHY: hardened 2026-07-19 — bare '/v1/tasks' substring had no /reports/
    // exclusion, same bug class found across the codebase's other ID-capture
    // methods; fixed as defense-in-depth.
    const taskIdPromise = this.armResponseWaitWithRecovery(
      (res) =>
        res.url().includes('/v1/tasks') &&
        !res.url().includes('/reports/') &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      'capture task ID (pending activity)',
      30000
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      const id = body?.id ?? body?.data?.id ?? null;
      return id ? String(id) : null;
    }).catch(() => null);
    await this.page.locator('button.add-task-button').click();
    // B6: the quick-task form must close after the save (it used to be `.catch(() => {})` plus a 1 s pause)
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.page.locator('.quick-task-create-backdrop'),
        'The quick-task form should close after Add Task'
      ).toBeHidden({ timeout: config.timeouts.expect })
    );
    const taskId = await taskIdPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveCompany() above.
    if (!taskId) {
      throw new Error('Task ID not captured after save — cannot proceed (save likely failed silently)');
    }
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

    await this.withSessionExpiryRecovery(() =>
      expect(this.companyRowNameCell(name)).toBeHidden({
        timeout: 10000,
      })
    );

    logger.success(`Company absent confirmed: ${name}`);
  }

  async assertCompanyUpdated(data: CompanyData): Promise<void> {
    await this.goToCompaniesList();

    await this.assertCompanyExistsInList(data.name);
  }

  async assertCompanyDeletedById(companyId: number): Promise<void> {
    logger.info(`Asserting company ${companyId} is deleted`);
    // B6: positive control first (the detail GET was answered), then the specific not-found state (staging trace 2026-11-17: the company GET answers 404 / code 02801002
    // "the record doesn't seem to exist, or you don't have enough permissions"). The old
    // check passed on ANY redirect or any error toast, after a fixed 2 s pause, even before the page loaded.
    const companyGet = this.armResponseWaitWithRecovery(
      (res) =>
        new URL(res.url()).pathname === `/v1/companies/${companyId}` && res.request().method() === 'GET',
      `assertCompanyDeletedById: company ${companyId} GET`,
      config.timeouts.navigation
    );
    companyGet.catch(() => undefined);
    await this.navigateTo(`${config.appUrl}/sales/companies/details/${companyId}`);
    const response = await companyGet;
    const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
    expect(
      { status: response.status(), code: body.code, message: body.message },
      `Company ${companyId} should answer 404 / code 02801002 (not found) after the delete`
    ).toMatchObject({ status: 404, code: '02801002' });
    logger.success(`Company ${companyId} confirmed deleted`);
  }

  async assertClonedCompanyName(clonedName: string, clonedId?: number | null): Promise<void> {
    // WHY: ID-first — mirrors DealsPage.assertClonedDealName's fix. List/name
    // search is unreliable once the cloned name carries a unique suffix and
    // risks matching the wrong row; navigating directly to the clone's own
    // ID is deterministic.
    //
    // WHY clonedId is optional with a list-search fallback (2026-07-16):
    // same reasoning as LeadsPage.assertClonedLeadLastName() — a caller
    // whose ID capture genuinely failed shouldn't hard-fail the whole test
    // on that alone; fall back to the existing retry-based list search as
    // a last resort rather than a primary path.
    if (clonedId) {
      logger.info(`Asserting cloned company detail page shows name: ${clonedName}`);
      await this.goToCompanyDetailsById(clonedId);
      // WHY: Confirmed live (2026-07-06) — waitForCompanyDetailsPage's GET-response
      // wait resolves the instant the network response is observed, not once React
      // has re-rendered the DOM with it. A one-shot body.innerText() read right
      // after can race ahead of the render (reproduced: GET returned 200, but body
      // was still just the app shell). Use an auto-retrying assertion instead of a
      // fixed extra sleep — it polls until the real DOM condition is met.
      await expect(this.page.locator('body')).toContainText(clonedName, { timeout: 15000 });
      logger.success(`Cloned company found with name: ${clonedName}`);
      return;
    }
    logger.warn('Cloned company ID not available — falling back to list search');
    const found = await this.retryFindCompany(clonedName);
    expect(found, `Cloned company "${clonedName}" should exist in list`).toBeTruthy();
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

  // B6: click a detail tab and know it is the active one (instead of pausing), same as LeadsPage.activateDetailTab():
  // the tab strip renders after the detail layout, so the tab is awaited first, and the pane is read only once
  // the tab carries the `active` class.
  private async activateDetailTab(tab: Locator, name: string): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(tab, `"${name}" detail tab should appear on the detail page`).toBeVisible({
        timeout: config.timeouts.navigation,
      })
    );
    await tab.click({ timeout: config.timeouts.expect });
    await this.withSessionExpiryRecovery(() =>
      expect(tab, `"${name}" detail tab should be active after the click`).toHaveClass(/active/, {
        timeout: config.timeouts.expect,
      })
    );
  }

  async assertCompanyDetailFields(data: CompanyData): Promise<void> {
    logger.info('Asserting company detail fields');
    // WHY: Detail page renders field values as text inside .read-only-info containers
    await this.assertOnCompanyDetailPage();
    // Assert company name in page body
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('body')).toContainText(data.name, { timeout: 10000 })
    );
    // WHY: Same tab pattern as ContactsPage.assertContactDetailFields()
    const tabPane = this.page.locator('.tab-pane.active.show');
    // B6: auto-retrying text checks on the active pane (the old code slept 800 ms, then read textContent once)
    const assertPaneContains = async (tabId: string, name: string, values: string[]): Promise<void> => {
      await this.activateDetailTab(this.page.locator(`#${tabId}`), name);
      for (const value of values) {
        await this.withSessionExpiryRecovery(() =>
          expect(tabPane, `${name} tab should show "${value}"`).toContainText(value, {
            ignoreCase: true,
            timeout: config.timeouts.expect,
          })
        );
      }
    };
    // WHY: Verify Communication tab — email, phone
    await assertPaneContains('nav-tab0-tab', 'Communication', [data.email, data.phone]);
    logger.debug(`Communication tab — email: ${data.email} | phone: ${data.phone}`);
    // WHY: Verify Location tab — city, state, zipcode
    await assertPaneContains('nav-tab1-tab', 'Location', [data.city, data.state, data.zipcode]);
    logger.debug(`Location tab — city: ${data.city} | state: ${data.state} | zipcode: ${data.zipcode}`);
    // WHY: Verify Social tab — facebook, twitter, linkedIn
    await assertPaneContains('nav-tab2-tab', 'Social', [data.facebook, data.twitter, data.linkedIn]);
    logger.debug(`Social tab — facebook: ${data.facebook} | twitter: ${data.twitter} | linkedin: ${data.linkedIn}`);
    // WHY: Company "Internals" tab (#nav-tab4-tab, confirmed live 2026-07-28 — shifted
    // from #nav-tab3-tab now that Company has its own "Other Details" custom-field tab
    // at that index, see otherDetailsDetailPageTab()) shows audit info (Created By/At,
    // etc.) — NOT the company's own fields. numberOfEmployees, industry, businessType,
    // website, uniqueText1, uniqueText2 are rendered in the RIGHT PANEL info section
    // (not inside any tab). Verify them via the full page body text which includes the
    // main panel.
    for (const value of [
      data.numberOfEmployees,
      data.industry,
      data.businessType,
      data.website,
      data.uniqueText1,
      data.uniqueText2,
    ]) {
      await this.withSessionExpiryRecovery(() =>
        expect(this.page.locator('body'), `Company detail should show "${value}"`).toContainText(value, {
          ignoreCase: true,
          timeout: config.timeouts.expect,
        })
      );
    }
    // TODO: annualRevenue assertion skipped — currency formatting varies (₹1,23,456 vs 123456)
    logger.debug(`Main panel — employees: ${data.numberOfEmployees} | industry: ${data.industry} | bizType: ${data.businessType}`);
    logger.success('Company detail fields verified');
  }

  // WHY: mirrors LeadsPage.assertLeadCustomFieldsOnDetail()/
  // ContactsPage.assertContactCustomFieldsOnDetail()/
  // DealsPage.assertDealCustomFieldsOnDetail() — only the 2 dedicated
  // custom-field tests need full value verification, every other Company
  // test just needs fillCompanyCustomFields()'s fill-if-present behavior to
  // run without erroring. Throws (does not skip) on a missing tab — this
  // method is called ONLY from the dedicated tests, which always run on an
  // environment already confirmed (via skipIfCustomFieldsAbsent()) to have
  // these fields, so a missing tab here means verification genuinely failed
  // to run, not a legitimate environment-absence case.
  async assertCompanyCustomFieldsOnDetail(data: CompanyData): Promise<void> {
    logger.info('Asserting all 9 custom field values on company detail page');
    const tab = this.otherDetailsDetailPageTab();
    await this.withSessionExpiryRecovery(() =>
      expect(
        tab,
        '"Other Details" tab did not appear on the detail page — custom field verification cannot proceed'
      ).toBeVisible({ timeout: config.timeouts.navigation })
    );
    // WHY this.click() and not a raw tab.click(): the DealsPage reference
    // implementation this method was ported from uses a raw, unwrapped
    // tab.click() here (DealsPage.assertDealCustomFieldsOnDetail()) — that's
    // a pre-existing gap in the reference, not something to blindly carry
    // forward. this.click() is the existing bounded, session-expiry-covered
    // BasePage helper (see its own comment), so using it here means this new
    // method introduces zero raw Playwright calls that bypass that
    // protection, per the standing checklist (points 2/3).
    await this.activateDetailTab(tab, 'Other Details');

    const cf = data.customFields;
    await this.assertCustomFieldOnDetail(
      COMPANY_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.assertCustomFieldOnDetail(
      COMPANY_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.assertCustomFieldOnDetail(COMPANY_CUSTOM_FIELD_NAMES.number, String(cf.number), 'Number');
    await this.assertCustomFieldOnDetail(COMPANY_CUSTOM_FIELD_NAMES.urlField, cf.urlField, 'URL Field');
    await this.assertCustomFieldOnDetail(
      COMPANY_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox ? 'Yes' : 'No',
      'Checkbox'
    );
    await this.assertCustomFieldOnDetail(
      COMPANY_CUSTOM_FIELD_NAMES.date,
      this.formatCustomFieldDetailDate(cf.date),
      'Date'
    );
    await this.assertCustomFieldOnDetail(
      COMPANY_CUSTOM_FIELD_NAMES.dateTimePicker,
      this.formatCustomFieldDetailDateTime(cf.dateTimePicker),
      'Date Time Picker'
    );
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(
        COMPANY_CUSTOM_FIELD_NAMES.pickList,
        cf.pickList,
        'Pick List'
      );
    }
    if (cf.multiPickList.length > 0) {
      await this.assertMultiPicklistCustomFieldOnDetail(
        COMPANY_CUSTOM_FIELD_NAMES.multiPickList,
        cf.multiPickList,
        'Multi Pick List'
      );
    }
    logger.success('All 9 custom field values verified on company detail page');
  }

  // ──────────────────────────────────────────────────────────
  // 10. Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  // WHY the optional `options` param (2026-09-22, Form Field Limit
  // feature): threaded straight through to fillCompanyForm() — see that
  // method's own WHY comment. createCompany()'s own retry/save control
  // flow is completely untouched; only what gets FILLED changes. Every
  // existing caller omits `options` and gets the original behavior.
  async createCompany(
    data: CompanyData,
    options?: { minimal?: boolean; onlyCustomField?: CompanyCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      // WHY the bounded transient-retry (root-caused 2026-07-21 from a real
      // failure): the create POST intermittently returns a transient backend
      // error (HTTP 400/5xx with a generic message and NO field-level
      // validation — confirmed live as {"message":"Unexpected error
      // occurred!!","fieldErrors":null} / "Internal server error"), which left
      // the create with no captured id and failed the test. saveCompany() now
      // classifies that as a TransientCompanySaveError; we retry the ENTIRE
      // create here. Duplicate-safe: a transient rejection is blocked before
      // any DB write, so no company was created — re-creating with the same
      // (still-unique) data yields exactly one. A GENUINE validation rejection
      // (duplicate name, bad data) surfaces via assertNoFormErrors() as a
      // different error and is NOT caught here, so it still fails loudly and is
      // never silently retried into a false pass. maxAttempts is small — this
      // covers a brief backend blip, not a sustained outage.
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await this.clickAddCompany();
          await this.fillCompanyForm(data, options);
          return await this.saveCompany();
        } catch (error) {
          if (error instanceof TransientCompanySaveError && attempt < maxAttempts) {
            logger.warn(
              `Company create hit a transient backend error (attempt ${attempt}/${maxAttempts}) — ` +
                're-navigating and retrying the whole create'
            );
            // Clean slate for the retry via a HARD navigation, NOT a
            // click-to-close: confirmed via reproduction (2026-07-21) that the
            // transient-error modal state can leave the cancel button
            // non-actionable, so goToCompaniesList()'s closeModalIfOpen() click
            // hangs until the test timeout. page.goto abandons the stuck modal
            // and forces a fresh list page.
            await this.navigateTo(`${config.appUrl}/sales/companies/list`);
            await this.waitForCompanyListPage();
            continue;
          }
          throw error;
        }
      }
      // Unreachable in practice (the loop returns or throws), but keeps the
      // type checker satisfied and fails loudly if the invariant ever breaks.
      throw new Error('createCompany: exhausted transient retries without a definitive outcome');
    }, 'createCompany');
  }

  async updateCompany(
    newData: CompanyData,
    originalName?: string,
    companyId?: number
  ): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      const searchName = originalName ?? newData.name;

      await this.searchAndOpenCompany(searchName, companyId);

      await this.clickEditIcon();

      await this.fillEditForm(newData);

      await this.saveEditedCompany();
    }, 'updateCompany');
  }

  async updateCompanyFull(
    newData: CompanyData,
    originalName?: string,
    companyId?: number
  ): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      const searchName = originalName ?? newData.name;

      await this.searchAndOpenCompany(searchName, companyId);

      await this.clickEditIcon();

      await this.fillFullEditForm(newData);

      await this.saveEditedCompany();
    }, 'updateCompanyFull');
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
