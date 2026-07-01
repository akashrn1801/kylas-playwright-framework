import { test, expect } from '../../../src/fixtures/index';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import {
  generateCompanyData,
  generateSharedCompanyData,
} from '../../../src/data/factories/companyFactory';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

test.describe('Companies', () => {

  // ── CO1 ───────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to companies list page', async ({ adminPage }) => {
    const companiesPage = new CompaniesPage(adminPage);

    await companiesPage.goToCompaniesList();
    await companiesPage.assertOnCompaniesListPage();
    logger.success('CO1 passed');
  });

  // ── CO2 ───────────────────────────────────────────────────

  test('@regression admin should create a new company with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);

    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();

    await companiesPage.goToCompaniesList();

    const companyId = await companiesPage.createCompany(companyData);

    await companiesPage.assertCompanyCreated(companyData, companyId ?? undefined);
    logger.success('CO2 passed');
  });

  // ── CO3 ───────────────────────────────────────────────────

  test('@regression admin should update a created company', async ({ adminPage }) => {
    test.setTimeout(480000);

    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();

    await companiesPage.goToCompaniesList();
    await companiesPage.createCompany(companyData);

    const updatedData = generateCompanyData();

    await companiesPage.updateCompany(updatedData, companyData.name);
    await companiesPage.assertCompanyUpdated(updatedData);
    logger.success('CO3 passed');
  });

  // ── CO4 ───────────────────────────────────────────────────

  test('@smoke @regression admin should verify all field values on detail page after create', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    // WHY: Navigate directly via ID — avoids search index lag
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    await companiesPage.assertCompanyDetailFields(companyData);
    logger.success('CO4 passed');
  });

  // ── CO5 ───────────────────────────────────────────────────

  test('@regression admin should verify all updated field values on detail page after edit', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    // WHY: Use updateCompanyFull to update all fields (not just name)
    const updatedData = generateCompanyData();
    await companiesPage.updateCompanyFull(updatedData, companyData.name, companyId ?? undefined);
    // WHY: Navigate to detail page via ID to verify all updated fields
    await companiesPage.searchAndOpenCompany(updatedData.name, companyId ?? undefined);
    await companiesPage.assertCompanyDetailFields(updatedData);
    logger.success('CO5 passed');
  });

  // ── CO6 ───────────────────────────────────────────────────

  test('@regression admin should clone a company via ellipsis menu', async ({ adminPage }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    await companiesPage.cloneCompany();
    await companiesPage.assertClonedCompanyName(companyData.name);
    logger.success('CO6 passed');
  });

  // ── CO7 ───────────────────────────────────────────────────

  test('@regression admin should share a company with restricted user', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminCompaniesPage = new CompaniesPage(adminPage);
    const companyData = generateSharedCompanyData();
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await adminCompaniesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const restrictedUserName = await adminCompaniesPage.getLoggedInUserName('restricted');
    await adminCompaniesPage.shareCompany(restrictedUserName, []);
    // WHY: Restricted user should now see this company in their list
    const restrictedCompaniesPage = new CompaniesPage(restrictedPage);
    await restrictedCompaniesPage.goToCompaniesList();
    await restrictedCompaniesPage.assertCompanyExistsInList(companyData.name);
    logger.success('CO7 passed');
  });

  // ── CO8 ───────────────────────────────────────────────────

  test('@regression admin should delete a company and verify it is removed', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    await companiesPage.deleteCompany();
    await companiesPage.assertCompanyDeletedById(companyId!);
    logger.success('CO8 passed');
  });

  // ── CO9 ───────────────────────────────────────────────────

  test('@regression admin should add a note to a company from productivity panel', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Click Notes icon to open notes panel, then capture baseline before adding
    await companiesPage.clickRightPanelIcon('Notes');
    await adminPage.waitForTimeout(500);
    // WHY: Capture baseline before adding notes — entity may have pre-existing notes from prior runs
    const baselineCount = await adminPage.locator('div.row.pt-2.pl-2.pr-2').count();
    const noteText = `Test note CO9 ${Date.now()}`;
    await adminPage.locator('textarea.notes-textarea').click();
    await adminPage.waitForTimeout(1000);
    await adminPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill(noteText);
    await adminPage.waitForTimeout(500);
    await adminPage.getByText('Add', { exact: true }).click();
    await adminPage.waitForTimeout(1500);
    // WHY: Verify note row count increased relative to baseline
    const notesAfterAdd = await adminPage.locator('div.row.pt-2.pl-2.pr-2').count();
    expect(notesAfterAdd).toBe(baselineCount + 1);
    // WHY: Verify note text via CKEditor iframe (skip active editor)
    const checkNoteText = async (text: string): Promise<boolean> =>
      adminPage.evaluate((t) => {
        for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
          if (iframe.title && iframe.title.includes('Rich Text Editor')) continue;
          try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
        }
        return false;
      }, text);
    expect(await checkNoteText(noteText)).toBe(true);
    logger.success(`CO9 passed — note added and verified: ${noteText}`);
  });

  // ── CO10 ──────────────────────────────────────────────────

  test('@regression admin should add a task to a company from productivity panel', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const taskName = `CO10 Task ${Date.now()}`;
    await companiesPage.addTaskFromPanel(taskName);
    // WHY: Click Tasks icon again to refresh the task list and verify task appears
    await companiesPage.clickRightPanelIcon('Tasks');
    await adminPage.waitForTimeout(1000);
    const taskLocator = adminPage.locator('.task-details-wrapper').getByText(taskName).first();
    await expect(taskLocator).toBeVisible({ timeout: 10000 });
    logger.success(`CO10 passed — task added: ${taskName}`);
  });

  // ── CO11 ──────────────────────────────────────────────────

  test('@regression admin should add a meeting to a company from productivity panel', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const meetingTitle = `CO11 Meeting ${Date.now()}`;
    await companiesPage.addMeetingFromPanel(meetingTitle);
    // WHY: Navigate back and verify meeting appears in Meetings section
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    await companiesPage.clickRightPanelIcon('Meetings');
    await adminPage.waitForTimeout(1000);
    const meetingEntry = adminPage.locator('.meeting__title').filter({ hasText: meetingTitle });
    await expect(meetingEntry).toBeVisible({ timeout: 10000 });
    logger.success(`CO11 passed — meeting added: ${meetingTitle}`);
  });

  // ── CO12 ──────────────────────────────────────────────────

  test('@regression admin should add a quotation to a company from productivity panel', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const dealsPage = new DealsPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Create a deal first — quotation requires an associated deal
    const dealData = generateDealData();
    const dealId = await companiesPage.addDealFromDirectButton(dealData, dealsPage);
    expect(dealId).not.toBeNull();
    logger.success(`Deal created for quotation test: ${dealId}`);
    // WHY: Navigate back to company detail after deal creation
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Add quotation from the Quotations productivity icon panel
    const quotationId = await companiesPage.addQuotationFromPanel();
    expect(quotationId).not.toBeNull();
    logger.success(`Quotation created: ${quotationId}`);
    // WHY: Verify quotation appears in Quotations card on company detail
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const quotationsCard = adminPage.locator('.card').filter({ has: adminPage.locator('h2').filter({ hasText: 'Quotations' }) }).first();
    await quotationsCard.scrollIntoViewIfNeeded();
    const quotationEntry = quotationsCard.locator('ul.card-list li, .list-item, a').first();
    await expect(quotationEntry).toBeVisible({ timeout: 10000 });
    logger.success(`CO12 passed — quotation created and verified: ${quotationId}`);
  });

  // ── CO13 ──────────────────────────────────────────────────

  test('@regression admin should add a contact from direct button on company detail page', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const contactData = generateContactData();
    const contactId = await companiesPage.addContactFromDirectButton(contactData);
    expect(contactId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Wait for card to show the new contact row before asserting content
    // Using row-count baseline approach per CLAUDE.md baseline-count pattern
    const contactsCard = adminPage.locator('.card').filter({ hasText: 'Contacts' }).first();
    await contactsCard.scrollIntoViewIfNeeded();
    // WHY: Wait for contact count to show (1) indicating the new contact rendered
    await expect(contactsCard).toContainText('Contacts (1)', { timeout: 15000 });
    // WHY: Assert both firstName AND lastName — the card renders full name
    await expect(contactsCard).toContainText(contactData.firstName, { timeout: 10000 });
    await expect(contactsCard).toContainText(contactData.lastName, { timeout: 10000 });
    logger.success(`CO13 passed — contact added: ID=${contactId}, name=${contactData.firstName} ${contactData.lastName}`);
  });

  // ── CO14 ──────────────────────────────────────────────────

  test('@regression admin should add a deal with product and part payment from direct button on company detail page', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const dealsPage = new DealsPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const dealData = generateDealData();
    const dealId = await companiesPage.addDealFromDirectButton(dealData, dealsPage);
    expect(dealId).not.toBeNull();
    logger.success(`Deal created with ID: ${dealId}`);
    // WHY: Navigate back to company detail and verify deal appears in Related Deals section
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const relatedDealsCard = adminPage.locator('.card-header').filter({ hasText: 'Related Deals' });
    await expect(relatedDealsCard).toBeVisible({ timeout: 10000 });
    const dealEntry = adminPage.locator('a.list__anchor.row').filter({ hasText: dealData.name }).first();
    await expect(dealEntry).toBeVisible({ timeout: 10000 });
    logger.success(`CO14 passed — deal with pipeline, product and payment created: ${dealId}`);
  });

  // ── CO15 ──────────────────────────────────────────────────

  test('@regression admin should add a second contact from ellipsis dropdown menu', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Add first contact via direct button — this makes the direct button disappear
    const firstContactData = generateContactData();
    const firstContactId = await companiesPage.addContactFromDirectButton(firstContactData);
    expect(firstContactId).not.toBeNull();
    // WHY: Navigate back to company detail — direct button gone, must use ellipsis
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const secondContactData = generateContactData();
    const secondContactId = await companiesPage.addContactFromEllipsis(secondContactData);
    expect(secondContactId).not.toBeNull();
    // WHY: Verify second contact appears in the Contacts card
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const contactsCard = adminPage.locator('.card').filter({ hasText: 'Contacts' }).first();
    await contactsCard.scrollIntoViewIfNeeded();
    await expect(contactsCard).toContainText(secondContactData.firstName, { timeout: 10000 });
    logger.success(`CO15 passed — second contact added via ellipsis: ID=${secondContactId}`);
  });

  // ── CO16 ──────────────────────────────────────────────────

  test('@regression admin should add a second deal from ellipsis dropdown menu', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const dealsPage = new DealsPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    // WHY: Add first deal via direct button — this may remove the direct button
    const firstDealData = generateDealData();
    const firstDealId = await companiesPage.addDealFromDirectButton(firstDealData, dealsPage);
    expect(firstDealId).not.toBeNull();
    // WHY: Navigate back to company detail — use ellipsis for the second deal
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const secondDealData = generateDealData();
    const secondDealId = await companiesPage.addDealFromEllipsis(secondDealData, dealsPage);
    expect(secondDealId).not.toBeNull();
    // WHY: Verify second deal appears in Related Deals section
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const dealEntry = adminPage.locator('a.list__anchor.row').filter({ hasText: secondDealData.name }).first();
    await expect(dealEntry).toBeVisible({ timeout: 10000 });
    logger.success(`CO16 passed — second deal added via ellipsis: ID=${secondDealId}`);
  });

  // ── CO17 ──────────────────────────────────────────────────

  test('@regression admin should add a task from pending activity quick-add section', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    await companiesPage.searchAndOpenCompany(companyData.name, companyId ?? undefined);
    const taskName = `CO17 PendingTask ${Date.now()}`;
    const { taskId } = await companiesPage.addTaskFromPendingActivity(taskName);
    logger.success(`Task created from pending activity: ID=${taskId}`);
    // WHY: Verify task appears in Tasks panel on company detail
    await companiesPage.clickRightPanelIcon('Tasks');
    await adminPage.waitForTimeout(1000);
    const taskLocator = adminPage.locator('.task-details-wrapper').getByText(taskName).first();
    await expect(taskLocator).toBeVisible({ timeout: 10000 });
    logger.success(`CO17 passed — task from pending activity verified: ${taskName}`);
  });

});
