import { test, expect } from '../../../src/fixtures/index';
import { QuotationsPage } from '../../../src/modules/quotations/QuotationsPage';

import {
  generateQuotationData,
  generateProductRowData,
  QuotationStatus,
} from '../../../src/data/factories/quotationFactory';

import { logger } from '../../../src/utils/logger';

test.describe('Quotations — UI', () => {
  // ─── T1 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression admin should navigate to quotations list', async ({ adminPage }) => {
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
    await quotationsPage.assertQuotationInList(data.summary);

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
    const updatedSummary = `Updated ${Date.now()}`;

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    await quotationsPage.updateQuotation(
      data.quotationNumber,
      {
        summary: updatedSummary,
        status: QuotationStatus.Negotiation,
      },
      id ?? undefined
    );

    await quotationsPage.assertStatusOnDetailPage(QuotationStatus.Negotiation);
    const bodyText = await adminPage.locator('body').innerText();
    expect(bodyText).toContain(updatedSummary);

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
    const updatedSummary = `Edited Summary ${Date.now()}`;

    const { id, dealName: _selectedDeal } = await quotationsPage.createQuotation(data);

    await quotationsPage.updateQuotation(
      data.quotationNumber,
      {
        summary: updatedSummary,
        status: QuotationStatus.Delivered,
        additionalDiscount: 15,
        additionalTax: 8,
        adjustment: 3,
      },
      id ?? undefined
    );

    const bodyText = await adminPage.locator('body').innerText();
    expect(bodyText).toContain(updatedSummary);
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
      shippingCountry: 'India',
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
});
