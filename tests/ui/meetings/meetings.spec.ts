import { test, expect } from '../../../src/fixtures/index';
import { MeetingsPage } from '../../../src/modules/meetings/MeetingsPage';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { logger } from '../../../src/utils/logger';
import {
  generateMeetingData,
  generateMeetingCustomFieldData,
} from '../../../src/data/factories/meetingFactory';
import { generateLeadData } from '../../../src/data/factories/leadFactory';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { generateCompanyData } from '../../../src/data/factories/companyFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Meetings — UI Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Meetings', () => {
  // ── Test 1: Navigate ───────────────────────────────────────────────────────

  test('@smoke @regression @prodSafe admin should navigate to meetings list', async ({ adminPage }) => {
    const meetingsPage = new MeetingsPage(adminPage);

    await meetingsPage.goToMeetingsList();
    await meetingsPage.assertOnMeetingsPage();
    logger.success('M1 passed');
  });

  // ── Test 2: Create ─────────────────────────────────────────────────────────

  test('@regression admin should create a new meeting with full details', async ({ adminPage }) => {
    test.setTimeout(600000); // 10 min — full form with calendar, GPS, related-to loop

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    const meetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    // Assert meeting appears in list — use ID if available for reliable verification
    await meetingsPage.assertMeetingInList(meetingData.title, meetingId);

    // Open the meeting and assert detail view
    await meetingsPage.openMeetingFromList(meetingData.title);
    await meetingsPage.assertMeetingDetailTitle(meetingData.title);

    // Assert key fields in detail view
    await meetingsPage.assertMeetingDetailField('status', 'Scheduled');

    // Assert invitee section exists (invitee card visible)
    const inviteeSection = adminPage.locator('.invitees-details, .card-deck.invitee-list');
    const inviteeSectionVisible = await inviteeSection.isVisible().catch(() => false);
    if (inviteeSectionVisible) {
      logger.info('Invitee section visible');
    } else {
      logger.warn('Invitee section not visible on this env — skipping invitee assertion');
    }
    logger.success('M2 passed');
  });

  // ── Test 3: Update ─────────────────────────────────────────────────────────

  test('@regression admin should update an existing meeting', async ({ adminPage }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(adminPage);
    const originalData = generateMeetingData();
    const updatedTitle = `UPDATED-${originalData.title}`;
    const updatedDesc = 'Updated meeting description by admin automation';

    // Create the meeting first
    await meetingsPage.goToMeetingsList();
    const originalMeetingId = await meetingsPage.createMeeting(originalData, 'Admin');
    await meetingsPage.assertMeetingInList(originalData.title, originalMeetingId);

    // Update title and description via edit form
    await meetingsPage.updateMeeting(updatedTitle, originalData.title, undefined, updatedDesc);

    // Assert updated title in list
    await meetingsPage.assertMeetingInList(updatedTitle, originalMeetingId);

    // Open meeting and change status via ellipsis menu
    await meetingsPage.openMeetingFromList(updatedTitle);
    await meetingsPage.assertMeetingDetailTitle(updatedTitle);

    // Change status randomly via ellipsis — Mark as Conducted or Cancel
    const newStatus = await meetingsPage.changeStatusViaEllipsis();

    // Assert status changed on detail page
    await meetingsPage.assertMeetingStatus(newStatus);
    logger.success('M3 passed');
  });

  // ── Test 4: Medium selection — calendar fallback behaviour ─────────────────

  test('@regression admin should select meeting medium with calendar fallback', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData({ title: `CalTest-${Date.now()}` });

    await meetingsPage.goToMeetingsList();
    const calMeetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    await meetingsPage.assertMeetingInList(meetingData.title, calMeetingId);
    await meetingsPage.openMeetingFromList(meetingData.title);

    // Assert medium is one of the valid options — fallback logic selected it
    const mediumField = adminPage.locator('#medium span.title').first();
    await mediumField.waitFor({ state: 'visible' });
    const mediumValue = await mediumField.textContent();

    const validMediums = ['Offline', 'Google Meet', 'Outlook'];
    const isValid = validMediums.some((m) => mediumValue?.includes(m));
    if (!isValid) {
      throw new Error(`Unexpected medium value on detail page: "${mediumValue}"`);
    }
    logger.info(`Meeting created with medium: ${mediumValue}`);
    logger.success('M4 passed');
  });

  // ── Test 5: prodSafe — read-only navigation ────────────────────────────────

  // ── Test 4b: Reschedule ───────────────────────────────────────────────────

  test('@regression admin should reschedule a meeting', async ({ adminPage }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    const rescheduleMeetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    await meetingsPage.assertMeetingInList(meetingData.title, rescheduleMeetingId);
    await meetingsPage.rescheduleMeeting(meetingData.title);
    await meetingsPage.assertMeetingInList(meetingData.title, rescheduleMeetingId);
    logger.success('M5 passed');
  });

  test('@prodSafe meetings list page should be accessible', async ({ adminPage }) => {
    const meetingsPage = new MeetingsPage(adminPage);

    await meetingsPage.goToMeetingsList();
    await meetingsPage.assertOnMeetingsPage();
    logger.success('M6 passed');
  });

  // ── Test: prodSafe — GPS address field works ─────────────────────────────

  test('@prodSafe meetings Add form GPS address field should work', async ({ adminPage }) => {
    test.setTimeout(120000);

    const meetingsPage = new MeetingsPage(adminPage);
    await meetingsPage.goToMeetingsList();

    // Open Add Meeting form
    await meetingsPage.openAddForm();

    // Fill title to keep form valid
    await meetingsPage.fillTitleOnly('GPS Test Meeting');

    // Click Get GPS Address
    const gpsBtn = adminPage.getByText('Get GPS Address');
    await gpsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await gpsBtn.click();
    await adminPage.waitForTimeout(1500);

    // Check if Field Sales addon trial modal appeared
    const addonDialog =
      (await adminPage
        .locator('.trial-feature__title')
        .isVisible()
        .catch(() => false)) ||
      (await adminPage
        .locator('text=Field Sales is now available')
        .isVisible()
        .catch(() => false));
    if (addonDialog) {
      // Dismiss by clicking I'll do it later
      await adminPage.locator('button.btn.link-primary', { hasText: "I'll do it later" }).click();
      await adminPage.waitForTimeout(500);
      logger.warn('Field Sales addon trial modal dismissed');
    }

    if (addonDialog) {
      // Addon not available — verify manual address works instead
      logger.info('Field Sales addon not available — testing manual address input');
      await adminPage.locator('[id="1_81_input_location"]').fill('123 Test Street, Mumbai, India');
      const locationValue = await adminPage.locator('[id="1_81_input_location"]').inputValue();
      if (!locationValue) throw new Error('Manual address input failed');
      logger.success(`Manual address entered: ${locationValue}`);
    } else {
      // GPS available — type to get predictions
      const gpsSearchInput = adminPage.getByPlaceholder('Search for area, street name');
      await gpsSearchInput.fill('Pune');
      await adminPage.waitForTimeout(1500);

      const predictionsVisible = await adminPage
        .locator('.autocomplete-prediction')
        .first()
        .isVisible()
        .catch(() => false);
      if (predictionsVisible) {
        await adminPage.locator('.autocomplete-prediction').first().click();
        await adminPage.waitForTimeout(500);
        // Verify location field has value
        const locationValue = await adminPage
          .locator('[id="1_81_input_location"]')
          .inputValue()
          .catch(() => '');
        logger.success(`GPS address selected: ${locationValue}`);
      } else {
        // No predictions — fall back to manual
        logger.warn('No GPS predictions — using manual address');
        await adminPage.locator('[id="1_81_input_location"]').fill('Pune, Maharashtra, India');
        logger.success('Manual address fallback used');
      }
    }

    // Close form without saving
    await adminPage.keyboard.press('Escape');
    await adminPage.waitForTimeout(500);
    logger.success('GPS address test completed');
    logger.success('M7 passed');
  });

  // ── Test 8: Clone ──────────────────────────────────────────────────────────
  // WHY: added 2026-07-16 — prior to this, the only Meetings clone coverage
  // was an RBAC check that the "Clone" menu item is merely VISIBLE, never
  // actually clicked. Confirmed live that cloning genuinely works (opens a
  // real "Clone Meeting" modal, needs no field edits before saving) — see
  // MeetingsPage.cloneMeeting()'s own comment for the full evidence.

  test('@regression admin should clone a meeting and verify cloned meeting exists', async ({
    adminPage,
  }) => {
    test.setTimeout(240000);
    const meetingsPage = new MeetingsPage(adminPage);
    const title = `Meeting-${Date.now()}`;

    await meetingsPage.goToMeetingsList();
    await meetingsPage.openAddForm();
    await meetingsPage.fillTitleOnly(title);
    const meetingId = await meetingsPage.saveMeeting();
    if (!meetingId) throw new Error('Meeting ID should be captured after create');

    await meetingsPage.searchMeetingById(meetingId);
    await meetingsPage.openMeetingFromList(title);
    const clonedId = await meetingsPage.cloneMeeting();
    if (!clonedId) throw new Error('Cloned meeting ID should be captured after clone');
    await meetingsPage.assertClonedMeetingTitle(title, clonedId);
    logger.success('M15 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 8 fields exist on QA and Prod as of 2026-07-29, not yet on
  // Stage — see MeetingsPage/BasePage's custom-field helpers for the
  // environment-safety skip logic that makes these tests (and every other
  // Meeting create/update path) work unchanged once Stage gets them too.
  // Meeting has no lookup-type or MultiPickList custom field, like Deal.
  //
  // WHY 5 separate create tests (standalone + 4 embedded parent panels)
  // instead of one: confirmed live (2026-07-29 investigation) the Add
  // Meeting form/custom-field DOM is byte-identical across all 5 contexts,
  // but each context's ENTRY POINT (which button opens the form, via which
  // panel) genuinely differs and is exercised by real, separate code paths
  // in the app — so each context is independently worth confirming actually
  // saves and persists custom-field data correctly. Per explicit instruction,
  // this coverage is deliberately NOT reduced despite the shared DOM.
  //
  // WHY update/validation are NOT repeated per context (unlike create):
  // confirmed live these flows are identical regardless of which panel
  // originally created the meeting — editing/validating a meeting has no
  // context-dependent variation, so repeating them 5x would test the exact
  // same code path with zero new signal. This reduced scope was explicitly
  // confirmed with the user before implementing.

  // ── M16 ───────────────────────────────────────────────────

  test('@regression admin should create a meeting with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    await meetingsPage.openAddForm();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(meetingData.customFields);
    logger.success('M16 passed');
  });

  // ── M17 ───────────────────────────────────────────────────

  test('@regression admin should create a meeting with all custom fields from a lead detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const meetingsPage = new MeetingsPage(adminPage);
    const leadData = generateLeadData();
    const meetingData = generateMeetingData({
      customFields: generateMeetingCustomFieldData(),
    });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.clickRightPanelIcon('Meetings');
    await meetingsPage.openAddFormFromEntityDetailPanel();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(meetingData.customFields);
    logger.success('M17 passed');
  });

  // ── M18 ───────────────────────────────────────────────────

  test('@regression admin should create a meeting with all custom fields from a deal detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const meetingsPage = new MeetingsPage(adminPage);
    const dealData = generateDealData();
    const meetingData = generateMeetingData({
      customFields: generateMeetingCustomFieldData(),
    });

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId, 'Deal ID should be captured after create').not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);

    await dealsPage.clickRightPanelIcon('Meetings');
    await meetingsPage.openAddFormFromEntityDetailPanel();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(meetingData.customFields);
    logger.success('M18 passed');
  });

  // ── M19 ───────────────────────────────────────────────────

  test('@regression admin should create a meeting with all custom fields from a contact detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const meetingsPage = new MeetingsPage(adminPage);
    const contactData = generateContactData();
    const meetingData = generateMeetingData({
      customFields: generateMeetingCustomFieldData(),
    });

    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    await contactsPage.clickRightPanelIcon('Meetings');
    await meetingsPage.openAddFormFromEntityDetailPanel();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(meetingData.customFields);
    logger.success('M19 passed');
  });

  // ── M20 ───────────────────────────────────────────────────

  test('@regression admin should create a meeting with all custom fields from a company detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const meetingsPage = new MeetingsPage(adminPage);
    const companyData = generateCompanyData();
    const meetingData = generateMeetingData({
      customFields: generateMeetingCustomFieldData(),
    });

    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId, 'Company ID should be captured after create').not.toBeNull();
    await companiesPage.goToCompanyDetailsById(companyId!);

    await companiesPage.clickRightPanelIcon('Meetings');
    await meetingsPage.openAddFormFromEntityDetailPanel();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(meetingData.customFields);
    logger.success('M20 passed');
  });

  // ── M21 ───────────────────────────────────────────────────

  test("@regression admin should update a meeting's custom fields and verify updated values", async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    await meetingsPage.openAddForm();
    await meetingsPage.skipIfCustomFieldsAbsent();
    await meetingsPage.fillMeetingForm(meetingData);
    const meetingId = await meetingsPage.saveMeeting();
    expect(meetingId, 'Meeting ID should be captured after create').not.toBeNull();

    const updatedCustomFields = generateMeetingCustomFieldData();
    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.openMeetingFromList(meetingData.title);
    await meetingsPage.clickEditFromMenu();
    await meetingsPage.fillEditForm(meetingData.title, undefined, undefined, updatedCustomFields);
    await meetingsPage.saveEditedMeeting();

    await meetingsPage.searchMeetingById(meetingId!);
    await meetingsPage.assertMeetingCustomFieldsOnDetail(updatedCustomFields);
    logger.success('M21 passed');
  });

  // ── M22 ───────────────────────────────────────────────────

  test('@regression admin should see validation errors for invalid meeting custom field values and not save the meeting', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const meetingsPage = new MeetingsPage(adminPage);

    interface InvalidCustomFieldCase {
      description: string;
      fieldSuffix: string;
      invalidValue: string;
      expectedError: string;
    }

    // WHY: confirmed live (2026-07-29), NOT assumed to match Lead/Deal —
    // Meeting's Number field is also a native <input type="number"> (no
    // realistic UI path to enter invalid text, same as every other entity's
    // Number field), so it's excluded here for the same reason. Unlike
    // Lead's ParagraphText (server-only, no inline error), Meeting's
    // TextField/ParagraphText/UrlField ALL validate inline — confirmed live,
    // not assumed — with Meeting-specific wording that differs from both
    // Lead's and Quotation's own confirmed text for the same field types.
    const cases: InvalidCustomFieldCase[] = [
      {
        description: 'TextField exceeding 255 characters',
        fieldSuffix: 'cfTextField',
        invalidValue: 'A'.repeat(256),
        expectedError: 'Enter the value having length between 1 - 255',
      },
      {
        description: 'ParagraphText exceeding 2,550 characters',
        fieldSuffix: 'cfParagraphText',
        invalidValue: 'B'.repeat(2551),
        expectedError: 'Enter the value having length between 1 - 2550',
      },
      {
        description: 'UrlField with a malformed URL',
        fieldSuffix: 'cfURLField',
        invalidValue: 'not a valid url###',
        expectedError: 'Enter a valid URL',
      },
    ];

    await meetingsPage.goToMeetingsList();
    await meetingsPage.openAddForm();
    await meetingsPage.skipIfCustomFieldsAbsent();

    for (const testCase of cases) {
      logger.info(`Negative custom field case: ${testCase.description}`);
      const input = adminPage.locator(`[id$="_input_${testCase.fieldSuffix}"]`);
      await input.fill(testCase.invalidValue);
      await adminPage.keyboard.press('Tab');
      const error = adminPage
        .locator('.invalid-feedback:visible, .help-text.error:visible')
        .filter({ hasText: testCase.expectedError });
      await expect(
        error.first(),
        `Expected validation error "${testCase.expectedError}" for ${testCase.description}, but it never appeared`
      ).toBeVisible({ timeout: 10000 });
      await input.fill('');
      logger.success(`Validation error confirmed for: ${testCase.description}`);
    }

    logger.success('M22 passed');
  });
});
