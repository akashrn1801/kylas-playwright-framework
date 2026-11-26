import { test, expect } from '../../src/fixtures/index';
import { ContactsPage } from '../../src/modules/contacts/ContactsPage';
import {
  generateContactData,
  generateAdminContactData,
  generateSharedContactData,
  generateRestrictedContactData,
  generateMinimalContactData,
} from '../../src/data/factories/contactFactory';
import { config } from '../../config/config';
import { logger } from '../../src/utils/logger';
import { TasksPage } from '../../src/modules/tasks/TasksPage';
import { generateTaskData } from '../../src/data/factories/taskFactory';
import { MeetingsPage } from '../../src/modules/meetings/MeetingsPage';
import { CallLogsPage } from '../../src/modules/call-logs/CallLogsPage';
import { waitForRecordAction } from '../../src/utils/recordActionsApi';
import { generateCallLogData } from '../../src/data/factories/callLogFactory';
import { CompaniesPage } from '../../src/modules/companies/CompaniesPage';
import { generateCompanyData, generateSharedCompanyData } from '../../src/data/factories/companyFactory';

test.describe('Contacts RBAC', () => {

  // ── CR1 ───────────────────────────────────────────────────

  test('@smoke @regression @prodSafe restricted user can navigate to contacts list', async ({
    restrictedPage,
  }) => {
    const contactsPage = new ContactsPage(restrictedPage);
    await contactsPage.goToContactsList();
    await contactsPage.assertOnContactsListPage();
    logger.success('CR1 passed');
  });

  // ── CR2 ───────────────────────────────────────────────────

  test('@regression restricted user can create a contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    await contactsPage.assertContactCreated(contactData, contactId ?? undefined);
    logger.success('CR2 passed');
  });

  // ── CR3 ───────────────────────────────────────────────────

  test('@regression restricted user can edit own contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    const updatedData = generateContactData();
    await contactsPage.updateContact(updatedData, contactData.firstName, contactId ?? undefined);
    await contactsPage.assertContactUpdated(updatedData, contactId ?? undefined);
    logger.success('CR3 passed');
  });

  // ── CR4 ───────────────────────────────────────────────────

  test('@regression restricted user cannot see an admin-owned contact', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    // WHY: generateAdminContactData uses timestamp prefix (ADM12345678)
    // guarantees this contact name has never existed before — no collision with old test data
    const adminContactsPage = new ContactsPage(adminPage);
    const contactData = generateAdminContactData();
    await adminContactsPage.goToContactsList();
    await adminContactsPage.createContact(contactData);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.assertContactNotInList(contactData.firstName);
    logger.success('CR4 passed');
  });

  // ── CR5 ───────────────────────────────────────────────────

  test('@regression admin shares contact Read only restricted user sees only Clone in ellipsis not Delete Share Reassign', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    // WHY: Share with Read only — no extra permissions
    await adminContactsPage.shareContact(restrictedUserName, []);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.openEllipsisMenu();
    // WHY: Read only — restricted should NOT see Delete, Share, Reassign
    await restrictedContactsPage.assertEllipsisOptionNotVisible('Delete');
    await restrictedContactsPage.assertEllipsisOptionNotVisible('Share');
    await restrictedContactsPage.assertEllipsisOptionNotVisible('Reassign');
    // WHY: Read only — Clone and Add Deal should be visible
    const cloneOption = restrictedPage.locator('.dropdown-menu.show a.dropdown-item').filter({ hasText: 'Clone' });
    await expect(cloneOption).toBeVisible({ timeout: 5000 });
    const addDealOption = restrictedPage.locator('.dropdown-menu.show a.dropdown-item').filter({ hasText: 'Add Deal' });
    await expect(addDealOption).toBeVisible({ timeout: 5000 });
    logger.success('CR5 passed');
  });

  // ── CR6 ───────────────────────────────────────────────────

  test('@regression admin shares contact Update permission restricted user sees edit button and can edit contact', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.shareContact(restrictedUserName, ['update']);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    // WHY: Update permission — edit button (#edit-action) should be visible
    // NOTE: Contacts uses #edit-action (no -btn suffix) unlike Leads (#edit-action-btn)
    await expect(restrictedPage.locator('#edit-action')).toBeVisible({ timeout: 10000 });
    // WHY: Restricted user edits the contact to verify update permission works
    await restrictedContactsPage.clickEditIcon();
    const updatedData = generateContactData();
    await restrictedContactsPage.fillEditForm(updatedData);
    await restrictedContactsPage.saveEditedContact();
    await restrictedContactsPage.assertContactExistsInList(updatedData.firstName);
    // WHY: Navigate back to verify ellipsis shows only Clone — not Delete/Reassign
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.openEllipsisMenu();
    await restrictedContactsPage.assertEllipsisOptionNotVisible('Delete');
    await restrictedContactsPage.assertEllipsisOptionNotVisible('Reassign');
    logger.success('CR6 passed');
  });

  // ── CR7 ───────────────────────────────────────────────────

  test('@regression admin shares contact Note permission restricted user sees Notes icon and can add note', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.shareContact(restrictedUserName, ['note']);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.assertRightPanelIconVisible('Notes');
    // B6: addNoteFromPanel opens the Notes panel, waits for it to settle (no skeleton rows), adds the note and
    // asserts the Notes card count went up by one; the note's own text is then asserted (the old check only saw
    // that the first `div.row.pt-2.pl-2.pr-2` was visible, which also matches a loading skeleton row)
    const noteText = `Test note from restricted user ${Date.now()}`;
    await restrictedContactsPage.addNoteFromPanel(noteText);
    await restrictedContactsPage.assertNoteTextPresent(noteText);
    logger.success(`Note added and verified: ${noteText}`);
    logger.success('CR7 passed');
  });

  // ── CR8 ───────────────────────────────────────────────────

  test('@regression admin shares contact Task permission restricted user sees Tasks icon and can create task', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.shareContact(restrictedUserName, ['task']);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.assertRightPanelIconVisible('Tasks');
    await restrictedContactsPage.clickRightPanelIcon('Tasks');
    // WHY: Use TasksPage to create quick task from contact detail panel
    const tasksPage = new TasksPage(restrictedPage);
    const taskData = generateTaskData();
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    const taskId = await tasksPage.saveQuickTaskFromEntityDetail();
    expect(taskId).not.toBeNull();
    logger.success(`Task created: ${taskId}`);
    // WHY: Click Tasks icon again to refresh task list and verify task appears
    await restrictedContactsPage.clickRightPanelIcon('Tasks');
    // B6: no pause: the retrying expect below waits for the task row
    const taskLocator = restrictedPage.locator('.task-details-wrapper').getByText(taskData.name).first();
    await expect(taskLocator).toBeVisible({ timeout: 10000 });
    logger.success(`Task verified in list: ${taskData.name}`);
    logger.success('CR8 passed');
  });

  // ── CR9 ───────────────────────────────────────────────────

  // WHY: reframed as a NEGATIVE RBAC assertion (2026-07-16) — confirmed live
  // this is CORRECT app behavior, not a bug: when a Contact has an
  // associated Company and only the CONTACT is shared (not the company),
  // the restricted user genuinely cannot access that company. Creating a
  // Meeting from the contact's detail page requires reading the associated
  // company's data, so it correctly fails with a permission error —
  // confirmed via the network response itself (POST /v1/meetings → 422,
  // errorCode "01503001", "Invalid company summary response."), the exact
  // same errorCode already documented for the separate, confirmed Lead
  // backend bug in README — but NOT the same conclusion: this Contact case
  // is genuine, correct RBAC enforcement (company truly not shared), not a
  // backend defect. See CR9b below for the positive case (company also
  // shared → succeeds).
  test('@regression admin shares contact Meeting permission (without its company) restricted user cannot create meeting requiring company access', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const adminCompaniesPage = new CompaniesPage(adminPage);

    // WHY: fixed 2026-07-24 — was calling generateSharedContactData() with
    // no company, which left fillContactForm() to pick a RANDOM existing
    // company via selectRandomFromSearchableReactSelect(). On staging that
    // random pick can land on a company already shared with the restricted
    // user from a prior run, silently defeating this test's "company NOT
    // shared" precondition (false pass/fail). Fix mirrors CR9b below:
    // create a fresh, guaranteed-unshared company and pass its exact name
    // through generateSharedContactData's company override.
    // WHY: uses plain generateCompanyData(), NOT generateSharedCompanyData()
    // — this company is deliberately never shared, so it shouldn't carry
    // the "SHR" prefix that implies it is (unlike CR9b below, which
    // genuinely shares its company and correctly keeps that prefix).
    const companyData = generateCompanyData();
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();

    const contactData = generateSharedContactData({ company: companyData.name });
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    // WHY: share ONLY the contact — its associated company (set by
    // fillContactForm's own Company field) is deliberately left unshared.
    await adminContactsPage.shareContact(restrictedUserName, ['meeting']);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.assertRightPanelIconVisible('Meetings');
    await restrictedContactsPage.clickRightPanelIcon('Meetings');
    // WHY: On contact detail, Meetings panel shows #addMeeting button
    // Click it to open the actual meeting form
    await restrictedPage.locator('#addMeeting').waitFor({ state: 'visible', timeout: 10000 });
    await restrictedPage.locator('#addMeeting').click();
    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingTitle = `Meeting-${Date.now()}`;
    await meetingsPage.fillTitleOnly(meetingTitle);

    // WHY: assert on the underlying network response, not just "save threw"
    // — distinguishes "correctly denied for the expected reason" from any
    // other unrelated failure (per docs/PATTERNS.md RBAC rules on negative/RBAC
    // assertions never conflating "correctly absent" with "failed to load").
    // WHY: hardened 2026-07-19 — bare '/v1/meetings' substring had no
    // /reports/ exclusion, same ID-capture-shaped bug class fixed at 10
    // other call sites (found via self-audit; missed originally because
    // that sweep never checked tests/).
    const meetingPostPromise = restrictedPage
      .waitForResponse(
        (res) =>
          /^\/v1\/meetings\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
        { timeout: 15000 }
      )
      .then(async (res) => ({ status: res.status(), body: await res.json().catch(() => ({})) }))
      .catch(() => null);

    let saveThrew = false;
    try {
      await meetingsPage.saveMeeting();
    } catch {
      saveThrew = true;
    }
    expect(
      saveThrew,
      'Meeting creation should fail when the contact\'s associated company is not shared'
    ).toBe(true);

    const response = await meetingPostPromise;
    expect(response, 'The meeting POST (/v1/meetings) should have been sent and answered').not.toBeNull();
    expect(response?.status, 'Expected the meeting POST to return 422').toBe(422);
    expect(
      response?.body?.errorCode,
      'Expected the confirmed "Invalid company summary response" errorCode (01503001)'
    ).toBe('01503001');

    logger.success('CR9 passed — correctly denied: contact\'s company was not shared');
  });

  // ── CR9b ──────────────────────────────────────────────────

  // WHY: positive counterpart to CR9 (2026-07-16) — same setup, except the
  // contact's associated company is a freshly-created, KNOWN company (via
  // ContactData.company + selectRandomFromSearchableReactSelect's new
  // exactValue param) that gets explicitly shared too. Confirms the CR9
  // failure is really about the company's share-state, not some other
  // regression — once both are shared, meeting creation succeeds normally.
  test('@regression admin shares contact AND its associated company restricted user can create meeting requiring company access', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const adminCompaniesPage = new CompaniesPage(adminPage);

    const companyData = generateSharedCompanyData();
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();

    const contactData = generateSharedContactData({ company: companyData.name });
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();

    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');

    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await adminContactsPage.shareContact(restrictedUserName, ['meeting']);

    // WHY: share the company WITH the 'meeting' permission specifically, not
    // a bare/empty-permissions share — matching the same permission granted
    // on the contact itself.
    await adminCompaniesPage.goToCompanyDetailsById(companyId!);
    await adminCompaniesPage.shareCompany(restrictedUserName, ['meeting']);

    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.assertRightPanelIconVisible('Meetings');
    await restrictedContactsPage.clickRightPanelIcon('Meetings');
    await restrictedPage.locator('#addMeeting').waitFor({ state: 'visible', timeout: 10000 });
    await restrictedPage.locator('#addMeeting').click();
    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingTitle = `Meeting-${Date.now()}`;
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: confirmed live (2026-07-16) — even with the company genuinely
    // shared seconds earlier, the same transient permission-propagation lag
    // already documented for Lead+Meeting (errorCode 01503001) can still
    // fire once here too; retry tolerates that lag without masking a
    // genuine, non-propagation failure (the wrapper only retries on that
    // exact errorCode).
    const meetingId = await meetingsPage.saveMeetingRetryOnEntitySummaryLag();
    expect(
      meetingId,
      'Meeting creation should succeed once the associated company is ALSO shared'
    ).not.toBeNull();

    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.clickRightPanelIcon('Meetings');
    // B6: no pause: the retrying expect below waits for the meeting row
    const meetingEntry = restrictedPage.locator('.meeting__title').filter({ hasText: meetingTitle });
    await expect(meetingEntry).toBeVisible({ timeout: 10000 });
    logger.success(`Meeting verified in contact panel: ${meetingTitle}`);
    logger.success('CR9b passed — meeting succeeded with company also shared');
  });

  // ── CR10 ──────────────────────────────────────────────────

  test('@regression admin shares contact Call permission restricted user sees Call Logs icon and can log call', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.shareContact(restrictedUserName, ['call']);
    // B6: the share must have applied for the restricted user before Log a call opens
    await waitForRecordAction(restrictedPage, 'contacts', contactId!, 'call');
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.assertRightPanelIconVisible('Call Logs');
    await restrictedContactsPage.clickRightPanelIcon('Call Logs');
    const callLogsPage = new CallLogsPage(restrictedPage);
    // WHY: Reload page to ensure Log a call button is fully loaded
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    // B6: the page has its data (skeleton gone) and the button is usable before it is clicked
    await callLogsPage.waitForNoLoadingSkeleton();
    const logACallButton = restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' });
    await expect(logACallButton).toBeEnabled({ timeout: config.timeouts.expect });
    await logACallButton.click();
    await restrictedPage.locator('#callLogModal').waitFor({ state: 'visible', timeout: config.timeouts.expect });
    // WHY: Remove aria-hidden so Playwright can interact with modal — same as Leads pattern
    await restrictedPage.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    const callLogData = generateCallLogData({ outcome: 'Connected' });
    // B6: the Type menu opens together with the form (Leads traces), so it is picked from there, never toggled shut
    await callLogsPage.fillCallTypeFromPanel(callLogData.callType);
    await callLogsPage.fillOutcome('Connected');
    await callLogsPage.fillPhoneNumber();
    await callLogsPage.fillCallSummary(callLogData.callSummary);
    if (callLogData.duration) {
      await callLogsPage.fillDurationDirect(callLogData.duration.value, callLogData.duration.type);
    }
    const callLogId = await callLogsPage.saveCallLog();
    expect(callLogId).not.toBeNull();
    logger.success(`Call log created: ${callLogId}`);
    // WHY: Navigate back to contact detail and verify call log appears in Call Logs section
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.clickRightPanelIcon('Call Logs');
    // B6: no pause: the retrying expect below waits for the call log row
    const callLogEntry = restrictedPage.locator('.call-log-info').first();
    await expect(callLogEntry).toBeVisible({ timeout: 10000 });
    logger.success('Call log verified in contact panel');
    logger.success('CR10 passed');
  });

  // ── CR11 removed — Quotation panel empty for restricted user (app behavior)

    // ── CR12 ──────────────────────────────────────────────────

  test('@regression admin shares contact Read only restricted user sees no productivity icons', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    // WHY: Share with Read only — no extra permissions
    await adminContactsPage.shareContact(restrictedUserName, []);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    // WHY: Read only — NO productivity icons should be visible
    await restrictedContactsPage.assertRightPanelIconNotVisible('Notes');
    await restrictedContactsPage.assertRightPanelIconNotVisible('Tasks');
    await restrictedContactsPage.assertRightPanelIconNotVisible('Meetings');
    await restrictedContactsPage.assertRightPanelIconNotVisible('Call Logs');
    logger.success('CR12 passed');
  });

  // ── CR13 ──────────────────────────────────────────────────

  // WHY: title says "four" permissions, not "five" (2026-07-17 fix) — Quotation
  // is genuinely inapplicable here, not just untested: CR11 (the standalone
  // Quotation RBAC test) was already removed with the documented reason
  // "Quotation panel empty for restricted user" (confirmed app behavior, see
  // the comment above CR11's removal). This test's own shareContact() call
  // and assertions only ever covered Note/Task/Meeting/Call — the title
  // previously claimed "Quotation"/"all five" but never actually verified it.
  test('@regression admin shares contact with Note Task Meeting Call permissions and restricted user can do all four', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const adminCompaniesPage = new CompaniesPage(adminPage);
    // WHY: Meeting creation from a contact's detail page reads the contact's
    // associated company (confirmed live 2026-07-16 — see CR9/CR9b) — this
    // combined-permissions test needs that company shared too, or its own
    // Meeting portion would correctly fail for the same reason CR9 does
    // without it, not because anything here is broken.
    const companyData = generateSharedCompanyData();
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(companyData);
    expect(companyId).not.toBeNull();
    const contactData = generateSharedContactData({ company: companyData.name });
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    // WHY: Share with all 4 permissions at once (Note, Task, Meeting, Call —
    // Quotation is genuinely inapplicable, see the test's own title comment)
    await adminContactsPage.shareContact(restrictedUserName, ['note', 'task', 'meeting', 'call']);
    // WHY: share the company WITH the 'meeting' permission specifically, not
    // a bare/empty-permissions share.
    await adminCompaniesPage.goToCompanyDetailsById(companyId!);
    await adminCompaniesPage.shareCompany(restrictedUserName, ['meeting']);
    // B6: the shares must have applied for the restricted user before the call (and the other three) are
    // used: the contact needs `call`, its company needs read
    await waitForRecordAction(restrictedPage, 'contacts', contactId!, 'call');
    await waitForRecordAction(restrictedPage, 'companies', Number(companyId), 'read');
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    // WHY: Verify all 4 icons visible (Notes, Tasks, Meetings, Call Logs)
    await restrictedContactsPage.assertRightPanelIconVisible('Notes');
    await restrictedContactsPage.assertRightPanelIconVisible('Tasks');
    await restrictedContactsPage.assertRightPanelIconVisible('Meetings');
    await restrictedContactsPage.assertRightPanelIconVisible('Call Logs');

    // WHY: Verify Note — click Notes icon, add note, verify note row appears
    // B6: see CR7 (settled panel, count + the note's own text)
    const noteText = `Note-${Date.now()}`;
    await restrictedContactsPage.addNoteFromPanel(noteText);
    await restrictedContactsPage.assertNoteTextPresent(noteText);
    logger.success('Note created and verified');

    // WHY: Verify Task — click Tasks icon, create quick task
    await restrictedContactsPage.clickRightPanelIcon('Tasks');
    const tasksPage = new TasksPage(restrictedPage);
    const taskData = generateTaskData();
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    const taskId = await tasksPage.saveQuickTaskFromEntityDetail();
    expect(taskId).not.toBeNull();
    logger.success(`Task created: ${taskId}`);
    // WHY: Reload page after task creation before moving to next operation
    const callLogsPage = new CallLogsPage(restrictedPage);
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    // B6: the reloaded page has its data (skeleton gone) before the next panel icon is used
    await callLogsPage.waitForNoLoadingSkeleton();

    // WHY: Verify Meeting — click Meetings icon, then #addMeeting button to open form
    await restrictedContactsPage.clickRightPanelIcon('Meetings');
    await restrictedPage.locator('#addMeeting').waitFor({ state: 'visible', timeout: 10000 });
    await restrictedPage.locator('#addMeeting').click();
    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingTitle = `Meeting-${Date.now()}`;
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: same entity-summary permission-propagation lag tolerance as CR9b
    // — the company here was also just shared moments earlier.
    const meetingId = await meetingsPage.saveMeetingRetryOnEntitySummaryLag();
    // B6: the old branch only warned when no id was captured and went on, an unverified "still created"
    expect(meetingId, 'Meeting creation should succeed (company also shared)').not.toBeNull();
    logger.success(`Meeting created: ${meetingId}`);
    // WHY: Navigate back to contact detail page after meeting creation
    await restrictedContactsPage.goToContactDetailsById(contactId!);

    // WHY: Verify Call — click Call Logs icon, log call
    await restrictedContactsPage.clickRightPanelIcon('Call Logs');
    // B6: the panel has its data (skeleton gone) and the button is usable before it is clicked
    await callLogsPage.waitForNoLoadingSkeleton();
    const logACallButton = restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' });
    await expect(logACallButton).toBeEnabled({ timeout: config.timeouts.expect });
    await logACallButton.click();
    await restrictedPage.locator('#callLogModal').waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await restrictedPage.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    const callLogData = generateCallLogData({ outcome: 'Connected' });
    // B6: the Type menu opens together with the form (Leads traces), so it is picked from there, never toggled shut
    await callLogsPage.fillCallTypeFromPanel(callLogData.callType);
    await callLogsPage.fillOutcome('Connected');
    await callLogsPage.fillPhoneNumber();
    await callLogsPage.fillCallSummary(callLogData.callSummary);
    if (callLogData.duration) {
      await callLogsPage.fillDurationDirect(callLogData.duration.value, callLogData.duration.type);
    }
    const callLogId = await callLogsPage.saveCallLog();
    expect(callLogId).not.toBeNull();
    logger.success(`Call log created: ${callLogId}`);

    logger.success('CR13 passed');
  });

  // ── CR14 ──────────────────────────────────────────────────

  test('@regression admin reassigns contact to restricted user and restricted becomes owner can edit and delete', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.reassignContact(restrictedUserName);
    // WHY: Restricted user now owns the contact — can edit and delete
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    // WHY: Verify edit button visible — restricted user is now owner
    // NOTE: Contacts uses #edit-action (no -btn suffix)
    await expect(restrictedPage.locator('#edit-action')).toBeVisible({ timeout: 10000 });
    // WHY: Verify restricted user can edit the contact
    await restrictedContactsPage.clickEditIcon();
    const updatedData = generateContactData();
    await restrictedContactsPage.fillEditForm(updatedData);
    await restrictedContactsPage.saveEditedContact();
    await restrictedContactsPage.assertContactExistsInList(updatedData.firstName);
    logger.success('Restricted user edited reassigned contact successfully');
    // WHY: Navigate back to contact detail to verify delete option
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    await restrictedContactsPage.deleteContact();
    await restrictedContactsPage.assertContactDeletedById(contactId!);
    logger.success('Restricted user deleted reassigned contact successfully');
    logger.success('CR14 passed');
  });

  // ── CR15 ──────────────────────────────────────────────────

  test('@regression restricted user can clone their own contact and verify cloned contact has Copy in title', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const clonedId = await contactsPage.cloneContact();
    expect(clonedId).not.toBeNull();
    await contactsPage.assertClonedContactLastName(contactData.lastName, clonedId!);
    logger.success('CR15 passed');
  });

  // ── CR16 ──────────────────────────────────────────────────

  test('@regression restricted user can delete their own contact and verify it is removed from list', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateRestrictedContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    await contactsPage.deleteContact();
    // WHY: Verify by both ID navigation (direct proof) and list search (index verification)
    await contactsPage.assertContactDeletedById(contactId!);
    await contactsPage.assertContactNotInList(contactData.firstName);
    logger.success('CR16 passed');
  });

  // ── CR17 ──────────────────────────────────────────────────

  test('@regression restricted user with Note permission can add and delete a note on shared contact', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminContactsPage = new ContactsPage(adminPage);
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    const contactData = generateSharedContactData();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await adminContactsPage.searchAndOpenContact(contactData.firstName, contactId ?? undefined);
    const restrictedUserName = await adminContactsPage.getLoggedInUserName('restricted');
    await adminContactsPage.shareContact(restrictedUserName, ['note']);
    await restrictedContactsPage.goToContactDetailsById(contactId!);
    // WHY the page object's Notes click, then the Notes card is scoped and its
    // skeleton rows awaited before ANY count is read: opening the Notes panel
    // fires GET /v1/notes/relation, and until it renders the card shows
    // react-loading-skeleton placeholder rows that match the page-wide
    // `div.row.pt-2.pl-2.pr-2` selector — a one-shot count() read them as notes
    // (the confirmed root cause of this test's flake, and of CO9 / COR17 — see
    // BasePage.notesPanel()). Counts are asserted with the retrying
    // toHaveCount(), never a one-shot count() + toBe().
    await restrictedContactsPage.clickRightPanelIcon('Notes');
    const { rows: noteRows, waitForSettled } = restrictedContactsPage.notesPanel();
    await waitForSettled();
    // WHY: Capture baseline before adding notes — entity may have pre-existing notes from prior runs
    const baselineCount = await noteRows.count();
    const richTextEditor = restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' });
    // WHY: Add first note — this note will be kept
    await restrictedPage.locator('textarea.notes-textarea').click();
    await richTextEditor.waitFor({ state: 'visible', timeout: 10000 });
    await richTextEditor.fill('Note to keep');
    await restrictedPage.getByText('Add', { exact: true }).click();
    await waitForSettled();
    await expect(noteRows, 'Note count should be baseline + 1 after the first add').toHaveCount(
      baselineCount + 1,
      { timeout: 10000 }
    );
    // WHY: Add second note — this note will be deleted
    await restrictedPage.locator('textarea.notes-textarea').click();
    await richTextEditor.waitFor({ state: 'visible', timeout: 10000 });
    await richTextEditor.fill('Note to delete');
    await restrictedPage.getByText('Add', { exact: true }).click();
    await waitForSettled();
    // WHY: Verify both new notes were added on top of baseline
    await expect(noteRows, 'Note count should be baseline + 2 after the second add').toHaveCount(
      baselineCount + 2,
      { timeout: 10000 }
    );
    // WHY: Delete the first note (newest first display) — "Note to delete" was added last so appears first
    await noteRows.first().locator('button[data-toggle="dropdown"]').click();
    await restrictedPage
      .locator('.dropdown-menu.show .dropdown-item')
      .filter({ hasText: 'Delete' })
      .click();
    // WHY: Confirm delete in modal
    const confirmDelete = restrictedPage.locator('button#confirm.btn-danger');
    await confirmDelete.waitFor({ state: 'visible', timeout: 5000 });
    await confirmDelete.click();
    await waitForSettled();
    // WHY: Verify count dropped by 1 relative to baseline
    await expect(noteRows, 'Note count should be baseline + 1 after the delete').toHaveCount(
      baselineCount + 1,
      { timeout: 10000 }
    );
    // WHY: Note text lives in CKEditor iframes — skip the active editor iframe (title="Rich Text Editor, main")
    // and use innerText (excludes hidden/removed nodes) to check only saved-note display iframes
    const checkNoteText = async (text: string): Promise<boolean> =>
      restrictedPage.evaluate((t) => {
        for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
          if (iframe.title && iframe.title.includes('Rich Text Editor')) continue;
          try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
        }
        return false;
      }, text);
    expect(await checkNoteText('Note to delete')).toBe(false);
    expect(await checkNoteText('Note to keep')).toBe(true);
    logger.success('CR17 passed');
  });

  // ── CR18 ──────────────────────────────────────────────────
  // NOTE: Admin can see ALL contacts including restricted user's — no RBAC restriction on admin side
  // This is correct Kylas CRM behavior — CR18 removed

  // ── CR19 ──────────────────────────────────────────────────

  test('@regression @prodSafe restricted user should navigate to contacts list page on production', async ({
    restrictedPage,
  }) => {
    const contactsPage = new ContactsPage(restrictedPage);
    await contactsPage.goToContactsList();
    await contactsPage.assertOnContactsListPage();
    logger.success('CR19 passed');
  });

  // ── CR20 ──────────────────────────────────────────────────
  // WHY: generateContactData() (NOT generateAdminContactData()) — this is a
  // restricted user creating and owning their own contact, not a cross-role
  // isolation scenario, so the ADM-prefix uniqueness guarantee doesn't apply
  // here. Mirrors LeadsPage's equivalent restricted-user dedicated test
  // (L29) for the same reason.

  test('@regression restricted user can create a contact with all custom fields, verified on details', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();

    await contactsPage.goToContactsList();
    await contactsPage.clickAddContact();
    await contactsPage.skipIfCustomFieldsAbsent();
    await contactsPage.fillContactForm(contactData);
    const contactId = await contactsPage.saveContact();
    expect(contactId, 'Contact ID should be captured after create').not.toBeNull();

    // WHY: reuses ContactsPage.assertContactCustomFieldsOnDetail() unchanged —
    // the same BasePage-generic method admin's tests use — to confirm the
    // custom-field design is genuinely role-agnostic, not admin-specific.
    await contactsPage.goToContactDetailsById(contactId!);
    await contactsPage.assertContactCustomFieldsOnDetail(contactData);
    logger.success('CR20 passed');
  });

  // ── Hide Empty Fields — CR21-CR24 (RBAC parity, restricted user's own
  // contact — mirrors tests/ui/contacts/contacts.spec.ts's C20-C23) ────────

  test('@regression restricted user should hide empty fields/tabs on a contact with minimal, genuinely-empty Social and Campaign Information tabs', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateMinimalContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    await contactsPage.toggleHideEmptyFields();

    await contactsPage.assertTabHiddenWhenFullyEmpty('Social');
    await contactsPage.assertTabHiddenWhenFullyEmpty('Campaign Information');
    await contactsPage.assertTabVisible('Professional');
    await contactsPage.assertTabVisible('Other Details');

    logger.success('CR21 passed');
  });

  test('@regression restricted user should restore all hidden fields/tabs after toggling Hide Empty Fields off', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateMinimalContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    await contactsPage.toggleHideEmptyFields();
    await contactsPage.assertTabHiddenWhenFullyEmpty('Social');

    await contactsPage.toggleHideEmptyFields();
    await contactsPage.assertTabVisible('Social');

    logger.success('CR22 passed');
  });

  test('@regression restricted user should hide only empty fields within a mixed section, keeping the section itself visible', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateMinimalContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    await contactsPage.toggleHideEmptyFields();
    await contactsPage.assertTabVisible('Professional');

    const professionalTab = restrictedPage
      .locator('a.nav-item.nav-link, a.nav-link')
      .filter({ hasText: 'Professional' });
    await professionalTab.click();
    await contactsPage.assertFieldLabelHidden('Department');
    await contactsPage.assertFieldLabelHidden('Designation');
    await contactsPage.assertFieldLabelVisible('Company');

    logger.success('CR23 passed');
  });

  test('@regression restricted user should auto-reveal a hidden field/tab immediately after editing it, without re-toggling', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateMinimalContactData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    expect(contactId).not.toBeNull();
    await contactsPage.goToContactDetailsById(contactId!);

    await contactsPage.toggleHideEmptyFields();
    await contactsPage.assertTabHiddenWhenFullyEmpty('Social');

    const newFacebook = `https://facebook.com/revealed.${Date.now()}`;
    await contactsPage.clickEditIcon();
    await contactsPage.fillEditForm({ ...contactData, facebook: newFacebook });
    await contactsPage.saveEditedContact();

    await contactsPage.assertTabVisible('Social');
    const socialTab = restrictedPage
      .locator('a.nav-item.nav-link, a.nav-link')
      .filter({ hasText: 'Social' });
    await socialTab.click();
    await expect(restrictedPage.getByText(newFacebook)).toBeVisible({ timeout: 10000 });

    logger.success('CR24 passed');
  });

});
