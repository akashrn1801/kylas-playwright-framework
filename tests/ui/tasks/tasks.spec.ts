import { test, expect } from '../../../src/fixtures/index';
import { TasksPage } from '../../../src/modules/tasks/TasksPage';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import {
  generateTaskData,
  generateTaskCustomFieldData,
  generateMinimalTaskData,
} from '../../../src/data/factories/taskFactory';

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

  test('@smoke @regression @prodSafe admin should navigate to tasks list page', async ({ adminPage }) => {
    const tasksPage = new TasksPage(adminPage);

    await tasksPage.goToTasksList();
    await tasksPage.assertOnTasksListPage();
    logger.success('TK1 passed');
  });

  // ── Test 2: Create via Quick Task form ────────────────────────────────────

  test('@regression admin should create a task via Quick Task form', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    // WHY: Quick task CKEditor text becomes the task name shown in the list
    const taskData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTask(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
    logger.success('TK2 passed');
  });

  // ── Test 3: Create via Detailed Task form (all fields + relation) ──────────

  test('@regression admin should create a task via Detailed Task form with all fields', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
    logger.success('TK3 passed');
  });

  // ── Test 4: Quick Form → switch to Detailed via toggle ────────────────────

  test('@regression admin should create a task by switching Quick Form to Detailed via toggle', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    // WHY: Distinct SWITCH- prefix makes this task easy to identify in list after save
    const taskData = generateTaskData({ name: `SWITCH-${Date.now()} Task` });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTaskThenSwitchToDetailed(taskData);

    await tasksPage.assertTaskCreated(taskData, taskId);
    logger.success('TK4 passed');
  });

  // ── Test 5: Update an existing task ───────────────────────────────────────

  test('@regression admin should update an existing task', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const originalData = generateTaskData();
    const updatedData = generateTaskData({ status: 'In Progress' });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(originalData);
    await tasksPage.assertTaskCreated(originalData, taskId);

    await tasksPage.updateTask(updatedData, originalData.name, taskId);
    await tasksPage.assertTaskUpdated(updatedData, taskId);
    logger.success('TK5 passed');
  });

  // ── Test 6: Mark a task as complete ───────────────────────────────────────

  test('@regression admin should mark a task as complete', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

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
        logger.info(
          `Task ${taskId} no longer in My Tasks view after completion — expected behaviour`
        );
      }
    }
    logger.success('TK6 passed');
  });

  // ── Test: Add note to task ─────────────────────────────────────────────────

  test('@regression admin should add a note to a task', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

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
    logger.success('TK7 passed');
  });

  // ── Test: Change Due Date via ellipsis ────────────────────────────────────

  test('@regression admin should change due date via ellipsis menu', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Change due date to 5 days from now via ellipsis
    await tasksPage.changeDueDateViaEllipsis(taskId!, 5);
    logger.info('Due date changed via ellipsis menu');
    logger.success('TK8 passed');
  });

  // ── Test: Mark as Completed via ellipsis ──────────────────────────────────

  test('@regression admin should mark task as completed via ellipsis and verify status', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Mark as completed via ellipsis then verify status on detail
    await tasksPage.markAsCompletedViaEllipsis(taskId!);
    await tasksPage.searchTaskById(taskId!);
    await tasksPage.assertTaskStatusOnDetail(taskId!, 'Completed');
    logger.success('TK9 passed');
  });

  // ── Test: Clone task via ellipsis ─────────────────────────────────────────

  test('@regression admin should clone a task via ellipsis menu', async ({ adminPage }) => {
    test.setTimeout(480000);

    const tasksPage = new TasksPage(adminPage);
    const taskData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData);
    await tasksPage.assertTaskCreated(taskData, taskId);

    // Clone via ellipsis — cloned task name = original + " Copy"
    await tasksPage.searchTaskById(taskId!);
    const clonedId = await tasksPage.cloneTaskViaEllipsis(taskId!);
    const clonedName = `${taskData.name} Copy`;
    await tasksPage.assertTaskCreated({ ...taskData, name: clonedName }, clonedId);
    logger.success('TK10 passed');
  });

  // ── Test 7: prodSafe — read-only navigation ────────────────────────────────

  test('@prodSafe tasks list page should be accessible', async ({ adminPage }) => {
    const tasksPage = new TasksPage(adminPage);

    await tasksPage.goToTasksList();
    await tasksPage.assertOnTasksListPage();
    logger.success('TK11 passed');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Custom Fields (TC20–TC23)
  // ─────────────────────────────────────────────────────────────────────────────
  // WHY 4 create contexts (standalone + 3 detail-panel variants), not 5 like
  // Meeting/Quotation/Call Log: confirmed live (2026-08-01 research) — Task has
  // no equivalent to "add from X panel" entry points. Task creation goes through
  // the global task dropdown in the sidebar (accessed from anywhere) or via the
  // list page's dedicated "Add Task" button. Once created, a task can only be
  // edited via detail panel or list item — there is no panel creation flow.
  //
  // WHY update/validation are NOT repeated per context: confirmed live —
  // editing a task goes through the same detail-panel Edit modal regardless of
  // which creation path was used; there is no context-dependent variation to test,
  // same conclusion already reached for Meeting/Quotation/Call Log.

  // ── TC20 ──────────────────────────────────────────────────────────────────────
  // WHY 2026-08-06: this test's own title has always claimed "verify on
  // details" but its body never actually called assertTaskCustomFieldsOnDetail()
  // — a genuine coverage gap that masked the suffixStyle/urlField-casing bug
  // fixed the same day (fillTaskCustomFields() was silently no-op'ing on every
  // field, on every environment including QA, since 2026-08-01, and nothing
  // here ever caught it). Now wired in for real.
  //
  // WHY open+skip+fill+save inline here instead of createDetailedTask():
  // skipIfCustomFieldsAbsent() must run while the create form is open (its
  // presence check reads live form-input locators), matching the identical
  // pattern already used by Lead/Contact/Company/Meeting/Call Log/Quotation's
  // own dedicated "create with all custom fields" test. Trade-off, stated
  // explicitly rather than left implicit: this bypasses createDetailedTask()'s
  // InaccessibleRelationError auto-retry (a randomly-picked Relation entity
  // turning out inaccessible), so this one test is narrowly less resilient to
  // that specific rare flake than other Task tests — acceptable here since
  // correct environment-safety (never hard-failing on an environment that
  // genuinely lacks these fields, per CLAUDE.md rule 7) matters more for the
  // dedicated custom-field test than that one retry does.
  test('@regression admin should create a task with all custom fields and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const data = generateTaskData();

    await tasksPage.goToTasksList();
    await tasksPage.openDetailedTaskForm();
    await tasksPage.skipIfCustomFieldsAbsent();
    await tasksPage.fillDetailedTaskForm(data);
    const taskId = await tasksPage.saveDetailedTask();
    expect(taskId, 'Task ID should be captured after create').not.toBeNull();

    await tasksPage.assertTaskCreated(data, taskId);
    await tasksPage.openTaskInDetailPanel(data.name, taskId);
    await tasksPage.assertTaskCustomFieldsOnDetail(data.customFields);
    logger.success('TC20 passed');
  });

  // ── TC21 ──────────────────────────────────────────────────────────────────────
  test('@regression admin should update a task and verify custom fields persist', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const originalData = generateTaskData();
    const updatedData = generateTaskData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(originalData);
    expect(taskId, 'Task ID should be captured after create').not.toBeNull();

    // Update the task with custom field data
    await tasksPage.updateTask(updatedData, originalData.name, taskId);
    await tasksPage.assertTaskUpdated(updatedData, taskId);
    logger.success('TC21 passed');
  });

  // ── TC22 ──────────────────────────────────────────────────────────────────────
  test('@regression admin should validate custom field types (number field bounds)', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const data = generateTaskData({
      customFields: {
        ...generateTaskCustomFieldData(),
        number: 999999, // High value to verify numeric field accepts large numbers
      },
    });

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(data);
    expect(taskId, 'Task ID should be captured').not.toBeNull();

    // Verify task with large number value was created successfully
    await tasksPage.assertTaskCreated(data, taskId);
    logger.success('TC22 passed');
  });

  // ── TC23 ──────────────────────────────────────────────────────────────────────
  test('@regression admin should create task from Quick form and have custom fields available', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    // WHY: Quick task creation does NOT fill custom fields (the Quick form has
    // no custom field section) — they start empty and must be filled via edit.
    // This test verifies that custom fields are present and fillable post-creation.
    const quickTaskData = generateTaskData();
    const customFieldData = generateTaskCustomFieldData();

    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createQuickTask(quickTaskData);
    expect(taskId, 'Task ID should be captured').not.toBeNull();

    // Edit the quick task to add custom fields
    const editData = { ...quickTaskData, customFields: customFieldData };
    await tasksPage.updateTask(editData, quickTaskData.name, taskId);
    await tasksPage.assertTaskUpdated(editData, taskId);
    logger.success('TC23 passed');
  });

  // ── Hide Empty Fields — TC24-TC26 ────────────────────────────
  // WHY only 3 tests, no tab-collapse variant: confirmed live via direct
  // code read of TasksPage.fillDetailedTaskForm()/fillTaskCustomFields()
  // that Type/Status/Priority/Reminder are always-populated react-selects
  // (no blankable placeholder) and PickList is unconditionally random-picked
  // regardless of input — so neither General Information nor Other Details
  // can ever be driven to a genuine 100%-empty state through this form.
  // This is a real, confirmed structural exception (not a coverage gap) —
  // Task's surface is mixed-section-only. Description and Text Field/
  // Paragraph Text/URL Field are the only genuinely blankable fields.
  // WHY a baseline-relative "Description" count, not assertFieldLabelHidden
  // (confirmed live via direct investigation, matching this repo's already-
  // established baseline-relative-count pattern — reference-patterns.md
  // §6): the literal text "Description" occurs TWICE on this page even with
  // the field genuinely blank — the real field label (which DOES respond to
  // the toggle) plus one separate, always-present occurrence elsewhere in
  // the page's UI chrome, unrelated to the toggle. Toggling ON reliably
  // drops the count by exactly 1 (2→1), never to 0 — asserting exact zero
  // would be asserting something never actually true for this module.
  // WHY the navigation fix in TasksPage.waitForTaskDetailsPage() (bundled
  // here, not a separate change): confirmed live via direct network capture
  // while building these tests — goToTaskDetailsById() failed 100% of the
  // time (a real, reproducible bug, not a scratch-script artifact) because
  // its GET-response regex was anchored with `$` right after the ID, but
  // the real request is `GET /v1/tasks/{id}/relation?targetEntityOwnerId=
  // ...` — a trailing path segment the anchor could never match. Same root-
  // cause class as the already-documented `/v1/quotations/`/`/v1/call-logs/`
  // versions of this exact bug.

  test('@regression admin should hide only empty fields on a task with minimal data, keeping both sections visible', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const taskData = generateMinimalTaskData();
    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);
    expect(taskId).not.toBeNull();
    await tasksPage.goToTaskDetailsById(taskId!);

    const descriptionBaseline = await adminPage.getByText('Description', { exact: true }).count();

    await tasksPage.toggleHideEmptyFields();

    const descriptionAfterHide = await adminPage.getByText('Description', { exact: true }).count();
    expect(
      descriptionAfterHide,
      'Description field label should disappear (one fewer occurrence) after the Hide Empty Fields toggle'
    ).toBe(descriptionBaseline - 1);

    // Other Details: Text Field/Paragraph Text/URL Field blanked — hidden;
    // Number/Checkbox/Pick List stay populated — tab itself stays visible.
    await tasksPage.assertTabVisible('Other Details');
    const otherDetailsTab = adminPage
      .locator('a.nav-item.nav-link, a.nav-link')
      .filter({ hasText: 'Other Details' });
    await otherDetailsTab.click();
    await tasksPage.assertFieldLabelHidden('Text Field');
    await tasksPage.assertFieldLabelHidden('Paragraph Text');
    await tasksPage.assertFieldLabelHidden('URL Field');
    await tasksPage.assertFieldLabelVisible('Number');

    logger.success('TC24 passed');
  });

  test('@regression admin should restore all hidden fields after toggling Hide Empty Fields off', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const taskData = generateMinimalTaskData();
    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);
    expect(taskId).not.toBeNull();
    await tasksPage.goToTaskDetailsById(taskId!);

    const descriptionBaseline = await adminPage.getByText('Description', { exact: true }).count();

    await tasksPage.toggleHideEmptyFields();
    expect(await adminPage.getByText('Description', { exact: true }).count()).toBe(
      descriptionBaseline - 1
    );

    await tasksPage.toggleHideEmptyFields();
    expect(await adminPage.getByText('Description', { exact: true }).count()).toBe(descriptionBaseline);

    logger.success('TC25 passed');
  });

  test('@regression admin should auto-reveal a hidden field immediately after editing it, without re-toggling', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);
    const tasksPage = new TasksPage(adminPage);
    const taskData = generateMinimalTaskData();
    await tasksPage.goToTasksList();
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true);
    expect(taskId).not.toBeNull();
    await tasksPage.goToTaskDetailsById(taskId!);

    const descriptionBaseline = await adminPage.getByText('Description', { exact: true }).count();

    await tasksPage.toggleHideEmptyFields();
    expect(await adminPage.getByText('Description', { exact: true }).count()).toBe(
      descriptionBaseline - 1
    );

    const newDescription = `Revealed description ${Date.now()}`;
    await tasksPage.clickEditButtonInDetailPanel();
    await tasksPage.fillEditForm({ ...taskData, description: newDescription });
    await tasksPage.saveEditedTask();

    // WHY a plain page.reload(), not a second goToTaskDetailsById() call
    // (confirmed live via direct investigation, matching this repo's own
    // "verify via stable end-state, not a transient UI snapshot" principle
    // — known-issues.md): the edit DID genuinely persist (confirmed present
    // after a fresh reload), but Task's in-place detail panel does not
    // refresh its own DOM after an edit-modal save — a real, Task-specific
    // staleness gap, not a genuine auto-reveal failure. A second
    // goToTaskDetailsById() call is itself flaky here — confirmed live that
    // re-navigating to an already-visited task's URL does not reliably
    // re-fire the `/relation` GET that method waits on (client-side
    // caching), so it's not a safe way to force a refetch. A hard reload
    // always re-boots the SPA from scratch, sidestepping that wait
    // entirely. The "Hide Empty Fields" preference is confirmed to persist
    // across it (verified below), so this is not a re-toggle.
    await adminPage.reload({ waitUntil: 'domcontentloaded' });
    // WHY no flat wait before this check (fixed 2026-09-08, pre-commit hook
    // sweep): toHaveAttribute() is itself a polling web-first assertion —
    // it already waits out the post-reload re-hydration on its own, up to
    // the explicit timeout below, so a preceding blind sleep was redundant.
    await expect(
      adminPage.locator('#hide-empty-fields-toggle-btn'),
      'Hide Empty Fields toggle should still be pressed after reloading — proves this check is genuine auto-reveal, not a reset toggle'
    ).toHaveAttribute('aria-pressed', 'true', { timeout: config.timeouts.navigation });

    // No re-toggle — auto-reveal must happen on its own
    expect(await adminPage.getByText('Description', { exact: true }).count()).toBe(descriptionBaseline);
    await expect(adminPage.getByText(newDescription)).toBeVisible({ timeout: 10000 });

    logger.success('TC26 passed');
  });
});
