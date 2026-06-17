import { test } from '../../../src/fixtures/index';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import {
  generateDealData,
  CLOSED_LOST_REASONS,
  CLOSED_UNQUALIFIED_REASONS,
} from '../../../src/data/factories/dealFactory';
import { faker } from '@faker-js/faker';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

test.describe('Deals', () => {
  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to deals list page', async ({ adminPage }) => {
    const dealsPage = new DealsPage(adminPage);
    await dealsPage.goToDealsList();
    await dealsPage.assertOnDealsListPage();
    logger.success('D1 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Create — all fields, random installments (2-12), verify equal split
  // WHY: One test covers create + part payments together to avoid
  // creating multiple deals unnecessarily.
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a deal with all fields and verify part payments', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    await dealsPage.assertDealCreated(dealData, dealId ?? undefined);
    logger.success('D2 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Update — edit name, mark first payment Received, update UTM
  // WHY: Creates one deal then immediately edits it — single deal lifecycle
  // ──────────────────────────────────────────────────────────

  test('@regression admin should update a deal and mark payment as received', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    const updatedData = generateDealData();
    await dealsPage.updateDeal(updatedData, dealData.name, dealId ?? undefined);
    await dealsPage.assertDealUpdated(updatedData);
    logger.success('D3 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Payment math verification
  // WHY: Dedicated test to verify payment summary math is correct
  // after marking first installment as Received:
  // Actual Total - Amount Received = Remaining Balance (±1 rounding tolerance)
  // ──────────────────────────────────────────────────────────

  test('@regression admin should verify payment math after marking installment received', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    // WHY: Use fixed 3 installments for predictable math verification
    const dealData = generateDealData({ numberOfInstallments: 3 });

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    // Open edit modal — mark first payment Received — assert math before saving
    await dealsPage.searchAndOpenDeal(dealData.name, dealId ?? undefined);
    await dealsPage.clickEditIcon();

    // Mark first installment as Received
    await dealsPage.fillEditForm(dealData);

    // WHY: assertPaymentReceivedAfterEdit verifies:
    // 1. First installment status = Received
    // 2. Amount Received > 0
    // 3. Remaining < Total
    // 4. Total - Received = Remaining (±1 rounding)
    await dealsPage.assertPaymentReceivedAfterEdit();

    await dealsPage.saveEditedDeal();
    logger.success(
      'Payment math verified: Total - Received = Remaining (±1 rounding tolerance) — amounts are correct. Deal saved successfully.'
    );
    logger.success('D4 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage verification on deal details
  // ──────────────────────────────────────────────────────────

  test('@regression admin should verify pipeline stage is Open after deal creation', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    if (dealId) {
      await adminPage.goto(`${config.appUrl}/sales/deals/details/${dealId}`, {
        waitUntil: 'domcontentloaded',
      });
      await adminPage.waitForURL(/deals\/details\//, { timeout: config.timeouts.navigation });
    } else {
      // WHY: dealId capture failed — use search to find and open the deal
      await dealsPage.searchAndOpenDeal(dealData.name);
    }

    // WHY: Default stage after creation is always Open
    await dealsPage.assertPipelineStageOnDetails('Open');
    await dealsPage.assertActualValueContainsINR();
    logger.success('Pipeline stage Open and INR currency verified after deal creation');
    logger.success('D5 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage change to Negotiation
  // ──────────────────────────────────────────────────────────

  test('@regression admin should change pipeline stage to Negotiation in edit', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    await dealsPage.searchAndOpenDeal(dealData.name, dealId ?? undefined);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(dealData);
    await dealsPage.changePipelineStageInEdit('Negotiation');
    await dealsPage.assertPaymentReceivedAfterEdit();
    await dealsPage.saveEditedDeal();

    // Verify stage changed on details page
    await adminPage.goto(`${config.appUrl}/sales/deals/details/${dealId}`, {
      waitUntil: 'domcontentloaded',
    });
    await dealsPage.assertPipelineStageOnDetails('Negotiation');
    logger.success('Pipeline stage changed to Negotiation and verified');
    logger.success('D6 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Closed Lost with stage reason
  // ──────────────────────────────────────────────────────────

  test('@regression admin should change pipeline stage to Closed Lost with random reason', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    await dealsPage.searchAndOpenDeal(dealData.name, dealId ?? undefined);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(dealData);

    // WHY: Pick random Closed Lost reason from valid options
    const closedLostReason = faker.helpers.arrayElement(CLOSED_LOST_REASONS);
    logger.info(`Selected Closed Lost reason: ${closedLostReason}`);
    await dealsPage.changePipelineStageInEdit('Closed Lost', closedLostReason);
    await dealsPage.assertPaymentReceivedAfterEdit();
    await dealsPage.saveEditedDeal();
    logger.success(`Deal closed as Lost with reason: ${closedLostReason}`);
    logger.success('D7 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Closed Unqualified with stage reason
  // ──────────────────────────────────────────────────────────

  test('@regression admin should change pipeline stage to Closed Unqualified with random reason', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    await dealsPage.searchAndOpenDeal(dealData.name, dealId ?? undefined);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(dealData);

    // WHY: Pick random Closed Unqualified reason from valid options
    const closedUnqualifiedReason = faker.helpers.arrayElement(CLOSED_UNQUALIFIED_REASONS);
    logger.info(`Selected Closed Unqualified reason: ${closedUnqualifiedReason}`);
    await dealsPage.changePipelineStageInEdit('Closed Unqualified', closedUnqualifiedReason);
    await dealsPage.assertPaymentReceivedAfterEdit();
    await dealsPage.saveEditedDeal();
    logger.success(`Deal closed as Unqualified with reason: ${closedUnqualifiedReason}`);
    logger.success('D8 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Part payments summary on deal details with INR verification
  // ──────────────────────────────────────────────────────────

  test('@regression admin should verify part payments summary on deal details with INR currency and correct math', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    // WHY: Fixed 3 installments for predictable math verification
    const dealData = generateDealData({ numberOfInstallments: 3 });

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    // Mark first payment as received
    const updatedData = generateDealData({ numberOfInstallments: 3 });
    await dealsPage.updateDeal(updatedData, dealData.name, dealId ?? undefined);

    // Navigate to deal details and verify part payments summary
    await adminPage.goto(`${config.appUrl}/sales/deals/details/${dealId}`, {
      waitUntil: 'domcontentloaded',
    });
    await adminPage.waitForURL(/deals\/details\//, { timeout: 20000 });
    await dealsPage.assertPartPaymentsSummaryOnDetails();
    logger.success('D9 passed');
  });
});
