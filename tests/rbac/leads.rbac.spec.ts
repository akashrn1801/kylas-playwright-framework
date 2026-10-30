import { test, expect } from '../../src/fixtures/index';
import type { LeadCleanup, ShareRuleCleanup } from '../../src/fixtures/index';
import { safeWaitForURL } from '../../src/utils/navigation';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { ContactsPage } from '../../src/modules/contacts/ContactsPage';
import { CompaniesPage } from '../../src/modules/companies/CompaniesPage';
import {
  generateContactData,
  generateAdminContactData,
} from '../../src/data/factories/contactFactory';
import {
  generateCompanyData,
  generateAdminCompanyData,
} from '../../src/data/factories/companyFactory';
import {
  generateLeadData,
  generateAdminLeadData,
  generateSharedLeadData,
  generateMinimalLeadData,
  LEAD_CUSTOM_FIELD_NAMES,
} from '../../src/data/factories/leadFactory';
import { config } from '../../config/config';
import { logger } from '../../src/utils/logger';
import { reportCreatedRecord } from '../../src/utils/createdRecords';
import { LeadApi } from '../../src/utils/leadApi';
import { redactTokens } from '../../src/utils/apiClient';
import { ShareRuleApi } from '../../src/utils/shareRuleApi';
import { ShareRulesPage } from '../../src/modules/shareRules/ShareRulesPage';
import { SharePermission, SharePermissionSet, permissionSet } from '../../src/core/sharePermissions';
import { TasksPage } from '../../src/modules/tasks/TasksPage';
import { generateTaskData } from '../../src/data/factories/taskFactory';
import { MeetingsPage } from '../../src/modules/meetings/MeetingsPage';
import { CallLogsPage } from '../../src/modules/call-logs/CallLogsPage';
import { generateCallLogData } from '../../src/data/factories/callLogFactory';

// WHY the API read-back: the stage text on the detail page is an unscoped text match, so the
// persisted stage is read from the lead itself (GET /v1/leads/{id} → pipeline.stage.name)
async function assertStagePersisted(
  page: Parameters<typeof LeadApi.forPage>[0],
  leadId: number,
  expectedStage: string
): Promise<void> {
  const api = await LeadApi.forPage(page);
  try {
    const lead = await api.getLeadOrThrow(leadId);
    expect(lead.pipeline?.stage.name, 'Stage stored on the lead').toBe(expectedStage);
  } finally {
    await api.dispose();
  }
}

// ──────────────────────────────────────────────────────────
// Helpers for the share-rule tests: what a lead shared with the restricted user allows
// ──────────────────────────────────────────────────────────

type PageArg = Parameters<typeof LeadApi.forPage>[0];

// The rights the server reports for a lead, as the restricted user sees them
async function restrictedRights(
  api: LeadApi,
  leadId: number
): Promise<{ status: number; actions: Record<string, boolean> }> {
  const result = await api.getLead(leadId);
  return { status: result.status, actions: result.ok ? (result.body.recordActions ?? {}) : {} };
}

// Poll the REAL access check (the lead's own rights for this user) until it shows the expected set.
// Returns how long the change took to apply. No sleeps: bounded polling on the server's own answer.
// WHY (known-bug tests L77/L79): after test.fail() ANY thrown error counts as the expected failure. A
// transport error (no HTTP answer at all, or an unreadable set-up read inside the call) says nothing about
// permissions, so it must not: such a run is reported as SKIPPED ("inconclusive"), and only the permission
// assertions that follow can produce the expected failure. Only calls that throw are wrapped — an HTTP
// status is returned as data and asserted by the test.
async function orInconclusive<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    test.skip(true, `inconclusive: transport error — ${redactTokens(String(error).split('\n')[0])}`);
    throw error;
  }
}

async function waitForRestrictedRights(api: LeadApi, leadId: number, expected: SharePermissionSet): Promise<number> {
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const { status, actions } = await restrictedRights(api, leadId);
        if (status !== 200) return `HTTP ${status}`;
        return (['update', 'note', 'task', 'meeting', 'call', 'email', 'sms', 'document'] as SharePermission[])
          .filter((permission) => (actions[permission] === true) !== expected[permission])
          .join(',');
      },
      {
        timeout: 60000,
        intervals: [500, 1000, 1000, 2000],
        message: "The restricted user's rights should match the edited share rule",
      }
    )
    .toBe('');
  return Date.now() - started;
}

// API: allowed actions succeed and removed ones are refused with the right code. Uses the SAME session
// that was open before the rule was edited — there is no new login.
async function assertRestrictedApiAccess(api: LeadApi, leadId: number, expected: SharePermissionSet): Promise<void> {
  // read — always granted by a share
  expect((await api.getLead(leadId)).status, 'Read').toBe(200);

  // update — the change succeeds when granted, is refused (400, code 000005) when not
  const update = await api.updateLead(leadId, { lastName: `Edited${Date.now()}` });
  if (expected.update) {
    expect(update.status, 'Update when granted').toBe(200);
  } else {
    expect(update.status, 'Update when removed').toBe(400);
    expect((update.body as { code?: string }).code, 'Update refused code').toBe('000005');
  }

  // note — adding one works when granted. When removed the server STILL accepts the call (a known
  // defect, tracked outside this repo), so then only the UI and the lead's rights are checked.
  if (expected.note) {
    expect((await api.addNote(leadId, `Note ${Date.now()}`)).status, 'Add note when granted').toBe(200);
  }

  // the server's own statement for every other right
  const { actions } = await restrictedRights(api, leadId);
  for (const permission of ['task', 'meeting', 'call', 'email', 'sms', 'document'] as SharePermission[]) {
    expect(actions[permission] === true, `Server rights: ${permission}`).toBe(expected[permission]);
  }

  // delete — never grantable through a share: always refused (400, code 002084)
  const deletion = await api.deleteLead(leadId);
  expect(deletion.status, 'Delete').toBe(400);
  expect((deletion.body as { code?: string }).code, 'Delete refused code').toBe('002084');
}

