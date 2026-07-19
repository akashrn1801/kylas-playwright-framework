import { test, expect } from '../../../src/fixtures/index';
import { safeWaitForURL } from '../../../src/utils/navigation';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import {
  generateContactData,
  generateContactCustomFieldData,
  generateContactCustomFieldInvalidTextField,
  generateContactCustomFieldInvalidParagraphText,
  generateContactCustomFieldInvalidUrl,
  CONTACT_CUSTOM_FIELD_NAMES,
  ContactCustomFieldData,
} from '../../../src/data/factories/contactFactory';
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
    const clonedId = await contactsPage.cloneContact();
    expect(clonedId).not.toBeNull();
    await contactsPage.assertClonedContactLastName(contactData.lastName, clonedId!);
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
    await safeWaitForURL(adminPage, /contacts\/details\//, 20000);
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
    // WHY: Confirmed live (2026-07-06/07) — the Quotations card refetches its
    // own related-quotations list independently of the main contact GET.
    // scrollIntoViewIfNeeded() right after re-navigation can grab a reference
    // to a card mid-refetch that React then replaces, hanging until the test
    // timeout ("Target page ... closed", the timeout kill, not the real
    // cause — reproduced live on the equivalent Companies/Deals cards). An
    // auto-retrying expect() re-queries the locator each poll; no manual
    // scroll needed for a visibility check.
    await expect(quotationsCard, 'Quotations card should be visible after refetch').toBeVisible({
      timeout: 15000,
    });
    // WHY: Quotations card should now show at least 1 quotation entry
    const quotationEntry = quotationsCard.locator('ul.card-list li, .list-item, a').first();
    await expect(quotationEntry).toBeVisible({ timeout: 15000 });
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
    await safeWaitForURL(newTab, /deals\/details\//, 20000);
    // WHY: Verify contact name appears on deal detail page
    await expect(newTab.locator('body')).toContainText(contactData.firstName, { timeout: 10000 });
    logger.success(`Deal detail verified — contact name "${contactData.firstName}" found on deal page`);
    // WHY: Close new tab and return to contact detail
    await newTab.close();
    await safeWaitForURL(adminPage, /contacts\/details\//, 10000);
    logger.success(`C15 passed — deal with pipeline, product and payment created and verified: ${dealId}`);
  });

  // ──────────────────────────────────────────────────────────
  // Custom Fields ("Other Details" section)
  // ──────────────────────────────────────────────────────────
  // WHY: these 9 fields exist only on QA today (2026-07-14) and are expected
  // on Stage/Prod later with identical names — see ContactsPage/BasePage's
  // custom-field helpers for the environment-safety skip logic that makes
  // these tests (and every other Contact create/update path) work unchanged
  // once that happens. Mirrors LeadsPage's L17-L19 structure exactly — see
  // that file's own comments for the reasoning behind each case.

  // ── C16 ───────────────────────────────────────────────────

  test('@regression admin should create a contact with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();

    await contactsPage.goToContactsList();
    await contactsPage.clickAddContact();
    await contactsPage.skipIfCustomFieldsAbsent();
    await contactsPage.fillContactForm(contactData);
    const contactId = await contactsPage.saveContact();
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();

    await contactsPage.goToContactDetailsById(contactId!);
    await contactsPage.assertContactCustomFieldsOnDetail(contactData);
    logger.success('C16 passed');
  });

  // ── C17 ───────────────────────────────────────────────────

  test("@regression admin should update a contact's custom fields and verify updated values", async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();

    await contactsPage.goToContactsList();
    await contactsPage.clickAddContact();
    await contactsPage.skipIfCustomFieldsAbsent();
    await contactsPage.fillContactForm(contactData);
    const contactId = await contactsPage.saveContact();
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();

    const updatedData = generateContactData();
    await contactsPage.updateContact(updatedData, contactData.firstName, contactId ?? undefined);

    // WHY: updateContact() leaves the browser on the same contact detail page
    // (edit is an in-place modal, not a route change) — no re-navigation needed.
    await contactsPage.assertContactCustomFieldsOnDetail(updatedData);
    logger.success('C17 passed');
  });

  // ── C18 ───────────────────────────────────────────────────

  test('@regression admin should see validation errors for invalid custom field values and not save the contact', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);

    interface InvalidCustomFieldCase {
      description: string;
      customFieldOverrides: Partial<ContactCustomFieldData>;
      assertError: () => Promise<void>;
    }

    // WHY: Number is deliberately excluded — confirmed live (2026-07-14) that
    // it renders as a native <input type="number">, which rejects non-numeric
    // characters at the browser level. Playwright's fill() itself throws
    // ("Cannot type text into input[type=number]") before the app ever sees
    // an invalid value, so there is no realistic UI path to trigger this case.
    const cases: InvalidCustomFieldCase[] = [
      {
        description: 'TextField exceeding 255 characters',
        customFieldOverrides: { textField: generateContactCustomFieldInvalidTextField() },
        // WHY: confirmed live — client-side, on-blur inline validation.
        assertError: () =>
          contactsPage.assertCustomFieldValidationError(
            CONTACT_CUSTOM_FIELD_NAMES.textField,
            'Enter value having maximum 255 characters',
            'Text Field'
          ),
      },
      {
        description: 'UrlField with a malformed URL',
        customFieldOverrides: { urlField: generateContactCustomFieldInvalidUrl() },
        // WHY: confirmed live — client-side, on-blur inline validation.
        assertError: () =>
          contactsPage.assertCustomFieldValidationError(
            CONTACT_CUSTOM_FIELD_NAMES.urlField,
            'Enter a valid URL',
            'URL Field'
          ),
      },
      {
        description: 'ParagraphText exceeding 2,550 characters',
        customFieldOverrides: { paragraphText: generateContactCustomFieldInvalidParagraphText() },
        // WHY: confirmed live — unlike TextField/UrlField, ParagraphText has
        // NO client-side length check at all (no `maxlength` attribute, no
        // inline error on blur). The only rejection is server-side on Save,
        // surfaced as a generic toast ("Uhoh! Your data is invalid...") — the
        // field-specific detail exists only in the raw API response, never
        // in the UI.
        assertError: () =>
          contactsPage.assertFormErrorToast('Uhoh! Your data is invalid', 'contact create form'),
      },
    ];

    for (const testCase of cases) {
      logger.info(`Negative custom field case: ${testCase.description}`);
      await contactsPage.goToContactsList();
      await contactsPage.clickAddContact();
      // WHY: cheap, harmless no-op when fields are present — checked every
      // iteration rather than only the first for simplicity, since a skip
      // on any iteration ends the test immediately anyway. Same reasoning
      // as LeadsPage's equivalent L19 test.
      await contactsPage.skipIfCustomFieldsAbsent();

      const contactData = generateContactData({
        customFields: generateContactCustomFieldData(testCase.customFieldOverrides),
      });
      await contactsPage.fillContactForm(contactData);
      await adminPage.locator('button[type="submit"].save-button').click();

      await testCase.assertError();

      await expect(
        adminPage.locator('button[type="submit"].save-button'),
        `Contact should NOT have been saved for case: ${testCase.description}`
      ).toBeVisible();

      logger.success(`Validation error confirmed for: ${testCase.description}`);
    }

    logger.success('C18 passed');
  });

  // ──────────────────────────────────────────────────────────
  // GPS Address (Get GPS Address lookup on the address field)
  // ──────────────────────────────────────────────────────────
  // WHY: BasePage.fillAddressViaGpsOrManual() (generalized 2026-07-15 out of
  // MeetingsPage.ts's private implementation) is already wired,
  // unconditionally, into every fillContactForm()/fillEditForm() call — so
  // C4/C5 above already exercise this path incidentally whenever the GPS
  // feature is available in the environment. This test exists as an
  // explicit, self-documenting anchor for the mechanism itself: whichever
  // value results — a live GPS prediction or a manual fallback if the
  // account has no Field Sales addon — must genuinely save and display
  // correctly on BOTH create and update. fillAddressViaGpsOrManual()'s own
  // "GPS address selected" / "Manual address entered" log line is the
  // record of which path was actually taken each run — do not add a
  // separate pre-check here (confirmed live to race the form's own render).

  // ── C19 ───────────────────────────────────────────────────

  test('@regression admin should populate contact address via GPS lookup and verify on create and update', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(adminPage);
    const contactData = generateContactData();

    // WHY: NOT checking "Get GPS Address" visibility here before filling —
    // confirmed live (2026-07-15) this races the form's own render (the
    // address section hasn't mounted yet immediately after the form opens,
    // so an isVisible() check here reads stale/false even when the button
    // renders moments later and IS actually used). fillContactForm()'s own
    // internal fillAddressViaGpsOrManual() call is the only point that
    // legitimately knows whether GPS or manual was used — its own
    // "GPS address selected" / "Manual address entered" log line is the
    // real signal, not a separate racy pre-check here.
    await contactsPage.goToContactsList();
    await contactsPage.clickAddContact();
    await contactsPage.fillContactForm(contactData);
    const contactId = await contactsPage.saveContact();
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();

    await contactsPage.goToContactDetailsById(contactId!);
    await contactsPage.assertContactDetailFields(contactData);
    logger.success(`Address after create: "${contactData.address}"`);

    // WHY: update with a fresh address — re-exercises the same GPS-or-manual
    // path on the edit form, proving it works on both create and update.
    const updatedData = generateContactData();
    await contactsPage.clickEditIcon();
    await contactsPage.fillEditForm(updatedData);
    await contactsPage.saveEditedContact();

    await contactsPage.goToContactDetailsById(contactId!);
    await contactsPage.assertContactDetailFields(updatedData);
    logger.success(`Address after update: "${updatedData.address}"`);
    logger.success('C19 passed');
  });

});
