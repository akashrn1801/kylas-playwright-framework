import { test, expect } from '../../../src/fixtures/index';
import { safeWaitForURL } from '../../../src/utils/navigation';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { generateCompanyData } from '../../../src/data/factories/companyFactory';
import {
  generateLeadData,
  generateAdminLeadData,
  generateLeadCustomFieldData,
  generateLeadCustomFieldInvalidTextField,
  generateLeadCustomFieldInvalidParagraphText,
  generateLeadCustomFieldInvalidUrl,
  LEAD_CUSTOM_FIELD_NAMES,
  LeadCustomFieldData,
} from '../../../src/data/factories/leadFactory';
import { faker } from '@faker-js/faker';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

test.describe('Leads', () => {
  test('@smoke @regression admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L1 passed');
  });

  test('@regression admin should create a new lead with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
    logger.success('L2 passed');
  });

  test('@regression admin should update a created lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName);
    await leadsPage.assertLeadUpdated(updatedData);
    logger.success('L3 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage verification
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a lead with pipeline stage and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData({ pipelineStage: 'Open' });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);

    // Navigate to lead details
    await leadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(adminPage, /leads\/details\//, 20000);

    // WHY: Verify pipeline stage is shown correctly on details page
    await leadsPage.assertPipelineStageOnDetails('Open');
    logger.success('L4 passed');
  });

  test('@regression admin should change pipeline stage while updating a lead', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData({ pipelineStage: 'Open' });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);

    // Open lead for editing
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);

    // WHY: Pick a random non-closed stage for update
    const newStage = faker.helpers.arrayElement([
      'Prospect/Contacted',
      'Requirements Gathered',
      'Demo/Meeting Conducted',
    ]);
    const updatedData = generateLeadData({
      pipelineStage: newStage as typeof leadData.pipelineStage,
    });

    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updatedData);
    await leadsPage.changePipelineStageInEdit(newStage);
    await leadsPage.saveEditedLead();

    // Verify stage updated on details page
    await leadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(adminPage, /leads\/details\//, 20000);
    await leadsPage.assertPipelineStageOnDetails(newStage);
    logger.success('L5 passed');
  });

  // ── L6 ────────────────────────────────────────────────────

  test('@regression admin should search lead by name and verify in list', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(leadData.firstName);
    logger.success('L6 passed');
  });

  // ── L7 ────────────────────────────────────────────────────

  test('@regression admin should verify all detail fields after creating a lead', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(adminPage, /leads\/details\//, 20000);
    // WHY: Verify Communication tab fields
    await leadsPage.assertDetailTabContent('nav-tab0-tab', [leadData.email]);
    // WHY: Verify Location tab fields
    await leadsPage.assertDetailTabContent('nav-tab1-tab', [leadData.city, leadData.state]);
    // WHY: Verify Social tab fields
    await leadsPage.assertDetailTabContent('nav-tab2-tab', [leadData.facebook, leadData.twitter]);
    // WHY: Verify Professional tab fields
    await leadsPage.assertDetailTabContent('nav-tab3-tab', [
      leadData.companyName,
      leadData.department,
      leadData.designation,
    ]);
    logger.success('L7 passed');
  });

  // ── L8 ────────────────────────────────────────────────────

  test('@regression admin should delete a lead and verify it is removed from list', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    // WHY: Use ADM prefix to guarantee uniqueness — only this test creates this lead
    const leadData = generateAdminLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();
    await leadsPage.assertLeadNotInList(leadData.firstName);
    logger.success('L8 passed');
  });

  // ── L9 ────────────────────────────────────────────────────

  test('@regression admin should clone a lead and verify new lead has Copy in lastName', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const clonedId = await leadsPage.cloneLead();
    expect(clonedId).not.toBeNull();
    await leadsPage.assertClonedLeadLastName(leadData.lastName, clonedId!);
    logger.success('L9 passed');
  });

  // ── L10 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Won via Close Lead dropdown and verify stage', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Won');
    await leadsPage.assertLeadStageOnDetail('Won');
    logger.success('L10 passed');
  });

  // ── L11 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Lost via Close Lead dropdown select reason and verify stage', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Closed Lost');
    await leadsPage.assertLeadStageOnDetail('Closed Lost');
    logger.success('L11 passed');
  });

  // ── L12 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Unqualified via Close Lead dropdown select reason and verify stage', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Closed Unqualified');
    await leadsPage.assertLeadStageOnDetail('Closed Unqualified');
    logger.success('L12 passed');
  });

  // ── L13 ───────────────────────────────────────────────────

  test('@regression admin should convert lead to Deal Contact and Company and verify Lead Converted badge', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const dealName = `Deal-${Date.now()}`;
    await leadsPage.convertLeadToAll(dealName);
    await leadsPage.assertLeadConvertedBadge();
    logger.success('L13 passed');
  });

  // ── L14 ───────────────────────────────────────────────────

  test('@regression admin should reassign lead to restricted user and verify owner changed', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await leadsPage.getLoggedInUserName('restricted');
    await leadsPage.reassignLead(restrictedUserName);
    await leadsPage.assertOwnerOnDetail(restrictedUserName);
    logger.success('L14 passed');
  });

  // ── L15 ───────────────────────────────────────────────────

  test('@regression admin should get validation error when saving lead without lastName', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    // WHY: Only fill firstName — leave lastName empty to trigger validation
    await leadsPage.fillLeadForm({ ...generateLeadData(), lastName: '' });
    // WHY: saveLead() clicks save button and checks for form errors
    await adminPage.locator('button[type="submit"].save-button').click();
    await leadsPage.assertValidationError('required');
    logger.success('L15 passed');
  });

  // ── L16 ───────────────────────────────────────────────────

  test('@prodSafe admin should navigate to leads list page on production', async ({
    adminPage,
  }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L16 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 9 fields exist only on QA today (2026-07-08) and are expected
  // on Stage/Prod later with identical names — see LeadsPage/BasePage's
  // custom-field helpers for the environment-safety skip logic that makes
  // these tests (and every other Lead create/update path) work unchanged
  // once that happens.

  // ── L17 ───────────────────────────────────────────────────

  test('@regression admin should create a lead with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.skipIfCustomFieldsAbsent();
    await leadsPage.fillLeadForm(leadData);
    const leadId = await leadsPage.saveLead();
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.assertLeadCustomFieldsOnDetail(leadData);
    await leadsPage.assertLeadStandardFieldsOnDetail(leadData);
    logger.success('L17 passed');
  });

  // ── L18 ───────────────────────────────────────────────────

  test("@regression admin should update a lead's custom fields and verify updated values", async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.skipIfCustomFieldsAbsent();
    await leadsPage.fillLeadForm(leadData);
    const leadId = await leadsPage.saveLead();
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName, leadId ?? undefined);

    // WHY: updateLead() leaves the browser on the same lead detail page
    // (edit is an in-place modal, not a route change) — no re-navigation needed.
    await leadsPage.assertLeadCustomFieldsOnDetail(updatedData);
    // WHY: assertCreateOnlyFields=false — Timezone/Country/Professional fields
    // are filled only by fillLeadForm() (create), not fillEditForm() (update),
    // so updatedData carries un-applied factory defaults for them on this path
    // (see assertLeadStandardFieldsOnDetail's own comment). Salutation,
    // Requirement, Products/Currency/Budget ARE updated and still asserted.
    await leadsPage.assertLeadStandardFieldsOnDetail(updatedData, false);
    logger.success('L18 passed');
  });

  // ── L19 ───────────────────────────────────────────────────

  test('@regression admin should see validation errors for invalid custom field values and not save the lead', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);

    interface InvalidCustomFieldCase {
      description: string;
      customFieldOverrides: Partial<LeadCustomFieldData>;
      assertError: () => Promise<void>;
    }

    // WHY: Number is deliberately excluded — confirmed live (2026-07-08) that
    // it renders as a native <input type="number">, which rejects non-numeric
    // characters at the browser level. Playwright's fill() itself throws
    // ("Cannot type text into input[type=number]") before the app ever sees
    // an invalid value, so there is no realistic UI path to trigger this case.
    const cases: InvalidCustomFieldCase[] = [
      {
        description: 'TextField exceeding 255 characters',
        customFieldOverrides: { textField: generateLeadCustomFieldInvalidTextField() },
        // WHY: confirmed live — client-side, on-blur inline validation.
        assertError: () =>
          leadsPage.assertCustomFieldValidationError(
            LEAD_CUSTOM_FIELD_NAMES.textField,
            'Enter value having maximum 255 characters',
            'Text Field'
          ),
      },
      {
        description: 'UrlField with a malformed URL',
        customFieldOverrides: { urlField: generateLeadCustomFieldInvalidUrl() },
        // WHY: confirmed live — client-side, on-blur inline validation.
        assertError: () =>
          leadsPage.assertCustomFieldValidationError(
            LEAD_CUSTOM_FIELD_NAMES.urlField,
            'Enter a valid URL',
            'URL Field'
          ),
      },
      {
        description: 'ParagraphText exceeding 2,550 characters',
        customFieldOverrides: { paragraphText: generateLeadCustomFieldInvalidParagraphText() },
        // WHY: confirmed live — unlike TextField/UrlField, ParagraphText has
        // NO client-side length check at all (no inline error on blur). The
        // only rejection is server-side on Save, surfaced as a generic toast
        // ("Uhoh! Your data is invalid...") — the field-specific detail
        // ("must be <= 2,550") exists only in the raw API response, never in
        // the UI.
        assertError: () =>
          leadsPage.assertFormErrorToast('Uhoh! Your data is invalid', 'lead create form'),
      },
    ];

    for (const testCase of cases) {
      logger.info(`Negative custom field case: ${testCase.description}`);
      await leadsPage.goToLeadsList();
      await leadsPage.clickAddLead();
      // WHY: cheap, harmless no-op when fields are present (a handful of
      // DOM count() queries) — checked every iteration rather than only the
      // first for simplicity, since a skip on any iteration ends the test
      // immediately anyway.
      await leadsPage.skipIfCustomFieldsAbsent();

      const leadData = generateLeadData({
        customFields: generateLeadCustomFieldData(testCase.customFieldOverrides),
      });
      await leadsPage.fillLeadForm(leadData);
      await adminPage.locator('button[type="submit"].save-button').click();

      await testCase.assertError();

      await expect(
        adminPage.locator('button[type="submit"].save-button'),
        `Lead should NOT have been saved for case: ${testCase.description}`
      ).toBeVisible();

      logger.success(`Validation error confirmed for: ${testCase.description}`);
    }

    logger.success('L19 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Lookup Custom Fields ("Company Lookup" / "Contact Lookup")
  // ──────────────────────────────────────────────────────────
  // WHY: two custom entity-LOOKUP fields in "Other Details" (confirmed live
  // 2026-07-21 — present on QA, absent on Stage/Prod for now, where the
  // presence-guard skips ONLY the lookup-specific steps/assertions, not the
  // whole test). Unlike the 9 text/picklist custom fields these are live,
  // server-side, RBAC-scoped searches.

  // ── L20 ──────────────────────────────────────────────────

  test('@regression admin creates a lead selecting Company Lookup and Contact Lookup and verifies both on the detail page', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const contactsPage = new ContactsPage(adminPage);
    const companiesPage = new CompaniesPage(adminPage);

    // WHY: admin-owned Contact + Company created first, so the lead's lookups
    // point at known, specific entities — their exact names drive both the
    // exact-match selection and the detail-page verification.
    const contactData = generateContactData();
    const companyData = generateCompanyData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId, 'Contact should be created').not.toBeNull();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId, 'Company should be created').not.toBeNull();

    const contactName = `${contactData.firstName} ${contactData.lastName}`;
    const companyName = companyData.name;

    // WHY: set the lookup TARGETS on the lead's custom-field data (left
    // undefined by the factory — see LeadCustomFieldData). fillLeadForm() fills
    // standard + the 9 text/picklist custom fields; fillLeadLookupCustomFields()
    // is called explicitly for the two lookups (deliberately not wired into the
    // shared fill flow).
    const leadData = generateLeadData();
    leadData.customFields.companyLookupTarget = companyName;
    leadData.customFields.contactLookupTarget = contactName;

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    const lookups = await leadsPage.fillLeadLookupCustomFields(leadData.customFields);
    const leadId = await leadsPage.saveLead();
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    // Standard fields are always verified — unaffected by lookup-field presence.
    await leadsPage.assertLeadStandardFieldsOnDetail(leadData);

    // WHY gate on the returned value: where a lookup field is absent,
    // fillLeadLookupCustomFields() returns null for it (and logCustomFieldSkipped()
    // already logged why) — we then skip ONLY that field's detail assertion
    // rather than failing the whole test.
    if (lookups.companyLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.companyLookup,
        companyName,
        'Company Lookup'
      );
    } else {
      logger.info(
        'Company Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }
    if (lookups.contactLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.contactLookup,
        contactName,
        'Contact Lookup'
      );
    } else {
      logger.info(
        'Contact Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }

    logger.success('L20 passed');
  });

  // ── L21 ──────────────────────────────────────────────────

  test('@regression admin edits a lead to add Company Lookup and Contact Lookup and verifies both on the detail page', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const contactsPage = new ContactsPage(adminPage);
    const companiesPage = new CompaniesPage(adminPage);

    // Admin-owned Contact + Company to point the lookups at (their exact names
    // drive the exact-match selection and detail-page verification).
    const contactData = generateContactData();
    const companyData = generateCompanyData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId, 'Contact should be created').not.toBeNull();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId, 'Company should be created').not.toBeNull();
    const contactName = `${contactData.firstName} ${contactData.lastName}`;
    const companyName = companyData.name;

    // Create a lead WITHOUT the lookups (generateLeadData leaves the lookup
    // targets undefined), then EDIT it to add them.
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    // Edit: set the lookup targets, run the standard edit-form fill, then add
    // the lookups explicitly (deliberately not wired into the shared fill flow).
    const editData = generateLeadData();
    editData.customFields.companyLookupTarget = companyName;
    editData.customFields.contactLookupTarget = contactName;
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(editData);
    const lookups = await leadsPage.fillLeadLookupCustomFields(editData.customFields);
    await leadsPage.saveEditedLead();

    // Re-open the lead by ID for a clean detail-page read, then verify.
    await leadsPage.searchAndOpenLead(editData.firstName, leadId ?? undefined);
    if (lookups.companyLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.companyLookup,
        companyName,
        'Company Lookup'
      );
    } else {
      logger.info(
        'Company Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }
    if (lookups.contactLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.contactLookup,
        contactName,
        'Contact Lookup'
      );
    } else {
      logger.info(
        'Contact Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }

    logger.success('L21 passed');
  });
});