// UI, after a fresh page load as the restricted user: each matching option is shown when granted and
// absent when removed (edit button, Delete in the menu, and the right-rail icons for note, task,
// meeting and call log).
async function assertRestrictedUiAccess(
  leadsPage: LeadsPage,
  page: PageArg,
  leadId: number,
  expected: SharePermissionSet
): Promise<void> {
  await leadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
  await safeWaitForURL(page, /leads\/details\//, config.timeouts.navigation);
  // positive anchor: the lead opened (read) and its menu has rendered
  await leadsPage.assertEllipsisOptionVisible('Clone');
  await leadsPage.assertEditButtonVisible(expected.update);
  await leadsPage.assertEllipsisOptionNotVisible('Delete');
  const icons: Array<[SharePermission, string]> = [
    ['note', 'Notes'],
    ['task', 'Tasks'],
    ['meeting', 'Meetings'],
    ['call', 'Call Logs'],
  ];
  for (const [permission, title] of icons) {
    if (expected[permission]) {
      await leadsPage.assertRightPanelIconVisible(title);
    } else {
      await leadsPage.assertRightPanelIconNotVisible(title);
    }
  }
}

// Creates a lead, shares it with the restricted user with the given rights, and returns what the edit
// tests need. Everything is registered (logged; deleted only with CLEANUP_TEST_DATA=1) the moment it exists.
async function shareNewLeadWithRestricted(
  adminPage: PageArg,
  restrictedPage: PageArg,
  initial: SharePermission[],
  cleanup: { leads: LeadCleanup; rules: ShareRuleCleanup },
  options: { withPhone?: boolean } = {}
): Promise<{
  leadId: number;
  leadName: string;
  ruleId: number;
  adminApi: LeadApi;
  restrictedApi: LeadApi;
  ruleApi: ShareRuleApi;
}> {
  const adminApi = await LeadApi.forPage(adminPage);
  const restrictedApi = await LeadApi.forPage(restrictedPage);
  const ruleApi = await ShareRuleApi.forPage(adminPage);
  const leadName = `SHR${Date.now()}rule`;
  // WHY a phone only when asked: a call log is logged against one of the lead's phone numbers
  const phoneNumbers = options.withPhone
    ? [{ type: 'MOBILE', code: 'IN', value: `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`, dialCode: '+91', primary: true }]
    : undefined;
  const lead = await adminApi.createLead({ firstName: leadName, lastName: 'Rule', ...(phoneNumbers ? { phoneNumbers } : {}) });
  await cleanup.leads.track(adminPage, lead.id);
  const share = await ruleApi.createShare({
    entityType: 'LEAD',
    recordId: lead.id,
    recordName: leadName,
    fromUserId: await adminApi.getMyUserId(),
    toUserId: await restrictedApi.getMyUserId(),
    permissions: initial,
  });
  expect(share.status, 'Sharing the lead should succeed').toBe(200);
  const rules = await ruleApi.findRules('LEAD', lead.id);
  for (const rule of rules) await cleanup.rules.track(adminPage, 'LEAD', rule.id);
  expect(rules, 'One share rule for the lead').toHaveLength(1);
  return { leadId: lead.id, leadName, ruleId: rules[0].id, adminApi, restrictedApi, ruleApi };
}

// Admin: finds the lead's rule on the Share Data page by filter, opens it, and returns the page
async function openLeadRuleOnShareDataPage(adminPage: PageArg, leadName: string): Promise<ShareRulesPage> {
  const rulesPage = new ShareRulesPage(adminPage);
  await rulesPage.goToShareRulesList();
  await rulesPage.filterByRecord('LEAD', leadName);
  await rulesPage.assertSingleRuleListedFor('LEAD', leadName);
  await rulesPage.openListedRule();
  return rulesPage;
}

test.describe('Leads RBAC', () => {
  test('@smoke @regression @prodSafe restricted user can navigate to leads list', async ({
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

  test('@regression restricted user should not see an admin-owned lead in the list', async ({
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, []);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    // WHY the positive check first: the title says "only Clone", so Clone must really be offered —
    // and a visible Clone proves the menu has rendered before the absent options are checked
    await restrictedLeadsPage.assertEllipsisOptionVisible('Clone');
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['update']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    // WHY the generous polling window instead of a fixed sleep: the restricted user's session reads
    // right after an admin-side share, so it can lag the share response (bounded wait, not an immediate assertion)
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    // WHY: Update permission — edit button visible
    await expect(restrictedPage.locator('#edit-action-btn')).toBeVisible({
      timeout: config.timeouts.navigation,
    });
    // WHY: Restricted user edits the lead to verify update permission works
    await restrictedLeadsPage.clickEditIcon();
    const updatedData = generateLeadData();
    await restrictedLeadsPage.fillEditForm(updatedData);
    await restrictedLeadsPage.saveEditedLead();
    await restrictedLeadsPage.assertLeadUpdated(updatedData, leadId ?? undefined);
    // WHY: Navigate back to verify ellipsis shows only Clone
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    await restrictedLeadsPage.assertEllipsisOptionVisible('Clone');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Delete');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Share');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Reassign');
    await restrictedLeadsPage.assertEllipsisOptionNotVisible('Convert');
    logger.success('L11 passed');
  });

  // ── L13 ───────────────────────────────────────────────────

  test('@regression admin shares lead Task permission restricted user sees Tasks icon and can create task from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['task']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    // WHY: Use TasksPage to create quick task from lead detail panel
    const tasksPage = new TasksPage(restrictedPage);
    const taskData = generateTaskData();
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    const taskId = await tasksPage.saveQuickTaskFromEntityDetail();
    reportCreatedRecord('task', taskId);
    expect(taskId).not.toBeNull();
    logger.success(`Task created: ${taskId}`);
    // WHY: Click Tasks icon again to refresh task list and verify task appears
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    await restrictedPage.waitForTimeout(1000);
    const taskLocator = restrictedPage
      .locator('.task-details-wrapper')
      .getByText(taskData.name)
      .first();
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    // WHY: Share with Read only — no extra permissions
    await adminLeadsPage.shareLead(restrictedUserName, []);
    // WHY: Restricted user navigates to shared lead via ID
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    // WHY the positive anchor: "icon not visible" passes instantly when nothing has rendered yet, so
    // first prove the lead detail page is rendered (Clone is offered to a read-only share)
    await restrictedLeadsPage.assertEllipsisOptionVisible('Clone');
    // WHY: Read only — productivity icons should NOT be visible
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Notes');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Tasks');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Meetings');
    await restrictedLeadsPage.assertRightPanelIconNotVisible('Call Logs');
    logger.success('L14 passed');
  });

  // ── L16 ───────────────────────────────────────────────────

  test('@regression admin shares lead with Note permission and restricted user can add note from lead detail', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['note']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    // WHY: fixed 2026-07-19 — cross-role share-propagation lag: a hardcoded 20000ms + flat
    // pre-sleep had no room to recover if this restricted-user session's route guard hadn't yet seen
    // the propagated share. Generous polling window, same as assertRightPanelIconVisible()'s fix.
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    // WHY: Note permission — Notes icon should be visible in right panel
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    // The title promises the restricted user "can add note": add one, then prove it is stored by
    // reading it back after a reload (addNote() itself counts the notes before and after)
    const noteText = `Persisted note ${Date.now()}`;
    await restrictedLeadsPage.addNote(noteText);
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    await restrictedLeadsPage.assertNoteTextPresent(noteText);
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['task']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, config.timeouts.navigation);
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    // The title promises the restricted user "can create task": create one, then prove it is stored
    // by finding it in the lead's Tasks panel after a reload (L13 checks the panel straight after saving)
    const tasksPage = new TasksPage(restrictedPage);
    const taskData = generateTaskData();
    await tasksPage.openQuickTaskForm();
    await tasksPage.fillQuickTaskForm(taskData);
    const taskId = await tasksPage.saveQuickTaskFromEntityDetail();
    expect(taskId, 'Task ID should be captured after create').not.toBeNull();
    // WHY the server read-back, not the panel: after a reload the panel can already be open, and the
    // icon click then CLOSES it (a failed run showed no tasks request after the click) — so the panel
    // says nothing about whether the task was stored. The restricted user's own read of the lead's
    // tasks does.
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      await expect
        .poll(async () => (await restrictedApi.getTaskNamesOfLead(leadId!, await restrictedApi.getLeadOwnerId(leadId!))), {
          timeout: 60000,
          intervals: [1000, 2000, 3000],
          message: 'The created task should be listed on the lead',
        })
        .toContain(taskData.name);
    } finally {
      await restrictedApi.dispose();
    }
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['meeting']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Meetings');
    await restrictedLeadsPage.clickRightPanelIcon('Meetings');
    // WHY: Use MeetingsPage to create meeting from lead detail panel
    const meetingsPage = new MeetingsPage(restrictedPage);
    const meetingTitle = `Meeting-${Date.now()}`;
    await meetingsPage.openAddForm();
    await meetingsPage.fillTitleOnly(meetingTitle);
    // WHY: retries specifically on the confirmed lead-summary permission-
    // propagation race (backend 422/01503001) — see MeetingsPage's own
    // comment for the live evidence this is based on.
    const meetingId = await meetingsPage.saveMeetingRetryOnEntitySummaryLag();
    reportCreatedRecord('meeting', meetingId);
    // WHY the meeting is verified independently of the ID capture (2026-10-30): the capture sometimes
    // returned null on CI and the test then passed without proving the meeting exists. The cause of
    // the null was NOT reproduced (see MeetingsPage.captureIdFromResponse), so the proof no longer
    // depends on it: the meeting must exist when searched by its title.
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      await expect
        .poll(() => restrictedApi.countMeetingsByTitle(meetingTitle), {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'The meeting should exist once saved',
        })
        .toBe(1);
    } finally {
      await restrictedApi.dispose();
    }
    logger.success(`Meeting created${meetingId ? ` with ID: ${meetingId}` : ''} — ${meetingTitle}`);
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['call']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Call Logs');
    await restrictedLeadsPage.clickRightPanelIcon('Call Logs');
    // WHY: Reload page to ensure Log a call button is fully loaded
    await restrictedPage.reload({ waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForTimeout(2000);
    await restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' }).click();
    await restrictedPage.waitForTimeout(1000);
    // WHY: Remove aria-hidden so Playwright can interact with modal
    await restrictedPage.evaluate(
      'document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")'
    );
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
    reportCreatedRecord('call log', callLogId);
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    // WHY: Share with all 4 permissions at once
    await adminLeadsPage.shareLead(restrictedUserName, ['note', 'task', 'meeting', 'call']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.assertRightPanelIconVisible('Tasks');
    await restrictedLeadsPage.assertRightPanelIconVisible('Meetings');
    await restrictedLeadsPage.assertRightPanelIconVisible('Call Logs');

    // WHY: Verify Note — addNote() counts the notes inside the Notes card before and after
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    await restrictedLeadsPage.addNote(`Note-${Date.now()}`);
    logger.success('Note created and verified');

    // WHY: Verify Task — click Tasks icon, create quick task
    await restrictedLeadsPage.clickRightPanelIcon('Tasks');
    const tasksPage2 = new TasksPage(restrictedPage);
    const taskData2 = generateTaskData();
    await tasksPage2.openQuickTaskForm();
    await tasksPage2.fillQuickTaskForm(taskData2);
    const taskId2 = await tasksPage2.saveQuickTaskFromEntityDetail();
    reportCreatedRecord('task', taskId2);
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
    // WHY: same lead-summary permission-propagation race as the Meeting
    // permission test above — see MeetingsPage.saveMeetingRetryOnEntitySummaryLag()'s
    // own comment for the live evidence.
    const meetingId2 = await meetingsPage2.saveMeetingRetryOnEntitySummaryLag();
    reportCreatedRecord('meeting', meetingId2);
    // WHY verified by title, not by the captured ID: see the note in the Meeting-permission test above
    const restrictedApi2 = await LeadApi.forPage(restrictedPage);
    try {
      await expect
        .poll(() => restrictedApi2.countMeetingsByTitle(meetingTitle2), {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'The meeting should exist once saved',
        })
        .toBe(1);
    } finally {
      await restrictedApi2.dispose();
    }
    logger.success(`Meeting created${meetingId2 ? `: ${meetingId2}` : ''}`);
    // WHY: Navigate back to lead detail page after meeting creation
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);

    // WHY: Verify Call — click Call Logs icon first, then Log a call button
    await restrictedLeadsPage.clickRightPanelIcon('Call Logs');
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.locator('button.btn.btn-primary', { hasText: 'Log a call' }).click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage.evaluate(
      'document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")'
    );
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
      await callLogsPage2.fillDurationDirect(
        callLogData2.duration.value,
        callLogData2.duration.type
      );
    }
    const callLogId2 = await callLogsPage2.saveCallLog();
    reportCreatedRecord('call log', callLogId2);
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
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.reassignLead(restrictedUserName);
    // WHY: Restricted user now owns the lead — can edit and delete
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    // WHY: Verify edit button visible — restricted user is now owner
    await expect(restrictedPage.locator('#edit-action-btn')).toBeVisible({ timeout: 10000 });
    // WHY: Verify restricted user can edit the lead
    await restrictedLeadsPage.clickEditIcon();
    const updatedData = generateLeadData();
    await restrictedLeadsPage.fillEditForm(updatedData);
    await restrictedLeadsPage.saveEditedLead();
    await restrictedLeadsPage.assertLeadUpdated(updatedData, leadId ?? undefined);
    logger.success('Restricted user edited reassigned lead successfully');
    // WHY: Navigate back to lead detail to verify delete option
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(2000);
    // WHY: Delete lead — deleteLead() opens ellipsis and clicks Delete internally
    await restrictedLeadsPage.deleteLead();
    // WHY: Verify deletion by navigating to detail URL — deleted lead redirects away
    await restrictedLeadsPage.assertLeadDeletedById(leadId!);
    // …and by the API, which does not depend on text matching on the page
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      expect((await restrictedApi.getLead(leadId!)).status, 'Deleted lead should be gone').toBe(404);
    } finally {
      await restrictedApi.dispose();
    }
    logger.success('Restricted user deleted reassigned lead successfully');
    logger.success('L21 passed');
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
    const clonedId = await leadsPage.cloneLead();
    expect(clonedId).not.toBeNull();
    await leadsPage.assertClonedLeadLastName(leadData.lastName, clonedId!);
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
    // WHY the API as well: a list search can miss a lead that still exists (index lag), the API cannot
    const api = await LeadApi.forPage(restrictedPage);
    try {
      expect((await api.getLead(leadId!)).status, 'Deleted lead should be gone').toBe(404);
    } finally {
      await api.dispose();
    }
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
    await assertStagePersisted(restrictedPage, leadId!, 'Won');
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
    await assertStagePersisted(restrictedPage, leadId!, 'Closed Lost');
    // WHY: Click Read More to verify reason is shown
    const readMoreLink = restrictedPage
      .locator('span.pipeline-info-link a')
      .filter({ hasText: 'Read More' })
      .first();
    await readMoreLink.waitFor({ state: 'visible', timeout: 10000 });
    await readMoreLink.click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Verify reason section shows the selected reason
    const reasonSection = restrictedPage
      .locator('.read-only-info')
      .filter({ hasText: 'Reason' })
      .first();
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
    await assertStagePersisted(restrictedPage, leadId!, 'Closed Unqualified');
    // WHY: Click Read More to verify reason is shown
    const readMoreLink = restrictedPage
      .locator('span.pipeline-info-link a')
      .filter({ hasText: 'Read More' })
      .first();
    await readMoreLink.waitFor({ state: 'visible', timeout: 10000 });
    await readMoreLink.click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Verify reason section shows the selected reason
    const reasonSection = restrictedPage
      .locator('.read-only-info')
      .filter({ hasText: 'Reason' })
      .first();
    await expect(reasonSection).toBeVisible({ timeout: 5000 });
    const reasonText = await reasonSection.textContent();
    expect(reasonText).toContain(selectedReason);
    logger.success(`Closed Unqualified reason verified: ${selectedReason}`);
    logger.success('L29 passed');
  });

  // ── L28 ───────────────────────────────────────────────────

  test('@regression restricted user with Note permission can add and delete a note on shared lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    const leadData = generateSharedLeadData();
    await adminLeadsPage.goToLeadsList();
    const leadId = await adminLeadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminLeadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await adminLeadsPage.getLoggedInUserName('restricted');
    await adminLeadsPage.shareLead(restrictedUserName, ['note']);
    await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${leadId}`);
    await safeWaitForURL(restrictedPage, /leads\/details\//, 20000);
    await restrictedPage.waitForTimeout(3000);
    // WHY (2026-09-07, PROD Build #4): this used to be a raw, unbounded
    // click with no timeout/retry/reload-fallback — under real PROD load
    // this exact right-panel-icon-visibility-can-lag-after-share race
    // (docs/PATTERNS.md P23) has no bound of its own and can consume
    // the whole 480s test timeout, surfacing later as a confusing "browser
    // has been closed" error on an unrelated downstream step. Reuse the
    // existing bounded reload-and-retry helper instead of a raw locator
    // click, matching every other module with this concept.
    await restrictedLeadsPage.assertRightPanelIconVisible('Notes');
    await restrictedLeadsPage.clickRightPanelIcon('Notes');
    // WHY: Confirmed live on Deals' identical Notes component — the generic
    // `div.row.pt-2.pl-2.pr-2` class combo also matches unrelated elements
    // elsewhere on the detail page (0 of 3 page-wide matches were actually
    // inside the Notes card on an empty-notes entity). Scope to the Notes card
    // specifically and target the stable `.note.card` per-note wrapper instead
    // — this is the same shared Notes UI component Deals already fixed, not a
    // Leads-specific pattern.
    const notesCard = restrictedPage
      .locator('.card')
      .filter({ has: restrictedPage.locator('h2').filter({ hasText: 'Notes' }) })
      .first();
    const noteRow = notesCard.locator('.note.card');
    // WHY: Adding/deleting a note (and the initial fetch after opening the panel)
    // briefly renders react-loading-skeleton placeholder rows sharing the same
    // .note.card wrapper as real notes, before settling. Capturing counts
    // without waiting for these to clear catches a transient mid-fetch state
    // instead of the true count — never assert an absolute count, but also
    // never read mid-skeleton.
    const waitForSkeletonsToClear = () =>
      expect(notesCard.locator('.react-loading-skeleton')).toHaveCount(0, { timeout: 15000 });
    await waitForSkeletonsToClear();
    // WHY: Capture baseline before adding notes — entity may have pre-existing notes from prior runs
    const baselineCount = await noteRow.count();
    // WHY: Add first note — this note will be kept
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage
      .getByRole('textbox', { name: 'Rich Text Editor, main' })
      .fill('Note to keep');
    await restrictedPage.waitForTimeout(500);
    await restrictedPage.getByText('Add', { exact: true }).click();
    await waitForSkeletonsToClear();
    await expect(noteRow, 'Note count should be baseline + 1 after first add').toHaveCount(
      baselineCount + 1,
      { timeout: 10000 }
    );
    // WHY: Add second note — this note will be deleted
    await restrictedPage.locator('textarea.notes-textarea').click();
    await restrictedPage.waitForTimeout(1000);
    await restrictedPage
      .getByRole('textbox', { name: 'Rich Text Editor, main' })
      .fill('Note to delete');
    await restrictedPage.waitForTimeout(500);
    await restrictedPage.getByText('Add', { exact: true }).click();
    await waitForSkeletonsToClear();
    // WHY: Verify both new notes were added on top of baseline — auto-retrying
    // toHaveCount (not a single .count() snapshot) gives a safety margin beyond
    // the skeleton wait, matching Deals' more robust assertion style
    await expect(noteRow, 'Note count should be baseline + 2 after second add').toHaveCount(
      baselineCount + 2,
      { timeout: 10000 }
    );
    // WHY: Delete the first note (newest first display) — "Note to delete" was added last so appears first
    const lastNoteEllipsis = noteRow.first().locator('button[data-toggle="dropdown"]');
    await lastNoteEllipsis.click();
    await restrictedPage.waitForTimeout(300);
    await restrictedPage
      .locator('.dropdown-menu.show .dropdown-item')
      .filter({ hasText: 'Delete' })
      .click();
    await restrictedPage.waitForTimeout(500);
    // WHY: Confirm delete in modal
    await restrictedPage
      .locator('button#confirm.btn-danger')
      .waitFor({ state: 'visible', timeout: 5000 });
    await restrictedPage.locator('button#confirm.btn-danger').click();
    await waitForSkeletonsToClear();
    // WHY: Verify count dropped by 1 relative to baseline
    await expect(noteRow, 'Note count should be baseline + 1 after deleting one note').toHaveCount(
      baselineCount + 1,
      { timeout: 10000 }
    );
    // WHY: Note text lives in CKEditor iframes — skip the active editor iframe (title="Rich Text Editor, main")
    // and use innerText (excludes hidden/removed nodes) to check only saved-note display iframes
    const checkNoteText = async (text: string): Promise<boolean> =>
      restrictedPage.evaluate((t) => {
        for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
          if (iframe.title && iframe.title.includes('Rich Text Editor')) continue;
          try {
            if (iframe.contentDocument?.body?.innerText?.includes(t)) return true;
          } catch {}
        }
        return false;
      }, text);
    expect(await checkNoteText('Note to delete')).toBe(false);
    expect(await checkNoteText('Note to keep')).toBe(true);
    logger.success('L28 passed');
  });

  // WHY: generateLeadData() (NOT generateAdminLeadData()) — this is a
  // restricted user creating and owning their own lead, not a cross-role
  // isolation scenario, so the ADM-prefix uniqueness guarantee doesn't apply
  // here. Matches the existing "restricted user can create a lead" test's
  // own choice above (line 25) for the same reason.
  test('@regression restricted user can create a lead with all custom fields and Campaign Information, verified on details', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.skipIfCustomFieldsAbsent();
    await leadsPage.fillLeadForm(leadData);
    const leadId = await leadsPage.saveLead();
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    // WHY: reuses LeadsPage.assertLeadCustomFieldsOnDetail() unchanged — the
    // same BasePage-generic method admin's tests use — to confirm the
    // custom-field design is genuinely role-agnostic, not admin-specific.
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.assertLeadCustomFieldsOnDetail(leadData);
    await leadsPage.assertLeadStandardFieldsOnDetail(leadData);
    logger.success('L29 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Lookup Custom Fields — RBAC ("Company Lookup" / "Contact Lookup")
  // ──────────────────────────────────────────────────────────
  // WHY: these two lookup fields are live, SERVER-SIDE, RBAC-scoped searches
  // (confirmed live 2026-07-21). L30 proves a restricted user cannot see an
  // admin-owned, non-shared entity in them; L31 proves the restricted user CAN
  // find and select entities they own.

  // ── L30 ───────────────────────────────────────────────────

  test('@regression restricted user cannot see admin-owned company or contact in Lead lookup custom fields', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    // Admin creates an admin-owned (ADM-prefixed, deliberately NOT shared)
    // Company + Contact — the ADM<timestamp> prefix guarantees a unique name
    // the restricted user can never coincidentally match.
    const adminCompany = generateAdminCompanyData();
    const adminContact = generateAdminContactData();
    const adminCompaniesPage = new CompaniesPage(adminPage);
    const adminContactsPage = new ContactsPage(adminPage);
    await adminCompaniesPage.goToCompaniesList();
    const companyId = await adminCompaniesPage.createCompany(adminCompany);
    reportCreatedRecord('company', companyId);
    expect(companyId, 'Admin company should be created').not.toBeNull();
    await adminContactsPage.goToContactsList();
    const contactId = await adminContactsPage.createContact(adminContact);
    reportCreatedRecord('contact', contactId);
    expect(contactId, 'Admin contact should be created').not.toBeNull();

    // Search token = the unique ADM<timestamp> first word of each name — it
    // WOULD return the entity if the restricted user were allowed to see it.
    const companyToken = adminCompany.name.trim().split(/\s+/)[0];
    const contactName = `${adminContact.firstName} ${adminContact.lastName}`;
    const contactToken = adminContact.firstName.trim().split(/\s+/)[0];

    // Restricted user opens a Lead create form and reveals "Other Details".
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await restrictedLeadsPage.goToLeadsList();
    await restrictedLeadsPage.clickAddLead();
    // Env-gate: skip the whole test only if NO Lead custom fields exist here.
    await restrictedLeadsPage.skipIfCustomFieldsAbsent();
    await restrictedLeadsPage.openOtherDetailsFormSection();

    // Neither admin-owned entity may be selectable in the restricted user's
    // lookups (server-side RBAC scoping) — assert the specific named option is
    // absent (not that the menu is empty; the "Add to …" create option is
    // always present).
    await restrictedLeadsPage.assertLeadLookupSelectableAbsent(
      LEAD_CUSTOM_FIELD_NAMES.companyLookup,
      companyToken,
      adminCompany.name
    );
    await restrictedLeadsPage.assertLeadLookupSelectableAbsent(
      LEAD_CUSTOM_FIELD_NAMES.contactLookup,
      contactToken,
      contactName
    );
    logger.success('L30 passed');
  });

  // ── L31 ───────────────────────────────────────────────────

  test('@regression restricted user creates own company and contact and can select them in Lead lookup custom fields', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const contactsPage = new ContactsPage(restrictedPage);
    const companiesPage = new CompaniesPage(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);

    // Restricted user creates its OWN Company + Contact (plain generators →
    // restricted-owned entities the user can genuinely access).
    const contactData = generateContactData();
    const companyData = generateCompanyData();
    await contactsPage.goToContactsList();
    const contactId = await contactsPage.createContact(contactData);
    reportCreatedRecord('contact', contactId);
    expect(contactId, 'Contact should be created').not.toBeNull();
    await companiesPage.goToCompaniesList();
    const companyId = await companiesPage.createCompany(companyData);
    reportCreatedRecord('company', companyId);
    expect(companyId, 'Company should be created').not.toBeNull();
    const contactName = `${contactData.firstName} ${contactData.lastName}`;
    const companyName = companyData.name;

    // Restricted user creates a Lead selecting its own entities in the lookups.
    const leadData = generateLeadData();
    leadData.customFields.companyLookupTarget = companyName;
    leadData.customFields.contactLookupTarget = contactName;
    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    const lookups = await leadsPage.fillLeadLookupCustomFields(leadData.customFields);
    const leadId = await leadsPage.saveLead();
    expect(leadId, 'Lead ID should be captured after create').not.toBeNull();

    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    if (lookups.companyLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.companyLookup,
        companyName,
        'Company Lookup'
      );
    } else {
      logger.info(
        'Company Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }
    if (lookups.contactLookup !== null) {
      await leadsPage.assertLeadLookupOnDetail(
        LEAD_CUSTOM_FIELD_NAMES.contactLookup,
        contactName,
        'Contact Lookup'
      );
    } else {
      logger.info(
        'Contact Lookup field absent on this environment — skipping its detail-page assertion'
      );
    }
    logger.success('L31 passed');
  });

  // ── Hide Empty Fields — L32-L35 (RBAC parity: same behavior for the
  // restricted user's own lead — this feature has no permission-boundary
  // component, confirmed during investigation; these mirror
  // tests/ui/leads/leads.spec.ts's L48-L51 exactly, just as the restricted
  // role) ─────────────────────────────────────────────────────

  test('@regression restricted user should hide empty fields/tabs on a lead with a minimal, genuinely-empty Social tab', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();

    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');
    await leadsPage.assertTabVisible('Professional');
    await leadsPage.assertTabVisible('Requirement');
    await leadsPage.assertTabVisible('Other Details');

    logger.success('L32 passed');
  });

  test('@regression restricted user should restore all hidden fields/tabs after toggling Hide Empty Fields off', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabVisible('Social');

    logger.success('L33 passed');
  });

  test('@regression restricted user should hide only empty fields within a mixed section, keeping the section itself visible', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabVisible('Professional');

    const professionalTab = restrictedPage
      .locator('a.nav-item.nav-link, a.nav-link')
      .filter({ hasText: 'Professional' });
    await professionalTab.click();
    await leadsPage.assertFieldLabelHidden('Company Name');
    await leadsPage.assertFieldLabelHidden('Department');
    await leadsPage.assertFieldLabelHidden('Designation');
    await leadsPage.assertFieldLabelVisible('Company Industry');
    await leadsPage.assertFieldLabelVisible('Business Type');
    await leadsPage.assertFieldLabelVisible('Company Employees');

    logger.success('L34 passed');
  });

  test('@regression restricted user should auto-reveal a hidden field/tab immediately after editing it, without re-toggling', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateMinimalLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadDetailsById(leadId!);

    await leadsPage.toggleHideEmptyFields();
    await leadsPage.assertTabHiddenWhenFullyEmpty('Social');

    const newFacebook = `https://facebook.com/revealed.${Date.now()}`;
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm({ ...leadData, facebook: newFacebook });
    await leadsPage.saveEditedLead();

    await leadsPage.assertTabVisible('Social');
    await leadsPage.assertDetailTabContent('nav-tab2-tab', [newFacebook]);

    logger.success('L35 passed');
  });
  // ── L53 ───────────────────────────────────────────────────

  // WHAT: the back-end service the tests use creates, reads, changes and deletes a lead owned by the
  //   restricted user, with the rights the server says that owner has.
  // WHY: restricted-user tests depend on this setup; a lead made with the wrong owner or rights would
  //   make every permission test meaningless.
  // HOW: each step is read back from the server (owner, rights, changed name, 404 after delete).
  test('@regression restricted user can create, read, change and delete their own lead through the set-up service the tests rely on', async ({
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(restrictedPage);
    try {
      const leadData = generateLeadData();
      const created = await api.createLead({
        firstName: leadData.firstName,
        lastName: leadData.lastName,
      });
      await leadCleanup.track(restrictedPage, created.id);

      const read = await api.getLeadOrThrow(created.id);
      expect(read.ownerId, 'Lead created by the restricted user should be owned by them').toBe(
        await api.getMyUserId()
      );
      // WHY recordActions: it is the server's own statement of what this user may do with the lead
      expect(read.recordActions).toMatchObject({ read: true, update: true, delete: true });

      const updated = await api.updateLead(created.id, { lastName: 'ApiUpdated' });
      expect(updated.status, 'PUT /v1/leads/{id} on an own lead should succeed').toBe(200);
      expect((await api.getLeadOrThrow(created.id)).lastName).toBe('ApiUpdated');

      expect((await api.deleteLead(created.id)).status).toBe(200);
      expect((await api.getLead(created.id)).status).toBe(404);
    } finally {
      await api.dispose();
    }
    logger.success('L53 passed');
  });
  // ──────────────────────────────────────────────────────────
  // Direct access, menus, smart lists and bulk bar
  // ──────────────────────────────────────────────────────────

  // ── L69 ───────────────────────────────────────────────────

  // WHAT: a restricted user cannot open, edit or delete a lead owned by admin that was not shared
  //   with them, and the admin's lead stays exactly as it was.
  // WHY: this is the core data-protection promise — one salesperson must not be able to see or
  //   destroy another's leads, even by typing the lead's address or calling the service directly.
  // HOW: UI — the lead's page shows nothing of the lead; server — read, change and delete are all
  //   answered "not found / no permission"; persisted — the admin still reads the lead unchanged.
  test('@regression restricted user cannot open, edit or delete a lead owned by admin that was not shared with them', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await adminLeadsPage.goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const adminApi = await LeadApi.forPage(adminPage);
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      const leadData = generateAdminLeadData();
      const created = await adminApi.createLead({
        firstName: leadData.firstName,
        lastName: leadData.lastName,
      });
      await leadCleanup.track(adminPage, created.id);

      // UI: opening the detail URL shows nothing of the lead
      const detailResponsePromise = restrictedPage.waitForResponse(
        (res) => res.url().endsWith(`/v1/leads/${created.id}`) && res.request().method() === 'GET',
        { timeout: config.timeouts.navigation }
      );
      await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${created.id}`);
      expect((await detailResponsePromise).status()).toBe(404);
      await expect(restrictedPage.getByText(leadData.firstName)).toHaveCount(0);

      // API: read, update and delete are all denied with the same "not found / no permission" answer
      const read = await restrictedApi.getLead(created.id);
      expect(read.status).toBe(404);
      expect(read.body.code).toBe('000010');
      const update = await restrictedApi.putLeadRaw(created.id, { firstName: 'Denied', lastName: 'Denied' });
      expect(update.status).toBe(404);
      expect(update.body.code).toBe('000010');
      const deletion = await restrictedApi.deleteLead(created.id);
      expect(deletion.status).toBe(404);
      expect(deletion.body.code).toBe('000010');

      // The admin's lead is unchanged and still there
      const after = await adminApi.getLeadOrThrow(created.id);
      expect(after.firstName).toBe(leadData.firstName);
      expect(after.lastName).toBe(leadData.lastName);
      expect(after.ownerId).toBe(await adminApi.getMyUserId());
    } finally {
      await adminApi.dispose();
      await restrictedApi.dispose();
    }
    logger.success('L69 passed');
  });

  // ── L70 ───────────────────────────────────────────────────

  // WHAT: a restricted user can share, convert, clone and delete their own lead but is not offered
  //   Reassign, while the admin is offered Reassign on theirs.
  // WHY: handing a lead to another owner is an admin-only power; offering it to everyone would let
  //   salespeople move leads (and commissions) around.
  // HOW: server — the lead's own rights say reassign is false for the restricted owner and true for
  //   the admin; UI — the exact menu on the lead's page and in the list row, with the admin's menu
  //   as the contrast.
  test('@regression restricted user can share, convert, clone and delete their own lead but cannot reassign it', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await adminLeadsPage.goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const adminApi = await LeadApi.forPage(adminPage);
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      const adminSeed = generateAdminLeadData();
      const adminLead = await adminApi.createLead({ firstName: adminSeed.firstName, lastName: adminSeed.lastName });
      await leadCleanup.track(adminPage, adminLead.id);
      // WHY a unique name: the search below looks for exactly this first name, and faker first names
      // are shared by many existing leads
      const ownSeed = { firstName: `RES${Date.now()}own`, lastName: 'Own' };
      const ownLead = await restrictedApi.createLead({ firstName: ownSeed.firstName, lastName: ownSeed.lastName });
      await leadCleanup.track(restrictedPage, ownLead.id);

      // The server's own statement of what each owner may do with their lead
      expect((await adminApi.getLeadOrThrow(adminLead.id)).recordActions?.reassign).toBe(true);
      expect((await restrictedApi.getLeadOrThrow(ownLead.id)).recordActions?.reassign).toBe(false);

      // Detail page menus (the admin's menu proves the check can tell the difference)
      await adminLeadsPage.goToLeadDetailsById(adminLead.id);
      await adminLeadsPage.assertEllipsisOptions([
        'Reassign',
        'Share',
        'Convert',
        'Clone',
        'Delete',
        'Trigger Sequence',
      ]);
      await restrictedLeadsPage.goToLeadDetailsById(ownLead.id);
      await restrictedLeadsPage.assertEllipsisOptions(['Share', 'Convert', 'Clone', 'Delete', 'Trigger Sequence']);

      // List row menu of the restricted user's own lead
      await expect
        .poll(
          async () =>
            (await restrictedApi.searchLeads(LeadApi.rule('firstName', 'equal', ownSeed.firstName))).totalElements,
          { timeout: 60000, intervals: [2000, 3000, 5000], message: 'Lead should become searchable' }
        )
        .toBe(1);
      await restrictedLeadsPage.goToLeadsList();
      expect(await restrictedLeadsPage.getRowMenuOptions(ownLead.id)).toEqual([
        'Open in new tab',
        'Edit',
        'Convert',
        'Clone',
        'Send WA Message',
        'Delete',
      ]);
    } finally {
      await adminApi.dispose();
      await restrictedApi.dispose();
    }
    logger.success('L70 passed');
  });

  // ── L71 ───────────────────────────────────────────────────

  // WHAT: a restricted user sees the standard lead lists, and "All my leads" contains only leads they
  //   own — including a brand-new one — while the admin's "All my leads" never holds theirs.
  // WHY: "my leads" is the list people work from every day; if it leaked someone else's leads it
  //   would be both a privacy problem and a wrong to-do list.
  // HOW: UI — the Manage Smart Lists dialog shows every list the server returns; server — every lead
  //   returned by each user's own "All my leads" list has that user as owner.
  test('@regression restricted user sees the standard lists and All my leads contains only their own leads', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await adminLeadsPage.goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const adminApi = await LeadApi.forPage(adminPage);
    const restrictedApi = await LeadApi.forPage(restrictedPage);
    try {
      const ownSeed = generateLeadData();
      const ownLead = await restrictedApi.createLead({ firstName: ownSeed.firstName, lastName: ownSeed.lastName });
      await leadCleanup.track(restrictedPage, ownLead.id);
      const restrictedId = await restrictedApi.getMyUserId();
      const adminId = await adminApi.getMyUserId();

      // The Manage Smart Lists dialog shows every list the API returns for this user
      const smartLists = await restrictedApi.getSmartLists();
      expect(smartLists.length, 'Smart lists returned').toBeGreaterThan(0);
      await restrictedLeadsPage.openSmartListManager();
      const managerText = (await restrictedLeadsPage.getSmartListManagerText()).toLowerCase();
      for (const list of smartLists) {
        expect(managerText, `Smart list "${list.name}" in the manager`).toContain(list.name.toLowerCase());
      }
      await restrictedLeadsPage.closeSmartListManager();

      // "All my leads" holds only the restricted user's own leads, including the one just created
      const myLeads = smartLists.find((list) => list.name === 'All my leads');
      expect(myLeads, 'System smart list "All my leads"').toBeDefined();
      await expect
        .poll(
          async () => {
            const result = await restrictedApi.searchLeads(myLeads!.searchRequest.jsonRule, { size: 100 });
            return result.content.some((lead) => lead.id === ownLead.id);
          },
          { timeout: 60000, intervals: [2000, 3000, 5000], message: 'New lead should appear in All my leads' }
        )
        .toBe(true);
      const mine = await restrictedApi.searchLeads(myLeads!.searchRequest.jsonRule, { size: 100 });
      expect(mine.content.every((lead) => lead.ownerId === restrictedId)).toBe(true);

      // …and the admin's own "All my leads" never contains the restricted user's leads
      const adminLists = await adminApi.getSmartLists();
      const adminMine = adminLists.find((list) => list.name === 'All my leads');
      const adminResult = await adminApi.searchLeads(adminMine!.searchRequest.jsonRule, { size: 100 });
      expect(adminResult.content.length).toBeGreaterThan(0);
      expect(adminResult.content.every((lead) => lead.ownerId === adminId)).toBe(true);
    } finally {
      await adminApi.dispose();
      await restrictedApi.dispose();
    }
    logger.success('L71 passed');
  });

  // ── L72 ───────────────────────────────────────────────────

  // WHAT: a restricted user sees the bulk actions (Email, Update, Whatsapp, Export, Delete) when
  //   their own lead is selected, and they disappear when it is cleared.
  // WHY: bulk actions change leads in one go; they must only be offered with a selection. (A lead
  //   merely shared read-only offers fewer actions, so the test uses a lead the user owns.)
  // HOW: a new own lead is created and the list is filtered to exactly it; UI — select it, check the
  //   five actions, clear it, check they are gone. No action is clicked.
  test('@regression restricted user sees the bulk actions when their own lead is selected and they disappear when it is cleared', async ({
    restrictedPage,
    leadCleanup,
  }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const api = await LeadApi.forPage(restrictedPage);
    try {
      const name = `RES${Date.now()}bar`;
      const created = await api.createLead({ firstName: name, lastName: 'Bar' });
      await leadCleanup.track(restrictedPage, created.id);
      // The list filter reads the search index, which trails a new lead briefly
      await expect
        .poll(async () => (await api.searchLeads(LeadApi.rule('firstName', 'equal', name))).totalElements, {
          timeout: 60000,
          intervals: [2000, 3000, 5000],
          message: 'Lead should become searchable',
        })
        .toBe(1);

      await leadsPage.goToLeadsList();
      await leadsPage.filterListBy('First Name', name);
      await leadsPage.waitForListData();
      expect(await leadsPage.getListTotalRecords()).toBe(1);

      await leadsPage.selectLeadRow(created.id);
      await leadsPage.assertSelectedLeadCount(1);
      await leadsPage.assertBulkActionsVisible(['Email', 'Update', 'Whatsapp', 'Export', 'Delete']);
      await leadsPage.deselectLeadRow(created.id);
      await leadsPage.assertBulkBarHidden();
    } finally {
      await api.dispose();
    }
    logger.success('L72 passed');
  });
  // ──────────────────────────────────────────────────────────
  // Share rules: editing or deleting a share changes what the restricted user can do
  // ──────────────────────────────────────────────────────────

  // ── L73 ───────────────────────────────────────────────────

  // WHAT: when an admin removes one right from a lead's share (here: Update), the restricted user
  //   loses exactly that right and keeps the others (Note and Task); nothing else is granted.
  // WHY: a share rule is how access is taken back; if removing a right left it working, or removed
  //   more than asked, people would keep access they should not have or lose access they need.
  // HOW: admin — finds the share on Setup → Share Data by filtering on the lead, turns Update off and
  //   saves. Then, with the restricted user's SAME session (no new login): server — the lead's rights
  //   change (polled; the time is reported), a change is refused (400/000005), a note can still be
  //   added, delete is refused (400/002084); UI after a fresh page load — the edit button is gone
  //   while the Notes and Tasks icons stay and Meetings and Call Logs are absent.
  test('@regression admin can remove a right from a lead share and the restricted user loses only that right', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await new LeadsPage(adminPage).goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const shared = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['update', 'note', 'task'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      // before: the rule grants Update, Note and Task
      await waitForRestrictedRights(shared.restrictedApi, shared.leadId, permissionSet(['update', 'note', 'task']));

      const rulesPage = await openLeadRuleOnShareDataPage(adminPage, shared.leadName);
      expect(await rulesPage.getPermissionStates()).toMatchObject({ update: true, note: true, task: true, meeting: false });
      await rulesPage.setPermission('update', false);
      await rulesPage.saveRule();

      const expected = permissionSet(['note', 'task']);
      const appliedInMs = await waitForRestrictedRights(shared.restrictedApi, shared.leadId, expected);
      test.info().annotations.push({ type: 'share rule change applied after (ms)', description: String(appliedInMs) });
      await assertRestrictedUiAccess(restrictedLeadsPage, restrictedPage, shared.leadId, expected);
      await assertRestrictedApiAccess(shared.restrictedApi, shared.leadId, expected);
    } finally {
      await shared.adminApi.dispose();
      await shared.restrictedApi.dispose();
      await shared.ruleApi.dispose();
    }
    logger.success('L73 passed');
  });

  // ── L74 ───────────────────────────────────────────────────

  // WHAT: when an admin adds one right to a lead's share (here: Task), the restricted user gains
  //   exactly that right, keeps Note, and gains nothing else.
  // WHY: widening a share must work without a new login and must not over-grant.
  // HOW: same as the removal test — the rule is found by filter on Share Data and saved with Task on;
  //   then, with the restricted user's SAME session: server — rights change (polled and timed), the
  //   note still works, a change and a delete are still refused (400/000005, 400/002084); UI after a
  //   fresh page load — the Tasks icon appears, Notes stays, edit button, Meetings and Call Logs are
  //   absent.
  test('@regression admin can add a right to a lead share and the restricted user gains only that right', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await new LeadsPage(adminPage).goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const shared = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['note'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      await waitForRestrictedRights(shared.restrictedApi, shared.leadId, permissionSet(['note']));

      const rulesPage = await openLeadRuleOnShareDataPage(adminPage, shared.leadName);
      expect(await rulesPage.getPermissionStates()).toMatchObject({ note: true, task: false });
      await rulesPage.setPermission('task', true);
      await rulesPage.saveRule();

      const expected = permissionSet(['note', 'task']);
      const appliedInMs = await waitForRestrictedRights(shared.restrictedApi, shared.leadId, expected);
      test.info().annotations.push({ type: 'share rule change applied after (ms)', description: String(appliedInMs) });
      await assertRestrictedUiAccess(restrictedLeadsPage, restrictedPage, shared.leadId, expected);
      await assertRestrictedApiAccess(shared.restrictedApi, shared.leadId, expected);
    } finally {
      await shared.adminApi.dispose();
      await shared.restrictedApi.dispose();
      await shared.ruleApi.dispose();
    }
    logger.success('L74 passed');
  });

  // ── L75 ───────────────────────────────────────────────────

  // WHAT: when an admin removes one right and adds another in the same edit (Update off, Meeting on),
  //   the restricted user gets exactly the new set: Update gone, Meeting gained, Note kept.
  // WHY: real edits mix both; the removed, the added and the untouched rights must each behave.
  // HOW: the rule is found by filter on Share Data and saved; then, with the restricted user's SAME
  //   session: server — rights change (polled and timed), a change is refused, the note still works,
  //   delete is refused; UI after a fresh page load — edit button gone, Meetings icon shown, Notes
  //   kept, Tasks and Call Logs absent.
  test('@regression admin can remove one right and add another in one edit of a lead share and the restricted user gets exactly the new set', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await new LeadsPage(adminPage).goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const shared = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['update', 'note'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      await waitForRestrictedRights(shared.restrictedApi, shared.leadId, permissionSet(['update', 'note']));

      const rulesPage = await openLeadRuleOnShareDataPage(adminPage, shared.leadName);
      expect(await rulesPage.getPermissionStates()).toMatchObject({ update: true, note: true, meeting: false });
      await rulesPage.setPermission('update', false);
      await rulesPage.setPermission('meeting', true);
      await rulesPage.saveRule();

      const expected = permissionSet(['note', 'meeting']);
      const appliedInMs = await waitForRestrictedRights(shared.restrictedApi, shared.leadId, expected);
      test.info().annotations.push({ type: 'share rule change applied after (ms)', description: String(appliedInMs) });
      await assertRestrictedUiAccess(restrictedLeadsPage, restrictedPage, shared.leadId, expected);
      await assertRestrictedApiAccess(shared.restrictedApi, shared.leadId, expected);
    } finally {
      await shared.adminApi.dispose();
      await shared.restrictedApi.dispose();
      await shared.ruleApi.dispose();
    }
    logger.success('L75 passed');
  });

  // ── L76 ───────────────────────────────────────────────────

  // WHAT: when an admin deletes a lead's share, the restricted user loses all access to that lead,
  //   while the admin's lead is untouched.
  // WHY: deleting the share is how a lead is taken back completely; if the user kept any access it
  //   would be a data leak.
  // HOW: the rule is found by filter on Share Data and deleted; then, with the restricted user's SAME
  //   session: server — read, change and delete are all answered "not found / no permission" (404/
  //   000010; the wait is polled and timed); UI — opening the lead shows nothing of it; the share list
  //   has no rule for the lead; the admin still reads the lead unchanged.
  test('@regression admin can delete a lead share and the restricted user loses all access to that lead', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await new LeadsPage(adminPage).goToLeadsList();
    await restrictedLeadsPage.goToLeadsList();
    const shared = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['update', 'note'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      await waitForRestrictedRights(shared.restrictedApi, shared.leadId, permissionSet(['update', 'note']));

      const rulesPage = await openLeadRuleOnShareDataPage(adminPage, shared.leadName);
      await rulesPage.deleteRule();

      // The restricted user's own read of the lead is the real access check
      const started = Date.now();
      await expect
        .poll(async () => (await shared.restrictedApi.getLead(shared.leadId)).status, {
          timeout: 60000,
          intervals: [500, 1000, 1000, 2000],
          message: 'The restricted user should lose access to the lead',
        })
        .toBe(404);
      test.info().annotations.push({ type: 'share rule delete applied after (ms)', description: String(Date.now() - started) });

      const read = await shared.restrictedApi.getLead(shared.leadId);
      expect((read.body as { code?: string }).code).toBe('000010');
      const update = await shared.restrictedApi.putLeadRaw(shared.leadId, { firstName: 'Denied', lastName: 'Denied' });
      expect(update.status).toBe(404);
      expect(update.body.code).toBe('000010');
      const deletion = await shared.restrictedApi.deleteLead(shared.leadId);
      expect(deletion.status).toBe(404);
      expect((deletion.body as { code?: string }).code).toBe('000010');

      const detailResponsePromise = restrictedPage.waitForResponse(
        (res) => res.url().endsWith(`/v1/leads/${shared.leadId}`) && res.request().method() === 'GET',
        { timeout: config.timeouts.navigation }
      );
      await restrictedLeadsPage.navigateTo(`${config.appUrl}/sales/leads/details/${shared.leadId}`);
      expect((await detailResponsePromise).status()).toBe(404);
      await expect(restrictedPage.getByText(shared.leadName)).toHaveCount(0);

      expect(await shared.ruleApi.countRules('LEAD', shared.leadId), 'Share rules left for the lead').toBe(0);
      const adminLead = await shared.adminApi.getLeadOrThrow(shared.leadId);
      expect(adminLead.firstName).toBe(shared.leadName);
      expect(adminLead.ownerId).toBe(await shared.adminApi.getMyUserId());
    } finally {
      await shared.adminApi.dispose();
      await shared.restrictedApi.dispose();
      await shared.ruleApi.dispose();
    }
    logger.success('L76 passed');
  });
  // ──────────────────────────────────────────────────────────
  // A read-only share gives NO productivity rights
  // ──────────────────────────────────────────────────────────

  // ── L77 ───────────────────────────────────────────────────

  // WHAT: on a lead the admin shared with the restricted user as READ ONLY, the restricted user cannot
  //   see the admin's notes and cannot add a note or delete the admin's note.
  // WHY: a share without the Note right must not let that person write to the lead's history; being
  //   able to add or remove notes through the back-end would bypass the share.
  // HOW: a brand-new admin lead (never an existing one, so no old share rule can add rights) with
  //   exactly one share rule, read only. The set-up is asserted first — the rule grants only Read, the
  //   token belongs to the shared user (not the admin), the user's rights are read only — and a second
  //   brand-new lead shared WITH Note is the control, where the same requests succeed. Only then is the
  //   test marked as an expected failure and the refusals asserted with the restricted user's own token.
  //   The UI half (no Notes icon) is proved by the read-only share test above (L14).
  // KNOWN KYLAS BUG — SD-32157: the server accepts adding a note and deleting the admin's note. The
  //   test.fail() below keeps the run green while that is true and turns it red ("expected to fail but
  //   passed") the day Kylas fixes it: then delete the marker and close KI-52. The assertions state the
  //   CORRECT behaviour and must not be weakened.
  test('@regression restricted user cannot add or delete notes on an admin lead shared read only', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    await new LeadsPage(adminPage).goToLeadsList();
    await new LeadsPage(restrictedPage).goToLeadsList();
    const readOnly = await shareNewLeadWithRestricted(adminPage, restrictedPage, [], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    const control = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['note'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      // ── set-up: any failure here is a set-up problem, NOT the known bug (test.fail() is not set yet)
      const adminId = await readOnly.adminApi.getMyUserId();
      const restrictedId = await readOnly.restrictedApi.getMyUserId();
      expect(restrictedId, 'Set-up: the token used for the calls is the shared user, not the admin').not.toBe(adminId);
      expect(await readOnly.ruleApi.countRules('LEAD', readOnly.leadId), 'Set-up: one rule on the read-only lead').toBe(1);
      const rule = await readOnly.ruleApi.getRule(readOnly.ruleId);
      expect(rule.body.toId, 'Set-up: the rule is for the restricted user').toBe(restrictedId);
      expect(ShareRuleApi.permissionsOf(rule.body), 'Set-up: the saved rule grants only Read').toEqual(permissionSet([]));
      expect((await readOnly.adminApi.getLeadOrThrow(readOnly.leadId)).ownerId, 'Set-up: the admin owns the lead').toBe(adminId);
      await waitForRestrictedRights(readOnly.restrictedApi, readOnly.leadId, permissionSet([]));
      await waitForRestrictedRights(control.restrictedApi, control.leadId, permissionSet(['note']));
      const adminNote = await readOnly.adminApi.addNote(readOnly.leadId, `Admin note ${Date.now()}`);
      expect(adminNote.status, 'Set-up: the admin can add a note').toBe(200);
      const adminNoteId = (adminNote.body as { id: number }).id;
      // control: with the Note right granted, the same requests work — so a refusal below is down to the missing right
      const controlNote = await control.restrictedApi.addNote(control.leadId, `Control note ${Date.now()}`);
      expect(controlNote.status, 'Set-up control: add note WITH the Note right').toBe(200);
      expect(
        (await control.restrictedApi.deleteNote((controlNote.body as { id: number }).id)).status,
        'Set-up control: delete own note WITH the Note right'
      ).toBe(200);
      // the admin's note is not listed to the read-only share (this part of the behaviour is correct today)
      expect(
        await readOnly.restrictedApi.getNoteIdsOfLead(readOnly.leadId, adminId),
        "The admin's note must not be listed to a read-only share"
      ).not.toContain(adminNoteId);

      // ── the known bug: from here the test is EXPECTED to fail (SD-32157)
      test.fail(true, 'Kylas bug SD-32157: the API allows adding and deleting notes on a read-only share');
      const addNote = await orInconclusive(() => readOnly.restrictedApi.addNote(readOnly.leadId, 'Must be refused'));
      expect(addNote.status, 'SD-32157: add note without the Note right must be refused').toBeGreaterThanOrEqual(400);
      expect(addNote.status, 'SD-32157: add note without the Note right must be refused (client error)').toBeLessThan(500);
      const deleteNote = await orInconclusive(() => readOnly.restrictedApi.deleteNote(adminNoteId));
      expect(deleteNote.status, "SD-32157: delete the admin's note without the Note right must be refused").toBeGreaterThanOrEqual(400);
      expect(deleteNote.status, "SD-32157: delete the admin's note without the Note right must be refused (client error)").toBeLessThan(500);
    } finally {
      for (const shared of [readOnly, control]) {
        await shared.adminApi.dispose();
        await shared.restrictedApi.dispose();
        await shared.ruleApi.dispose();
      }
    }
    logger.success('L77 passed');
  });

  // ── L79 ───────────────────────────────────────────────────

  // WHAT: on a lead the admin shared with the restricted user as READ ONLY, the restricted user cannot
  //   add a task to it.
  // WHY: tasks are part of a lead's history and are shared separately (Task right); read-only must not
  //   let someone add to them.
  // HOW: same set-up and control as the notes test, with the Task right. After the set-up is asserted
  //   the test is marked as an expected failure and the refusal is asserted with the restricted
  //   user's own token.
  // KNOWN KYLAS BUG — SD-32158: the server accepts the task. test.fail() keeps the run green while
  //   that is true and turns it red the day Kylas fixes it: then delete the marker and close KI-52.
  //   The assertion states the CORRECT behaviour and must not be weakened.
  test('@regression restricted user cannot add tasks on an admin lead shared read only', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    await new LeadsPage(adminPage).goToLeadsList();
    await new LeadsPage(restrictedPage).goToLeadsList();
    const readOnly = await shareNewLeadWithRestricted(adminPage, restrictedPage, [], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    const control = await shareNewLeadWithRestricted(adminPage, restrictedPage, ['task'], {
      leads: leadCleanup,
      rules: shareRuleCleanup,
    });
    try {
      // ── set-up: any failure here is a set-up problem, NOT the known bug (test.fail() is not set yet)
      const adminId = await readOnly.adminApi.getMyUserId();
      const restrictedId = await readOnly.restrictedApi.getMyUserId();
      expect(restrictedId, 'Set-up: the token used for the calls is the shared user, not the admin').not.toBe(adminId);
      expect(await readOnly.ruleApi.countRules('LEAD', readOnly.leadId), 'Set-up: one rule on the read-only lead').toBe(1);
      const rule = await readOnly.ruleApi.getRule(readOnly.ruleId);
      expect(rule.body.toId, 'Set-up: the rule is for the restricted user').toBe(restrictedId);
      expect(ShareRuleApi.permissionsOf(rule.body), 'Set-up: the saved rule grants only Read').toEqual(permissionSet([]));
      await waitForRestrictedRights(readOnly.restrictedApi, readOnly.leadId, permissionSet([]));
      await waitForRestrictedRights(control.restrictedApi, control.leadId, permissionSet(['task']));
      const controlTask = await control.restrictedApi.createTaskOnLead(
        { id: control.leadId, name: control.leadName },
        restrictedId
      );
      expect(controlTask.status, 'Set-up control: add task WITH the Task right').toBe(200);
      if (controlTask.body.id) await leadCleanup.trackRecord(adminPage, 'task', controlTask.body.id);

      // ── the known bug: from here the test is EXPECTED to fail (SD-32158)
      test.fail(true, 'Kylas bug SD-32158: the API allows adding a task on a read-only share');
      const addTask = await orInconclusive(() =>
        readOnly.restrictedApi.createTaskOnLead({ id: readOnly.leadId, name: readOnly.leadName }, restrictedId)
      );
      if (addTask.body.id) await leadCleanup.trackRecord(adminPage, 'task', addTask.body.id); // only if the server wrongly accepted it
      expect(addTask.status, 'SD-32158: add task without the Task right must be refused').toBeGreaterThanOrEqual(400);
      expect(addTask.status, 'SD-32158: add task without the Task right must be refused (client error)').toBeLessThan(500);
    } finally {
      for (const shared of [readOnly, control]) {
        await shared.adminApi.dispose();
        await shared.restrictedApi.dispose();
        await shared.ruleApi.dispose();
      }
    }
    logger.success('L79 passed');
  });

  // ── L78 ───────────────────────────────────────────────────

  // WHAT: on a lead the admin shared with the restricted user as READ ONLY, the restricted user cannot
  //   add a meeting or log a call.
  // WHY: meetings and calls are part of a lead's history and are shared separately; read-only must
  //   not let someone add to them.
  // HOW: same set-up as the notes and tasks test — a brand-new admin lead with exactly one read-only
  //   rule, and a brand-new control lead shared WITH Meeting and Call, where the same requests work.
  //   Server, restricted user's own token: adding a meeting and logging a call on the read-only lead
  //   are refused (the call log with its own "not allowed" code).
  test('@regression restricted user cannot add meetings or log calls on an admin lead shared read only', async ({
    adminPage,
    restrictedPage,
    leadCleanup,
    shareRuleCleanup,
  }) => {
    test.setTimeout(480000);
    await new LeadsPage(adminPage).goToLeadsList();
    await new LeadsPage(restrictedPage).goToLeadsList();
    const readOnly = await shareNewLeadWithRestricted(
      adminPage,
      restrictedPage,
      [],
      { leads: leadCleanup, rules: shareRuleCleanup },
      { withPhone: true }
    );
    const control = await shareNewLeadWithRestricted(
      adminPage,
      restrictedPage,
      ['meeting', 'call'],
      { leads: leadCleanup, rules: shareRuleCleanup },
      { withPhone: true }
    );
    const restrictedUser = { id: await readOnly.restrictedApi.getMyUserId(), name: 'User 1' };
    try {
      expect(await readOnly.ruleApi.countRules('LEAD', readOnly.leadId), 'Rules on the read-only lead').toBe(1);
      expect(await control.ruleApi.countRules('LEAD', control.leadId), 'Rules on the control lead').toBe(1);
      await waitForRestrictedRights(readOnly.restrictedApi, readOnly.leadId, permissionSet([]));
      await waitForRestrictedRights(control.restrictedApi, control.leadId, permissionSet(['meeting', 'call']));

      // control: with the rights granted, the same requests work
      const controlMeeting = await control.restrictedApi.createMeetingOnLead(
        { id: control.leadId, name: control.leadName },
        restrictedUser
      );
      expect(controlMeeting.status, 'Control: add meeting with the Meeting right').toBe(201);
      if (controlMeeting.body.id) await leadCleanup.trackRecord(adminPage, 'meeting', controlMeeting.body.id);
      const controlCall = await control.restrictedApi.createCallLogOnLead({
        id: control.leadId,
        name: control.leadName,
        phoneId: await control.adminApi.getLeadPhoneId(control.leadId),
      });
      expect(controlCall.status, 'Control: log a call with the Call right').toBe(201);
      if (controlCall.body.id) await leadCleanup.trackRecord(adminPage, 'call log', controlCall.body.id);

      // read-only lead: both are refused
      const addMeeting = await readOnly.restrictedApi.createMeetingOnLead(
        { id: readOnly.leadId, name: readOnly.leadName },
        restrictedUser
      );
      if (addMeeting.body.id) await leadCleanup.trackRecord(adminPage, 'meeting', addMeeting.body.id); // only if wrongly accepted
      expect(addMeeting.status, 'Add meeting without the Meeting right').toBeGreaterThanOrEqual(400);
      expect(addMeeting.status).toBeLessThan(500);
      const addCall = await readOnly.restrictedApi.createCallLogOnLead({
        id: readOnly.leadId,
        name: readOnly.leadName,
        phoneId: await readOnly.adminApi.getLeadPhoneId(readOnly.leadId),
      });
      if (addCall.body.id) await leadCleanup.trackRecord(adminPage, 'call log', addCall.body.id); // only if wrongly accepted
      expect(addCall.status, 'Log a call without the Call right').toBe(403);
      expect((addCall.body as { errorCode?: string }).errorCode, 'Call log refused code').toBe('02001006');
    } finally {
      for (const shared of [readOnly, control]) {
        await shared.adminApi.dispose();
        await shared.restrictedApi.dispose();
        await shared.ruleApi.dispose();
      }
    }
    logger.success('L78 passed');
  });
});
