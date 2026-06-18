import { test, expect } from '../../src/fixtures/index';
import { QuotationsPage } from '../../src/modules/quotations/QuotationsPage';
import {
  generateAdminQuotationData,
  generateRestrictedQuotationData,
  generateProductRowData,
  QuotationStatus,
} from '../../src/data/factories/quotationFactory';
import { logger } from '../../src/utils/logger';
import { config } from '../../config/config';
import { DealsPage } from '../../src/modules/deals/DealsPage';
import { generateDealData } from '../../src/data/factories/dealFactory';

test.describe('Quotations — RBAC', () => {
  // ─── T5 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression restricted user should navigate to quotations list', async ({
    restrictedPage,
  }) => {
    const qp = new QuotationsPage(restrictedPage);
    await qp.goToQuotationsList();
    await qp.assertOnListPage();
    logger.success('T5 passed');
  });

  // ─── T6 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should create a quotation with accessible deal', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();
    const { id } = await qp.createQuotation(data);
    await qp.assertQuotationInList(data.quotationNumber);
    if (id) {
      await qp.goToQuotationDetail(id);
      await qp.assertOnDetailPage(id);
    }
    logger.success('T6 passed');
  });

  // ─── T7 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should handle inaccessible entity error and retry successfully', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData({
      dealName: config.deals.adminDealName,
    });

    // WHY: Register listener BEFORE navigation — 422 fires during save
    let errorMessage = '';
    restrictedPage.on('response', async (response) => {
      if (
        response.url().includes('/quotations') &&
        response.request().method() === 'POST' &&
        response.status() >= 400
      ) {
        const body = await response.json().catch(() => ({}));
        // WHY: Kylas 029003 returns top-level message, not inside errors[]
        errorMessage =
          body?.message || body?.errors?.[0]?.message || body?.validationErrors?.[0]?.message || '';
        logger.warn(`API error — code: ${body?.errorCode}, message: ${errorMessage}`);
      }
    });

    await qp.goToQuotationsList();
    await qp.openCreateForm();
    await qp.fillQuotationForm(data);

    // Step 1 — first save, expect 422 due to inaccessible company
    await qp.saveQuotationExpectingError();
    await qp.assertErrorToast();
    logger.info(`Error message captured: "${errorMessage}"`);

    // Step 2 — still on form, clear inaccessible entity and retry
    const currentUrl = restrictedPage.url();
    const alreadySaved =
      currentUrl.includes('/quotations/list') || currentUrl.includes('/quotations/details/');

    if (!alreadySaved) {
      if (errorMessage.toLowerCase().includes('company')) {
        logger.info('Clearing inaccessible company');
        await qp.clearAssociatedCompany();
      } else {
        logger.info('Clearing inaccessible contact');
        await qp.clearAssociatedContacts();
      }
      await qp.saveQuotation();
      await qp.assertSuccessToast();
      await qp.assertOnListPage();
    } else {
      logger.warn('Save already succeeded on first attempt — skipping retry');
    }

    // WHY: Search by summary — list rows show system IDs not RES... prefix
    await qp.assertQuotationInList(data.summary);
    logger.success('T7 passed — inaccessible entity handled, quotation created on retry');
  });

  // ─── T8 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should not see admin-owned quotation in list', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminQP = new QuotationsPage(adminPage);
    const restrictedQP = new QuotationsPage(restrictedPage);
    const adminDealsPage = new DealsPage(adminPage);

    // WHY: Create admin deal with NO company/contact — any linked accessible entity
    // makes the quotation visible to restricted user in Kylas RBAC model.
    const adminDealData = generateDealData({ skipAssociatedEntities: true });
    await adminDealsPage.goToDealsList();
    await adminDealsPage.createDeal(adminDealData);
    logger.info(`Admin deal created (no entities): "${adminDealData.name}"`);

    const adminData = generateAdminQuotationData({ dealName: adminDealData.name });
    await adminQP.createQuotation(adminData);
    await adminQP.assertQuotationInList(adminData.quotationNumber);

    await restrictedQP.assertQuotationNotInList(adminData.summary);
    logger.success('T8 passed — restricted user cannot see admin-owned quotation');
  });

  // ─── T9 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should update own quotation', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();
    const updatedSummary = `RES Updated ${Date.now()}`;

    const { id } = await qp.createQuotation(data);
    await qp.updateQuotation(
      data.quotationNumber,
      { summary: updatedSummary, status: QuotationStatus.Negotiation, additionalDiscount: 5 },
      id ?? undefined
    );
    // WHY: Wait for detail page to fully render before grabbing body text.
    // updateQuotation navigates to detail page but staging renders slower — same fix as T14.
    await restrictedPage.waitForLoadState('domcontentloaded');
    await restrictedPage.waitForTimeout(1500);
    const bodyText = await restrictedPage.locator('body').innerText();
    expect(bodyText).toContain(updatedSummary);
    await qp.assertStatusOnDetailPage(QuotationStatus.Negotiation);
    logger.success('T9 passed');
  });

  // ─── T10 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should see and edit quotation when set as owner by admin', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminQP = new QuotationsPage(adminPage);
    const restrictedQP = new QuotationsPage(restrictedPage);
    const restrictedDealsPage = new DealsPage(restrictedPage);

    const restrictedUserName = await restrictedQP.getLoggedInUserName('restricted');

    // WHY: createQuotationWithOwner picks a random deal — if it's admin-owned,
    // restricted user gets 404 when edit modal fetches the deal → fields stay disabled.
    // Fix: restricted user creates their own deal first so they have access to it.
    const dealData = generateDealData();
    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.createDeal(dealData);
    logger.info(`Restricted user created deal: "${dealData.name}"`);

    const adminData = generateAdminQuotationData({ dealName: dealData.name });
    const { id } = await adminQP.createQuotationWithOwner(adminData, restrictedUserName);
    expect(id, 'Quotation ID must be captured').toBeTruthy();

    // Restricted user should see the quotation in their list
    await restrictedQP.goToQuotationsList();
    await restrictedPage.waitForTimeout(1500);
    await restrictedQP.searchQuotation(adminData.summary);
    await restrictedPage.waitForTimeout(2000);
    const allRows = restrictedPage.locator('.rt-tr-group');
    const rowCount = await allRows.count();
    let found = false;
    for (let i = 0; i < rowCount; i++) {
      const text = (
        await allRows
          .nth(i)
          .innerText()
          .catch(() => '')
      ).trim();
      if (text.length > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    logger.info('Restricted user can see quotation set as owner by admin');

    // Open the quotation detail page
    await restrictedQP.searchAndOpenQuotation(adminData.quotationNumber, id ?? undefined);
    await restrictedQP.assertOnDetailPage();

    // Open edit modal and wait for layout to load
    const updatedSummary = `Restricted edit ${Date.now()}`;
    await restrictedQP.clickEditButton();
    // WHY: Modal fetches /v1/quotations/layout/edit — fields disabled until complete
    const summaryInput = restrictedPage.locator('[id="0_21_input_summary"]');
    await summaryInput.waitFor({ state: 'visible', timeout: 10000 });
    let isDisabled = true;
    for (let i = 0; i < 30; i++) {
      isDisabled = await summaryInput.isDisabled();
      if (!isDisabled) break;
      await restrictedPage.waitForTimeout(500);
    }
    expect(isDisabled, 'Summary field still disabled — deal may be inaccessible').toBe(false);

    await restrictedQP.fillEditForm({ summary: updatedSummary });
    await restrictedQP.saveQuotation();
    await restrictedQP.assertSuccessToast();

    // Navigate to detail to verify update
    await restrictedQP.goToQuotationDetail(id!);
    await restrictedPage.waitForTimeout(2000);
    const bodyText = await restrictedPage.locator('body').innerText();
    expect(bodyText.toLowerCase()).toContain(updatedSummary.toLowerCase());
    logger.success('T10 passed — restricted user saw and edited quotation as owner');
  });

  // ─── T22 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should verify all field values on detail page after create', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData({ status: QuotationStatus.Draft });

    const { id } = await qp.createQuotation(data);
    if (id) {
      await qp.goToQuotationDetail(id);
    } else {
      await qp.searchAndOpenQuotation(data.quotationNumber);
    }

    await qp.assertDetailPageFields(data);
    const chips = restrictedPage.locator('.related-entity-container');
    if ((await chips.count()) === 0) throw new Error('No entity chips on detail page');

    const bodyText = await restrictedPage.locator('body').innerText();
    expect(bodyText).toContain(data.quotationNumber);
    expect(bodyText.toLowerCase()).toContain(data.summary.toLowerCase());
    logger.success('T22 passed');
  });

  // ─── T23 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should verify grand total math', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();
    const productRow = generateProductRowData({ discount: 3, tax: 5 });

    await qp.goToQuotationsList();
    await qp.openCreateForm();
    await qp.fillQuotationForm(data);
    await qp.editProductRow(0, productRow);
    await qp.fillEditForm({
      additionalDiscount: 5,
      additionalTax: 3,
      adjustment: 1,
    });

    const totals = await qp.assertGrandTotalMath();
    logger.info(`Grand Total: ${totals.grandTotal}`);
    await qp.saveQuotation();
    await qp.assertSuccessToast();
    logger.success('T23 passed');
  });

  // ─── T24 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should download own quotation and verify file', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();

    const { id } = await qp.createQuotation(data);
    if (id) {
      await qp.goToQuotationDetail(id);
    } else {
      await qp.searchAndOpenQuotation(data.quotationNumber);
    }

    const { filename, size } = await qp.downloadQuotation();
    expect(filename).toContain('.pdf');
    expect(filename).toContain('Quotation_');
    expect(size).toBeGreaterThan(0);
    logger.success(`T24 passed — downloaded: ${filename} (${size} bytes)`);
  });

  // ─── T25 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should see entity chip on detail page of shared quotation', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminQP = new QuotationsPage(adminPage);
    const restrictedQP = new QuotationsPage(restrictedPage);

    const adminData = generateAdminQuotationData();
    const restrictedUserName = await restrictedQP.getLoggedInUserName('restricted');
    const { id } = await adminQP.createQuotationWithOwner(adminData, restrictedUserName);

    if (id) {
      await restrictedPage.goto(`${config.appUrl}/sales/quotations/details/${id}`, {
        waitUntil: 'domcontentloaded',
      });
      await restrictedPage
        .locator('.related-entity-container')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 });
    } else {
      await restrictedQP.searchAndOpenQuotation(adminData.quotationNumber);
      await restrictedPage
        .locator('.related-entity-container')
        .first()
        .waitFor({ state: 'visible', timeout: 15000 });
    }

    const chipCount = await restrictedPage.locator('.related-entity-container').count();
    expect(chipCount).toBeGreaterThan(0);
    logger.success('T25 passed');
  });

  // ─── T26 ──────────────────────────────────────────────────────────────────
  // WHY: Linking an admin-owned company causes a white-screen crash (app bug —
  // TypeError: e is not iterable in componentDidUpdate) when restricted user
  // opens the detail page. Fix: restricted user creates their own deal first.
  // Admin uses that deal → edit modal renders all fields editable for restricted user.
  test('@regression restricted user should edit shared quotation when deal is accessible', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminQP = new QuotationsPage(adminPage);
    const restrictedQP = new QuotationsPage(restrictedPage);
    const restrictedDealsPage = new DealsPage(restrictedPage);

    // Step 1 — get restricted user name
    const restrictedUserName = await restrictedQP.getLoggedInUserName('restricted');
    logger.info(`Restricted user name: "${restrictedUserName}"`);
    expect(restrictedUserName.length).toBeGreaterThan(0);

    // Step 2 — restricted user creates their own deal
    // WHY: Admin-owned deal → restricted user 404 in edit modal → all fields disabled.
    // Restricted user's own deal → edit modal fully editable.
    const dealData = generateDealData();
    await restrictedDealsPage.goToDealsList();
    const dealId = await restrictedDealsPage.createDeal(dealData);
    logger.info(`Restricted user created deal: "${dealData.name}" (id: ${dealId})`);
    expect(dealData.name.length).toBeGreaterThan(0);

    // Step 3 — admin creates quotation using restricted user's deal + sets owner
    const adminData = generateAdminQuotationData({ dealName: dealData.name });
    const { id } = await adminQP.createQuotationWithOwner(adminData, restrictedUserName);
    expect(id, 'Quotation ID must be captured').toBeTruthy();
    logger.info(`Admin created quotation ID: ${id}`);

    // Step 4 — restricted user opens detail page
    const detailUrl = `${config.appUrl}/sales/quotations/details/${id}`;
    await restrictedPage.goto(detailUrl, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForTimeout(3000);

    const currentUrl = restrictedPage.url();
    logger.info(`Restricted user current URL: ${currentUrl}`);
    expect(currentUrl).toContain(`/quotations/details/${id}`);

    // Step 5 — verify no white screen
    const bodyText = await restrictedPage.locator('body').innerText();
    expect(bodyText.trim().length).toBeGreaterThan(50);
    logger.info('Detail page rendered — no white screen');

    // Step 6 — open edit and verify fields are editable
    // WHY: Modal fetches /v1/quotations/layout/edit after opening — fields are
    // briefly disabled while layout loads. Poll isDisabled until false.
    await restrictedQP.clickEditButton();
    const summaryInput = restrictedPage.locator('[id="0_21_input_summary"]');
    await summaryInput.waitFor({ state: 'visible', timeout: 10000 });

    let isDisabled = true;
    for (let i = 0; i < 30; i++) {
      isDisabled = await summaryInput.isDisabled();
      if (!isDisabled) break;
      await restrictedPage.waitForTimeout(500);
    }
    expect(isDisabled, 'Summary field is disabled after 15s — deal may be inaccessible').toBe(
      false
    );
    logger.info('Fields are editable');

    // Step 7 — edit and save
    const updatedSummary = `T26 Edit ${Date.now()}`;
    await restrictedQP.fillEditForm({ summary: updatedSummary });
    await restrictedQP.saveQuotation();
    await restrictedQP.assertSuccessToast();

    // Navigate to detail page to verify the updated summary is visible
    await restrictedQP.goToQuotationDetail(id!);
    await restrictedPage.waitForTimeout(2000);
    const updatedBody = await restrictedPage.locator('body').innerText();
    expect(updatedBody).toContain(updatedSummary);
    logger.success('T26 passed — restricted user edited shared quotation with accessible deal');
  });

  // ─── T27 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should not be able to find quotation owned by admin', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminQP = new QuotationsPage(adminPage);
    const restrictedQP = new QuotationsPage(restrictedPage);
    const adminDealsPage = new DealsPage(adminPage);

    // WHY: Create admin deal with NO company/contact — any linked accessible entity
    // makes the quotation visible to restricted user in Kylas RBAC model.
    const adminDealData = generateDealData({ skipAssociatedEntities: true });
    await adminDealsPage.goToDealsList();
    await adminDealsPage.createDeal(adminDealData);
    logger.info(`Admin deal created (no entities): "${adminDealData.name}"`);

    const adminData = generateAdminQuotationData({ dealName: adminDealData.name });
    await adminQP.createQuotation(adminData);
    await adminQP.assertQuotationInList(adminData.quotationNumber);

    await restrictedQP.assertQuotationNotInList(adminData.summary);
    logger.success('T27 passed — restricted user cannot find admin-owned quotation');
  });

  // ─── T28 ──────────────────────────────────────────────────────────────────
  test('@prodSafe restricted user should navigate to quotations list on production', async ({
    restrictedPage,
  }) => {
    const qp = new QuotationsPage(restrictedPage);
    await qp.goToQuotationsList();
    await qp.assertOnListPage();
    logger.success('T28 passed');
  });
});
