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
  generateMinimalLeadData,
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
import { reportCreatedRecord } from '../../../src/utils/createdRecords';
import { uniqueEmail } from '../../../src/data/factories/uniqueValues';
import { LeadApi } from '../../../src/utils/leadApi';

// WHY the server read-back: the stage text on the detail page is an unscoped text match, so the
// persisted stage is read from the lead itself (GET /v1/leads/{id} -> pipeline.stage.name)
async function assertStagePersisted(
  page: Parameters<typeof LeadApi.forPage>[0],
  leadId: number,
  expectedStage: string
): Promise<void> {
  const api = await LeadApi.forPage(page);
  try {
    const lead = await api.getLeadOrThrow(leadId);
    expect(lead.pipeline?.stage.name, 'Stage stored on the lead').toBe(expectedStage);
  } finally {
    await api.dispose();
  }
}

test.describe('Leads', () => {
  test('@smoke @regression @prodSafe admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L1 passed');
  });

  test('@regression admin should create a new lead with all fields', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
    await leadCleanup.track(adminPage, leadId!);
    // WHY the ID, not a list search: a search for the first name proves only that "a row with this
    // name exists" (faker names repeat) and can lag the write
    await leadsPage.assertLeadCreated(leadData, leadId!);
    const api = await LeadApi.forPage(adminPage);
    try {
      const saved = await api.getLeadOrThrow(leadId!);
      expect(saved.firstName).toBe(leadData.firstName);
      expect(saved.lastName).toBe(leadData.lastName);
      expect(saved.emails?.[0]?.value.toLowerCase()).toBe(leadData.email.toLowerCase());
    } finally {
      await api.dispose();
    }
    logger.success('L2 passed');
  });

  test('@regression admin should update a created lead', async ({ adminPage, leadCleanup }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
    await leadCleanup.track(adminPage, leadId!);
    const updatedData = generateLeadData();
    // WHY: ID-first — open and verify the lead by its captured ID, not by a first-name list
    // search + row click. On QA (run 38936405639, both attempts) the by-name path found the
    // row but the row click never reached /leads/details/ within 20s.
    await leadsPage.updateLead(updatedData, leadData.firstName, leadId ?? undefined);
    await leadsPage.assertLeadUpdated(updatedData, leadId ?? undefined);
    // The stored lead carries the new names, not just a page that shows them
    const api = await LeadApi.forPage(adminPage);
    try {
      const saved = await api.getLeadOrThrow(leadId!);
      expect(saved.firstName).toBe(updatedData.firstName);
      expect(saved.lastName).toBe(updatedData.lastName);
    } finally {
      await api.dispose();
    }
    logger.success('L3 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage verification
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a lead with pipeline stage and verify on details', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    // WHY a stage that is NOT the default: "Open" is already selected on a new lead and the form
    // skips picking it, so with 'Open' this test could not tell a working stage picker from a broken
    // one. The stage name is read from the live pipeline (rule 4), the second one in its order.
    const api = await LeadApi.forPage(adminPage);
    let stage: string;
    try {
      stage = (await api.getLeadPipeline()).stages[1].name;
    } finally {
      await api.dispose();
    }
    const leadData = generateLeadData({ pipelineStage: stage as 'Open' });

    const leadId = await leadsPage.createLead(leadData);
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
    await leadCleanup.track(adminPage, leadId!);

    // Navigate to lead details
    await leadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(adminPage, /leads\/details\//, 20000);

    // WHY: Verify pipeline stage is shown correctly on details page
    await leadsPage.assertPipelineStageOnDetails(stage);
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

  // ── L32 ────────────────────────────────────────────────────

  test('@regression admin should search lead by name and verify in list', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    // WHY the ADM name: a faker first name is shared by many leads, so "a row with this name exists"
    // proved nothing about THIS lead
    const leadData = generateAdminLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(leadData.firstName);
    expect(await leadsPage.getListRowCount(), 'The search leaves only the matching lead').toBe(1);
    expect(await leadsPage.getFirstListLeadId(), 'The listed row is the lead just created').toBe(leadId);
    logger.success('L32 passed');
  });

  // ── L33 ────────────────────────────────────────────────────

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
    logger.success('L33 passed');
  });

  // ── L34 ────────────────────────────────────────────────────

  test('@regression admin should delete a lead and verify it is removed from list', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    // WHY: Use ADM prefix to guarantee uniqueness — only this test creates this lead
    const leadData = generateAdminLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();
    await leadsPage.assertLeadNotInList(leadData.firstName);
    // WHY the server as well: a list search can miss a lead that still exists (index lag)
    const api = await LeadApi.forPage(adminPage);
    try {
      expect((await api.getLead(leadId!)).status, 'Deleted lead should be gone').toBe(404);
    } finally {
      await api.dispose();
    }
    logger.success('L34 passed');
  });

  // ── L35 ────────────────────────────────────────────────────

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
    logger.success('L35 passed');
  });

  // ── L36 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Won via Close Lead dropdown and verify stage', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.markLeadAsStage('Won');
    await leadsPage.assertLeadStageOnDetail('Won');
    await assertStagePersisted(adminPage, leadId!, 'Won');
    logger.success('L36 passed');
  });

  // ── L37 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Lost via Close Lead dropdown select reason and verify stage', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.markLeadAsStage('Closed Lost');
    await leadsPage.assertLeadStageOnDetail('Closed Lost');
    await assertStagePersisted(adminPage, leadId!, 'Closed Lost');
    logger.success('L37 passed');
  });

  // ── L38 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Unqualified via Close Lead dropdown select reason and verify stage', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.markLeadAsStage('Closed Unqualified');
    await leadsPage.assertLeadStageOnDetail('Closed Unqualified');
    await assertStagePersisted(adminPage, leadId!, 'Closed Unqualified');
    logger.success('L38 passed');
  });

  // ── L40 ───────────────────────────────────────────────────

  test('@regression admin should reassign lead to restricted user and verify owner changed', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await leadsPage.getLoggedInUserName('restricted');
    // Tracked with the admin's token: it is the one that can read the lead after the reassign
    await leadCleanup.track(adminPage, leadId!);
    await leadsPage.reassignLead(restrictedUserName);
    await leadsPage.assertOwnerOnDetail(restrictedUserName);
    // WHY the server: the owner name on the page is an unscoped text match
    await leadsPage.goToLeadsList();
    const adminApi = await LeadApi.forPage(adminPage);
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      expect((await adminApi.getLeadOrThrow(leadId!)).ownerId, 'Owner stored on the lead').toBe(
        await restrictedApi.getMyUserId()
      );
    } finally {
      await adminApi.dispose();
      await restrictedApi.dispose();
    }
    logger.success('L40 passed');
  });

  // ── L41 ───────────────────────────────────────────────────

  test('@regression admin should get validation error when saving lead without lastName', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    const createPosts: string[] = [];
    adminPage.on('request', (request) => {
      if (request.method() === 'POST' && /\/v1\/leads\/?(?:\?|$)/.test(request.url())) {
        createPosts.push(request.url());
      }
    });
    // WHY: Only fill firstName — leave lastName empty to trigger validation
    await leadsPage.fillLeadForm({ ...generateLeadData(), lastName: '' });
    await leadsPage.clickSaveExpectingClientValidation();
    await leadsPage.assertValidationError('required');
    expect(createPosts, 'The form should not send a create request without a last name').toHaveLength(0);
    logger.success('L41 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 9 fields exist only on QA today (2026-07-08) and are expected
  // on Stage/Prod later with identical names — see LeadsPage/BasePage's
  // custom-field helpers for the environment-safety skip logic that makes
  // these tests (and every other Lead create/update path) work unchanged
  // once that happens.

  // ── L43 ───────────────────────────────────────────────────

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
    logger.success('L43 passed');
  });

  // ── L44 ───────────────────────────────────────────────────

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
    logger.success('L44 passed');
  });

  // ── L45 ───────────────────────────────────────────────────

  // WHY three tests, not one loop (hardened 2026-10-30): the old single test filled the whole form
  // three times inside one time budget, so a slow environment made it time out, and it could not say
  // which case failed. Each invalid value is now its own test.
  // WHY Number is excluded: confirmed live (2026-07-08) it renders as a native <input type="number">,
  // which rejects non-numeric characters before the app sees them, so there is no UI path to test.
  const invalidCustomFieldCases: Array<{
    key: string;
    description: string;
    customFieldOverrides: Partial<LeadCustomFieldData>;
    // true when only the server rejects the value (no inline check in the form)
    serverSideOnly: boolean;
    assertError: (leadsPage: LeadsPage) => Promise<void>;
  }> = [
    {
      key: 'text',
      description: 'a text field longer than 255 characters',
      customFieldOverrides: { textField: generateLeadCustomFieldInvalidTextField() },
      serverSideOnly: false,
      assertError: (leadsPage) =>
        leadsPage.assertCustomFieldValidationError(
          LEAD_CUSTOM_FIELD_NAMES.textField,
          'Enter value having maximum 255 characters',
          'Text Field'
        ),
    },
    {
      key: 'url',
      description: 'a malformed website address',
      customFieldOverrides: { urlField: generateLeadCustomFieldInvalidUrl() },
      serverSideOnly: false,
      assertError: (leadsPage) =>
        leadsPage.assertCustomFieldValidationError(
          LEAD_CUSTOM_FIELD_NAMES.urlField,
          'Enter a valid URL',
          'URL Field'
        ),
    },
    {
      // WHY server-side only: confirmed live — unlike the other two, a paragraph has NO client-side
      // length check; only the server rejects it on Save and the page shows a generic toast.
      key: 'paragraph',
      description: 'a paragraph longer than 2,550 characters',
      customFieldOverrides: { paragraphText: generateLeadCustomFieldInvalidParagraphText() },
      serverSideOnly: true,
      assertError: (leadsPage) =>
        leadsPage.assertFormErrorToast('Uhoh! Your data is invalid', 'lead create form'),
    },
  ];

  for (const testCase of invalidCustomFieldCases) {
    // WHAT: an admin cannot save a lead whose custom field holds an invalid value, and nothing is saved.
    // WHY: bad values in custom fields corrupt reports and imports that rely on their format.
    // HOW: UI — the field's error appears (inline, or a toast for the paragraph); the form is still
    //   open; no lead was created: no create request was sent (inline cases) or the create request
    //   was refused (paragraph), and no lead exists under the name used.
    test(`@regression admin cannot save a lead with ${testCase.description} in a custom field`, async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const leadsPage = new LeadsPage(adminPage);
      const api = await LeadApi.forPage(adminPage);
      try {
        const leadData = generateAdminLeadData({
          customFields: generateLeadCustomFieldData(testCase.customFieldOverrides),
        });
        const createPosts: string[] = [];
        adminPage.on('request', (request) => {
          if (request.method() === 'POST' && /\/v1\/leads\/?(?:\?|$)/.test(request.url())) {
            createPosts.push(request.url());
          }
        });

        await leadsPage.goToLeadsList();
        await leadsPage.clickAddLead();
        await leadsPage.skipIfCustomFieldsAbsent();
        await leadsPage.fillLeadForm(leadData);

        if (testCase.serverSideOnly) {
          const response = await leadsPage.clickSaveAndCaptureCreateResponse();
          expect(response.status, 'The server should refuse the invalid value').toBeGreaterThanOrEqual(400);
        } else {
          await leadsPage.clickSaveExpectingClientValidation();
          expect(createPosts, 'The form should not send a create request').toHaveLength(0);
        }
        await testCase.assertError(leadsPage);

        const saved = await api.searchLeads(LeadApi.rule('firstName', 'equal', leadData.firstName));
        expect(saved.totalElements, 'No lead should have been saved').toBe(0);
      } finally {
        await api.dispose();
      }
      logger.success(`L45 passed (${testCase.key})`);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Lookup Custom Fields ("Company Lookup" / "Contact Lookup")
  // ──────────────────────────────────────────────────────────
  // WHY: two custom entity-LOOKUP fields in "Other Details" (confirmed live
  // 2026-07-21 — present on QA, absent on Stage/Prod for now, where the
  // presence-guard skips ONLY the lookup-specific steps/assertions, not the
  // whole test). Unlike the 9 text/picklist custom fields these are live,
  // server-side, RBAC-scoped searches.

  // ── L46 ──────────────────────────────────────────────────

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
    reportCreatedRecord('contact', contactId);
    expect(contactId, 'Contact should be created').not.toBeNull();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    reportCreatedRecord('company', companyId);
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
      expect(config.env, 'Company Lookup field must exist on QA').not.toBe('qa');
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
      expect(config.env, 'Contact Lookup field must exist on QA').not.toBe('qa');
      logger.info(
        'Contact Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }

    logger.success('L46 passed');
  });

  // ── L47 ──────────────────────────────────────────────────

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
    reportCreatedRecord('contact', contactId);
    expect(contactId, 'Contact should be created').not.toBeNull();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    reportCreatedRecord('company', companyId);
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
      expect(config.env, 'Company Lookup field must exist on QA').not.toBe('qa');
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
      expect(config.env, 'Contact Lookup field must exist on QA').not.toBe('qa');
      logger.info(
        'Contact Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }

    logger.success('L47 passed');
  });

  // ── Hide Empty Fields — L48-L51 ─────────────────────────────
  // WHY these 4 tests, this shape, confirmed live during investigation:
  // - Tabs are the granularity, not individual fields at the top level —
  //   a tab with ZERO populated fields collapses entirely; a tab with AT
  //   LEAST ONE populated field stays visible, hiding only its own empty
  //   fields.
  // - Social (Facebook/Twitter/LinkedIn) is the one tab this factory can
  //   make GENUINELY, fully empty — Timezone/Country/Company Industry/
  //   Business Type/Company Employees/Campaign/Source/Products/Currency/
  //   PickList/MultiPickList are all confirmed live to be unconditionally
  //   random-picked by fillLeadForm() regardless of factory input (the same
  //   class of gap already fixed with skipOptionalFields on CallLogsPage),
  //   so those tabs can never be driven to a true 100%-empty state without
  //   a similar structural fix — out of scope here, not needed for this
  //   feature's coverage.
  // - Professional/Requirement/Other Details are the MIXED-state targets:
  //   generateMinimalLeadData() blanks companyName/department/designation/
  //   companyAddress/City/State/Zipcode/Website but leaves Company Industry/
  //   Business Type/Company Employees/Annual Revenue populated (Professional
  //   stays visible); blanks requirementName but leaves Products/Currency/
  //   Budget populated (Requirement stays visible); blanks textField/
  //   paragraphText/urlField but leaves Number/Checkbox/Date/DateTimePicker/
  //   PickList/MultiPickList populated (Other Details stays visible).

  test('@regression admin should hide empty fields/tabs on a lead with a minimal, genuinely-empty Social tab', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();

    // Social tab is 100% empty — must fully collapse
    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');

    // Professional/Requirement/Other Details are MIXED — tab stays visible
    await leadsPage.assertTabVisible('Professional');
    await leadsPage.assertTabVisible('Requirement');
    await leadsPage.assertTabVisible('Other Details');

    logger.success('L48 passed');
  });

  test('@regression admin should restore all hidden fields/tabs after toggling Hide Empty Fields off', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');

    // Toggle OFF — Social must reappear
    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabVisible('Social');

    logger.success('L49 passed');
  });

  test('@regression admin should hide only empty fields within a mixed section, keeping the section itself visible', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();

    // Professional tab: Company Industry/Business Type/Company Employees
    // stay populated (unconditionally random-picked), so the tab itself
    // must stay visible — but Company Name/Department/Designation (blanked
    // by generateMinimalLeadData()) must individually disappear.
    await leadsPage.assertTabVisible('Professional');
    const professionalTab = adminPage
      .locator('a.nav-item.nav-link, a.nav-link')
      .filter({ hasText: 'Professional' });
    await professionalTab.click();
    await leadsPage.assertFieldLabelHidden('Company Name');
    await leadsPage.assertFieldLabelHidden('Department');
    await leadsPage.assertFieldLabelHidden('Designation');
    await leadsPage.assertFieldLabelVisible('Company Industry');
    await leadsPage.assertFieldLabelVisible('Business Type');
    await leadsPage.assertFieldLabelVisible('Company Employees');

    logger.success('L50 passed');
  });

  test('@regression admin should auto-reveal a hidden field/tab immediately after editing it, without re-toggling', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');

    // Edit: set Facebook to a real value (Twitter/LinkedIn stay blank —
    // confirms auto-reveal is genuinely per-field/tab-content-driven, not a
    // stale one-time snapshot)
    const newFacebook = `https://facebook.com/revealed.${Date.now()}`;
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm({ ...leadData, facebook: newFacebook });
    await leadsPage.saveEditedLead();

    // No re-toggle here — auto-reveal must happen on its own. Assert the
    // actual VALUE text (not a guessed field label) — matches the proven
    // assertDetailTabContent() convention used elsewhere in this file.
    await leadsPage.assertTabVisible('Social');
    await leadsPage.assertDetailTabContent('nav-tab2-tab', [newFacebook]);

    logger.success('L51 passed');
  });
  // ──────────────────────────────────────────────────────────
  // Lead set-up service (API) used by the tests below
  // ──────────────────────────────────────────────────────────

  // ── L52 ───────────────────────────────────────────────────

  // WHAT: the back-end service the tests use to set up leads really creates, reads, changes and
  //   deletes an admin lead (the delete is also what the opt-in cleanup, CLEANUP_TEST_DATA=1, relies on).
  // WHY: many tests now start from a lead made this way; if it silently produced the wrong data,
  //   every one of them would test the wrong thing.
  // HOW: each step is read back from the server (owner, names, changed name, 404 after delete).
  test('@regression admin can create, read, change and delete a lead through the set-up service the tests rely on', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const leadData = generateAdminLeadData();
      const created = await api.createLead({
        firstName: leadData.firstName,
        lastName: leadData.lastName,
      });
      await leadCleanup.track(adminPage, created.id);

      const read = await api.getLeadOrThrow(created.id);
      expect(read.firstName).toBe(leadData.firstName);
      expect(read.lastName).toBe(leadData.lastName);
      expect(read.ownerId, 'Lead created by the admin should be owned by the admin').toBe(
        await api.getMyUserId()
      );

      const updated = await api.updateLead(created.id, { lastName: 'ApiUpdated' });
      expect(updated.status, 'Changing the lead should succeed').toBe(200);
      expect((await api.getLeadOrThrow(created.id)).lastName).toBe('ApiUpdated');

      expect((await api.deleteLead(created.id)).status).toBe(200);
      const gone = await api.getLead(created.id);
      expect(gone.status, 'Deleted lead should no longer be readable').toBe(404);
      expect(gone.body.code).toBe('000010');
    } finally {
      await api.dispose();
    }
    logger.success('L52 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Duplicate detection, validation and data handling
  // ──────────────────────────────────────────────────────────

  // ── L54 ───────────────────────────────────────────────────

  // WHAT: an admin cannot create a lead with an e-mail that another lead already uses. The form says
  //   so on the e-mail field ("Lead with this email already exists") and in the summary at the bottom
  //   ("Emails Lead with email already exists", 1 of 1), and its "View Lead" link lists the lead that
  //   already has that e-mail.
  // WHY: duplicate leads split one customer's history across two records and get worked twice; the
  //   link is how a user finds the original instead of guessing.
  // HOW: precondition — the account's lead uniqueness setting includes e-mail (read, never changed); UI — the field error, the summary text and its (1/1) count, the "View Lead" link opened in
  //   its own tab shows the existing lead; no create request is sent; server — creating the same lead
  //   directly is refused (status and error code only — that response's message wording has a known
  //   defect, tracked outside this repo); persisted — no lead exists under the refused name.
  test('@regression admin cannot create a lead with an e-mail that another lead already uses', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      // WHY a precondition: this test is about the duplicate check, which is an ACCOUNT setting. If someone
      // switches it off (NONE) the duplicate is really created and the test would fail for a reason that is
      // not a defect. The test only reads the setting; it never changes it.
      const uniquenessField = await api.getUniquenessField();
      expect(
        uniquenessField,
        `precondition: lead duplicate check for e-mail is disabled on this account (uniqueness setting is "${uniquenessField}", expected one that includes EMAIL)`
      ).toMatch(/EMAIL/);
      const existing = generateAdminLeadData();
      const created = await api.createLead({
        firstName: existing.firstName,
        lastName: existing.lastName,
        emails: [{ type: 'OFFICE', value: existing.email, primary: true }],
      });
      await leadCleanup.track(adminPage, created.id);

      // WHY a unique name: the check at the end looks for a lead with this exact name, and faker first
      // names are shared by many existing leads
      const duplicate = generateAdminLeadData({
        firstName: `${existing.firstName}dup`,
        email: existing.email,
      });
      const createPosts: string[] = [];
      adminPage.on('request', (request) => {
        if (request.method() === 'POST' && /\/v1\/leads\/?(?:\?|$)/.test(request.url())) {
          createPosts.push(request.url());
        }
      });

      await leadsPage.clickAddLead();
      await leadsPage.fillFormField('firstName', duplicate.firstName);
      await leadsPage.fillFormField('lastName', duplicate.lastName);
      await leadsPage.addEmail(0, existing.email);
      await leadsPage.assertFieldInlineError('emails[0].value', 'Lead with this email already exists');
      await leadsPage.assertFormErrorSummary('Emails Lead with email already exists');
      await leadsPage.assertViewLeadLinkTargets(existing.email);
      // The link opens the Leads list for that e-mail: the existing lead is listed
      await expect
        .poll(async () => leadsPage.getLeadIdsListedByViewLeadLink(), {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'The "View Lead" list should show the existing lead (search index lag)',
        })
        .toContain(created.id);

      await leadsPage.clickSaveExpectingClientValidation();
      expect(createPosts, 'The form should not send a create request for a duplicate e-mail').toHaveLength(0);

      const refused = await api.createLeadRaw({
        firstName: duplicate.firstName,
        lastName: duplicate.lastName,
        emails: [{ type: 'OFFICE', value: existing.email, primary: true }],
      });
      expect(refused.status).toBe(400);
      expect(refused.body.code, 'Duplicate-e-mail error code').toBe('002019');

      const saved = await api.searchLeads(LeadApi.rule('firstName', 'equal', duplicate.firstName));
      expect(saved.totalElements, 'No lead should exist under the refused name').toBe(0);
    } finally {
      await api.dispose();
    }
    logger.success('L54 passed');
  });

  // ── L55 ───────────────────────────────────────────────────

  // WHAT: an admin cannot save a first name, last name or zipcode longer than the allowed length. A
  //   too-long last name alone shows "Enter value having maximum 255 characters" on the field and
  //   "Last Name Enter value having maximum 255 characters" (1 of 1) in the summary at the bottom.
  // WHY: over-long text breaks list layouts and exports, and silently cut-off data loses information.
  // HOW: UI — the exact field message, the summary text and its (1/1) count for the last name alone,
  //   then the same field message on first name and zipcode; no create request is sent; server — the
  //   same over-long name is refused with the field named (not the top-level message, which is wrong
  //   for a length error — a known defect tracked outside this repo); persisted — nothing was saved.
  //   The limit is read from the live form layout, never hardcoded.
  test('@regression admin cannot save a first name, last name or zipcode that is longer than allowed', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const limit = await api.getEditLayoutFieldLength('firstName');
      const tooLong = 'A'.repeat(limit + 1);
      const message = `Enter value having maximum ${limit} characters`;
      const createPosts: string[] = [];
      adminPage.on('request', (request) => {
        if (request.method() === 'POST' && /\/v1\/leads\/?(?:\?|$)/.test(request.url())) {
          createPosts.push(request.url());
        }
      });

      await leadsPage.clickAddLead();
      // The last name is the ONLY thing typed, so its error is the only one and the summary counts 1/1
      // (if First Name were typed first, the summary would still show the earlier "required" error)
      await leadsPage.fillFormField('lastName', tooLong);
      await leadsPage.assertFieldInlineError('lastName', message);
      await leadsPage.assertFormErrorSummary(`Last Name ${message}`);

      await leadsPage.disableRequiredFieldsToggle();
      for (const fieldName of ['firstName', 'zipcode']) {
        await leadsPage.fillFormField(fieldName, tooLong);
        await leadsPage.assertFieldInlineError(fieldName, message);
      }
      await leadsPage.clickSaveExpectingClientValidation();
      expect(createPosts, 'The form should not send a create request while fields are too long').toHaveLength(0);

      const refused = await api.createLeadRaw({ firstName: tooLong, lastName: 'Limit' });
      expect(refused.status).toBe(400);
      expect(refused.body.errorDetails).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'firstName', message: `size must be between 0 and ${limit}` }),
        ])
      );
      const saved = await api.searchLeads(LeadApi.rule('firstName', 'equal', tooLong));
      expect(saved.totalElements, 'No lead should exist with the refused name').toBe(0);
    } finally {
      await api.dispose();
    }
    logger.success('L55 passed');
  });

  // ── L56 ───────────────────────────────────────────────────

  // WHAT: an admin cannot save a lead with an invalid e-mail, website address or phone number, and
  //   an existing lead is left untouched by such an attempt.
  // WHY: bad contact details make a lead impossible to reach and pollute e-mail and call campaigns.
  // HOW: UI — the form shows "Enter a valid Email" and "Enter a valid URL"; server — changing an
  //   existing lead to each bad value is refused with a specific error code; persisted — the lead's
  //   e-mails, website and phone numbers are unchanged afterwards.
  test('@regression admin cannot save a lead with an invalid e-mail, website address or phone number', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      await leadsPage.clickAddLead();
      await leadsPage.disableRequiredFieldsToggle();
      await leadsPage.addEmail(0, 'not-an-email');
      await leadsPage.assertFieldInlineError('emails[0].value', 'Enter a valid Email');
      await leadsPage.fillFormField('facebook', 'not a url');
      await leadsPage.assertFieldInlineError('facebook', 'Enter a valid URL');

      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      const before = await api.getLeadOrThrow(created.id);

      const badEmail = await api.updateLead(created.id, {
        emails: [{ type: 'OFFICE', value: 'not-an-email', primary: true }],
      });
      expect(badEmail.status).toBe(400);
      expect(badEmail.body.code).toBe('000009');

      const badUrl = await api.updateLead(created.id, { facebook: 'not a url' });
      expect(badUrl.status).toBe(400);
      expect(badUrl.body.code).toBe('000009');
      expect(badUrl.body.errorDetails).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'facebook' })])
      );

      const badPhone = await api.updateLead(created.id, {
        phoneNumbers: [{ type: 'MOBILE', code: 'IN', value: 'abc', dialCode: '+91', primary: true }],
      });
      expect(badPhone.status).toBe(400);
      expect(badPhone.body.code).toBe('002008');

      const after = await api.getLeadOrThrow(created.id);
      expect(after.emails, 'E-mails must be unchanged after the refused changes').toEqual(before.emails);
      expect(after.facebook).toEqual(before.facebook);
      expect(after.phoneNumbers).toEqual(before.phoneNumbers);
    } finally {
      await api.dispose();
    }
    logger.success('L56 passed');
  });

  // ── L57 ───────────────────────────────────────────────────

  // WHAT: an admin can save a lead whose name has extra spaces, an apostrophe and non-English
  //   characters; the spaces are removed and everything else is kept exactly as typed.
  // WHY: real customers have names like O'Brien or नमस्ते — a form that mangles or rejects them loses
  //   the very lead it was meant to capture.
  // HOW: the lead is created through the form and read back from the server.
  test('@regression admin can save a lead name with extra spaces, an apostrophe and non-English characters', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const api = await LeadApi.forPage(adminPage);
    try {
      const base = generateAdminLeadData();
      const leadData = {
        ...base,
        firstName: `  ${base.firstName}  `,
        lastName: "O'Brien-नमस्ते  ",
      };
      await leadsPage.goToLeadsList();
      const leadId = await leadsPage.createLead(leadData);
      expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
      await leadCleanup.track(adminPage, leadId!);

      const saved = await api.getLeadOrThrow(leadId!);
      expect(saved.firstName).toBe(base.firstName);
      expect(saved.lastName).toBe("O'Brien-नमस्ते");
    } finally {
      await api.dispose();
    }
    logger.success('L57 passed');
  });

  // ── L58 ───────────────────────────────────────────────────

  // WHAT: an admin can save a lead with two e-mail addresses and the first one stays the primary.
  // WHY: customers have work and personal addresses; if the second is dropped or becomes the
  //   primary, campaigns go to the wrong inbox.
  // HOW: the lead is created through the form and both addresses and their primary flags are read
  //   back from the server.
  test('@regression admin can save a lead with two e-mails and the first one stays primary', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const api = await LeadApi.forPage(adminPage);
    try {
      const leadData = generateAdminLeadData();
      const secondEmail = uniqueEmail('second');
      await leadsPage.goToLeadsList();
      await leadsPage.clickAddLead();
      await leadsPage.fillLeadForm(leadData);
      await leadsPage.addEmail(1, secondEmail);
      const leadId = await leadsPage.saveLead();
      expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
      await leadCleanup.track(adminPage, leadId!);

      const saved = await api.getLeadOrThrow(leadId!);
      expect(saved.emails?.map((e) => e.value.toLowerCase())).toEqual([
        leadData.email.toLowerCase(),
        secondEmail.toLowerCase(),
      ]);
      expect(saved.emails?.map((e) => e.primary)).toEqual([true, false]);
    } finally {
      await api.dispose();
    }
    logger.success('L58 passed');
  });

  // ── L59 ───────────────────────────────────────────────────

  // WHAT: an admin can save the sub source and the five campaign tracking fields on a lead.
  // WHY: marketing relies on these fields to know which campaign produced a lead; if they are lost,
  //   campaign results cannot be measured.
  // HOW: the lead is created through the form and every tracking value is read back from the server.
  test('@regression admin can save the sub source and all five campaign tracking fields on a lead', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const api = await LeadApi.forPage(adminPage);
    try {
      const leadData = generateAdminLeadData();
      const stamp = Date.now();
      const tracking = {
        subSource: `sub${stamp}`,
        utmSource: `src${stamp}`,
        utmCampaign: `cmp${stamp}`,
        utmMedium: `med${stamp}`,
        utmContent: `con${stamp}`,
        utmTerm: `trm${stamp}`,
      };
      await leadsPage.goToLeadsList();
      await leadsPage.clickAddLead();
      await leadsPage.fillLeadForm(leadData);
      for (const [fieldName, value] of Object.entries(tracking)) {
        await leadsPage.fillFormField(fieldName, value);
      }
      const leadId = await leadsPage.saveLead();
      expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
      await leadCleanup.track(adminPage, leadId!);

      const saved = await api.getLeadOrThrow(leadId!);
      for (const [fieldName, value] of Object.entries(tracking)) {
        expect(saved[fieldName], `Saved ${fieldName}`).toBe(value);
      }
    } finally {
      await api.dispose();
    }
    logger.success('L59 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline: attach, close and reopen
  // ──────────────────────────────────────────────────────────

  // ── L60 ───────────────────────────────────────────────────

  // WHAT: an admin can add a pipeline to a lead that has none, and only then does the Close Lead
  //   button appear.
  // WHY: a lead without a pipeline cannot be moved through stages or closed; users must be able to
  //   fix such leads (for example ones that came in from an integration).
  // HOW: server — the lead has no pipeline before and a stage after; UI — Close Lead is absent
  //   before and present after a reload.
  test('@regression admin can add a pipeline to a lead that has none, which makes the Close Lead button appear', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);

      const before = await api.getLeadPipelineOf(created.id);
      expect(before.status, 'A lead created without a pipeline has none').toBe(400);
      expect(before.body.code).toBe('002056');

      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertCloseLeadControlVisible(false);
      await leadsPage.attachPipelineFromDetail('Open');

      const attached = await api.getLeadOrThrow(created.id);
      expect(attached.pipeline?.stage.name).toBe('Open');
      expect((await api.getLeadPipelineOf(created.id)).status).toBe(200);
      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertCloseLeadControlVisible(true);
    } finally {
      await api.dispose();
    }
    logger.success('L60 passed');
  });

  // ── L61 ───────────────────────────────────────────────────

  // WHAT: a closed lead can be reopened by moving it back to an open stage.
  // WHY: leads are closed by mistake or customers come back; if a closed lead were stuck, the
  //   business would have to re-enter it and lose its history.
  // HOW: server — the lead is Closed Lost, then Open after the change; UI — the Close Lead button is
  //   absent while closed and returns after reopening (after a reload).
  test('@regression a closed lead can be reopened by moving it back to an open stage', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      await api.attachPipeline(created.id, 'Open');
      await api.closeLead(created.id, 'Closed Lost');
      expect((await api.getLeadOrThrow(created.id)).pipeline?.stage.name).toBe('Closed Lost');

      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertCloseLeadControlVisible(false);

      await leadsPage.clickEditIcon();
      await leadsPage.changePipelineStageInEdit('Open');
      await leadsPage.saveEditedLead();

      expect((await api.getLeadOrThrow(created.id)).pipeline?.stage.name).toBe('Open');
      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertCloseLeadControlVisible(true);
    } finally {
      await api.dispose();
    }
    logger.success('L61 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Conversion
  // ──────────────────────────────────────────────────────────

  // ── L62 ───────────────────────────────────────────────────

  // WHAT: converting a lead to contact, company and deal creates all three, linked to the lead, and
  //   the lead is marked won and converted.
  // WHY: conversion is how a lead becomes revenue; a conversion that loses a record or the link
  //   between them breaks sales reporting.
  // HOW: server — the lead's own data lists the deal, contact and company, each is read back (deal
  //   name, contact name equal to the lead's, deal linked to the contact) and the lead is Won;
  //   UI — the "Lead Converted" badge shows after a reload. The records the conversion creates are
  //   logged at teardown (and deleted with the lead only when CLEANUP_TEST_DATA=1).
  test('@regression converting a lead to contact, company and deal creates all three, linked to the lead', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      await api.attachPipeline(created.id, 'Open');

      const dealName = `Deal-${Date.now()}`;
      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.convertLeadToAll(dealName);

      const converted = await api.getLeadOrThrow(created.id);
      expect(converted.convertedAt, 'convertedAt').toBeTruthy();
      expect(converted.convertedBy, 'convertedBy').toBe(await api.getMyUserId());
      expect(converted.pipeline?.stage.name, 'A converted lead is moved to Won').toBe('Won');
      const links = Object.fromEntries((converted.conversionDetails ?? []).map((l) => [l.entityType, l.entityId]));
      expect(Object.keys(links).sort()).toEqual(['COMPANY', 'CONTACT', 'DEAL']);

      const deal = await api.getRecord('deals', links.DEAL);
      expect(deal.status).toBe(200);
      expect(deal.body.name).toBe(dealName);
      const contact = await api.getRecord('contacts', links.CONTACT);
      expect(contact.status).toBe(200);
      expect(`${contact.body.firstName} ${contact.body.lastName}`).toBe(`${seed.firstName} ${seed.lastName}`);
      expect((await api.getRecord('companies', links.COMPANY)).status).toBe(200);
      expect(deal.body.associatedContacts).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: links.CONTACT })])
      );
      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertLeadConvertedBadge();
    } finally {
      await api.dispose();
    }
    logger.success('L62 passed');
  });

  // ── L63 ───────────────────────────────────────────────────

  // WHAT: converting a lead without creating anything marks it as converted and won, and links it
  //   to no contact, company or deal.
  // WHY: some leads only need closing out; if "convert only" silently created records, the CRM
  //   would fill with stray contacts, companies and deals.
  // HOW: UI — the confirmation question is answered; server — the lead is converted, Won, and its
  //   own data lists no linked records (not a search, which could miss them); UI — the badge shows
  //   after a reload.
  test('@regression converting a lead without creating anything marks it as converted only', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      await api.attachPipeline(created.id, 'Open');
      expect((await api.getLeadOrThrow(created.id)).convertedAt).toBeUndefined();

      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.convertLeadWithoutEntities();

      const converted = await api.getLeadOrThrow(created.id);
      expect(converted.convertedAt, 'convertedAt').toBeTruthy();
      expect(converted.convertedBy).toBe(await api.getMyUserId());
      expect(converted.pipeline?.stage.name).toBe('Won');
      expect(converted.conversionDetails ?? [], 'No contact, company or deal link').toHaveLength(0);
      await leadsPage.goToLeadDetailsById(created.id);
      await leadsPage.assertLeadConvertedBadge();
    } finally {
      await api.dispose();
    }
    logger.success('L63 passed');
  });

  // ──────────────────────────────────────────────────────────
  // List view: filter, page size, sort, bulk actions, board view
  // ──────────────────────────────────────────────────────────

  // ── L64 ───────────────────────────────────────────────────

  // WHAT: an admin can filter the lead list by first name and sees only the matching lead.
  // WHY: with thousands of leads, a filter that returns extra or missing rows sends salespeople to
  //   the wrong customer.
  // HOW: a lead with a unique name is created; once searchable (the list reads a search index that
  //   trails a new lead briefly) the UI filter must leave exactly that lead.
  test('@regression admin can filter the lead list by first name and sees only the matching lead', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      await expect
        .poll(async () => (await api.searchLeads(LeadApi.rule('firstName', 'contains', seed.firstName))).totalElements, {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'Lead should become searchable',
        })
        .toBe(1);

      await leadsPage.goToLeadsList();
      await leadsPage.filterListBy('First Name', seed.firstName);
      await leadsPage.waitForListData();
      expect(await leadsPage.getListTotalRecords(), 'Only the matching lead is listed').toBe(1);
      expect(await leadsPage.getListColumnValues('First Name')).toEqual([seed.firstName]);
    } finally {
      await api.dispose();
    }
    logger.success('L64 passed');
  });

  // ── L65 ───────────────────────────────────────────────────

  // WHAT: an admin can change how many leads are shown per page and sort the list by last name in
  //   both directions.
  // WHY: these controls are how people browse a large list; a page that shows the wrong number of
  //   rows or an order that does not match the heading misleads them.
  // HOW: UI only, read-only on lead data — for every page size the control offers, the rows shown
  //   and the footer must match; each sort click must show the heading direction and rows in that
  //   order. Sort and page size are remembered per user, so the original settings are restored.
  test('@regression admin can change how many leads are shown per page and sort the list by last name', async ({
    adminPage,
    leadCleanup,
  }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadCleanup.restoreListPreferencesOnTeardown(adminPage);
    await leadsPage.waitForListData();
    const total = await leadsPage.getListTotalRecords();

    const sizes = await leadsPage.getAvailablePageSizes();
    expect(sizes.length, 'Page size options').toBeGreaterThan(1);
    for (const size of sizes) {
      await leadsPage.selectPageSize(size);
      await leadsPage.waitForListData();
      const rows = await leadsPage.getListRowCount();
      expect(rows, `Rows shown for page size ${size}`).toBe(Math.min(size, total));
      expect(await leadsPage.getListFooterText()).toContain(`Showing 1 - ${rows} of`);
    }

    // The first click starts in one direction, the second flips it — assert whichever applies
    const directionOf = (text: string): 'asc' | 'desc' => (/Ascending/i.test(text) ? 'asc' : 'desc');
    const assertSortedAs = async (direction: 'asc' | 'desc'): Promise<void> => {
      // WHY plain letters only: test data is kept, so the list holds names with apostrophes, spaces and
      // non-English characters whose order depends on the server's collation, not on a rule this test knows.
      // The names made of letters only sort the same everywhere, and a sorted list stays sorted when the
      // other rows are left out — so the order of those names is still a real check of the sort.
      const values = (await leadsPage.getListColumnValues('Last Name'))
        .map((v) => v.toLowerCase())
        .filter((v) => /^[a-z]+$/.test(v));
      expect(values.length, 'Last names made of letters only on this page').toBeGreaterThanOrEqual(3);
      const expected = [...values].sort((a, b) => (direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)));
      expect(values, `Last names in ${direction} order`).toEqual(expected);
    };
    await leadsPage.sortListByColumn('Last Name');
    const firstText = await leadsPage.getListSortedByText();
    expect(firstText).toMatch(/Last Name/i);
    const first = directionOf(firstText);
    await assertSortedAs(first);
    await leadsPage.sortListByColumn('Last Name');
    const second = directionOf(await leadsPage.getListSortedByText());
    expect(second, 'The second click flips the direction').not.toBe(first);
    await assertSortedAs(second);
    logger.success('L65 passed');
  });

  // ── L66 ───────────────────────────────────────────────────

  // WHAT: an admin sees the bulk actions (Email, Update, Whatsapp, Export, Delete) as soon as a lead
  //   is selected, and they disappear when the selection is cleared.
  // WHY: bulk actions change many leads at once; they must only be offered when something is
  //   selected, or users could trigger them on nothing (or on everything).
  // HOW: UI only, read-only — one lead is selected and cleared; no action is clicked.
  test('@regression @prodSafe admin sees the bulk actions when a lead is selected and they disappear when it is cleared', async ({
    adminPage,
  }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.waitForListData();
    const leadId = await leadsPage.getFirstListLeadId();

    await leadsPage.selectLeadRow(leadId);
    await leadsPage.assertSelectedLeadCount(1);
    await leadsPage.assertBulkActionsVisible(['Email', 'Update', 'Whatsapp', 'Export', 'Delete']);
    await leadsPage.deselectLeadRow(leadId);
    await leadsPage.assertBulkBarHidden();
    logger.success('L66 passed');
  });

  // ── L67 ───────────────────────────────────────────────────

  // WHAT: an admin can change the city of two selected leads in one go, then delete both in one go,
  //   and no other lead is touched.
  // WHY: bulk update and delete are the highest-impact actions in the list; a wrong selection would
  //   change or destroy real customer data.
  // HOW: two new leads share a unique name and the list is filtered to exactly them, so nothing else
  //   can be selected. Server — both cities change (the bulk job runs in the background, so it is
  //   polled) and only those two leads hold the new city; then both are deleted (404).
  test('@regression admin can change the city of two selected leads in one go and then delete both', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    try {
      const token = `ADM${Date.now()}bulk`;
      const ids: number[] = [];
      for (const suffix of ['A', 'B']) {
        const created = await api.createLead({ firstName: `${token}${suffix}`, lastName: 'Bulk' });
        await leadCleanup.track(adminPage, created.id);
        ids.push(created.id);
      }
      await expect
        .poll(async () => (await api.searchLeads(LeadApi.rule('firstName', 'contains', token))).totalElements, {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'Both leads should become searchable',
        })
        .toBe(2);

      await leadsPage.goToLeadsList();
      await leadsPage.filterListBy('First Name', token);
      await leadsPage.waitForListData();
      expect(await leadsPage.getListTotalRecords(), 'Only the two new leads are listed').toBe(2);
      for (const id of ids) await leadsPage.selectLeadRow(id);
      await leadsPage.assertSelectedLeadCount(2);

      const newCity = `BulkCity${Date.now()}`;
      await leadsPage.bulkUpdateTextField('City', 'city', newCity);
      for (const id of ids) {
        await expect
          .poll(async () => (await api.getLeadOrThrow(id)).city, { timeout: 60000, intervals: [2000, 3000, 5000] })
          .toBe(newCity);
      }
      const updatedElsewhere = await api.searchLeads(LeadApi.rule('city', 'equal', newCity));
      expect(updatedElsewhere.totalElements, 'Only the two selected leads were updated').toBe(2);

      await leadsPage.goToLeadsList();
      await leadsPage.filterListBy('First Name', token);
      await leadsPage.waitForListData();
      expect(await leadsPage.getListTotalRecords()).toBe(2);
      for (const id of ids) await leadsPage.selectLeadRow(id);
      await leadsPage.assertSelectedLeadCount(2);
      await leadsPage.bulkDeleteSelected(2);
      for (const id of ids) {
        await expect
          .poll(async () => (await api.getLead(id)).status, { timeout: 60000, intervals: [2000, 3000, 5000] })
          .toBe(404);
      }
    } finally {
      await api.dispose();
    }
    logger.success('L67 passed');
  });

  // ── L68 ───────────────────────────────────────────────────

  // WHAT: the lead list can be switched to a board view whose columns are the pipeline stages, and a
  //   lead shows up counted in its own stage.
  // WHY: sales managers run their pipeline from the board; columns that do not match the pipeline,
  //   or a lead in the wrong column, would misreport where deals stand.
  // HOW: server — the pipeline's stage list; UI — the board's columns must equal it in order, and
  //   with the list filtered to one new lead only the Open column counts it. The view mode is
  //   remembered per user, so it is switched back and restored afterwards.
  test('@regression the lead list can be switched to a board view that shows pipeline stages as columns', async ({
    adminPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(adminPage);
    await leadCleanup.restoreListPreferencesOnTeardown(adminPage);
    try {
      const seed = generateAdminLeadData();
      const created = await api.createLead({ firstName: seed.firstName, lastName: seed.lastName });
      await leadCleanup.track(adminPage, created.id);
      await api.attachPipeline(created.id, 'Open');
      const pipeline = await api.getLeadPipeline();
      const openStage = pipeline.stages.find((stage) => stage.name === 'Open')!;
      // The board and its filter read the search index, which trails the write briefly
      await expect
        .poll(
          async () =>
            (await api.searchLeads(LeadApi.rule('firstName', 'contains', seed.firstName))).content[0]
              ?.pipelineStage,
          { timeout: 60000, intervals: [2000, 3000, 5000], message: 'Lead should be indexed in the Open stage' }
        )
        .toBe(openStage.id);

      await leadsPage.openListViewMode('Kanban View');
      const headers = await leadsPage.getKanbanStageHeaders();
      expect(
        headers.map((header) => header.replace(/\s*\(\d+\)\s*$/, '')),
        'Board columns follow the pipeline stages'
      ).toEqual(pipeline.stages.map((stage) => stage.name));

      await leadsPage.filterListBy('First Name', seed.firstName);
      await leadsPage.assertKanbanCardShown(created.id);
      const counts = await leadsPage.getKanbanStageCounts();
      expect(counts['Open'], 'The filtered lead is counted in Open').toBe(1);
      const elsewhere = Object.entries(counts).filter(([stage]) => stage !== 'Open');
      expect(elsewhere.every(([, count]) => count === 0), 'No other stage holds the filtered lead').toBe(true);

      await leadsPage.openListViewMode('List View');
      await leadsPage.waitForListData();
    } finally {
      await api.dispose();
    }
    logger.success('L68 passed');
  });
});
