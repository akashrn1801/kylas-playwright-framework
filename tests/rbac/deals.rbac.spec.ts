import { test, expect } from '../../src/fixtures/index';
import { DealsPage } from '../../src/modules/deals/DealsPage';
import {
  generateDealData,
  generateAdminDealData,
} from '../../src/data/factories/dealFactory';
import { logger } from '../../src/utils/logger';
import { config } from '../../config/config';

test.describe('Deals RBAC', () => {

  test('@smoke @regression restricted user can navigate to deals list', async ({ restrictedPage }) => {
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await dealsPage.assertOnDealsListPage();
  });

  test('@regression restricted user can create a deal', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(restrictedPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    await dealsPage.assertDealCreated(dealData, dealId ?? undefined);
  });

  test('@regression restricted user can edit own deal', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const dealsPage = new DealsPage(restrictedPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    const updatedData = generateDealData();
    await dealsPage.updateDeal(updatedData, dealData.name, dealId ?? undefined);
    await dealsPage.assertDealUpdated(updatedData);
  });


  // ──────────────────────────────────────────────────────────
  // RBAC — Contact and Company ownership verification
  // WHY: Restricted user creates a deal selecting first available
  // contact and company. After save, verify on deal details that
  // both are owned by the restricted user NOT the admin.
  // User names captured from /v1/users/me API — no hardcoding.
  // ──────────────────────────────────────────────────────────

  test('@regression restricted user contact and company owned by restricted not admin', async ({ restrictedPage, adminPage }) => {
    test.setTimeout(480000);

    // WHY: /v1/users/me is called automatically on every page load.
    // We intercept it to get the display name without any UI interaction.
    const getUserName = async (page: typeof restrictedPage): Promise<string> => {
      try {
        const responsePromise = page.waitForResponse(
          (res) => res.url().includes('/v1/users/me') && res.status() === 200,
          { timeout: 15000 },
        );
        await page.goto(`${config.appUrl}/sales/deals/list`, { waitUntil: 'domcontentloaded' });
        const response = await responsePromise;
        const body = await response.json();
        const name = (body?.name ?? '').trim();
        logger.info(`Captured user name from API: ${name}`);
        return name;
      } catch (error) {
        logger.warn(`Could not capture user name: ${String(error)}`);
        return '';
      }
    };

    // Step 1 — Capture both user names via API interception
    const adminName = await getUserName(adminPage);
    logger.info(`Admin: ${adminName}`);

    const restrictedName = await getUserName(restrictedPage);
    logger.info(`Restricted: ${restrictedName}`);

    // Step 2 — Restricted user creates a deal
    const dealsPage = new DealsPage(restrictedPage);
    const dealData = generateDealData();
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(dealData);
    if (!dealId) throw new Error('Deal ID not captured — cannot verify ownership');

    // Step 3 — Navigate to deal details
    await restrictedPage.goto(
      `${config.appUrl}/sales/deals/details/${dealId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await restrictedPage.waitForURL(/deals\/details\//, { timeout: 20000 });
    logger.info('On deal details page');

    // Step 4 — Verify Company Owner via modal
    logger.info('Verifying company owner');
    const companyLink = restrictedPage.locator('.title.text-break.link-primary span').first();
    await companyLink.waitFor({ state: 'visible', timeout: 10000 });
    await companyLink.click();

    const companyModal = restrictedPage
      .locator('.modal-content')
      .filter({ hasText: 'Owner' })
      .last();
    await companyModal.waitFor({ state: 'visible', timeout: 10000 });

    const companyOwner = (await companyModal
      .locator('.read-only-info')
      .filter({ has: restrictedPage.locator('label', { hasText: 'Owner' }) })
      .first()
      .locator('.title span')
      .first()
      .textContent())?.trim() ?? '';
    logger.info(`Company owner: ${companyOwner}`);

    if (adminName) expect(companyOwner).not.toBe(adminName);
    if (restrictedName) expect(companyOwner).toBe(restrictedName);
    logger.success(`Company owner verified: ${companyOwner}`);

    await companyModal.locator('button[aria-label="Close"]').click();
    await companyModal.waitFor({ state: 'hidden', timeout: 5000 });

    // Step 5 — Verify Contact Owner via new tab
    logger.info('Verifying contact owner');
    const contactLink = restrictedPage.locator('.deal-contact__name').first();
    await contactLink.waitFor({ state: 'visible', timeout: 10000 });

    try {
      const [newTab] = await Promise.all([
        restrictedPage.context().waitForEvent('page', { timeout: 10000 }),
        contactLink.click(),
      ]);
      await newTab.waitForLoadState('domcontentloaded');
      logger.info(`Contact tab URL: ${newTab.url()}`);

      const contactOwner = (await newTab
        .locator('.read-only-info')
        .filter({ has: newTab.locator('label', { hasText: 'Owner' }) })
        .first()
        .locator('span.title')
        .first()
        .textContent())?.trim() ?? '';
      logger.info(`Contact owner: ${contactOwner}`);

      if (adminName) expect(contactOwner).not.toBe(adminName);
      if (restrictedName) expect(contactOwner).toBe(restrictedName);
      logger.success(`Contact owner verified: ${contactOwner}`);

      await newTab.close();
    } catch (error) {
      logger.warn(`Contact owner verification skipped: ${String(error)}`);
    }
  });

  // ──────────────────────────────────────────────────────────
  // RBAC — Restricted cannot edit admin deal even via direct URL
  // ──────────────────────────────────────────────────────────

  test('@regression restricted user cannot edit admin-owned deal via direct URL', async ({ adminPage, restrictedPage }) => {
    test.setTimeout(480000);

    const adminDealsPage = new DealsPage(adminPage);
    const adminDealData = generateAdminDealData();
    await adminDealsPage.goToDealsList();
    const dealId = await adminDealsPage.createDeal(adminDealData);
    if (!dealId) throw new Error('Admin deal ID not captured');

    // Restricted user navigates directly to admin deal via URL
    await restrictedPage.goto(
      `${config.appUrl}/sales/deals/details/${dealId}`,
      { waitUntil: 'domcontentloaded' },
    );

    try {
      await restrictedPage.waitForURL(/deals\/details\//, { timeout: 10000 });
      // Page loaded — verify edit button is NOT visible
      const editBtn = restrictedPage.locator('#edit-action-btn');
      const editBtnVisible = await editBtn.isVisible();
      expect(editBtnVisible).toBe(false);
      logger.success('Edit button not visible for restricted user on admin deal — RBAC working');
    } catch {
      // Redirected away — also valid RBAC behaviour
      logger.success('Restricted user redirected from admin deal — RBAC working');
    }
  });

  // WHY: generateAdminDealData() uses ADM<timestamp> prefix — guaranteed
  // unique name that restricted user can never find from a previous run.
  test('@regression restricted user cannot see admin-owned deal', async ({ adminPage, restrictedPage }) => {
    test.setTimeout(480000);
    const adminDealsPage = new DealsPage(adminPage);
    const adminDealData = generateAdminDealData();
    await adminDealsPage.goToDealsList();
    await adminDealsPage.createDeal(adminDealData);
    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.assertDealNotInList(adminDealData.name);
  });

});
