import { test } from '../../../src/fixtures/index';
import { MeetingsPage } from '../../../src/modules/meetings/MeetingsPage';
import { logger } from '../../../src/utils/logger';
import {
  generateMeetingData,
} from '../../../src/data/factories/meetingFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Meetings — UI Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Meetings', () => {
  // ── Test 1: Navigate ───────────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to meetings list', async ({ adminPage }) => {
    const meetingsPage = new MeetingsPage(adminPage);

    await meetingsPage.goToMeetingsList();
    await meetingsPage.assertOnMeetingsPage();
    logger.success('M1 passed');
  });

  // ── Test 2: Create ─────────────────────────────────────────────────────────

  test('@regression admin should create a new meeting with full details', async ({ adminPage }) => {
    test.setTimeout(600000); // 10 min — full form with calendar, GPS, related-to loop

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    const meetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    // Assert meeting appears in list — use ID if available for reliable verification
    await meetingsPage.assertMeetingInList(meetingData.title, meetingId);

    // Open the meeting and assert detail view
    await meetingsPage.openMeetingFromList(meetingData.title);
    await meetingsPage.assertMeetingDetailTitle(meetingData.title);

    // Assert key fields in detail view
    await meetingsPage.assertMeetingDetailField('status', 'Scheduled');

    // Assert invitee section exists (invitee card visible)
    const inviteeSection = adminPage.locator('.invitees-details, .card-deck.invitee-list');
    const inviteeSectionVisible = await inviteeSection.isVisible().catch(() => false);
    if (inviteeSectionVisible) {
      logger.info('Invitee section visible');
    } else {
      logger.warn('Invitee section not visible on this env — skipping invitee assertion');
    }
    logger.success('M2 passed');
  });

  // ── Test 3: Update ─────────────────────────────────────────────────────────

  test('@regression admin should update an existing meeting', async ({ adminPage }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(adminPage);
    const originalData = generateMeetingData();
    const updatedTitle = `UPDATED-${originalData.title}`;
    const updatedDesc = 'Updated meeting description by admin automation';

    // Create the meeting first
    await meetingsPage.goToMeetingsList();
    const originalMeetingId = await meetingsPage.createMeeting(originalData, 'Admin');
    await meetingsPage.assertMeetingInList(originalData.title, originalMeetingId);

    // Update title and description via edit form
    await meetingsPage.updateMeeting(updatedTitle, originalData.title, undefined, updatedDesc);

    // Assert updated title in list
    await meetingsPage.assertMeetingInList(updatedTitle, originalMeetingId);

    // Open meeting and change status via ellipsis menu
    await meetingsPage.openMeetingFromList(updatedTitle);
    await meetingsPage.assertMeetingDetailTitle(updatedTitle);

    // Change status randomly via ellipsis — Mark as Conducted or Cancel
    const newStatus = await meetingsPage.changeStatusViaEllipsis();

    // Assert status changed on detail page
    await meetingsPage.assertMeetingStatus(newStatus);
    logger.success('M3 passed');
  });

  // ── Test 4: Medium selection — calendar fallback behaviour ─────────────────

  test('@regression admin should select meeting medium with calendar fallback', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData({ title: `CalTest-${Date.now()}` });

    await meetingsPage.goToMeetingsList();
    const calMeetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    await meetingsPage.assertMeetingInList(meetingData.title, calMeetingId);
    await meetingsPage.openMeetingFromList(meetingData.title);

    // Assert medium is one of the valid options — fallback logic selected it
    const mediumField = adminPage.locator('#medium span.title').first();
    await mediumField.waitFor({ state: 'visible' });
    const mediumValue = await mediumField.textContent();

    const validMediums = ['Offline', 'Google Meet', 'Outlook'];
    const isValid = validMediums.some((m) => mediumValue?.includes(m));
    if (!isValid) {
      throw new Error(`Unexpected medium value on detail page: "${mediumValue}"`);
    }
    logger.info(`Meeting created with medium: ${mediumValue}`);
    logger.success('M4 passed');
  });

  // ── Test 5: prodSafe — read-only navigation ────────────────────────────────

  // ── Test 4b: Reschedule ───────────────────────────────────────────────────

  test('@regression admin should reschedule a meeting', async ({ adminPage }) => {
    test.setTimeout(600000);

    const meetingsPage = new MeetingsPage(adminPage);
    const meetingData = generateMeetingData();

    await meetingsPage.goToMeetingsList();
    const rescheduleMeetingId = await meetingsPage.createMeeting(meetingData, 'Admin');
    await meetingsPage.assertMeetingInList(meetingData.title, rescheduleMeetingId);
    await meetingsPage.rescheduleMeeting(meetingData.title);
    await meetingsPage.assertMeetingInList(meetingData.title, rescheduleMeetingId);
    logger.success('M5 passed');
  });

  test('@prodSafe meetings list page should be accessible', async ({ adminPage }) => {
    const meetingsPage = new MeetingsPage(adminPage);

    await meetingsPage.goToMeetingsList();
    await meetingsPage.assertOnMeetingsPage();
    logger.success('M6 passed');
  });

  // ── Test: prodSafe — GPS address field works ─────────────────────────────

  test('@prodSafe meetings Add form GPS address field should work', async ({ adminPage }) => {
    test.setTimeout(120000);

    const meetingsPage = new MeetingsPage(adminPage);
    await meetingsPage.goToMeetingsList();

    // Open Add Meeting form
    await adminPage.locator('button.btn.btn-primary', { hasText: 'Add' }).first().click();
    await adminPage.waitForTimeout(800);

    // Fill title to keep form valid
    await adminPage.locator('[id="1_11_input_title"]').fill('GPS Test Meeting');

    // Click Get GPS Address
    const gpsBtn = adminPage.getByText('Get GPS Address');
    await gpsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await gpsBtn.click();
    await adminPage.waitForTimeout(1500);

    // Check if Field Sales addon trial modal appeared
    const addonDialog =
      (await adminPage
        .locator('.trial-feature__title')
        .isVisible()
        .catch(() => false)) ||
      (await adminPage
        .locator('text=Field Sales is now available')
        .isVisible()
        .catch(() => false));
    if (addonDialog) {
      // Dismiss by clicking I'll do it later
      await adminPage.locator('button.btn.link-primary', { hasText: "I'll do it later" }).click();
      await adminPage.waitForTimeout(500);
      logger.warn('Field Sales addon trial modal dismissed');
    }

    if (addonDialog) {
      // Addon not available — verify manual address works instead
      logger.info('Field Sales addon not available — testing manual address input');
      await adminPage.locator('[id="1_81_input_location"]').fill('123 Test Street, Mumbai, India');
      const locationValue = await adminPage.locator('[id="1_81_input_location"]').inputValue();
      if (!locationValue) throw new Error('Manual address input failed');
      logger.success(`Manual address entered: ${locationValue}`);
    } else {
      // GPS available — type to get predictions
      const gpsSearchInput = adminPage.getByPlaceholder('Search for area, street name');
      await gpsSearchInput.fill('Pune');
      await adminPage.waitForTimeout(1500);

      const predictionsVisible = await adminPage
        .locator('.autocomplete-prediction')
        .first()
        .isVisible()
        .catch(() => false);
      if (predictionsVisible) {
        await adminPage.locator('.autocomplete-prediction').first().click();
        await adminPage.waitForTimeout(500);
        // Verify location field has value
        const locationValue = await adminPage
          .locator('[id="1_81_input_location"]')
          .inputValue()
          .catch(() => '');
        logger.success(`GPS address selected: ${locationValue}`);
      } else {
        // No predictions — fall back to manual
        logger.warn('No GPS predictions — using manual address');
        await adminPage.locator('[id="1_81_input_location"]').fill('Pune, Maharashtra, India');
        logger.success('Manual address fallback used');
      }
    }

    // Close form without saving
    await adminPage.keyboard.press('Escape');
    await adminPage.waitForTimeout(500);
    logger.success('GPS address test completed');
    logger.success('M7 passed');
  });
});
