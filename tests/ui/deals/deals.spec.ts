import { test } from '../../../src/fixtures/index';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { logger } from '../../../src/utils/logger';

test.describe('Deals', () => {

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to deals list page', async ({ adminPage }) => {
    const dealsPage = new DealsPage(adminPage);
    await dealsPage.goToDealsList();
    await dealsPage.assertOnDealsListPage();
  });

  // ──────────────────────────────────────────────────────────
  // Create — all fields, random installments (2-12), verify equal split
  // WHY: One test covers create + part payments together to avoid
  // creating multiple deals unnecessarily.
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a deal with all fields and verify part payments', async ({ adminPage }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    await dealsPage.assertDealCreated(dealData, dealId ?? undefined);
  });

  // ──────────────────────────────────────────────────────────
  // Update — edit name, mark first payment Received, update UTM
  // WHY: Creates one deal then immediately edits it — single deal lifecycle
  // ──────────────────────────────────────────────────────────

  test('@regression admin should update a deal and mark payment as received', async ({ adminPage }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    const updatedData = generateDealData();
    await dealsPage.updateDeal(updatedData, dealData.name, dealId ?? undefined);
    await dealsPage.assertDealUpdated(updatedData);
  });

  // ──────────────────────────────────────────────────────────
  // Payment math verification
  // WHY: Dedicated test to verify payment summary math is correct
  // after marking first installment as Received:
  // Actual Total - Amount Received = Remaining Balance (±1 rounding tolerance)
  // ──────────────────────────────────────────────────────────

  test('@regression admin should verify payment math after marking installment received', async ({ adminPage }) => {
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
    logger.success('Payment math verified: Total - Received = Remaining (±1 rounding tolerance) — amounts are correct. Deal saved successfully.');
  });

});
