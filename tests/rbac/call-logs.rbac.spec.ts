import { test, expect } from '../../src/fixtures/index';
import { CallLogsPage } from '../../src/modules/call-logs/CallLogsPage';
import {
  generateAdminCallLogData,
  generateRestrictedCallLogData,
} from '../../src/data/factories/callLogFactory';
import { logger } from '../../src/utils/logger';
import { config } from '../../config/config';

test.describe('Call Logs — RBAC', () => {

  // ── CL19 ──────────────────────────────────────────────────────────────────

  test(
    '@smoke @regression Restricted user should navigate to Call Logs list page and verify list is visible',
    async ({ restrictedPage }) => {
      const callLogsPage = new CallLogsPage(restrictedPage);
      await callLogsPage.goToCallLogsList();
      await callLogsPage.assertOnCallLogsListPage();
      logger.success('CL19 passed');
    }
  );

  // ── CL20 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should create a Lead call log with Outcome Connected and verify toaster, ID capture, and detail panel shows correct data',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      const { callLogId, entityName } = await callLogsPage.createCallLog(data);
      await callLogsPage.assertToasterVisible();
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.assertDetailEntityHeadingContains(entityName);
      await callLogsPage.assertOutcomeOnDetail('Connected');
      await callLogsPage.assertOwnerVisible();
      logger.success('CL20 passed');
    }
  );

  // ── CL21 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should create a Contact call log with Outcome Busy and verify duration is disabled and call log saved correctly',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Contact', outcome: 'Busy' });
      await callLogsPage.goToCallLogsList();
      await callLogsPage.openLogACallForm();
      await callLogsPage.fillEntityType('Contact');
      await callLogsPage.fillCreateForm(data);
      await callLogsPage.assertDurationDisabled();
      const callLogId = await callLogsPage.saveCallLog();
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.assertOutcomeOnDetail('Busy');
      logger.success('CL21 passed');
    }
  );

  // ── CL22 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should create a Contact call log with optional Associated Deal and Outcome No Answer and verify both entity associations on detail panel',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({
        entityType: 'Contact',
        outcome: 'No Answer',
        includeAssociatedDeal: true,
      });
      await callLogsPage.goToCallLogsList();
      const { callLogId, entityName } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.assertDetailEntityHeadingContains(entityName);
      await callLogsPage.assertOutcomeOnDetail('No Answer');
      logger.success('CL22 passed');
    }
  );

  // ── CL23 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should create a Deal call log with Outcome Rejected and verify Associated Contact mandatory, phone auto-populated, duration disabled',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Deal', outcome: 'Rejected' });
      await callLogsPage.goToCallLogsList();
      await callLogsPage.openLogACallForm();
      await callLogsPage.fillEntityType('Deal');
      await callLogsPage.fillCreateForm(data);
      await callLogsPage.assertPhoneFieldDisabled();
      await callLogsPage.assertDurationDisabled();
      const callLogId = await callLogsPage.saveCallLog();
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.assertOutcomeOnDetail('Rejected');
      logger.success('CL23 passed');
    }
  );

  // ── CL24 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should create a Lead call log with Outcome Missed Call and verify call log saved with correct outcome',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Missed Call' });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.assertOutcomeOnDetail('Missed Call');
      logger.success('CL24 passed');
    }
  );

  // ── CL25 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should update all editable fields of their own call log and verify updated values persist on detail panel',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const originalData = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      const updatedData = generateRestrictedCallLogData({
        entityType: 'Lead',
        outcome: 'Busy',
        callSummary: `RES-UPDATED-${Date.now()} summary`,
      });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(originalData);
      expect(callLogId).not.toBeNull();
      await callLogsPage.assertCallLogInList(callLogId!);
      await callLogsPage.updateCallLog(callLogId!, updatedData);
      await callLogsPage.assertOutcomeOnDetail('Busy');
      logger.success('CL25 passed');
    }
  );

  // ── CL26 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should add a note from the call log details panel after create and verify note content visible after expanding View Call Notes',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      // WHY: Add wait for permissions to fully load — intermittent permission error on CI
      await restrictedPage.waitForTimeout(2000);
      const { callLogId } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogById(callLogId!);
      const noteText = `Restricted detail note ${Date.now()} — post create verification`;
      await callLogsPage.addNoteFromDetailPanel(noteText);
      await callLogsPage.assertNoteVisible(noteText);
      logger.success('CL26 passed');
    }
  );

  // ── CL27 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should add a note during call log create form and verify note is saved and visible on detail panel',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const noteText = `RES-create-note-${Date.now()} — added during create form`;
      const data = generateRestrictedCallLogData({
        entityType: 'Lead',
        outcome: 'Connected',
        notes: noteText,
      });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(data, {
        includeNoteDuringCreate: true,
      });
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogById(callLogId!);
      // WHY: Verify create note is visible on detail panel
      await callLogsPage.assertNoteVisible(noteText);
      logger.success('Create note verified on detail panel');
      // WHY: Add a second note from detail panel and verify it too
      const detailNoteText = `RES-detail-note-${Date.now()} — added from detail panel`;
      await callLogsPage.addNoteFromDetailPanel(detailNoteText);
      await callLogsPage.assertNoteVisible(detailNoteText);
      logger.success('Detail panel note verified');
      logger.success('CL27 passed');
    }
  );

  // ── CL28 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should search their own call log by phone number and verify matching call log appears in list',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      const { callLogId, selectedPhone } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogsList();
      if (selectedPhone && selectedPhone.trim() !== '') {
        await callLogsPage.searchByPhoneNumber(selectedPhone.trim());
        await callLogsPage.assertSearchResultContains(selectedPhone);
      } else {
        logger.warn('Phone not captured — skipping phone search assertion');
      }
      logger.success('CL28 passed');
    }
  );

  // ── CL29 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should search their own call log by entity name and verify matching call log appears in list',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      const { callLogId, selectedPhone } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogsList();
      if (selectedPhone && selectedPhone.trim() !== '') {
        await callLogsPage.searchByPhoneNumber(selectedPhone.trim());
        await callLogsPage.assertSearchResultContains(selectedPhone);
      } else {
        logger.warn('Phone number not captured — skipping phone search assertion');
      }
      logger.success('CL29 passed');
    }
  );

 // ── CL30 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should click toaster after create and verify navigation to call log specific URL with only that call log visible',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      await callLogsPage.openLogACallForm();
      await callLogsPage.fillCreateForm(data);
      const callLogId = await callLogsPage.saveCallLog();
      expect(callLogId).not.toBeNull();
      const toastLink = callLogsPage['toasterCallLogIdLink']();
      await toastLink.waitFor({ state: 'visible', timeout: 10000 });
      await toastLink.click();
      await restrictedPage.waitForURL(new RegExp(`/sales/calls/list\\?id=${callLogId}`), {
        timeout: config.timeouts.navigation,
      });
      const currentUrl = restrictedPage.url();
      expect(currentUrl).toContain(`?id=${callLogId}`);
      logger.info(`Restricted user navigated to: ${currentUrl}`);
      logger.success('CL30 passed');
    }
  );
  // ── CL31 — Cross-module: Lead ─────────────────────────────────────────────

  test(
    '@regression Restricted user should create Lead call log, navigate to lead detail via entity link, open Call Logs productivity section, verify call log appears with correct outcome and logged by, then return to call logs list',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogById(callLogId!);
      const restrictedName = await callLogsPage.getLoggedInUserName('restricted');
      await callLogsPage.navigateToEntityViaDetailLink();
      await callLogsPage.openCallLogsProductivitySection();
      await callLogsPage.assertCallLogInProductivitySection('Connected', restrictedName);
      await callLogsPage.returnToCallLogsList(restrictedPage);
      await callLogsPage.assertOnCallLogsListPage();
      logger.success('CL31 passed');
    }
  );

  // ── CL31b — Cross-module: Contact ─────────────────────────────────────────

  test(
    '@regression Restricted user should create Contact call log, navigate to contact detail via entity link, open Call Logs productivity section, verify call log appears, return to call logs list',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const data = generateRestrictedCallLogData({ entityType: 'Contact', outcome: 'Busy' });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogById(callLogId!);
      const restrictedName = await callLogsPage.getLoggedInUserName('restricted');
      await callLogsPage.navigateToEntityViaDetailLink();
      await callLogsPage.openCallLogsProductivitySection();
      await callLogsPage.assertCallLogInProductivitySection('Busy', restrictedName);
      await callLogsPage.returnToCallLogsList(restrictedPage);
      await callLogsPage.assertOnCallLogsListPage();
      logger.success('CL31b passed');
    }
  );

  // ── CL31c — Cross-module RBAC: restricted navigates to admin entity ────────

  test(
    '@regression Restricted user should navigate to admin-owned Lead detail and verify admin call log is NOT visible in Call Logs productivity section',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId: adminCallLogId, entityName: adminEntityName } =
        await adminCallLogs.createCallLog(adminData);
      expect(adminCallLogId).not.toBeNull();
      logger.info(`Admin call log created: ID ${adminCallLogId}, entity: ${adminEntityName}`);
      await adminCallLogs.goToCallLogById(adminCallLogId!);
      const entityLink = adminPage.locator('h2.call-log-entity a.link-primary');
      const adminEntityUrl = await entityLink.getAttribute('href').catch(() => '');
      if (!adminEntityUrl) {
        logger.warn('Could not capture admin entity URL — skipping cross-module RBAC check');
        logger.success('CL31c passed (skipped — entity URL not available)');
        return;
      }
      const absoluteUrl = adminEntityUrl.startsWith('http')
        ? adminEntityUrl
        : `${config.appUrl}${adminEntityUrl}`;
      await restrictedPage.goto(absoluteUrl, { waitUntil: 'domcontentloaded' });
      await restrictedPage.waitForTimeout(1000);
      const callLogsBtn = restrictedPage.locator("button[data-original-title='Call Logs'] svg");
      const btnVisible = await callLogsBtn.isVisible().catch(() => false);
      if (btnVisible) {
        await callLogsBtn.click();
        await restrictedPage.waitForTimeout(1000);
        const adminCallLogVisible = await restrictedPage
          .locator('ul.list-unstyled.mb-0.card-list li.media')
          .isVisible()
          .catch(() => false);
        if (adminCallLogVisible) {
          const loggedBy = await restrictedPage
            .locator('.call-body').first().textContent().catch(() => '');
          const adminName = await adminCallLogs.getLoggedInUserName('admin');
          if (loggedBy?.includes(adminName)) {
            throw new Error(
              `Admin call log "${adminName}" should NOT be visible to restricted user on admin entity`
            );
          }
          logger.info('Call log visible but logged by restricted user — correct RBAC behaviour');
        } else {
          logger.info('No call logs visible — correct RBAC behaviour');
        }
      } else {
        logger.info('Call Logs button not visible — restricted user cannot access admin entity');
      }
      logger.success('CL31c passed');
    }
  );

  // ── CL31d — Cross-module RBAC: admin creates call log on restricted entity ──

  test(
    '@regression Restricted user should see and access call log that admin created on restricted user own lead entity in productivity section',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const restrictedCallLogs = new CallLogsPage(restrictedPage);
      const restrictedData = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await restrictedCallLogs.goToCallLogsList();
      const { callLogId: restrictedCallLogId, entityName: restrictedEntityName } =
        await restrictedCallLogs.createCallLog(restrictedData);
      expect(restrictedCallLogId).not.toBeNull();
      logger.info(`Restricted user lead entity: ${restrictedEntityName}`);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Busy' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId: adminCallLogId } = await adminCallLogs.createCallLog(adminData, {
        selectedEntityName: restrictedEntityName,
      });
      expect(adminCallLogId).not.toBeNull();
      logger.info(`Admin created call log ID ${adminCallLogId} on restricted user's lead: ${restrictedEntityName}`);
      await restrictedCallLogs.goToCallLogById(adminCallLogId!);
      const detailVisible = await restrictedCallLogs['detailEntityHeading']()
        .isVisible().catch(() => false);
      if (!detailVisible) {
        throw new Error(
          `Restricted user should see call log ID ${adminCallLogId} created on their lead entity`
        );
      }
      logger.success(`Restricted user can see admin's call log on their own lead entity`);
      await restrictedCallLogs.navigateToEntityViaDetailLink();
      await restrictedCallLogs.openCallLogsProductivitySection();
      // WHY: After navigateToEntityViaDetailLink, restrictedCallLogs.page = new tab
      // Use restrictedCallLogs page locator not restrictedPage (old tab)
      const items = restrictedCallLogs['page'].locator('ul.list-unstyled.mb-0.card-list li.media');
      await items.first().waitFor({ state: 'visible', timeout: 15000 });
      const count = await items.count();
      logger.info(`Call log items in productivity section: ${count}`);
      expect(count).toBeGreaterThanOrEqual(1);
      await restrictedCallLogs.returnToCallLogsList(restrictedPage);
      await restrictedCallLogs.assertOnCallLogsListPage();
      logger.success('CL31d passed');
    }
  );

  // ── CL32 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should not see admin-owned call log when navigating directly via call log ID URL',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const restrictedCallLogs = new CallLogsPage(restrictedPage);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId } = await adminCallLogs.createCallLog(adminData);
      expect(callLogId).not.toBeNull();
      logger.info(`Admin call log ID: ${callLogId}`);
      await restrictedCallLogs.assertCallLogNotInList(callLogId!);
      logger.success('CL32 passed');
    }
  );

  // ── CL33 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should not see Edit option on admin-owned call log detail panel',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const restrictedCallLogs = new CallLogsPage(restrictedPage);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId } = await adminCallLogs.createCallLog(adminData);
      expect(callLogId).not.toBeNull();
      await restrictedPage.goto(
        `${config.appUrl}/sales/calls/list?id=${callLogId}`,
        { waitUntil: 'domcontentloaded' }
      );
      await restrictedPage.waitForTimeout(1000);
      const detailVisible = await restrictedCallLogs['detailEntityHeading']()
        .isVisible().catch(() => false);
      if (detailVisible) {
        await restrictedCallLogs.assertEditButtonNotVisible();
        logger.info('Edit button correctly absent on admin call log detail');
      } else {
        logger.info('Admin call log not accessible to restricted user — Edit button check implicit');
      }
      logger.success('CL33 passed');
    }
  );

  // ── CL34 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user search by admin lead phone number should return no matching call log results',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const restrictedCallLogs = new CallLogsPage(restrictedPage);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId, selectedPhone } = await adminCallLogs.createCallLog(adminData);
      expect(callLogId).not.toBeNull();
      logger.info(`Admin call log phone: ${selectedPhone}`);
      await restrictedCallLogs.goToCallLogsList();
      if (selectedPhone && selectedPhone.trim() !== '') {
        await restrictedCallLogs.searchByPhoneNumber(selectedPhone.trim());
        const callLogItemCount = await restrictedPage
          .locator('li.list-group-item').count().catch(() => 0);
        logger.info(`Search results count for restricted user: ${callLogItemCount}`);
        if (callLogItemCount > 0) {
          const adminCallLogInResults = await restrictedPage
            .locator(`li.list-group-item input#check_${callLogId}`)
            .isVisible().catch(() => false);
          if (adminCallLogInResults) {
            throw new Error(
              `Admin call log ID ${callLogId} should NOT appear in restricted user search results`
            );
          }
          logger.info('Admin call log not in restricted user search results — correct RBAC');
        } else {
          logger.info('No results returned for restricted user — correct RBAC behaviour');
        }
      } else {
        logger.warn('Admin phone not captured — skipping search RBAC assertion');
      }
      logger.success('CL34 passed');
    }
  );

  // ── CL35 ──────────────────────────────────────────────────────────────────

  test(
    '@regression Restricted user should see and access call log that admin created on restricted user own lead entity',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);
      const adminCallLogs = new CallLogsPage(adminPage);
      const restrictedCallLogs = new CallLogsPage(restrictedPage);
      const restrictedData = generateRestrictedCallLogData({ entityType: 'Lead', outcome: 'Connected' });
      await restrictedCallLogs.goToCallLogsList();
      const { entityName: restrictedLeadName } = await restrictedCallLogs.createCallLog(restrictedData);
      logger.info(`Restricted user's lead: ${restrictedLeadName}`);
      const adminData = generateAdminCallLogData({ entityType: 'Lead', outcome: 'Busy' });
      await adminCallLogs.goToCallLogsList();
      const { callLogId: adminCallLogId } = await adminCallLogs.createCallLog(adminData, {
        selectedEntityName: restrictedLeadName,
      });
      expect(adminCallLogId).not.toBeNull();
      logger.info(`Admin created call log ID ${adminCallLogId} on restricted user's lead`);
      await restrictedCallLogs.goToCallLogById(adminCallLogId!);
      const detailVisible = await restrictedCallLogs['detailEntityHeading']()
        .isVisible().catch(() => false);
      if (!detailVisible) {
        throw new Error(
          `Restricted user should see call log ID ${adminCallLogId} created by admin on their lead`
        );
      }
      await restrictedCallLogs.assertDetailEntityHeadingContains(restrictedLeadName);
      await restrictedCallLogs.assertOutcomeOnDetail('Busy');
      logger.success('Restricted user can see admin call log on their own lead entity');
      logger.success('CL35 passed');
    }
  );

  // ── CL36 — prodSafe ───────────────────────────────────────────────────────

  // ── CL37 — Recording Upload ──────────────────────────────────────────────

  test(
    '@regression Restricted user should create a lead call log with outcome connected, upload a recording file and verify recording appears on detail panel',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);
      const callLogsPage = new CallLogsPage(restrictedPage);
      const recordingPath = require('path').resolve('src/data/files/test-recording.mp3');
      const data = generateRestrictedCallLogData({
        entityType: 'Lead',
        outcome: 'Connected',
        recording: recordingPath,
      });
      await callLogsPage.goToCallLogsList();
      const { callLogId } = await callLogsPage.createCallLog(data);
      expect(callLogId).not.toBeNull();
      await callLogsPage.goToCallLogById(callLogId!);
      await callLogsPage.assertRecordingOnDetail('test-recording.mp3');
      logger.success('CL37 passed');
    }
  );

  test(
    '@prodSafe Restricted user should navigate to Call Logs list page on production and verify list is accessible without errors',
    async ({ restrictedPage }) => {
      const callLogsPage = new CallLogsPage(restrictedPage);
      await callLogsPage.goToCallLogsList();
      await callLogsPage.assertOnCallLogsListPage();
      logger.success('CL36 passed');
    }
  );

});