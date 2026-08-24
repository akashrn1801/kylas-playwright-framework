import { test, expect } from '../../../src/fixtures/index';
import { safeWaitForURL } from '../../../src/utils/navigation';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import {
  generateDealData,
  generateSharedDealData,
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

  test('@smoke @regression @prodSafe admin should navigate to deals list page', async ({
    adminPage,
  }) => {
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
    // WHY dealId passed here (fixed 2026-08-11, staging run failure): this
    // was previously omitted despite being in scope, forcing
    // assertDealUpdated() down its slow list-search fallback instead of its
    // already-implemented ID-first fast path — the exact mechanism behind
    // this test's "save failed silently" timeout under real --workers=2
    // staging load (a single-worker headed repro passed because the
    // fallback had no concurrent contention to time out against).
    await dealsPage.assertDealUpdated(updatedData, dealId ?? undefined);
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
      await dealsPage.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
      await safeWaitForURL(adminPage, /deals\/details\//, config.timeouts.navigation);
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
    await dealsPage.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
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
    await dealsPage.navigateTo(`${config.appUrl}/sales/deals/details/${dealId}`);
    await safeWaitForURL(adminPage, /deals\/details\//, 20000);
    await dealsPage.assertPartPaymentsSummaryOnDetails();
    logger.success('D9 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Won pipeline stage
  // ──────────────────────────────────────────────────────────

  test('@regression admin should change pipeline stage to Won', async ({ adminPage }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);

    await dealsPage.searchAndOpenDeal(dealData.name, dealId ?? undefined);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(dealData);
    await dealsPage.changePipelineStageInEdit('Won');
    await dealsPage.assertPaymentReceivedAfterEdit();
    await dealsPage.saveEditedDeal();

    // WHY: Re-navigate for a real re-fetch — don't trust the in-memory render
    // right after save; Won replaces .in-progress-stage with .closed-pipeline-stage.
    await dealsPage.goToDealDetailsById(dealId!);
    await dealsPage.assertClosedPipelineStage('Won');
    logger.success('Pipeline stage changed to Won and verified on reload');
    logger.success('D30 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Detail page header fields and tabs
  // ──────────────────────────────────────────────────────────

  test('@regression admin should verify deal detail header fields and tabs', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();

    await dealsPage.goToDealDetailsById(dealId!);
    await dealsPage.assertDealDetailFields(dealData);
    logger.success('D31 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Share
  // ──────────────────────────────────────────────────────────

  test('@regression admin should share a deal with restricted user', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const adminDealsPage = new DealsPage(adminPage);
    const dealData = generateSharedDealData();
    await adminDealsPage.goToDealsList();
    const dealId = await adminDealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();
    await adminDealsPage.goToDealDetailsById(dealId!);
    const restrictedUserName = await adminDealsPage.getLoggedInUserName('restricted');
    await adminDealsPage.shareDeal(restrictedUserName, []);

    // WHY: Real end-state check — restricted user's own list, not just save success
    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.assertDealExistsInList(dealData.name);
    logger.success('D32 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Reassign
  // ──────────────────────────────────────────────────────────

  test('@regression admin should reassign deal to restricted user and verify owner changed', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);
    const restrictedUserName = await dealsPage.getLoggedInUserName('restricted');
    await dealsPage.reassignDeal(restrictedUserName);
    // WHY: Real end-state check — Owner header field actually changed, not just no-error
    await dealsPage.assertOwnerOnDetail(restrictedUserName);
    logger.success('D33 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Clone
  // ──────────────────────────────────────────────────────────

  test('@regression admin should clone a deal via ellipsis menu and verify cloned deal exists', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);
    const clonedId = await dealsPage.cloneDeal();
    // WHY the primary correctness signal is now ID-based, not a mid-render
    // UI field read (redesigned 2026-08-23 — see
    // .claude/sandbox-build-144-task-a-deals-clone.md): cloneDeal()'s
    // clonedId comes from a genuine network response (a discrete, hard
    // event), not a DOM snapshot that can be caught half-rendered.
    expect(clonedId).not.toBeNull();
    // WHY assert clonedId !== dealId: a non-null return alone isn't proof a
    // real clone happened — it could coincidentally be null-checked away
    // while still (in some other bug) resolving to the SAME deal. Asserting
    // the two IDs differ is the actual "a genuine second record was
    // created" proof.
    expect(clonedId, 'Cloned deal must have a different ID from the original').not.toBe(dealId);
    // WHY this name check is safe now, unlike the old pre-save modal check:
    // it reads the cloned deal's name off its own separately-loaded, fully
    // -settled detail page (assertClonedDealName() navigates there first),
    // not off the clone modal mid-render — no longer vulnerable to the same
    // rendering-timing race.
    await dealsPage.assertClonedDealName(dealData.name, clonedId!);
    logger.success('D34 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Add Contact
  // ──────────────────────────────────────────────────────────

  test('@regression admin should add an existing contact to a deal from ellipsis menu and verify in Associated Contacts', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData({ skipAssociatedEntities: true });
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);
    // WHY getDisplayedAssociatedContactsCount(), not getAssociatedContactsCount()
    // (2026-07-27): this test's whole purpose is verifying the contact becomes
    // visible in the "Associated Contacts" UI card — deliberately reads the UI,
    // not the API, so it keeps surfacing the confirmed, real, unresolved
    // app-level display bug (see CLAUDE.md's Known Issues) if it's still present.
    const baselineCount = await dealsPage.getDisplayedAssociatedContactsCount();
    await dealsPage.addContactToDeal();
    // WHY: Real end-state check — reload and re-read the card count.
    // Bounded retry (fixed 2026-08-22, real flake): a single reload could
    // still race the reloaded card's own async data fetch — see
    // waitForDisplayedAssociatedContactsCount()'s own comment.
    const afterCount = await dealsPage.waitForDisplayedAssociatedContactsCount(
      dealId!,
      baselineCount + 1
    );
    expect(afterCount, 'Associated contacts count should increase by 1').toBe(baselineCount + 1);
    logger.success('D35 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Delete
  // ──────────────────────────────────────────────────────────

  test('@regression admin should delete a deal and verify it is removed', async ({ adminPage }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    expect(dealId).not.toBeNull();
    await dealsPage.goToDealDetailsById(dealId!);
    await dealsPage.deleteDeal();
    await dealsPage.assertDealDeletedById(dealId!);
    await dealsPage.assertDealNotInList(dealData.name);
    logger.success('D36 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 9 fields exist only on QA today (2026-07-24) and are expected
  // on Stage/Prod later with identical names — see DealsPage/BasePage's
  // custom-field helpers for the environment-safety skip logic that makes
  // these tests (and every other Deal create/update path) work unchanged
  // once that happens. Deal has no lookup-type custom field, unlike Lead —
  // no lookup-specific tests here (see CLAUDE.md's Custom Fields entry).

  // ── D37 ───────────────────────────────────────────────────

  test('@regression admin should create a deal with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    await dealsPage.clickAddDeal();
    await dealsPage.skipIfCustomFieldsAbsent();
    await dealsPage.fillDealForm(dealData);
    const dealId = await dealsPage.saveDeal();
    expect(dealId, 'Deal ID should be captured after create').not.toBeNull();

    await dealsPage.goToDealDetailsById(dealId!);
    await dealsPage.assertDealCustomFieldsOnDetail(dealData);
    logger.success('D37 passed');
  });

  // ── D38 ───────────────────────────────────────────────────

  test("@regression admin should update a deal's custom fields and verify updated values", async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    await dealsPage.clickAddDeal();
    await dealsPage.skipIfCustomFieldsAbsent();
    await dealsPage.fillDealForm(dealData);
    const dealId = await dealsPage.saveDeal();
    expect(dealId, 'Deal ID should be captured after create').not.toBeNull();

    const updatedData = generateDealData();
    await dealsPage.updateDeal(updatedData, dealData.name, dealId ?? undefined);

    // WHY: updateDeal() leaves the browser on the same deal detail page
    // (edit is an in-place modal, not a route change) — no re-navigation needed.
    await dealsPage.assertDealCustomFieldsOnDetail(updatedData);
    logger.success('D38 passed');
  });

  // ── D41 ───────────────────────────────────────────────────
  // WHY this test exists as its own dedicated case, not folded into T11's
  // (Products & Services) fix: this is genuinely Deal-specific behavior —
  // adding a product to a deal that already has part-payment installments
  // configured — not a Products & Services concern at all. Root-caused and
  // fixed 2026-08-10 (see PRODUCTS_AND_SERVICES_PROGRESS.md): the app
  // correctly detects the resulting Total/installment mismatch and blocks
  // Save until "Distribute Equally" is resolved — a real, working app
  // feature, not a bug. This test verifies the app's OWN detection and the
  // real persisted result, not just that automation can click through it.

  test('@regression admin should distribute unallocated amount equally after adding a product to a deal with part payments', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    // WHY no separate fixture/arrange step is needed: fillDealForm() always
    // adds 1-3 random products AND always calls
    // addPartPayments(dealData.numberOfInstallments) — confirmed live,
    // 2026-08-10 — so a freshly-created deal already has both prerequisites
    // (at least one product, part-payments already configured) by the time
    // create finishes.
    await dealsPage.goToDealsList();
    await dealsPage.clickAddDeal();
    await dealsPage.fillDealForm(dealData);
    const dealId = await dealsPage.saveDeal();
    expect(dealId, 'Deal ID should be captured after create').not.toBeNull();

    await dealsPage.goToDealDetailsById(dealId!);
    await dealsPage.clickEditIcon();

    // WHY a real field change first: Save starts disabled until the form is
    // dirtied (confirmed live) — a genuinely different name change achieves
    // this, matching every other edit test's own pattern.
    const updatedData = generateDealData();
    await dealsPage.fillEditForm(updatedData);

    // Add a NEW product row — this is what legitimately changes the deal's
    // Total after installments were already split against the old total.
    await dealsPage.addProductRow();

    // Step 3 (the real assertion that matters): the app must correctly
    // detect the resulting mismatch and surface the CTA — not just clicking
    // through it blindly.
    await dealsPage.assertDistributeUnallocatedBannerVisible();

    // Step 4: open the modal, assert it shows a real unallocated amount and
    // at least one new-value cell.
    //
    // WHY not asserting newAmounts.length === dealData.numberOfInstallments
    // (real, confirmed finding, 2026-08-10): a real run showed the modal's
    // table listing FEWER rows (6) than the deal's actual installment count
    // (7) — the app apparently only lists installments whose amount
    // actually changes, not every installment unconditionally. Asserting
    // exact equality was an unverified assumption that turned out wrong;
    // bounding by <= the real installment count is what's actually
    // confirmed true.
    const { unallocatedText, newAmounts } = await dealsPage.openDistributeModalAndReadDetails();
    expect(unallocatedText.length, 'Unallocated amount text should be non-empty').toBeGreaterThan(
      0
    );
    expect(newAmounts.length, 'Should show at least one new-value cell').toBeGreaterThan(0);
    expect(
      newAmounts.length,
      'Modal row count should never exceed the deal’s actual installment count'
    ).toBeLessThanOrEqual(dealData.numberOfInstallments);

    // Step 5: proceed, assert the modal closes and the banner clears.
    await dealsPage.proceedDistributeEqually();
    await dealsPage.assertDistributeUnallocatedBannerHidden();

    // Step 6: save.
    await dealsPage.saveEditedDeal();

    // Step 7: re-fetch the real, persisted record (not just trust the UI) —
    // assert the installments actually sum to the deal's new total.
    await dealsPage.goToDealDetailsById(dealId!);
    const savedDeal = await dealsPage.fetchCurrentDealApiData();
    expect(savedDeal, 'Fresh GET on the saved deal should succeed').not.toBeNull();
    const partPayments = (savedDeal?.partPayments ?? []) as Array<{
      amount?: { value?: number };
    }>;
    expect(partPayments.length, 'Persisted installment count should match').toBe(
      dealData.numberOfInstallments
    );
    const persistedSum = partPayments.reduce((sum, p) => sum + (p.amount?.value ?? 0), 0);
    const persistedTotal = (savedDeal?.actualValue as { value: number } | undefined)?.value ?? 0;
    // WHY ±1 tolerance: matches assertPaymentReceivedAfterEdit()'s own
    // established rounding allowance for the identical "sum of installments
    // vs total" comparison (e.g. an odd total split across many
    // installments always leaves a few paise of rounding remainder).
    expect(
      Math.abs(persistedSum - persistedTotal),
      `Persisted installments (sum: ${persistedSum}) should sum to the deal's new total (${persistedTotal})`
    ).toBeLessThanOrEqual(1);

    logger.success('D41 passed');
  });

  // WHY this test exists: BasePage.removeProductRow() had no real test
  // exercising it (its selector was a defensive, unverified guess — see the
  // method's own comment history). Live investigation (2026-08-10) found the
  // real remove trigger is `i.fa-times.cursor-pointer`, not the originally-
  // guessed button/aria-label/class-name shape; the method was corrected and
  // this test proves it against a real Deal.
  test('@regression admin should remove a product row from a deal and save successfully', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(adminPage);
    const dealData = generateDealData();

    await dealsPage.goToDealsList();
    await dealsPage.clickAddDeal();
    await dealsPage.fillDealForm(dealData);

    // fillDealForm() already added 1-3 random products — add one more to
    // guarantee at least 2 rows exist, so removal has something real to
    // remove without leaving zero product rows behind.
    await dealsPage.addProductRow();

    const rows = adminPage.locator('.products-input__row');
    const countBefore = await rows.count();
    expect(
      countBefore,
      'Should have at least 2 product rows before removal'
    ).toBeGreaterThanOrEqual(2);
    const removedRowName = await rows
      .last()
      .locator('.is-invalid__single-value')
      .first()
      .textContent();
    // WHY count occurrences BEFORE removal, not just check the name exists:
    // fillDealForm()'s random product picker can independently select the
    // SAME product for two different rows in one deal (confirmed live,
    // real, non-rare — see PRODUCTS_AND_SERVICES_PROGRESS.md Entry 37's
    // "3 BHK" picked twice example) — so a removed row's name can still
    // legitimately appear in a surviving row. Found live via this exact
    // test: an earlier version asserted zero remaining occurrences and
    // failed on a real, correct removal specifically because of this
    // duplicate-pick scenario. Asserting "count decreased by exactly 1" is
    // correct regardless of whether the name is otherwise unique or
    // duplicated.
    let countMatchingBefore = 0;
    if (removedRowName) {
      const escaped = removedRowName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      countMatchingBefore = await rows
        .locator('.is-invalid__single-value', { hasText: new RegExp(`^${escaped}$`) })
        .count();
    }

    await dealsPage.removeProductRow(rows.last());

    const countAfter = await rows.count();
    expect(countAfter, 'Row count should decrease by exactly 1').toBe(countBefore - 1);
    if (removedRowName) {
      const escaped = removedRowName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const countMatchingAfter = await rows
        .locator('.is-invalid__single-value', { hasText: new RegExp(`^${escaped}$`) })
        .count();
      expect(
        countMatchingAfter,
        `Occurrences of the removed product name should decrease by exactly 1 (was ${countMatchingBefore} before removal — may legitimately be duplicated across rows)`
      ).toBe(countMatchingBefore - 1);
    }

    const dealId = await dealsPage.saveDeal();
    expect(dealId, 'Deal should still save successfully after a row removal').not.toBeNull();

    logger.success('D42 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Production-safe navigation check
  // ──────────────────────────────────────────────────────────

  test('@prodSafe admin should navigate to deals list page', async ({ adminPage }) => {
    const dealsPage = new DealsPage(adminPage);
    await dealsPage.goToDealsList();
    await dealsPage.assertOnDealsListPage();
    logger.success('D-prodSafe passed');
  });
});
