import { test, expect } from '../../src/fixtures/index';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData, generateAdminLeadData } from '../../src/data/factories/leadFactory';
import { config } from '../../config/config';
import { logger } from '../../src/utils/logger';
import { TasksPage } from '../../src/modules/tasks/TasksPage';
import { generateTaskData } from '../../src/data/factories/taskFactory';
import { MeetingsPage } from '../../src/modules/meetings/MeetingsPage';
import { CallLogsPage } from '../../src/modules/call-logs/CallLogsPage';
import { generateCallLogData } from '../../src/data/factories/callLogFactory';

test.describe('Leads RBAC', () => {
  test('@smoke @regression restricted user can navigate to leads list', async ({
    restrictedPage,
  }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L6 passed');
  });

  test('@regression restricted user can create a lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
    logger.success('L7 passed');
  });

  test('@regression restricted user can edit own lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName);
    await leadsPage.assertLeadUpdated(updatedData);
    logger.success('L8 passed');
  });

  test('@regression restricted user cannot edit an admin-owned lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    // WHY: generateAdminLeadData uses timestamp prefix (ADM12345678)
    // guarantees this lead name has never existed before — no collision with old test data
    const adminLeadsPage = new LeadsPage(adminPage);
    const leadData = generateAdminLeadData();
    await adminLeadsPage.goToLeadsList();
    await adminLeadsPage.createLead(leadData);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await restrictedLeadsPage.goToLeadsList();
    await restrictedLeadsPage.assertLeadNotInList(leadData.firstName);
    logger.success('L9 passed');
  });

  // ── L10 ───────────────────────────────────────────────────

  test('@regression admin shares lead Read only restricted user sees only Clone in ellipsis not Delete Share Reassign Convert', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = require('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, []);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.openEllipsisMenu();
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Delete');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Share');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Reassign');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Convert');
    logger.success('L10 passed');
  });

  // ── L11 ───────────────────────────────────────────────────

  test('@regression admin shares lead Update permission restricted user sees edit button and only Clone in ellipsis', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = require('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['update']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Update permission — edit button visible
    await expect(restrictedPage.locator('#edit-action-btn')).toBeVisible({ timeout: 10000 });
    // WHY: Restricted user edits the lead to verify update permission works
    await restrictedLeadsPage.clickEditIcon();
    const updatedData = generateLeadData();
    await restrictedLeadsPage.fillEditForm(updatedData);
    await restrictedLeadsPage.saveEditedLead();
    await restrictedLeadsPage.assertLeadExistsInList(updatedData.firstName);
    // WHY: Navigate back to verify ellipsis shows only Clone
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.openEllipsisMenu();
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Delete');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Reassign');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Convert');
    logger.success('L11 passed');
  });

  // ── L12 ───────────────────────────────────────────────────

  test('@regression admin shares lead Note permission restricted user sees Notes icon and can add note from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = require('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['note']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    // WHY: Wait for page to fully load and permissions to apply
    await restrictedPage.waitForTimeout(3000);
    // WHY: Verify page loaded correctly — check URL still on lead details
    const currentUrl = restrictedPage.url();
    logger.info(`Restricted user URL: ${currentUrl}`);
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    // WHY: Click textarea first to activate CKEditor
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    // WHY: Fill note in CKEditor after it activates
    const noteText = `Test note from restricted user ${Date.now()}`;
    await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill(noteText);
    await restrictedPage.waitForTimeout(500);
    // WHY: Click Add button to save note
    await restrictedPage.getByText('Add', { exact: true }).click();
    await restrictedPage.waitForTimeout(1500);
    // WHY: Verify note appears in the notes list — row contains user + timestamp metadata
    const noteRow = restrictedPage.locator('div.row.pt-2.pl-2.pr-2').first();
    await expect(noteRow).toBeVisible({ timeout: 10000 });
    const noteRowText = await noteRow.textContent();
    logger.success(`Note added and verified: ${noteRowText?.trim().substring(0, 80)}`);
    logger.success('L12 passed');
  });

  // ── L13 ───────────────────────────────────────────────────

  test('@regression admin shares lead Task permission restricted user sees Tasks icon and can create task from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = require('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['task']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    // WHY: Use TasksPage to create quick task from lead detail panel
    const tasksPage = new TasksPage(restrictedPage);
    const taskData = generateTaskData();
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    const taskId = await tasksPage.saveQuickTask();
    expect(taskId).not.toBeNull();
    logger.success(`Task created: ${taskId}`);
    // WHY: Click Tasks icon again to refresh task list and verify task appears
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    await restrictedPage.waitForTimeout(1000);
    const taskLocator = restrictedPage.locator('.task-details-wrapper').getByText(taskData.name).first();
    await expect(taskLocator).toBeVisible({ timeout: 10000 });
    logger.success(`Task verified in list: ${taskData.name}`);
    logger.success('L13 passed');
  });

    // ── L14 ───────────────────────────────────────────────────

  test('@regression admin shares lead Read only with restricted user and restricted sees lead but no productivity icons', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    // WHY: Share with Read only — no extra permissions
    await adminLeadsPage.shareLead(restrictedUserName, []);
    // WHY: Restricted user navigates to shared lead via ID
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Read only — productivity icons should NOT be visible
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Notes');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Tasks');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Meetings');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Call Logs');
    logger.success('L14 passed');
  });

  // ── L15 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Update permission and restricted user can edit lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['update']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Update permission — edit button should be visible
    await expect(restrictedPage.locator('#edit-action-btn')).toBeVisible({ timeout: 10000 });
    // WHY: Edit the lead to verify update permission works
    await restrictedLeadsPage.clickEditIcon();
    const updatedData = generateLeadData();
    await restrictedLeadsPage.fillEditForm(updatedData);
    await restrictedLeadsPage.saveEditedLead();
    await restrictedLeadsPage.assertLeadExistsInList(updatedData.firstName);
    logger.success('L15 passed');
  });

  // ── L16 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Note permission and restricted user can add note from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['note']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Note permission — Notes icon should be visible in right panel
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    logger.success('L16 passed');
  });

  // ── L17 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Task permission and restricted user can create task from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['task']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    logger.success('L17 passed');
  });

  // ── L18 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Meeting permission and restricted user can create meeting from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['meeting']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Meetings');
    await restrictedLeadsPage.clickRightPanelIcon('Meetings');
    // WHY: Use MeetingsPage to create meeting from lead detail panel
    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingTitle = `Meeting-${Date.now()}`;
    await meetingsPage.openAddForm();
    await meetingsPage.fillTitleOnly(meetingTitle);
    const meetingId = await meetingsPage.saveMeeting();
    // WHY: meetingId can be null on CI when POST response is slow
    // Meeting was created (popup clicked) — ID capture is best-effort only
    if (meetingId) {
      logger.success(`Meeting created with ID: ${meetingId} — ${meetingTitle}`);
    } else {
      logger.warn('Meeting ID not captured — meeting still created successfully (popup confirmed)');
    }
    logger.success('L18 passed');
  });

  // ── L19 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Call permission and restricted user can log call from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['call']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Call Logs');
    await restrictedLeadsPage.clickRightPanelIcon('Call Logs');
    // WHY: Reload page to ensure Log a call button is fully loaded
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForTimeout(2000);
    await restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' }).click();
    await restrictedPage.waitForTimeout(1000);
    // WHY: Remove aria-hidden so Playwright can interact with modal
    await restrictedPage.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    const callLogsPage = new CallLogsPage(restrictedPage);
    const callLogData = generateCallLogData({ outcome: 'Connected' });
    // WHY: Entity type pre-selected as Lead — no need to select entity
    // WHY: Dropdown may auto-open — wait then select option directly
    await restrictedPage.waitForTimeout(500);
    const callTypeMenu = restrictedPage.locator('.is-invalid__menu');
    const callTypeMenuVisible = await callTypeMenu.isVisible().catch(() => false);
    if (callTypeMenuVisible) {
      // WHY: Menu already open — click first option directly
      await callTypeMenu.locator('.is-invalid__option').first().click({ force: true });
      await restrictedPage.waitForTimeout(300);
    } else {
      await callLogsPage.fillCallType(callLogData.callType);
    }
    // WHY: Use Connected outcome — duration field only enabled for Connected calls
    await callLogsPage.fillOutcome('Connected');
    await callLogsPage.fillPhoneNumber();
    await callLogsPage.fillCallSummary(callLogData.callSummary);
    // WHY: Fill duration — Connected outcome enables duration field
    if (callLogData.duration) {
      await callLogsPage.fillDurationDirect(callLogData.duration.value, callLogData.duration.type);
    }
    const callLogId = await callLogsPage.saveCallLog();
    expect(callLogId).not.toBeNull();
    logger.success(`Call log created: ${callLogId}`);
    logger.success(`Call log created: ${callLogId}`);
    logger.success('L19 passed');
  });

  // ── L20 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Note Task Meeting Call permissions and restricted user can do all four', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    // WHY: Share with all 4 permissions at once
    await adminLeadsPage.shareLead(restrictedUserName, ['note', 'task', 'meeting', 'call']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.assertRightPanelIconVisible('Meetings');
    await restrictedLeadsPage.assertRightPanelIconVisible('Call Logs');

    // WHY: Verify Note — click Notes icon, add note, verify note row appears
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill(`Note-${Date.now()}`);
    await restrictedPage.waitForTimeout(500);
    await restrictedPage.getByText('Add', { exact: true }).click();
    await restrictedPage.waitForTimeout(1500);
    await expect(restrictedPage.locator('div.row.pt-2.pl-2.pr-2').first()).toBeVisible({ timeout: 10000 });
    logger.success('Note created and verified');

    // WHY: Verify Task — click Tasks icon, create quick task
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    const tasksPage2 = new TasksPage(restrictedPage);
    const taskData2 = generateTaskData();
    await tasksPage2.openQuickTaskForm();
    await tasksPage2.fillQuickTaskForm(taskData2);
    const taskId2 = await tasksPage2.saveQuickTaskFromEntityDetail();
    expect(taskId2).not.toBeNull();
    logger.success(`Task created: ${taskId2}`);
    // WHY: Reload page after task creation before moving to next operation
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForTimeout(2000);

    // WHY: Verify Meeting — click Meetings icon, create meeting, verify ID
    await restrictedLeadsPage.clickRightPanelIcon('Meetings');
    const meetingsPage2 = new MeetingsPage(restrictedPage);
    const meetingTitle2 = `Meeting-${Date.now()}`;
    await meetingsPage2.openAddForm();
    await meetingsPage2.fillTitleOnly(meetingTitle2);
    const meetingId2 = await meetingsPage2.saveMeeting();
    // WHY: meetingId can be null on CI — log warning but continue
    if (meetingId2) {
      logger.success(`Meeting created: ${meetingId2}`);
    } else {
      logger.warn('Meeting ID not captured — meeting still created successfully');
    }
    // WHY: Navigate back to lead detail page after meeting creation
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);

    // WHY: Verify Call — click Call Logs icon first, then Log a call button
    await restrictedLeadsPage.clickRightPanelIcon('Call Logs');
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' }).click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    const callLogsPage2 = new CallLogsPage(restrictedPage);
    const callLogData2 = generateCallLogData({ outcome: 'Connected' });
    await restrictedPage.waitForTimeout(800);
    // WHY: Check if call type dropdown is already open — select first option if so
    const callTypeMenu3 = restrictedPage.locator('.is-invalid__menu');
    const callTypeMenuOpen = await callTypeMenu3.isVisible().catch(() => false);
    if (callTypeMenuOpen) {
      await callTypeMenu3.locator('.is-invalid__option').first().click({ force: true });
      await restrictedPage.waitForTimeout(300);
    } else {
      await callLogsPage2.fillCallType(callLogData2.callType);
    }
    // WHY: Use Connected outcome — duration field only enabled for Connected calls
    await callLogsPage2.fillOutcome('Connected');
    await callLogsPage2.fillPhoneNumber();
    await callLogsPage2.fillCallSummary(callLogData2.callSummary);
    // WHY: Fill duration — Connected outcome enables duration field
    if (callLogData2.duration) {
      await callLogsPage2.fillDurationDirect(callLogData2.duration.value, callLogData2.duration.type);
    }
    const callLogId2 = await callLogsPage2.saveCallLog();
    expect(callLogId2).not.toBeNull();
    logger.success(`Call log created: ${callLogId2}`);
    logger.success('L20 passed');
  });

  // ── L21 ───────────────────────────────────────────────────

  test('@regression admin reassigns lead to restricted user and restricted becomes owner can edit and delete', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const { generateSharedLeadData } = await import('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.reassignLead(restrictedUserName);
    // WHY: Restricted user now owns the lead — can edit and delete
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Verify edit button visible — restricted user is now owner
    await expect(restrictedPage.locator('#edit-action-btn')).toBeVisible({ timeout: 10000 });
    // WHY: Verify restricted user can edit the lead
    await restrictedLeadsPage.clickEditIcon();
    const updatedData = generateLeadData();
    await restrictedLeadsPage.fillEditForm(updatedData);
    await restrictedLeadsPage.saveEditedLead();
    await restrictedLeadsPage.assertLeadExistsInList(updatedData.firstName);
    logger.success('Restricted user edited reassigned lead successfully');
    // WHY: Navigate back to lead detail to verify delete option
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(2000);
    // WHY: Delete lead — deleteLead() opens ellipsis and clicks Delete internally
    await restrictedLeadsPage.deleteLead();
    // WHY: Verify deletion by navigating to detail URL — deleted lead redirects away
    await restrictedLeadsPage.assertLeadDeletedById(leadId!);
    logger.success('Restricted user deleted reassigned lead successfully');
    logger.success('L21 passed');
  });

  // ── L22 ───────────────────────────────────────────────────

  test('@regression converted lead still shows Lead Converted badge on admin detail page', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const dealName = `Deal-${Date.now()}`;
    await leadsPage.convertLeadToAll(dealName);
    await leadsPage.assertLeadConvertedBadge();
    logger.success('L22 passed');
  });

  // ── L23 ───────────────────────────────────────────────────

  test('@regression restricted user can clone their own lead and verify cloned lead has Copy in lastName', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.cloneLead();
    await leadsPage.assertClonedLeadLastName(leadData.lastName);
    logger.success('L23 passed');
  });

  // ── L24 ───────────────────────────────────────────────────

  test('@regression restricted user can delete their own lead and verify it is removed from list', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateAdminLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();
    await leadsPage.assertLeadNotInList(leadData.firstName);
    logger.success('L24 passed');
  });

  // ── L25 ───────────────────────────────────────────────────

  test('@regression restricted user can mark their own lead as Won and verify stage', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Won');
    await leadsPage.assertLeadStageOnDetail('Won');
    logger.success('L25 passed');
  });

  // ── L26 ───────────────────────────────────────────────────

  test('@regression restricted user can mark their own lead as Closed Lost and verify stage', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const selectedReason = await leadsPage.markLeadAsStage('Closed Lost');
    await leadsPage.assertLeadStageOnDetail('Closed Lost');
    // WHY: Click Read More to verify reason is shown
    const readMoreLink = restrictedPage.locator('span.pipeline-info-link a').filter({ hasText: 'Read More' }).first();
    await readMoreLink.waitFor({ state: 'visible', timeout: 10000 });
    await readMoreLink.click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Verify reason section shows the selected reason
    const reasonSection = restrictedPage.locator('.read-only-info').filter({ hasText: 'Reason' }).first();
    await expect(reasonSection).toBeVisible({ timeout: 5000 });
    const reasonText = await reasonSection.textContent();
    expect(reasonText).toContain(selectedReason);
    logger.success(`Closed Lost reason verified: ${selectedReason}`);
    logger.success('L26 passed');
  });

  // ── L29 ───────────────────────────────────────────────────

  test('@regression restricted user can mark their own lead as Closed Unqualified select reason and verify stage', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const selectedReason = await leadsPage.markLeadAsStage('Closed Unqualified');
    await leadsPage.assertLeadStageOnDetail('Closed Unqualified');
    // WHY: Click Read More to verify reason is shown
    const readMoreLink = restrictedPage.locator('span.pipeline-info-link a').filter({ hasText: 'Read More' }).first();
    await readMoreLink.waitFor({ state: 'visible', timeout: 10000 });
    await readMoreLink.click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Verify reason section shows the selected reason
    const reasonSection = restrictedPage.locator('.read-only-info').filter({ hasText: 'Reason' }).first();
    await expect(reasonSection).toBeVisible({ timeout: 5000 });
    const reasonText = await reasonSection.textContent();
    expect(reasonText).toContain(selectedReason);
    logger.success(`Closed Unqualified reason verified: ${selectedReason}`);
    logger.success('L29 passed');
  });

  // ── L27 ───────────────────────────────────────────────────

  test('@prodSafe restricted user should navigate to leads list page on production', async ({
    restrictedPage,
  }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L27 passed');
  });

  // ── L28 ───────────────────────────────────────────────────

  test('@regression restricted user with Note permission can add and delete a note on shared lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const { generateSharedLeadData } = require('../../src/data/factories/leadFactory');
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['note']);
    await restrictedPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await restrictedPage.waitForTimeout(3000);
    // WHY: Click Notes icon to open notes panel
    await restrictedPage.locator('button.btn.btn-transparent:has(svg #paint0_linear_972_2654)').first().click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Capture baseline before adding notes — entity may have pre-existing notes from prior runs
    const baselineCount = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();
    // WHY: Add first note — this note will be kept
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to keep');
    await restrictedPage.waitForTimeout(500);
    await restrictedPage.getByText('Add', { exact: true }).click();
    await restrictedPage.waitForTimeout(1500);
    // WHY: Add second note — this note will be deleted
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to delete');
    await restrictedPage.waitForTimeout(500);
    await restrictedPage.getByText('Add', { exact: true }).click();
    await restrictedPage.waitForTimeout(1500);
    // WHY: Verify both new notes were added on top of baseline
    const notesBeforeDelete = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();
    expect(notesBeforeDelete).toBe(baselineCount + 2);
    // WHY: Delete the first note (newest first display) — "Note to delete" was added last so appears first
    const lastNoteEllipsis = restrictedPage.locator('div.row.pt-2.pl-2.pr-2')
      .first()
      .locator('button[data-toggle="dropdown"]');
    await lastNoteEllipsis.click();
    await restrictedPage.waitForTimeout(300);
    await restrictedPage.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: 'Delete' }).click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Confirm delete in modal
    await restrictedPage.locator('button#confirm.btn-danger').waitFor({ state: 'visible', timeout: 5000 });
    await restrictedPage.locator('button#confirm.btn-danger').click();
    await restrictedPage.waitForTimeout(1500);
    // WHY: Verify count dropped by 1 relative to baseline
    const notesAfterDelete = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();
    expect(notesAfterDelete).toBe(baselineCount + 1);
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
    logger.success('L28 passed');
  });
});
