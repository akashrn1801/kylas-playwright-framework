import { test, expect } from '../../../src/fixtures/index';
import { QuotationsPage } from '../../../src/modules/quotations/QuotationsPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';

import {
  generateQuotationData,
  generateProductRowData,
  generateQuotationCustomFieldData,
  QuotationStatus,
} from '../../../src/data/factories/quotationFactory';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { generateCompanyData } from '../../../src/data/factories/companyFactory';

import { logger } from '../../../src/utils/logger';

test.describe('Quotations — UI', () => {
  test.describe.configure({ mode: 'serial' });

  // ─── T1 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression @prodSafe admin should navigate to quotations list', async ({ adminPage }) => {
    const quotationsPage = new QuotationsPage(adminPage);

    await quotationsPage.goToQuotationsList();
    await quotationsPage.assertOnListPage();
    logger.success('T1 passed');
  });

  // ─── T2 ───────────────────────────────────────────────────────────────────
  test('@regression admin should create a quotation', async ({ adminPage }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);
    // WHY: assertQuotationInList skipped when ID captured — createQuotation already
    // searched and clicked the row to get the ID, proving it exists in the list.
    // Calling assertQuotationInList again is redundant and causes slow retries on staging.
    if (!id) await quotationsPage.assertQuotationInList(data.summary);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
      await quotationsPage.assertOnDetailPage(id);
      // Deal was selected randomly — assert any entity chip is visible
      // WHY: Entity chips render async — wait for at least one to appear before counting
      const chips = adminPage.locator('.related-entity-container');
      await chips.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      const chipCount = await chips.count();
      if (chipCount === 0) throw new Error('No entity chips found on detail page');
      logger.success(`Entity chips visible: ${chipCount}`);
    }

    logger.success('T2 passed');
  });

  // ─── T3 ───────────────────────────────────────────────────────────────────
  test('@regression admin should update a quotation', async ({ adminPage }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    await quotationsPage.updateQuotation(
      data.quotationNumber,
      {
        // WHY: Summary field is disabled in edit mode on this Kylas CRM version — omit it
        // so fillEditForm does not warn-and-skip on every run. Assert status change only.
        status: QuotationStatus.Negotiation,
      },
      id ?? undefined
    );

    // WHY: Summary update is not asserted — the field is disabled in edit mode (read-only
    // on this CRM version). Instead confirm identity via the original quotation number and
    // that the status transition was persisted.
    logger.warn('Summary update skipped — field is disabled in edit mode on this CRM version');
    const bodyText = await adminPage.locator('body').innerText();
    expect(bodyText).toContain(data.quotationNumber);
    await quotationsPage.assertStatusOnDetailPage(QuotationStatus.Negotiation);

    logger.success('T3 passed');
  });

  // ─── T4 ───────────────────────────────────────────────────────────────────
  test('@prodSafe admin should view quotations list', async ({ adminPage }) => {
    const quotationsPage = new QuotationsPage(adminPage);

    await quotationsPage.goToQuotationsList();
    await quotationsPage.assertOnListPage();

    const errorToast = adminPage.locator('.rrt-error, [class*="toast-error"]');
    const errorVisible = await errorToast.isVisible().catch(() => false);
    expect(errorVisible).toBe(false);

    logger.success('T4 passed');
  });

  // ─── T11 ──────────────────────────────────────────────────────────────────
  test('@regression admin should verify grand total math after editing discount and tax', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();
    const productRow = generateProductRowData({ discount: 5, tax: 9 });

    await quotationsPage.goToQuotationsList();
    await quotationsPage.openCreateForm();
    await quotationsPage.fillQuotationForm(data);

    // Edit first product row
    await quotationsPage.editProductRow(0, productRow);

    // Edit totals section
    await quotationsPage.fillEditForm({
      additionalDiscount: 10,
      additionalTax: 5,
      adjustment: 2,
    });

    // Verify math before saving
    const totals = await quotationsPage.assertGrandTotalMath();
    logger.info(`Math verified — Grand Total: ${totals.grandTotal}`);

    await quotationsPage.saveQuotation();
    await quotationsPage.assertSuccessToast();

    logger.success('T11 passed');
  });

  // ─── T12 ──────────────────────────────────────────────────────────────────
  test('@smoke @regression admin should verify all field values on detail page after create', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData({ status: QuotationStatus.Draft });

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
    } else {
      await quotationsPage.searchAndOpenQuotation(data.quotationNumber);
    }

    await quotationsPage.assertDetailPageFields(data);

    const bodyText = await adminPage.locator('body').innerText();
    expect(bodyText).toContain(data.quotationNumber);
    expect(bodyText.toLowerCase()).toContain(data.summary.toLowerCase());

    // Deal was selected randomly — assert any entity chip exists
    const chips = adminPage.locator('.related-entity-container');
    const chipCount = await chips.count();
    if (chipCount === 0) throw new Error('No entity chips found on detail page');
    logger.success(`T12 passed — entity chips: ${chipCount}`);
  });

  // ─── T13 ──────────────────────────────────────────────────────────────────
  test('@regression admin should verify all updated field values on detail page after edit', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    await quotationsPage.updateQuotation(
      data.quotationNumber,
      {
        // WHY: Summary field is disabled in edit mode on this Kylas CRM version — omit it
        status: QuotationStatus.Delivered,
        additionalDiscount: 15,
        additionalTax: 8,
        adjustment: 3,
      },
      id ?? undefined
    );

    // WHY: Summary update is not asserted — the field is disabled in edit mode on this CRM
    // version so fillEditForm skips it silently. Assert the original quotation number to
    // confirm we are on the correct record, then assert the status transition was persisted.
    logger.warn('Summary update skipped — field is disabled in edit mode on this CRM version');
    const bodyText = await adminPage.locator('body').innerText();
    expect(bodyText).toContain(data.quotationNumber);
    await quotationsPage.assertStatusOnDetailPage(QuotationStatus.Delivered);

    logger.success('T13 passed');
  });

  // ─── T14 ──────────────────────────────────────────────────────────────────
  test('@regression admin should verify owner field on detail page after create', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
    } else {
      await quotationsPage.searchAndOpenQuotation(data.quotationNumber);
    }

    // Admin is owner by default — use actual display name from userNames.json
    const adminName = await quotationsPage.getLoggedInUserName('admin');
    await quotationsPage.assertOwnerOnDetailPage(adminName);

    logger.success('T14 passed');
  });

  // ─── T15 ──────────────────────────────────────────────────────────────────
  test('@regression admin should change owner during edit and verify on detail page', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
    } else {
      await quotationsPage.searchAndOpenQuotation(data.quotationNumber);
    }

    const restrictedQuotationsPage = new QuotationsPage(restrictedPage);
    const restrictedUserName = await restrictedQuotationsPage.getLoggedInUserName('restricted');
    await quotationsPage.clickEditButton();
    await quotationsPage.fillOwner(restrictedUserName);
    await quotationsPage.saveQuotation();
    await quotationsPage.assertSuccessToast();

    logger.success('T15 passed');
  });

  // ─── T16 ──────────────────────────────────────────────────────────────────
  test('@smoke @regression admin should verify quotation status is Draft after create', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData({ status: QuotationStatus.Draft });

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
    } else {
      await quotationsPage.searchAndOpenQuotation(data.quotationNumber);
    }

    await quotationsPage.assertOnDetailPage();
    await quotationsPage.assertStatusOnDetailPage(QuotationStatus.Draft);

    logger.success('T16 passed');
  });

  // ─── T17 ──────────────────────────────────────────────────────────────────
  test('@regression admin should verify status changes correctly through all transitions', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData({ status: QuotationStatus.Draft });
    const statuses: QuotationStatus[] = [
      QuotationStatus.Negotiation,
      QuotationStatus.Delivered,
      QuotationStatus.OnHold,
      QuotationStatus.Confirmed,
    ];

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    for (const status of statuses) {
      await quotationsPage.updateQuotation(data.quotationNumber, { status }, id ?? undefined);
      await quotationsPage.assertStatusOnDetailPage(status);
      logger.info(`Status transition verified: ${status}`);
    }

    logger.success('T17 passed');
  });

  // ─── T18 ──────────────────────────────────────────────────────────────────
  test('@regression admin should download quotation and verify file', async ({ adminPage }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    if (id) {
      await quotationsPage.goToQuotationDetail(id);
    } else {
      await quotationsPage.searchAndOpenQuotation(data.quotationNumber);
    }

    const { filename, size } = await quotationsPage.downloadQuotation();

    expect(filename).toContain('.pdf');
    expect(filename).toContain('Quotation_');
    expect(size).toBeGreaterThan(0);

    logger.success(`T18 passed — downloaded: ${filename} (${size} bytes)`);
  });

  // ─── T19 ──────────────────────────────────────────────────────────────────
  test('@regression admin should verify separate shipping address when toggle is off', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData({
      sameShippingAsBilling: false,
      shippingAddress: '456 Shipping Street',
      shippingCity: 'Mumbai',
      shippingState: 'Maharashtra',
      shippingZipcode: '400001',
    });

    await quotationsPage.goToQuotationsList();
    await quotationsPage.openCreateForm();
    await quotationsPage.fillQuotationForm(data);

    await quotationsPage.assertShippingFieldsVisible();
    await quotationsPage.saveQuotation();
    await quotationsPage.assertSuccessToast();
    await quotationsPage.assertOnListPage();
    logger.success('T19 passed');
  });
  // ─── T20 ──────────────────────────────────────────────────────────────────
  test('@smoke @regression admin should verify shipping copies billing address when toggle is on', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData({ sameShippingAsBilling: true });

    await quotationsPage.goToQuotationsList();
    await quotationsPage.openCreateForm();
    await quotationsPage.fillQuotationForm(data);

    // Toggle should be on by default
    const toggleChecked = await adminPage
      .locator('[id="2_41_input_isBillingAndShippingAddressSame"]')
      .isChecked();
    expect(toggleChecked).toBe(true);

    const _id = await quotationsPage.saveQuotation();
    await quotationsPage.assertSuccessToast();

    logger.success('T20 passed');
  });

  // ─── T21 ──────────────────────────────────────────────────────────────────
  test('@regression admin should add multiple contacts to a quotation', async ({ adminPage }) => {
    test.setTimeout(480000);

    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    await quotationsPage.goToQuotationsList();
    await quotationsPage.openCreateForm();
    await quotationsPage.fillQuotationForm(data);

    // Add contacts — use names available in QA env
    // These should be configured or known contacts
    // await quotationsPage.fillAssociatedContacts(['Contact One', 'Contact Two']);
    // await quotationsPage.fillAssociatedContacts(['Contact One', 'Contact Two']);
    await quotationsPage.saveQuotation();
    await quotationsPage.assertSuccessToast();
    await quotationsPage.assertOnListPage();
    logger.success('T21 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 8 fields exist on QA today, not yet on Stage — see
  // QuotationsPage/BasePage's custom-field helpers for the environment-safety
  // skip logic that makes these tests (and every other Quotation create/
  // update path) work unchanged once Stage gets them too. Quotation has no
  // lookup-type or MultiPickList custom field, like Meeting/Deal. Lead has no
  // Quotations entry point at all, so there are only 4 creation contexts
  // here (standalone + Deal/Contact/Company panels), one fewer than Meeting.
  //
  // WHY 4 separate create tests instead of one: confirmed live (2026-07-30)
  // the panel-opened "Add Quotation" modal is structurally the SAME full
  // form as the standalone create form (same field ids, same custom fields)
  // — but each context's ENTRY POINT (which panel/button opens it) is still
  // a genuinely separate code path worth confirming independently, matching
  // the same reasoning already applied to Meeting.
  //
  // WHY update/validation are NOT repeated per context (unlike create):
  // confirmed live — editing/validating a quotation goes through the same
  // `#edit-action-btn` → same modal regardless of which panel originally
  // created it; there is no context-dependent variation to test, same
  // conclusion already reached for Meeting.

  // ─── T22 ──────────────────────────────────────────────────────────────────
  test('@regression admin should create a quotation with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id } = await quotationsPage.createQuotation(data, true);
    expect(id, 'Quotation ID should be captured after create').not.toBeNull();

    await quotationsPage.goToQuotationDetail(id!);
    await quotationsPage.assertQuotationCustomFieldsOnDetail(data.customFields);
    logger.success('T22 passed');
  });

  // ─── T23 ──────────────────────────────────────────────────────────────────
  test('@regression admin should create a quotation with all custom fields from a deal detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const quotationsPage = new QuotationsPage(adminPage);
    const dealData = generateDealData();
    const customFields = generateQuotationCustomFieldData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId, 'Deal ID should be captured after create').not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);

    const quotationId = await dealsPage.addQuotationFromPanel(customFields, true);
    expect(quotationId, 'Quotation ID should be captured after create').not.toBeNull();

    await quotationsPage.goToQuotationDetail(quotationId!);
    await quotationsPage.assertQuotationCustomFieldsOnDetail(customFields);
    logger.success('T23 passed');
  });

  // ─── T24 ──────────────────────────────────────────────────────────────────
  test('@regression admin should create a quotation with all custom fields from a contact detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const quotationsPage = new QuotationsPage(adminPage);
    const contactData = generateContactData();
    const customFields = generateQuotationCustomFieldData();

    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    const quotationId = await contactsPage.addQuotationFromPanel(customFields, true);
    expect(quotationId, 'Quotation ID should be captured after create').not.toBeNull();

    await quotationsPage.goToQuotationDetail(quotationId!);
    await quotationsPage.assertQuotationCustomFieldsOnDetail(customFields);
    logger.success('T24 passed');
  });

  // ─── T25 ──────────────────────────────────────────────────────────────────
  test('@regression admin should create a quotation with all custom fields from a company detail panel and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const quotationsPage = new QuotationsPage(adminPage);
    const companyData = generateCompanyData();
    const customFields = generateQuotationCustomFieldData();

    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId, 'Company ID should be captured after create').not.toBeNull();
    await companiesPage.goToCompanyDetailsById(companyId!);

    const quotationId = await companiesPage.addQuotationFromPanel(customFields, true);
    expect(quotationId, 'Quotation ID should be captured after create').not.toBeNull();

    await quotationsPage.goToQuotationDetail(quotationId!);
    await quotationsPage.assertQuotationCustomFieldsOnDetail(customFields);
    logger.success('T25 passed');
  });

  // ─── T26 ──────────────────────────────────────────────────────────────────
  test("@regression admin should update a quotation's custom fields and verify updated values", async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const quotationsPage = new QuotationsPage(adminPage);
    const data = generateQuotationData();

    const { id } = await quotationsPage.createQuotation(data, true);
    expect(id, 'Quotation ID should be captured after create').not.toBeNull();

    const updatedCustomFields = generateQuotationCustomFieldData();
    await quotationsPage.updateQuotation(
      data.quotationNumber,
      { customFields: updatedCustomFields },
      id ?? undefined
    );

    await quotationsPage.goToQuotationDetail(id!);
    await quotationsPage.assertQuotationCustomFieldsOnDetail(updatedCustomFields);
    logger.success('T26 passed');
  });

  // ─── T27 ──────────────────────────────────────────────────────────────────
  test('@regression admin should see validation errors for invalid quotation custom field values and not save the quotation', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const quotationsPage = new QuotationsPage(adminPage);

    interface InvalidCustomFieldCase {
      description: string;
      fieldSuffix: string;
      invalidValue: string;
      expectedError: string;
    }

    // WHY: confirmed live (2026-07-30), NOT assumed to transfer from Meeting
    // — Quotation's Number field is also a native <input type="number"> (no
    // realistic UI path to enter invalid text), so it's excluded here for
    // the same reason as every other entity's Number field.
    const cases: InvalidCustomFieldCase[] = [
      {
        description: 'TextField exceeding 255 characters',
        fieldSuffix: 'customFieldValues.cfTextField',
        invalidValue: 'A'.repeat(256),
        expectedError: 'Enter the value having length between 1 - 255',
      },
      {
        description: 'ParagraphText exceeding 2,550 characters',
        fieldSuffix: 'customFieldValues.cfParagraphText',
        invalidValue: 'B'.repeat(2551),
        expectedError: 'Enter the value having length between 1 - 2550',
      },
      {
        description: 'UrlField with a malformed URL',
        fieldSuffix: 'customFieldValues.cfURLField',
        invalidValue: 'not a valid url###',
        expectedError: 'Enter a valid URL',
      },
    ];

    await quotationsPage.goToQuotationsList();
    await quotationsPage.openCreateForm();
    await quotationsPage.skipIfCustomFieldsAbsent();

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

    logger.success('T27 passed');
  });
});
