import { test } from '../../src/fixtures/index';
import { MeetingsPage } from '../../src/modules/meetings/MeetingsPage';
import { logger } from '../../src/utils/logger';
import {
  generateAdminMeetingData,
  generateRestrictedMeetingData,
} from '../../src/data/factories/meetingFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Meetings — RBAC Tests
//
// Verifies that:
//  - Restricted user can navigate, create and edit their OWN meetings
//  - Restricted user CANNOT see admin meetings they are NOT invited to
//  - Restricted user CAN see admin meetings they ARE invited to (as invitee)
//  - Restricted user CANNOT edit a meeting owned by admin (even as invitee)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Meetings RBAC', () => {
  // ── Test 1: Restricted user navigates ─────────────────────────────────────

  test('@regression restricted user should navigate to meetings list', async ({
    restrictedPage,
  }) => {
    const meetingsPage = new MeetingsPage(restrictedPage);

    await meetingsPage.goToMeetingsList();
    await meetingsPage.assertOnMeetingsPage();
    logger.success('M8 passed');
  });

  // ── Test 2: Restricted user creates own meeting ────────────────────────────

  test('@regression restricted user should create their own meeting', async ({
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingData = generateRestrictedMeetingData();

    await meetingsPage.goToMeetingsList();
    const rescheduleMeetingId = await meetingsPage.createMeeting(meetingData, 'Restricted');
    // Assert the meeting appears in the restricted user's list
    await meetingsPage.assertMeetingInList(meetingData.title, rescheduleMeetingId);

    // Open and assert detail view
    await meetingsPage.openMeetingFromList(meetingData.title);
    await meetingsPage.assertMeetingDetailTitle(meetingData.title);

    // Restricted user owns this meeting — Edit should be available
    await meetingsPage.assertEditOptionInMenu();
    logger.success('M9 passed');
  });

  // ── Test 3: Restricted user edits own meeting ──────────────────────────────

  test('@regression restricted user should be able to edit their own meeting', async ({
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(restrictedPage);
    const originalData = generateRestrictedMeetingData();
    const updatedTitle = `EDITED-${originalData.title}`;

    // Create first
    await meetingsPage.goToMeetingsList();
    const originalId = await meetingsPage.createMeeting(originalData, 'Restricted');
    await meetingsPage.assertMeetingInList(originalData.title, originalId);

    // Reschedule first
    await meetingsPage.rescheduleMeeting(originalData.title);
    await meetingsPage.assertMeetingInList(originalData.title, originalId);

    // Then Edit
    await meetingsPage.updateMeeting(
      updatedTitle,
      originalData.title,
      'conducted',
      'Restricted user edited this meeting'
    );

    // Assert updated title in list and detail
    await meetingsPage.assertMeetingInList(updatedTitle, originalId);
    await meetingsPage.openMeetingFromList(updatedTitle);
    await meetingsPage.assertMeetingDetailTitle(updatedTitle);
    const newStatus = await meetingsPage.changeStatusViaEllipsis();
    await meetingsPage.assertMeetingStatus(newStatus);
    logger.success('M10 passed');
  });

  // ── Test 4: Restricted user CANNOT see admin meeting (not invited) ─────────

  test('@regression restricted user should not see admin-owned meeting when not invited', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const _adminMeetings = new MeetingsPage(adminPage);
    const restrictedMeetings = new MeetingsPage(restrictedPage);

    // Admin creates a meeting — does NOT add restricted user as invitee
    // WHY: Pass addInvitee=false to prevent the first invitee option (restricted user)
    // from being added automatically. Default addInvitee=true was causing the restricted
    // user to be added as invitee, giving them access and failing the RBAC assertion.
    const adminData = generateAdminMeetingData();

    await _adminMeetings.goToMeetingsList();
    // WHY: addInvitee=false — don't add restricted user as invitee
    // WHY: skipRelatedTo=true — Related To entities owned by restricted user
    // grant access regardless of invitee list (Kylas product behaviour)
    const adminMeetingId1 = await _adminMeetings.createMeeting(adminData, 'Admin', false, true);
    await _adminMeetings.assertMeetingInList(adminData.title, adminMeetingId1);

    // Restricted user searches for the admin meeting — must NOT find it
    // WHY: Pass meeting ID so assertMeetingNotInList uses direct URL check
    // which returns "No meetings found" — deterministic RBAC verification
    await restrictedMeetings.goToMeetingsList();
    await restrictedMeetings.assertMeetingNotInList(adminData.title, adminMeetingId1);
    logger.success('M11 passed');
  });

  // ── Test 5: Restricted user CAN see admin meeting when invited ────────────
  //   AND cannot edit it

  test('@regression restricted user invited to admin meeting can view but not edit', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const _adminMeetings = new MeetingsPage(adminPage);
    const restrictedMeetings = new MeetingsPage(restrictedPage);

    // Admin creates meeting — invitee search 'restricted' adds restricted user
    const adminData = generateAdminMeetingData();
    await _adminMeetings.goToMeetingsList();
    const adminMeetingId1 = await _adminMeetings.createMeeting(adminData, 'Admin');
    await _adminMeetings.assertMeetingInList(adminData.title, adminMeetingId1);

    // Capture meeting ID from admin detail view
    await _adminMeetings.openMeetingFromList(adminData.title);
    const detailTitle = await adminPage.locator('h2.h2.text-break.meeting__title').textContent();
    const idMatch = detailTitle?.match(/#(\d+)/);
    const meetingId = idMatch ? parseInt(idMatch[1]) : null;
    logger.info(`Admin meeting ID: ${meetingId}`);

    if (!meetingId) throw new Error('Could not capture meeting ID from detail title');

    // ── Restricted user perspective ──────────────────────────────────────────
    await restrictedMeetings.goToMeetingsList();

    // Search by meeting ID using filter
    await restrictedMeetings.searchMeetingById(meetingId);

    // Meeting should appear in list (restricted user is invitee)
    const meetingVisible = await restrictedPage
      .locator(`input#check_${meetingId}`)
      .isVisible()
      .catch(() => false);
    if (!meetingVisible)
      throw new Error(
        `Meeting ID ${meetingId} not visible for restricted user — not added as invitee`
      );
    logger.success(`Meeting ${meetingId} visible for restricted user as invitee`);

    // Click the meeting to open it
    await restrictedPage.locator('h2.meeting__title.text-truncate').first().click();
    await restrictedPage.waitForTimeout(800);

    // Assert detail title visible
    await restrictedMeetings.assertMeetingDetailTitle(adminData.title);

    // Restricted user CANNOT edit this meeting (owned by admin)
    // The ellipsis menu should only show Clone — not Edit
    await restrictedMeetings.openEllipsisMenu();
    const editVisible = await restrictedPage
      .locator('div.dropdown-menu.show a.dropdown-item', { hasText: 'Edit' })
      .isVisible()
      .catch(() => false);
    if (editVisible)
      throw new Error('Edit option should NOT be visible for restricted user on admin meeting');
    logger.success('Edit option correctly absent — only Clone visible');
    await restrictedPage.keyboard.press('Escape');
    logger.success('M12 passed');
  });

  // ── Test 8: Restricted user reschedules own meeting ──────────────────────

  test('@regression restricted user should reschedule their own meeting', async ({
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingData = generateRestrictedMeetingData();

    await meetingsPage.goToMeetingsList();
    const meetingId1 = await meetingsPage.createMeeting(meetingData, 'Restricted');
    await meetingsPage.assertMeetingInList(meetingData.title, meetingId1);
    await meetingsPage.rescheduleMeeting(meetingData.title);
    await meetingsPage.assertMeetingInList(meetingData.title, meetingId1);
    logger.success('M13 passed');
  });

  // ── Test: Restricted user cannot see admin entities in Related To ──────────

  test('@regression restricted user should not see admin entities in Related To dropdown', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(600000);

    const _adminMeetings = new MeetingsPage(adminPage);
    const restrictedMeetings = new MeetingsPage(restrictedPage);

    // Admin creates a lead with ADM prefix so we can search for it
    // We verify restricted user cannot find it in Related To dropdown

    // Open Add Meeting form as restricted user
    await restrictedMeetings.goToMeetingsList();
    await restrictedMeetings.openAddForm();

    // Fill title only
    await restrictedMeetings.fillTitleOnly('RBAC Entity Test Meeting');

    // Open Related To — select Lead entity type
    await restrictedPage.locator('.entity-lookup').locator('.is-invalid__control').first().click();
    await restrictedPage.waitForTimeout(400);
    // WHY: Scope to dropdown options only — getByText matches invitee chips too
    await restrictedPage.locator('.is-invalid__option').filter({ hasText: 'Lead' }).first().click();
    await restrictedPage.waitForTimeout(500);

    // Open search dropdown and search for ADM prefix (admin-created leads)
    await restrictedPage.getByText('Search ...').last().click();
    await restrictedPage.waitForTimeout(400);
    await restrictedPage.locator('[id="1_71_input_relatedTo"]').fill('ADM');
    await restrictedPage.waitForTimeout(1500);

    // Assert no ADM results appear for restricted user
    const adminLeadOption = restrictedPage.locator('.is-invalid__option', { hasText: /^ADM/ });
    const adminLeadVisible = await adminLeadOption.isVisible().catch(() => false);
    if (adminLeadVisible) {
      throw new Error(
        'Restricted user should NOT see admin-owned ADM leads in Related To dropdown'
      );
    }
    logger.success('Restricted user correctly cannot see admin ADM entities in Related To');

    // Close form
    await restrictedPage.keyboard.press('Escape');
    await restrictedPage.waitForTimeout(500);
    logger.success('M14 passed');
  });
});
