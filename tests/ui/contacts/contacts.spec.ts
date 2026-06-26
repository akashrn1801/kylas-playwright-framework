import { test, expect } from '../../../src/fixtures/index';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { generateContactData } from '../../../src/data/factories/contactFactory';
import { generateDealData } from '../../../src/data/factories/dealFactory';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

test.describe('Contacts', () => {

  // ── C1 ────────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to contacts list page', async ({ adminPage }) => {
    const contactsPage = new ContactsPage(adminPage);
    await contactsPage.goToContactsList();
    await contactsPage.assertOnContactsListPage();
    logger.success('C1 passed');
  });

  // ── C2 ────────────────────────────────────────────────────

  test('@regression admin should create a new contact with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    await contactsPage.assertContactCreated(contactData, contactId ?? undefined);
    logger.success('C2 passed');
  });

  // ── C3 ────────────────────────────────────────────────────

  test('@regression admin should update a created contact', async ({ adminPage }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    await contactsPage.createContact(contactData);
    const updatedData = generateContactData();
    await contactsPage.updateContact(updatedData, contactData.firstName);
    await contactsPage.assertContactUpdated(updatedData);
    logger.success('C3 passed');
  });

  // ── C4 ────────────────────────────────────────────────────

  test('@regression admin should verify all field values on detail page after create', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    // WHY: Navigate directly via ID — avoids search index lag
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await contactsPage.assertContactDetailFields(contactData);
    logger.success('C4 passed');
  });

  // ── C5 ────────────────────────────────────────────────────

  test('@regression admin should verify all field values on detail page after update', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    const updatedData = generateContactData();
    await contactsPage.updateContact(updatedData, contactData.firstName, contactId ?? undefined);
    // WHY: Navigate to detail page via ID to verify all updated fields
    await contactsPage.searchAndOpenContact(updatedData.firstName, contactId ?? undefined);
    await contactsPage.assertContactDetailFields(updatedData);
    logger.success('C5 passed');
  });

  // ── C6 ────────────────────────────────────────────────────

  test('@regression admin should delete a contact and verify it is removed', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await contactsPage.deleteContact();
    await contactsPage.assertContactDeletedById(contactId!);
    logger.success('C6 passed');
  });

  // ── C7 ────────────────────────────────────────────────────

  test('@regression admin should clone a contact and verify cloned contact exists', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await contactsPage.cloneContact();
    await contactsPage.assertClonedContactLastName(contactData.lastName);
    logger.success('C7 passed');
  });

  // ── C8 ────────────────────────────────────────────────────

  test('@regression admin should see validation error when lastName is missing', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    await contactsPage.goToContactsList();
    await contactsPage.clickAddContact();
    // WHY: Fill only firstName — leave lastName empty to trigger validation
    const contactData = generateContactData();
    await contactsPage.fillContactForm({ ...contactData, lastName: '' });
    await adminPage.locator('button[type="submit"].save-button').click();
    await contactsPage.assertValidationError('last');
    logger.success('C8 passed');
  });

  // ── C9 ────────────────────────────────────────────────────

  test('@regression admin should see owner field on contact detail page', async ({ adminPage }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    // WHY: Owner should be the logged-in admin user
    const adminName = await contactsPage.getLoggedInUserName('admin');
    await contactsPage.assertOwnerOnDetail(adminName);
    logger.success('C9 passed');
  });

  // ── C10 ───────────────────────────────────────────────────

  test('@regression admin should see Notes Tasks Meetings Call Logs and Quotations icons on contact detail', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    // WHY: Verify all productivity icons visible for admin (owner)
    await contactsPage.assertRightPanelIconVisible('Notes');
    await contactsPage.assertRightPanelIconVisible('Tasks');
    await contactsPage.assertRightPanelIconVisible('Meetings');
    await contactsPage.assertRightPanelIconVisible('Call Logs');
    await contactsPage.assertRightPanelIconVisible('Quotations');
    // WHY: Click each icon and verify the corresponding card section loads
    await contactsPage.assertDetailTabContent('Notes');
    await contactsPage.assertDetailTabContent('Tasks');
    await contactsPage.assertDetailTabContent('Meetings');
    logger.success('C10 passed');
  });

  // ── C11 ───────────────────────────────────────────────────

  test('@regression admin should reassign contact to restricted user', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    // WHY: Get restricted user display name for reassign
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.reassignContact(restrictedUserName);
    // WHY: Restricted user should now see this contact in their list
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.assertContactExistsInList(contactData.firstName);
    logger.success('C11 passed');
  });

  // ── C12 ───────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to contact detail via direct URL', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    // WHY: Navigate directly to detail URL — tests URL-based navigation works
    await adminPage.goto(
      `${config.appUrl}/sales/contacts/details/${contactId}`,
      { waitUntil: 'domcontentloaded' }
    );
    await adminPage.waitForURL(/contacts\/details\//, { timeout: 20000 });
    await contactsPage.assertOnContactDetailPage();
    logger.success('C12 passed');
  });

  // ── C13 ───────────────────────────────────────────────────

  test('@prodSafe admin should view contacts list safely', async ({ adminPage }) => {
    const contactsPage = new ContactsPage(adminPage);
    await contactsPage.goToContactsList();
    await contactsPage.assertOnContactsListPage();
    logger.success('C13 passed');
  });

  // ── C14 ───────────────────────────────────────────────────



  // ── C14 ───────────────────────────────────────────────────

  test('@regression admin should add a quotation from contact productivity panel', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const dealsPage = new DealsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    // WHY: Create a deal first — quotation requires an associated deal
    await contactsPage.clickEllipsisOption('Add Deal');
    await adminPage.locator('#editEntityModal').waitFor({ state: 'visible', timeout: 10000 });
    const dealData = generateDealData();
    await adminPage.locator('[id="0_11_input_name"]').fill(dealData.name);
    // WHY: Select pipeline — required for deal
    const pipelineControl = adminPage.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
    await pipelineControl.click();
    const pipelineOption = adminPage.getByText('Default Deal Pipeline', { exact: true });
    await pipelineOption.waitFor({ state: 'visible', timeout: 10000 });
    await pipelineOption.click();
    // WHY: Fill estimated value — required when no product is added
    const estimatedValueInput = adminPage.locator('[id="1_21_input_estimatedValue"]');
    if (await estimatedValueInput.isVisible().catch(() => false)) {
      await estimatedValueInput.fill('50000');
      logger.debug('Estimated value filled: 50000');
    }
    const dealSavePromise = adminPage.waitForResponse(
      (res) => (res.url().includes('/deals') || res.url().includes('/deal')) && res.request().method() === 'POST' && (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).catch(() => null);
    await adminPage.locator('#editEntityModal button.save-button').click();
    await adminPage.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    await dealSavePromise;
    logger.success('Deal created for quotation test');
    // WHY: Navigate back to contact detail
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    // WHY: Add quotation from the Quotations productivity icon panel
    const quotationId = await contactsPage.addQuotationFromPanel();
    expect(quotationId).not.toBeNull();
    logger.success(`Quotation created: ${quotationId}`);
    // WHY: Verify quotation appears in Quotations card on contact detail
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const quotationsCard = adminPage.locator('.card').filter({ has: adminPage.locator('h2').filter({ hasText: 'Quotations' }) }).first();
    await quotationsCard.scrollIntoViewIfNeeded();
    // WHY: Quotations card should now show at least 1 quotation entry
    const quotationEntry = quotationsCard.locator('ul.card-list li, .list-item, a').first();
    await expect(quotationEntry).toBeVisible({ timeout: 10000 });
    logger.success(`C14 passed — quotation created and verified on contact: ${quotationId}`);
  });



  // ── C15 ───────────────────────────────────────────────────

  test('@regression admin should add a deal with product and part payment from contact ellipsis menu', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const dealsPage = new DealsPage(adminPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await contactsPage.clickEllipsisOption('Add Deal');
    await adminPage.locator('#editEntityModal').waitFor({ state: 'visible', timeout: 10000 });
    await expect(adminPage.locator('#editEntityModal .modal-title')).toHaveText('Add Deal', { timeout: 5000 });
    // WHY: Wait for modal to fully initialize — contact ID must be resolved before filling fields
    await adminPage.locator('[id="0_11_input_name"]').waitFor({ state: 'visible', timeout: 10000 });
    const dealData = generateDealData();
    // WHY: Fill deal name
    await adminPage.locator('[id="0_11_input_name"]').fill(dealData.name);
    // WHY: Select pipeline — same locator as DealsPage.pipelineControl()
    const pipelineControl = adminPage.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
    await pipelineControl.click();
    const pipelineOption = adminPage.getByText('Default Deal Pipeline', { exact: true });
    await pipelineOption.waitFor({ state: 'visible', timeout: 10000 });
    await pipelineOption.click();
    logger.info('Pipeline selected');
    // WHY: Add product row
    await dealsPage.addProductRow();
    // WHY: Add 2 part payment installments
    await dealsPage.addPartPayments(2);
    // WHY: Set up response listener BEFORE clicking save — response may arrive immediately
    const dealIdPromise = adminPage.waitForResponse(
      (res) =>
        (res.url().includes('/deals') || res.url().includes('/deal')) &&
        res.request().method() === 'POST' &&
        (res.status() === 200 || res.status() === 201),
      { timeout: 30000 }
    ).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
    }).catch(() => null);
    await adminPage.locator('#editEntityModal button.save-button').click();
    await adminPage.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
    const dealId = await dealIdPromise;
    expect(dealId).not.toBeNull();
    logger.success(`Deal created with ID: ${dealId}`);
    // WHY: Navigate back to contact detail and verify deal appears in Related Deals section
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const relatedDealsCard = adminPage.locator('.card-header').filter({ hasText: 'Related Deals' });
    await expect(relatedDealsCard).toBeVisible({ timeout: 10000 });
    // WHY: Toggle is ON by default (dealsWithPipeline=true) — pipeline deals show automatically
    // No need to toggle — deal with pipeline should already be visible
    const dealToggle = adminPage.locator('#dealsWithPipeline');
    const isToggleChecked = await dealToggle.isChecked().catch(() => false);
    logger.info(`Pipeline deals toggle checked: ${isToggleChecked}`);
    // WHY: Find deal entry by name and click — opens in new tab
    const dealEntry = adminPage.locator('a.list__anchor.row').filter({ hasText: dealData.name }).first();
    await expect(dealEntry).toBeVisible({ timeout: 10000 });
    // WHY: Deal link opens in new tab — listen for new page before clicking
    const [newTab] = await Promise.all([
      adminPage.context().waitForEvent('page'),
      dealEntry.click(),
    ]);
    await newTab.waitForLoadState('domcontentloaded');
    await newTab.waitForURL(/deals\/details\//, { timeout: 20000 });
    // WHY: Verify contact name appears on deal detail page
    await expect(newTab.locator('body')).toContainText(contactData.firstName, { timeout: 10000 });
    logger.success(`Deal detail verified — contact name "${contactData.firstName}" found on deal page`);
    // WHY: Close new tab and return to contact detail
    await newTab.close();
    await adminPage.waitForURL(/contacts\/details\//, { timeout: 10000 });
    logger.success(`C15 passed — deal with pipeline, product and payment created and verified: ${dealId}`);
  });

});
