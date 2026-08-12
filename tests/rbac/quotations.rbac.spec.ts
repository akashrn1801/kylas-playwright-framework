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
import { CompaniesPage } from '../../src/modules/companies/CompaniesPage';
import { generateCompanyData } from '../../src/data/factories/companyFactory';

test.describe('Quotations — RBAC', () => {
  // WHY: serial mode removed (2026-07-24) — this file used to force
  // mode: 'serial', serializing all 14 tests onto 1 worker regardless of
  // the --workers flag or fullyParallel:true in playwright.config.ts.
  // Reviewed the file first: no module-level/shared state between tests —
  // each test creates and owns its own quotation/deal/contact data, so
  // there was no structural dependency on execution order. Verified live:
  // ran with mode: 'serial' removed and --workers=4 — all 14 tests passed
  // clean, 9.8m -> 4.9m (2x faster). Not a full 4x, likely partial QA
  // backend contention under concurrent load, but a real, safe win with
  // zero failures. If this ever needs to go back to serial, that would
  // point to genuine session/auth contention between concurrent
  // restrictedPage instances — investigate before just reverting blindly.

  // ─── Q5 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression @prodSafe restricted user should navigate to quotations list', async ({
    restrictedPage,
  }) => {
    const qp = new QuotationsPage(restrictedPage);
    await qp.goToQuotationsList();
    await qp.assertOnListPage();
    logger.success('Q5 passed');
  });

  // ─── Q6 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should create a quotation with accessible deal', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();
    const { id } = await qp.createQuotation(data);
    await qp.assertQuotationInList(data.summary);
    if (id) {
      await qp.goToQuotationDetail(id);
      await qp.assertOnDetailPage(id);
    }
    logger.success('Q6 passed');
  });

  // ─── Q7 ───────────────────────────────────────────────────────────────────
  // WHY a freshly-created, EXPLICITLY-SHARED deal with a deliberately fresh,
  // never-shared associated company (fixed 2026-08-11, corrected twice):
  // (1) the original static `config.deals.adminDealName` went stale; (2) a
  // first live fix (mirroring Q8's `skipAssociatedEntities: true`) was
  // wrong for this test — confirmed live: a restricted user's "Associated
  // Deal" search is scoped to deals they can access (owned/shared), not a
  // bare text search — an unshared deal returned ZERO results after 80s,
  // while explicitly sharing it (even with zero permissions) made it
  // instantly searchable; (3) sharing the deal alone was live-verified to
  // work (run 1: real 422 correctly triggered, deal found and selected) —
  // but non-deterministic (run 2: the deal's RANDOMLY-PICKED associated
  // company happened to already be accessible in this long-lived, never-
  // cleaned QA environment, so no 422 occurred at all). Fix: create a
  // dedicated, fresh, never-shared Company and pass it explicitly via
  // `associatedCompanyName` — guaranteeing the deal's associated company is
  // both real (something for the error-handling logic below to clear) and
  // genuinely inaccessible (deterministic, not a random pre-existing
  // record that might already be shared from an unrelated prior test).
  test('@regression restricted user should handle inaccessible entity error and retry successfully', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminCompaniesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(companyData);
    if (!companyId) throw new Error('Fresh company ID not captured — cannot proceed');
    logger.info(`Fresh, never-shared company created: "${companyData.name}"`);

    const adminDealsPage = new DealsPage(adminPage);
    const adminDealData = generateDealData({ associatedCompanyName: companyData.name });
    await adminDealsPage.goToDealsList();
    const adminDealId = await adminDealsPage.createDeal(adminDealData);
    if (!adminDealId) throw new Error('Admin deal ID not captured — cannot share');
    await adminDealsPage.goToDealDetailsById(adminDealId);
    const restrictedUserName = await adminDealsPage.getLoggedInUserName('restricted');
    await adminDealsPage.shareDeal(restrictedUserName, []);
    logger.info(
      `Admin deal shared with ${restrictedUserName} (deal itself visible; its fresh associated company deliberately left unshared): "${adminDealData.name}"`
    );

    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData({
      dealName: adminDealData.name,
    });

    // WHY: Register listener BEFORE navigation — 422 fires during save.
    // Also captures the id from a successful (< 400) create response, so the
    // final verification below can navigate directly by ID instead of
    // relying on list search-index lag.
    let errorMessage = '';
    let quotationId: number | null = null;
    restrictedPage.on('response', async (response) => {
      if (
        response.url().includes('/quotations') &&
        response.request().method() === 'POST'
      ) {
        if (response.status() >= 400) {
          const body = await response.json().catch(() => ({}));
          // WHY: Kylas 029003 returns top-level message, not inside errors[]
          errorMessage =
            body?.message || body?.errors?.[0]?.message || body?.validationErrors?.[0]?.message || '';
          logger.warn(`API error — code: ${body?.errorCode}, message: ${errorMessage}`);
        } else {
          const body = await response.json().catch(() => ({}));
          const id = body?.id ?? body?.data?.id ?? null;
          if (id) {
            quotationId = id;
            logger.success(`Captured quotation ID from save response: ${id}`);
          }
        }
      }
    });

    await qp.goToQuotationsList();
    await qp.openCreateForm();
    await qp.fillQuotationForm(data);

    // Step 1 — first save, expect 422 due to inaccessible company
    await qp.saveQuotationExpectingError();
    // WHY `saveFailed` drives the retry decision, not a URL check (fixed
    // 2026-08-11): the Quotation create form is an in-place modal — the
    // URL never changes on success OR failure (same root cause already
    // fixed in saveQuotation() itself), so the old `alreadySaved` check
    // was always true regardless of outcome, making the retry branch
    // below permanently unreachable. `assertErrorToast()` already computed
    // the real signal internally; it just never returned it — now it does.
    const saveFailed = await qp.assertErrorToast();
    logger.info(`Error message captured: "${errorMessage}"`);

    // Step 2 — still on form, clear inaccessible entity(ies) and retry.
    // WHY a bounded loop, not a single if/else (fixed 2026-08-11 —
    // HARDENED BASED ON CODE REVIEW, ROOT CAUSE NOT YET INDEPENDENTLY
    // LIVE-CONFIRMED, per CLAUDE.md rule 10): a headed-mode observation
    // reported a SECOND inaccessible-entity error after the first retry —
    // plausible because `adminDealData` above only pins the deal's
    // Company (`associatedCompanyName`), never its Contact, and
    // DealsPage.fillDealForm()'s own associated-contact pick is
    // deliberately randomized when not pinned (a separate, already-
    // documented behavior) — so there's a real, non-zero chance the
    // randomly-picked contact is ALSO inaccessible to the restricted user,
    // independent of the deliberately-unshared company. The old code only
    // ever inspected the FIRST error message and cleared exactly one
    // field, then assumed success — with no handling for a second,
    // different failure. This loop tries at most 2 clears (Company and
    // Contact are the only 2 possible inaccessible entities here), using
    // the same expecting-error path for every attempt except the final
    // allowed one, so a second distinct failure is caught and handled
    // instead of silently assumed away.
    const cleared = new Set<'company' | 'contact'>();
    const maxRetries = 2;
    let attempt = 0;
    let stillFailing = saveFailed;
    while (stillFailing && attempt < maxRetries) {
      attempt++;
      const entity: 'company' | 'contact' = errorMessage.toLowerCase().includes('company')
        ? 'company'
        : 'contact';
      if (cleared.has(entity)) {
        // Already cleared this exact entity once — a repeat means something
        // genuinely unexpected is happening (not just "the other entity is
        // also inaccessible"). Stop looping rather than risk getting stuck.
        break;
      }
      logger.info(`Clearing inaccessible ${entity}`);
      if (entity === 'company') {
        await qp.clearAssociatedCompany();
      } else {
        await qp.clearAssociatedContacts();
      }
      cleared.add(entity);
      errorMessage = ''; // reset so a fresh failure (if any) isn't confused with the last one
      // WHY: Clearing a react-select field's clear indicator can leave its
      // dropdown/menu portal open, intercepting clicks on Save — same
      // confirmed-live issue and fix already used in
      // saveQuotationHandlingInaccessibleEntities() (QuotationsPage.ts).
      // clearAssociatedCompany()/clearAssociatedContacts() only dismiss the
      // menu conditionally (a 500ms visibility check that can miss a
      // slower-to-render portal), so this unconditional Escape is needed
      // here too, before the next save click. WHY a condition-based wait,
      // not a flat timeout (fixed per CLAUDE.md rule #2): waits for the
      // real signal — the menu actually closing — same
      // `.is-invalid__menu`-hidden check already proven in
      // QuotationsPage.fillOwner()'s retry backoff.
      await restrictedPage.keyboard.press('Escape');
      await restrictedPage
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});

      if (attempt < maxRetries) {
        // WHY: A stale error toast from the PREVIOUS failed attempt can
        // still be visible/matching when assertErrorToast() checks below,
        // even though THIS attempt's save actually succeeded — confirmed
        // live (2026-08-11): assertErrorToast() returned true in ~170ms,
        // too fast to reflect THIS attempt's real response, and the actual
        // POST response (with quotationId) only arrived ~600ms later. A
        // flat delay to "let the response listener catch up" was a guess,
        // not a real wait — fixed per CLAUDE.md rule #2 by registering a
        // page.waitForResponse() on the actual save POST/PATCH/PUT BEFORE
        // the triggering click (same URL/method matching convention as
        // QuotationsPage.saveQuotationHandlingInaccessibleEntities()'s own
        // create/update response interception), then awaiting the real
        // response instead of guessing how long it takes to arrive.
        const retryResponsePromise = restrictedPage
          .waitForResponse(
            (res) =>
              /^\/v1\/quotations\/?(\d+)?\/?$/.test(new URL(res.url()).pathname) &&
              ['POST', 'PATCH', 'PUT'].includes(res.request().method()),
            { timeout: 20000 }
          )
          .catch(() => null);
        await qp.saveQuotationExpectingError();
        stillFailing = await qp.assertErrorToast();
        const retryResponse = await retryResponsePromise;
        if (retryResponse && retryResponse.status() < 400) {
          const body = await retryResponse.json().catch(() => ({}));
          const id = body?.id ?? body?.data?.id ?? null;
          if (id) quotationId = id;
          logger.info(`Retry save response confirms success (id: ${quotationId}) despite toast state`);
          stillFailing = false;
        }
        logger.info(`Retry ${attempt} error message captured: "${errorMessage}"`);
      } else {
        // Final allowed attempt — require success; saveQuotation() itself
        // throws a clear error if this genuinely doesn't succeed.
        await qp.saveQuotation();
        stillFailing = false;
      }
    }

    if (stillFailing) {
      throw new Error(
        `Quotation save still failing after clearing ${[...cleared].join(' and ')} — last error: "${errorMessage}"`
      );
    }
    if (cleared.size > 0) {
      await qp.assertSuccessToast();
      await qp.assertOnListPage();
    } else {
      logger.warn('Save already succeeded on first attempt — skipping retry');
    }

    // WHY: Verify by ID captured from the save response instead of list
    // search-by-summary — the response body's id is authoritative and
    // immediate, avoiding any list search-index lag.
    if (!quotationId) {
      throw new Error('Quotation ID not captured from save response — cannot verify by ID');
    }
    await qp.goToQuotationDetail(String(quotationId));
    await qp.assertDetailPageFields(data);
    logger.success(`Q7 passed — inaccessible entity handled, quotation created on retry (id: ${quotationId})`);
  });

  // ─── T7b ──────────────────────────────────────────────────────────────────
  // WHY: Distinct from Q7 — Q7 exercises the deal itself being inaccessible
  // via a manual inline retry. This exercises saveQuotationHandlingInaccessibleEntities()
  // directly: a deal that IS selectable, but whose auto-populated Associated
  // Contact and/or Associated Company the restricted user cannot access —
  // confirmed live (staging) that this returns HTTP 422 { errorCode: "029003",
  // message: "Invalid contact - id: <id>" } and the fallback must strip the
  // named entity (and Company too if still failing) before retrying.
  test('@regression restricted user should save quotation after fallback removes inaccessible deal-linked contact/company', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);

    // WHY: Whether the randomly-selected deal's auto-populated Associated
    // Contact/Company happens to be inaccessible to the restricted user is
    // NOT something this test controls — it depends entirely on which deal
    // gets picked. Both outcomes are valid and must PASS: if the 029003 error
    // is thrown, the fallback must catch it and recover; if it isn't, there
    // was nothing to fall back from and the save should simply succeed on
    // the first attempt. Only fail if the save itself doesn't succeed —
    // never for the error not reproducing this particular run.
    const data = generateRestrictedQuotationData();
    await qp.goToQuotationsList();
    await qp.openCreateForm();
    await qp.fillQuotationForm(data);
    const result = await qp.saveQuotationHandlingInaccessibleEntities();

    expect(result.succeeded, 'Save should succeed, whether or not a fallback was needed').toBe(true);

    if (result.removedEntities.length > 0) {
      // Confirm the fallback's own report of what it identified/removed —
      // must be exactly 'contact' and/or 'company', nothing else.
      for (const entity of result.removedEntities) {
        expect(['contact', 'company']).toContain(entity);
      }
      logger.success(
        `Inaccessible entity error was hit this run — fallback removed [${result.removedEntities.join(', ')}], ` +
          `server-identified cause: "${result.lastErrorMessage}"`
      );
    } else {
      logger.info(
        "No inaccessible entity error this run — the randomly-selected deal's linked contact/company " +
          'were already accessible, so there was nothing to fall back from. This is a valid, passing outcome.'
      );
    }

    await qp.assertSuccessToast();
    await qp.assertOnListPage();
    await qp.assertQuotationInList(data.summary);
    logger.success(
      result.removedEntities.length > 0
        ? `T7b passed — fallback removed [${result.removedEntities.join(', ')}] and quotation saved`
        : 'T7b passed — quotation saved directly, no inaccessible entity encountered this run'
    );
  });

  // ─── Q8 ───────────────────────────────────────────────────────────────────
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
    // WHY: assertQuotationInList searches fulltext by the provided term. Pass summary — not
    // quotationNumber — because the list view renders system-assigned QUO-XXXXX numbers, not
    // the custom ADM... prefix we enter. Summary IS indexed by the fulltext search API.
    await adminQP.assertQuotationInList(adminData.summary);

    await restrictedQP.assertQuotationNotInList(adminData.summary);
    logger.success('Q8 passed — restricted user cannot see admin-owned quotation');
  });

  // ─── Q9 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should update own quotation', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    const data = generateRestrictedQuotationData();

    const { id } = await qp.createQuotation(data);
    await qp.updateQuotation(
      data.quotationNumber,
      // WHY: Summary field is disabled in edit mode on this Kylas CRM version — omit it
      { status: QuotationStatus.Negotiation, additionalDiscount: 5 },
      id ?? undefined
    );
    // WHY: updateQuotation ends with goToQuotationDetail which already waits for the API
    // response — the extra waits below are a staging safety net for slower renders
    await restrictedPage.waitForLoadState('domcontentloaded');
    await qp.waitForVisible(restrictedPage.locator('h1.h1, .page-title h1').first(), 30000);
    await restrictedPage.waitForTimeout(3000);
    // WHY: Summary update not asserted — field is disabled in edit mode on this CRM version
    logger.warn('Summary update skipped — field is disabled in edit mode on this CRM version');
    await qp.assertStatusOnDetailPage(QuotationStatus.Negotiation);
    logger.success('Q9 passed');
  });

  // ─── Q10 ──────────────────────────────────────────────────────────────────
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
    // WHY: Retry search — prod indexing lag can delay visibility after ownership assignment
    let found = false;
    const maxRetries = 5;
    const retryWait = 3000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.info(`Search attempt ${attempt}/${maxRetries} for: ${adminData.summary}`);
      await restrictedQP.goToQuotationsList();
      await restrictedQP.searchQuotation(adminData.summary);
      await restrictedPage.waitForTimeout(2000);
      const allRows = restrictedPage.locator('.rt-tr-group');
      const rowCount = await allRows.count();
      for (let i = 0; i < rowCount; i++) {
        const text = (await allRows.nth(i).innerText().catch(() => '')).trim();
        if (text.length > 0) {
          found = true;
          break;
        }
      }
      if (found) break;
      logger.warn(`Quotation not found yet — waiting ${retryWait}ms before retry`);
      await restrictedPage.waitForTimeout(retryWait);
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
    logger.success('Q10 passed — restricted user saw and edited quotation as owner');
  });

  // ─── Q22 ──────────────────────────────────────────────────────────────────
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
      await qp.searchAndOpenQuotation(data.summary);
    }

    await qp.assertDetailPageFields(data);
    const chips = restrictedPage.locator('.related-entity-container');
    if ((await chips.count()) === 0) throw new Error('No entity chips on detail page');

    const bodyText = await restrictedPage.locator('body').innerText();
    // WHY: quotationNumber (RES prefix) may not show on detail — assert summary only
    expect(bodyText.toLowerCase()).toContain(data.summary.toLowerCase());
    logger.success('Q22 passed');
  });

  // ─── Q23 ──────────────────────────────────────────────────────────────────
  test('@regression restricted user should verify grand total math', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const qp = new QuotationsPage(restrictedPage);
    // WHY: Confirmed live (2026-07-06) — this test doesn't care which deal backs
    // the quotation, only the discount/tax/adjustment math, so relying on
    // fillQuotationForm's selectRandomDeal() (any deal visible to the restricted
    // user, including ones shared with only partial associated-entity access)
    // risked landing on a deal whose linked contact/company the restricted user
    // can't fully access, tripping the "required permissions on associated
    // entities" (029003) error on save — this test has no strip-and-retry
    // handling for that, unlike Q7/T7b. A self-created deal with NO associated
    // entities (skipAssociatedEntities) removes that failure class entirely
    // rather than just narrowing its odds.
    const restrictedDealsPage = new DealsPage(restrictedPage);
    const dealData = generateDealData({ skipAssociatedEntities: true });
    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.createDeal(dealData);
    logger.info(`Restricted-owned deal created (no associated entities): "${dealData.name}"`);

    const data = generateRestrictedQuotationData({ dealName: dealData.name });
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
    logger.success('Q23 passed');
  });

  // ─── Q24 ──────────────────────────────────────────────────────────────────
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
    logger.success(`Q24 passed — downloaded: ${filename} (${size} bytes)`);
  });

  // ─── Q25 ──────────────────────────────────────────────────────────────────
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
      await restrictedQP.navigateTo(`${config.appUrl}/sales/quotations/details/${id}`);
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
    logger.success('Q25 passed');
  });

  // ─── Q26 ──────────────────────────────────────────────────────────────────
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
    // WHY: fixed 2026-07-20 — this used to be a raw restrictedPage.goto(),
    // bypassing BasePage.navigateTo() (and its mid-test session-recovery)
    // entirely. That gap is exactly why this test failed live (2026-07-19,
    // sandbox CI): the restricted user's session genuinely expired
    // server-side ~24 minutes in, mid-test, landing on /signIn — a raw goto
    // has no recovery path at all. goToQuotationDetail() already exists and
    // is already used later in this same test (see below) — using it here
    // too means this navigation now benefits from the same recovery
    // mechanism, automatically, with no test-specific logic added.
    await restrictedQP.goToQuotationDetail(id!);
    // WHY: fixed 2026-07-20 — found via a real re-run failure after the fix
    // above: goToQuotationDetail() only waits for the URL + API response, not
    // for React to actually render the page. The old raw goto's flat
    // waitForTimeout(3000) was accidentally covering this gap too; removing
    // it exposed it. See waitForDetailPageRendered()'s own comment.
    await restrictedQP.waitForDetailPageRendered();

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
    const updatedSummary = `Q26 Edit ${Date.now()}`;
    await restrictedQP.fillEditForm({ summary: updatedSummary });
    await restrictedQP.saveQuotation();
    await restrictedQP.assertSuccessToast();

    // Navigate to detail page to verify the updated summary is visible
    await restrictedQP.goToQuotationDetail(id!);
    await restrictedPage.waitForTimeout(2000);
    const updatedBody = await restrictedPage.locator('body').innerText();
    expect(updatedBody).toContain(updatedSummary);
    logger.success('Q26 passed — restricted user edited shared quotation with accessible deal');
  });

  // ─── Q27 ──────────────────────────────────────────────────────────────────
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
    // WHY: Pass summary not quotationNumber — the list shows system QUO-XXXXX numbers,
    // not the custom ADM... prefix. Summary is indexed by the fulltext search API.
    await adminQP.assertQuotationInList(adminData.summary);

    await restrictedQP.assertQuotationNotInList(adminData.summary);
    logger.success('Q27 passed — restricted user cannot find admin-owned quotation');
  });

  // ─── Q28 ──────────────────────────────────────────────────────────────────
  test('@prodSafe restricted user should navigate to quotations list on production', async ({
    restrictedPage,
  }) => {
    const qp = new QuotationsPage(restrictedPage);
    await qp.goToQuotationsList();
    await qp.assertOnListPage();
    logger.success('Q28 passed');
  });
});
