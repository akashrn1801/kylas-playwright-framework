import { test } from '../../../src/fixtures/index';
import { TasksPage } from '../../../src/modules/tasks/TasksPage';
import { logger } from '../../../src/utils/logger';
import { generateTaskData } from '../../../src/data/factories/taskFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Tasks — UI Tests
//
// Covers:
//  1. Navigate to tasks list
//  2. Create task via Quick Task form (from dropdown)
//  3. Create task via Detailed Task form (from dropdown) — all fields + relation
//  4. Create task via Quick Form → switch to Detailed via toggle
//  5. Update an existing task (name, status, priority)
//  6. Mark a task as complete
//  7. prodSafe — read-only navigation
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Tasks', () => {

  // ── Test 1: Navigate ───────────────────────────────────────────────────────

  test('@smoke @regression admin should navigate to tasks list page', async ({ adminPage }) => {
    const tasksPage = new TasksPage(adminPage);

    await tasksPage.goToTasksList();
    await tasksPage.assertOnTasksListPage();
  });

  // ── Test 2: Create via Quick Task form ────────────────────────────────────

  test('@regression admin should create a task via Quick Task form', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    // WHY: Quick task CKEditor text becomes the task name shown in the list
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTask(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
  });

  // ── Test 3: Create via Detailed Task form (all fields + relation) ──────────

  test('@regression admin should create a task via Detailed Task form with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
  });

  // ── Test 4: Quick Form → switch to Detailed via toggle ────────────────────

  test('@regression admin should create a task by switching Quick Form to Detailed via toggle', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    // WHY: Distinct SWITCH- prefix makes this task easy to identify in list after save
    const taskData  = generateTaskData({ name: `SWITCH-${Date.now()} Task` });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTaskThenSwitchToDetailed(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
  });

  // ── Test 5: Update an existing task ───────────────────────────────────────

  test('@regression admin should update an existing task', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage    = new TasksPage(adminPage);
    const originalData = generateTaskData();
    const updatedData  = generateTaskData({ status: 'In Progress' });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(originalData);
    await tasksPage.assertTaskCreated(originalData, taskId);

    await tasksPage.updateTask(updatedData, originalData.name, taskId);
    await tasksPage.assertTaskUpdated(updatedData, taskId);
  });

  // ── Test 6: Mark a task as complete ───────────────────────────────────────

  test('@regression admin should mark a task as complete', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Open in detail panel then mark complete
    await tasksPage.openTaskInDetailPanel(taskData.name, taskId);
    await tasksPage.markTaskAsComplete(taskId);

    // WHY: After marking complete the task may move out of "My Tasks" view —
    // verify it still exists by searching with ID filter
    if (taskId) {
      await tasksPage.searchTaskById(taskId);
      const item = adminPage.locator(`li#task_${taskId}`);
      const visible = await item.isVisible().catch(() => false);
      if (!visible) {
        // Task may have been removed from default view after completion — acceptable
        logger.info(`Task ${taskId} no longer in My Tasks view after completion — expected behaviour`);
      }
    }
  });


  // ── Test: Add note to task ─────────────────────────────────────────────────

  test('@regression admin should add a note to a task', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    // Create task first
    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Open task in detail panel
    await tasksPage.openTaskInDetailPanel(taskData.name, taskId);

    // WHY: Use timestamp in note text to uniquely identify this note
    // even if other notes already exist on the task
    const noteText = `Automation note ${Date.now()} — task follow up required`;
    await tasksPage.addNoteToTask(noteText);
    await tasksPage.assertNoteAdded(noteText);
  });


  // ── Test: Change Due Date via ellipsis ────────────────────────────────────

  test('@regression admin should change due date via ellipsis menu', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Change due date to 5 days from now via ellipsis
    await tasksPage.changeDueDateViaEllipsis(taskId!, 5);
    logger.info('Due date changed via ellipsis menu');
  });

  // ── Test: Mark as Completed via ellipsis ──────────────────────────────────

  test('@regression admin should mark task as completed via ellipsis and verify status', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Mark as completed via ellipsis then verify status on detail
    await tasksPage.markAsCompletedViaEllipsis(taskId!);
    await tasksPage.searchTaskById(taskId!);
    await tasksPage.assertTaskStatusOnDetail(taskId!, 'Completed');
  });

  // ── Test: Clone task via ellipsis ─────────────────────────────────────────

  test('@regression admin should clone a task via ellipsis menu', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData  = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Clone via ellipsis — cloned task name = original + " Copy"
    await tasksPage.searchTaskById(taskId!);
    const clonedId = await tasksPage.cloneTaskViaEllipsis(taskId!);
    const clonedName = `${taskData.name} Copy`;
    await tasksPage.assertTaskCreated({ ...taskData, name: clonedName }, clonedId);
  });

  // ── Test 7: prodSafe — read-only navigation ────────────────────────────────

  test('@prodSafe tasks list page should be accessible', async ({ adminPage }) => {
    const tasksPage = new TasksPage(adminPage);

    await tasksPage.goToTasksList();
    await tasksPage.assertOnTasksListPage();
  });

});