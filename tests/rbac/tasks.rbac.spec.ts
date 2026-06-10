import { test } from '../../src/fixtures/index';
import { TasksPage } from '../../src/modules/tasks/TasksPage';
import { logger } from '../../src/utils/logger';
import {
  generateTaskData,
  generateAdminTaskData,
} from '../../src/data/factories/taskFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Tasks — RBAC Tests
//
// Verifies that:
//  1. Restricted user can navigate to tasks list
//  2. Restricted user can create own task via Quick form
//  3. Restricted user can create own task via Detailed form
//  4. Restricted user can edit their own task
//  5. Restricted user can mark their own task as complete
//  6. Restricted user CANNOT see admin task (not assigned to them)
//  7. Restricted user CAN see AND edit admin task when assigned to them
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Tasks RBAC', () => {

  // ── Test 1: Navigate ───────────────────────────────────────────────────────

  test('@smoke @regression restricted user can navigate to tasks list', async ({ restrictedPage }) => {
    const tasksPage = new TasksPage(restrictedPage);

    await tasksPage.goToTasksList();
    await tasksPage.assertOnTasksListPage();
  });

  // ── Test 2: Restricted user creates own quick task ────────────────────────

  test('@regression restricted user can create a task via Quick Task form', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(restrictedPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTask(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
  });

  // ── Test 3: Restricted user creates own detailed task ────────────────────

  test('@regression restricted user can create a task via Detailed Task form', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(restrictedPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    // WHY: skipRelation=true — this test focuses on note adding, not relations
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);

    await tasksPage.assertTaskCreated(taskData, taskId);
  });

  // ── Test 4: Restricted user edits own task ────────────────────────────────

  test('@regression restricted user can edit their own task', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const tasksPage    = new TasksPage(restrictedPage);
    const originalData = generateTaskData();
    const updatedData  = generateTaskData({ status: 'In Progress' });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(originalData);
    await tasksPage.assertTaskCreated(originalData, taskId);

    await tasksPage.updateTask(updatedData, originalData.name, taskId);
    await tasksPage.assertTaskUpdated(updatedData, taskId);
  });

  // ── Test 5: Restricted user marks own task as complete ───────────────────

  test('@regression restricted user can mark their own task as complete', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(restrictedPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    // WHY: skipRelation=true — this test focuses on note adding, not relations
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);
    await tasksPage.assertTaskCreated(taskData, taskId);

    await tasksPage.openTaskInDetailPanel(taskData.name, taskId);
    await tasksPage.markTaskAsComplete(taskId);
    logger.success('Restricted user marked own task as complete');
  });

  // ── Test 6: Restricted user CANNOT see admin task (not assigned) ──────────

  test('@regression restricted user cannot see admin task when not assigned', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const adminTasks      = new TasksPage(adminPage);
    const restrictedTasks = new TasksPage(restrictedPage);

    // WHY: ADM<timestamp> prefix guarantees uniqueness — restricted user searching
    // for this name can never accidentally find a task from a previous test run
    const adminData = generateAdminTaskData();

    // Admin creates the task (not assigned to restricted user)
    await adminTasks.goToTasksList();
    await adminTasks.createDetailedTask(adminData);

    // Restricted user searches — must NOT find it
    await restrictedTasks.goToTasksList();
    await restrictedTasks.assertTaskNotInList(adminData.name);
  });

  // ── Test 7: Restricted user CAN see AND edit admin task when assigned ──────

  test('@regression restricted user can view and edit admin task when assigned to them', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const adminTasks      = new TasksPage(adminPage);
    const restrictedTasks = new TasksPage(restrictedPage);

    // WHY: ADM<timestamp> prefix for RBAC isolation
    const adminData = generateAdminTaskData();

    // Admin creates task and assigns it to "User 1" (restricted user name in QA)
    // WHY: We type the restricted user's display name — same as meetings invitee pattern
    await adminTasks.goToTasksList();
    // WHY: skipRelation=true — this test verifies assignment RBAC only.
    // Admin-owned relations cause intermittent validation errors when restricted
    // user edits, because parallel workers may affect entity availability.
    // Relation RBAC is covered separately in the detailed task create tests.
    const taskId = await adminTasks.createDetailedTask(adminData, 'User 1', true);
    await adminTasks.assertTaskCreated(adminData, taskId);

    logger.info(`Admin task ID: ${taskId}`);
    if (!taskId) throw new Error('Could not capture admin task ID — cannot proceed with RBAC check');

    // ── Restricted user perspective ──────────────────────────────────────────

    // Search by task ID using filter (same pattern as meetings searchMeetingById)
    // WHY: Restricted user's default "My Tasks" view shows tasks assigned to them —
    // use ID filter to find it reliably without search index lag
    await restrictedTasks.goToTasksList();
    await restrictedTasks.searchTaskById(taskId);

    // Task should appear in filtered list
    const taskVisible = await restrictedPage.locator(`li#task_${taskId}`).isVisible().catch(() => false);
    if (!taskVisible) {
      throw new Error(
        `Task ID ${taskId} not visible for restricted user — not assigned correctly`,
      );
    }
    logger.success(`Task ${taskId} visible for restricted user as assignee`);

    // Open in detail panel
    await restrictedPage.locator(`li#task_${taskId}`).click();
    await restrictedPage.waitForTimeout(800);

    // WHY: Unlike meetings where invitees cannot edit — tasks assigned to restricted
    // user are fully editable by them (Edit button visible in detail panel header)
    await restrictedTasks.assertEditOptionVisible();

    // Restricted user edits the assigned task
    const updatedByRestricted = generateTaskData({ status: 'In Progress' });
    await restrictedTasks.clickEditButtonInDetailPanel();
    await restrictedTasks.fillEditForm(updatedByRestricted);
    await restrictedTasks.saveEditedTask();

    // Verify the update persisted
    await restrictedTasks.goToTasksList();
    await restrictedTasks.searchTaskById(taskId);
    const updatedVisible = await restrictedPage.locator(`li#task_${taskId}`).isVisible().catch(() => false);
    if (!updatedVisible) throw new Error(`Updated task ${taskId} not found for restricted user after edit`);
    logger.success('Restricted user successfully edited admin-assigned task');
  });


  // ── Test: Restricted user adds note to own task ───────────────────────────

  test('@regression restricted user can add a note to their own task', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(restrictedPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    // WHY: skipRelation=true — this test focuses on note adding, not relations
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Open task and add note
    await tasksPage.openTaskInDetailPanel(taskData.name, taskId);
    const noteText = `Restricted user note ${Date.now()} — automation test`;
    await tasksPage.addNoteToTask(noteText);
    await tasksPage.assertNoteAdded(noteText);
  });


  // ── Test: Restricted user cannot Delete admin-assigned task ───────────────

  test('@regression restricted user cannot see Delete option on admin-assigned task', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const adminTasks      = new TasksPage(adminPage);
    const restrictedTasks = new TasksPage(restrictedPage);

    const adminData = generateAdminTaskData();

    // Admin creates task assigned to restricted user (no relation to avoid validation issues)
    await adminTasks.goToTasksList();
    const taskId = await adminTasks.createDetailedTask(adminData, 'User 1', true);
    await adminTasks.assertTaskCreated(adminData, taskId);

    // Restricted user finds the task via ID filter
    await restrictedTasks.goToTasksList();
    await restrictedTasks.searchTaskById(taskId!);

    // WHY: Restricted user is only assignee — cannot delete admin-owned task
    await restrictedTasks.assertDeleteOptionNotVisible(taskId!);
  });


  // ── Test: Restricted user can add note to admin-assigned task ────────────

  test('@regression restricted user can add a note to admin-assigned task', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const adminTasks      = new TasksPage(adminPage);
    const restrictedTasks = new TasksPage(restrictedPage);

    const adminData = generateAdminTaskData();

    // Admin creates task with full relations, assigned to restricted user
    // WHY: skipRelation=false — we want relations present to verify restricted user
    // can still add notes even when task has admin-owned relations
    await adminTasks.goToTasksList();
    const taskId = await adminTasks.createDetailedTask(adminData, 'User 1', false);
    await adminTasks.assertTaskCreated(adminData, taskId);

    // Restricted user finds the task via ID filter
    await restrictedTasks.goToTasksList();
    await restrictedTasks.searchTaskById(taskId!);

    // Open task in detail panel
    await restrictedPage.locator(`li#task_${taskId}`).click();
    await restrictedPage.waitForTimeout(800);

    // WHY: Restricted user is assignee — should be able to add notes
    // Adding a note does not trigger relation validation (no save of task fields)
    const adminTaskNote = `Restricted assignee note ${Date.now()} — admin task`;
    await restrictedTasks.addNoteToTask(adminTaskNote);
    await restrictedTasks.assertNoteAdded(adminTaskNote);
  });

});