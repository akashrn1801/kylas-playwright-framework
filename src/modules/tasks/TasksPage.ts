import { Page, Response, expect } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { logger } from '@utils/logger';
import { config } from '@config/config';
import {
  TaskData,
  TaskCustomFieldData,
  TASK_CUSTOM_FIELD_NAMES,
  TaskCustomFieldKey,
} from '@data/factories/taskFactory';
import { TaskRelationTargets, getTaskRelationTargets } from './TaskRelationTargets';

class InaccessibleRelationError extends Error {}

// WHY: the shape of a task-save error response body — a dynamic API response,
// not something Playwright/TypeScript can know statically. Captures exactly
// the one field this file's error-classification method reads (confirmed
// against a real, live "<entity>.not.found" response body).
interface TaskSaveErrorBody {
  message?: string;
}
export class TasksPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // Retry Config
  // ──────────────────────────────────────────────────────────

  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // Locators — List page
  // ──────────────────────────────────────────────────────────

  private readonly addDropdownToggle = () => this.page.locator('#quickEntityDropdown');

  private readonly addQuickTaskOption = () => this.page.locator('a#addQuickEntityButton');

  private readonly addDetailedTaskOption = () => this.page.locator('a#detailedEntityButton');

  private readonly taskList = () => this.page.locator('ul.task-list.list-group.list-group-flush');

  private readonly taskListItemByName = (name: string) =>
    this.page
      .locator('li.list-group-item')
      .filter({
        has: this.page.locator('p.card-list-content', { hasText: name }),
      })
      .first();

  private readonly taskListItemById = (taskId: number) => this.page.locator(`li#task_${taskId}`);

  private readonly taskSearchInput = () => this.page.locator('input#fulltext-search').first();

  // ──────────────────────────────────────────────────────────
  // Locators — Quick task form
  // ──────────────────────────────────────────────────────────

  private readonly quickTaskBackdrop = () => this.page.locator('.quick-task-create-backdrop');

  private readonly quickTaskCard = () => this.page.locator('.quick-task-card');

  // WHY: Toggle #formType — checked = Quick Form, unchecked = Detailed Form
  private readonly quickFormToggle = () => this.page.locator('#formType');

  private readonly quickTaskPriorityButton = () =>
    this.page.locator('.quick-task-card button.priority');
  private readonly quickTaskDateButton = () =>
    this.page.locator('.quick-task-card button.calender-button');
  private readonly quickTaskAssignedToButton = () =>
    this.page.locator('.quick-task-card button.assign-to');

  private readonly quickTaskDescriptionEditor = () =>
    this.page.locator('.quick-task-card .ck-editor__editable[role="textbox"]');

  private readonly quickTaskAddButton = () => this.page.locator('button.add-task-button');

  private readonly quickTaskCloseButton = () => this.page.locator('button.close-cross-cta');

  // ──────────────────────────────────────────────────────────
  // Locators — Detailed task modal
  // ──────────────────────────────────────────────────────────

  private readonly detailedTaskModal = () => this.page.locator('#editEntityModal.tasks');

  private readonly taskNameInput = () => this.page.locator('[id="0_11_input_name"]');

  private readonly taskTypeInput = () => this.page.locator('[id="0_12_input_type"]');

  private readonly taskDescriptionInput = () => this.page.locator('[id="0_21_input_description"]');

  private readonly taskStatusInput = () => this.page.locator('[id="0_31_input_status"]');

  private readonly taskPriorityInput = () => this.page.locator('[id="0_32_input_priority"]');

  private readonly taskReminderInput = () => this.page.locator('[id="0_51_input_reminder"]');

  private readonly taskAssignedToInput = () => this.page.locator('[id="0_52_input_assignedTo"]');

  private readonly taskRelationTypeInput = () => this.page.locator('[id="0_61_input_relation"]');

  private readonly detailedTaskSaveButton = () =>
    this.page.locator('#editEntityModal.tasks button.save-button');

  private readonly detailedTaskCancelButton = () =>
    this.page.locator('#editEntityModal.tasks .btn-outline-primary', { hasText: 'Cancel' });

  // ──────────────────────────────────────────────────────────
  // Locators — Detail panel (right side, same page)
  // ──────────────────────────────────────────────────────────

  // WHY: Edit button is in .title-wrapper .page-header-action — confirmed from DOM inspection
  private readonly detailPanelEditButton = () =>
    this.page.locator('.title-wrapper .page-header-action button[data-original-title="Edit"]');

  // WHY: 3-dot ellipsis on list item row — opens Edit/Change Due Date/Mark as Completed/Clone menu
  private readonly listItemEllipsisButton = (taskId: number) =>
    this.page.locator(`li#task_${taskId} button.btn-transparent`);

  private readonly dropdownMenuEditOption = () =>
    this.page.locator('.dropdown-menu.show .dropdown-item', { hasText: 'Edit' });

  private readonly dropdownMenuMarkCompleteOption = () =>
    this.page.locator('.dropdown-menu.show .dropdown-item', { hasText: 'Mark as Completed' });

  private readonly detailPanelMarkCompleteButton = () =>
    this.page.locator('button.btn-outline-primary.btn-sm', { hasText: 'Mark as complete' });

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────

  // WHY: Tasks has no separate /details/{id} page — the detail panel opens
  // over /sales/tasks/list?id={id}. This is the canonical wait for that URL
  // shape, mirroring waitForXDetailsPage() in the other modules.
  //
  // WHY: delegates to the shared BasePage.waitForEntityDetailPage() —
  // navigation-drift reload-and-retry built and verified once (2026-07-27,
  // via 2 real live reproductions on DealsPage's identical pattern), reused
  // here instead of a module-local copy. The `?id=` requirement in the URL
  // pattern still correctly distinguishes this from a bare list-page
  // navigation drift (e.g. the app dropping the id param) — a reload
  // preserves the full URL including its query string.
  // WHY the regex changed from `\/v1\/tasks\/\d+$` (2026-09-08, found while
  // building Hide-Empty-Fields tests): confirmed live via direct network
  // capture — a task detail-panel load, including one with NO relation
  // entities (skipRelation:true), never fires a bare `GET /v1/tasks/{id}`
  // at all. The real request is `GET /v1/tasks/{id}/relation?targetEntity
  // OwnerId=...` — the `$`-anchored regex could never match it, so this
  // wait (and its own reload-and-retry) was silently guaranteed to fail
  // every time, 100% reproducible. Same root-cause class as the already-
  // documented `/v1/quotations/` and `/v1/call-logs/` versions of this
  // exact bug (a versioned-path anchor that didn't account for a real
  // trailing path segment/query string) — just not caught here until now.
  async waitForTaskDetailsPage(): Promise<void> {
    await this.waitForEntityDetailPage(
      /sales\/tasks\/list\?.*id=/,
      (res) => res.url().match(/\/v1\/tasks\/\d+(?:\/|\?|$)/) !== null && res.request().method() === 'GET',
      'Task details'
    );
  }

  async goToTaskDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to task details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/tasks/list?id=${id}`);
    await this.waitForTaskDetailsPage();
  }

  // WHY plain page.waitForResponse(), not armResponseWaitWithRecovery(): same
  // fix, same root cause, as BasePage.waitForEntityListPage() (see that
  // method's own comment for the full evidence trail) — this method has its
  // own separate inline copy of the identical Promise.race shape, found via
  // the same codebase sweep (2026-07-28) rather than fixed only where first
  // discovered. armResponseWaitWithRecovery() arms page-level
  // response/framenavigated listeners via armSessionExpirySignal() that only
  // get detached when ITS OWN internal race settles — an abandoned losing
  // branch of THIS OUTER race never gives it that chance, leaving the
  // listeners attached to the page for up to config.timeouts.navigation
  // (60000ms) after this method has already returned, ready to fire a
  // spurious, wrongly-targeted recovery attempt if a genuine session expiry
  // happens later on a completely different page/step.
  private async waitForListReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await Promise.race([
      this.page
        .waitForResponse(
          (res) =>
            res.url().includes('/v1/tasks') &&
            res.request().method() === 'GET' &&
            res.status() === 200,
          { timeout: config.timeouts.navigation }
        )
        .catch(() => null),
      this.taskList()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
    logger.debug('Tasks list is ready');
  }

  private async captureIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.armResponseWaitWithRecovery(
        (res: Response) =>
          // WHY: hardened 2026-07-19 — same ID-capture bug class as the other
          // page objects' capture methods, found on a deeper re-sweep after
          // this one was initially missed (it has a toast-based fallback,
          // which masked that the primary response-based path was still
          // vulnerable to silently capturing a WRONG id from an unrelated
          // /v1/tasks-containing POST, not just falling through to null).
          // ADR 0016 (B3): exactly the create request (POST /v1/tasks), whatever its status: a 4xx/5xx
          // answer used to match nothing, so the wait ran its full 60 s before falling to the toast.
          /^\/v1\/tasks\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
        'captureIdFromResponse (task create)',
        config.timeouts.navigation
      );
      if (!response.ok()) {
        logger.warn(`Task create answered ${await this.describeMatchedResponse(response)}`);
        return await this.captureIdFromToast();
      }
      const body = await response.json();
      const id = body?.id ?? body?.data?.id ?? null;
      if (id) logger.success(`Captured task ID from POST response: ${id}`);
      return id;
    } catch {
      logger.warn('Could not capture task ID from POST response — trying toast');
      return await this.captureIdFromToast();
    }
  }

  private async captureIdFromToast(): Promise<number | null> {
    // WHY: Toast shows "Task created (Task ID: 85140)" — extract number from span.link-primary
    try {
      const toast = this.page.locator('.rrt-middle-container .link-primary');
      await toast.waitFor({ state: 'visible', timeout: 5000 });
      const text = await toast.textContent();
      const match = text?.match(/Task ID:\s*(\d+)/);
      if (match) {
        const id = parseInt(match[1]);
        logger.success(`Captured task ID from toast: ${id}`);
        return id;
      }
    } catch {
      logger.warn('Could not capture task ID from toast');
    }
    return null;
  }

  private async selectReactSelectOption(inputId: string, optionText: string): Promise<void> {
    // WHY: React Select dropdowns — click the ancestor control div to open,
    // then click the matching option from the menu
    const inputLocator = this.page.locator(`[id="${inputId}"]`);
    const control = inputLocator.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    await control.waitFor({ state: 'visible', timeout: 10000 });
    // WHY this.click() instead of the bare control.click() (2026-11-04, FFRTK6, 2026-11-03 sandbox run): the bare click
    // had no timeout, so `<div class="app-error something-is-broken">` intercepting the pointer made it retry 657 times
    // until the 480 s test timeout (and the next test of the file, queued on the form-field lock, died of the same
    // budget). this.click() is bounded (15 s) and names the error screen.
    await this.click(control, `${inputId} dropdown`);
    // B6: no pause: the option wait below is the signal that the menu is open
    const menu = this.page.locator('.is-invalid__menu');
    const option = menu.locator('.is-invalid__option', { hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    // WHY wrapped in withRateLimitRecovery() (2026-09-30 — real CI failures,
    // sandbox run 36663556957: FFRTK7/FFTK8 both failed here with the app's
    // own generic error-boundary state, `<div class="app-error something-is-
    // broken">` from `<div id="app">`, physically intercepting this exact
    // click — confirmed via 787 retry attempts all reporting the identical
    // intercepting element). See authManager.isAppErrorBoundaryPage()'s own
    // WHY comment for the full incident.
    await this.withRateLimitRecovery(() => option.click());
    // WHY defensive hardening, NOT a confirmed root-cause fix (2026-07-23):
    // tasks.rbac.spec.ts:69 hung once in CI — saveEditedTask()'s save click
    // registered (assertNoFormErrors found zero errors) yet the modal never
    // closed. 0/5 local reproductions, so the exact mechanism for that one
    // occurrence is NOT confirmed. Code review of this method found a real,
    // concrete gap regardless: it used to return immediately after the
    // option click with no confirmation the selection actually committed —
    // this is the LAST action fillEditForm() runs before saveEditedTask()
    // clicks Save (for the 'reminder' field), so a still-settling react-
    // select state here is the most plausible candidate to bleed into that
    // very next click — the same *shape* of race already root-caused for
    // DealsPage.cloneDeal() (a click landing during an async React commit
    // produces zero effect). Waiting for the menu to actually close is a
    // real readiness signal (react-select's own state transition), not a
    // guessed delay — matching the "wait for a real signal" discipline used
    // for that same DealsPage fix. Now the shared primitive (KI-35, ADR 0011): an
    // already-closed menu passes at once; a menu still open after the grace period gets
    // Escape and, if it is still open, fails naming this field instead of being ignored.
    await this.ensureReactSelectMenuClosed(`${inputId} (${optionText})`, control);
    logger.success(`Selected "${optionText}" for ${inputId}`);
  }

  // B6 (staging trace 2026-11-17: the list search is POST /v1/tasks/search; the old wait matched a GET on any
  // /v1/tasks path and swallowed its miss): fill the quoted name, press Enter and require the search's own answer.
  private async searchTaskByName(name: string, description: string): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.taskSearchInput(), `${description}: the search input should be visible`).toBeVisible({
        timeout: config.timeouts.expect,
      })
    );
    // WHY: Wrap name in double quotes for exact match search —
    // prevents partial matches and returns only the specific task.
    // Confirmed from DOM: #fulltext-search with quoted input returns exact results.
    await this.taskSearchInput().fill(`"${name}"`);
    // WHY: Press Enter to trigger search — the input does not auto-search on type
    await this.saveAndAwait(() => this.taskSearchInput().press('Enter'), {
      method: 'POST',
      urlRe: /^\/v1\/tasks\/search\/?$/,
      description: `${description} (POST /v1/tasks/search)`,
    });
  }

  private async retryFindTask(name: string): Promise<boolean> {
    const { retries } = this.retryConfig;
    // B6: the real condition is the task's row after a fresh list + quoted search (a new task can lag in the
    // search index); retryAttempts repeats that with its own backoff inside the budget the fixed retries x (list +
    // results wait + pause) took, instead of fixed pauses. Same shape as LeadsPage.retryFindLead().
    await this.withSessionExpiryRecovery(() =>
      this.retryAttempts(retries, `Task "${name}" search`, async () => {
        logger.info(`Looking for task "${name}"`);
        await this.navigateTo(`${config.appUrl}/sales/tasks/list`);
        await this.waitForListReady();
        await this.searchTaskByName(name, 'retryFindTask');
        await expect(this.taskListItemByName(name)).toBeVisible({ timeout: 5000 });
      })
    );
    logger.success(`Task "${name}" found via quoted search`);
    return true;
  }

  private async closeDetailedModalIfOpen(): Promise<void> {
    try {
      const modal = this.detailedTaskModal();
      if (await modal.isVisible()) {
        logger.info('Closing existing detailed task modal');
        await this.detailedTaskCancelButton().click();
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
      }
    } catch {
      /* not open */
    }
  }

  private async closeQuickFormIfOpen(): Promise<void> {
    try {
      const backdrop = this.quickTaskBackdrop();
      if (await backdrop.isVisible()) {
        logger.info('Closing quick task form');
        await this.quickTaskCloseButton().click();
        await backdrop.waitFor({ state: 'hidden', timeout: 5000 });
      }
    } catch {
      /* not open */
    }
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToTasksList(): Promise<void> {
    logger.info('Navigating to Tasks List');
    await this.closeDetailedModalIfOpen();
    await this.closeQuickFormIfOpen();
    await this.navigateTo(`${config.appUrl}/sales/tasks/list`);
    await this.waitForListReady();
    logger.success('On Tasks List page');
  }

  // ──────────────────────────────────────────────────────────
  // Quick Task Form
  // ──────────────────────────────────────────────────────────

  async openQuickTaskForm(): Promise<void> {
    logger.info('Opening Quick Task form via dropdown');
    await this.withRateLimitRecovery(() =>
      this.openMenuAndWaitForItem(
        this.addDropdownToggle(),
        '.dropdown-menu.show',
        this.addQuickTaskOption(),
        'Add dropdown: the "Quick Task" option'
      )
    );
    await this.addQuickTaskOption().click();
    await this.quickTaskCard().waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Wait for CKEditor to initialise before interacting with it
    await this.quickTaskDescriptionEditor().waitFor({ state: 'visible', timeout: 10000 });
    logger.success('Quick Task form opened');
  }

  async fillQuickTaskForm(data: TaskData): Promise<void> {
    logger.info(`Filling Quick Task form: "${data.name}"`);

    // B6 (staging probe 2026-11-17): each control shows its pick on the button itself (due-date button "Tomorrow",
    // Assigned To "@<user>" instead of "@Assigned To", Priority "<value>" instead of "Priority") and its menu
    // closes after the pick. Each step waits for its menu, picks once and asserts that result; a missing option
    // fails by name instead of saving the task with a default.
    // Due date — click calendar button, select "Tomorrow" from quick options
    logger.info('Setting due date to Tomorrow');
    const tomorrowOption = this.page.locator('.duedate-dropdown-options .dropdown-option', {
      hasText: 'Tomorrow',
    });
    await this.withRateLimitRecovery(() =>
      this.openMenuAndWaitForItem(
        this.quickTaskDateButton(),
        '.duedate-dropdown-options',
        tomorrowOption,
        'Quick task: the "Tomorrow" due-date option',
        { openBy: 'hover' }
      )
    );
    await tomorrowOption.click({ timeout: config.timeouts.expect });
    await this.withSessionExpiryRecovery(async () => {
      await expect(
        this.page.locator('.duedate-dropdown-options'),
        'Quick task: the due-date menu should close after the pick'
      ).toBeHidden({ timeout: config.timeouts.expect });
      await expect(this.quickTaskDateButton(), 'Quick task: the due date should read "Tomorrow"').toContainText(
        'Tomorrow',
        { timeout: config.timeouts.expect }
      );
    });
    logger.success('Due date set to Tomorrow');

    // Assigned To — click button, wait for dropdown, pick random user
    logger.info('Setting Assigned To');
    // WHY: Assigned To uses .assigned-to-menu-list with .is-invalid__option items
    const assignedToOptions = this.page.locator('.assigned-to-menu-list .is-invalid__option');
    await this.withRateLimitRecovery(() =>
      this.openMenuAndWaitForItem(
        this.quickTaskAssignedToButton(),
        '.assigned-to-menu-list',
        assignedToOptions.first(),
        'Quick task: the Assigned To options',
        { lookupUrlPart: '/users/lookup', openBy: 'hover' }
      )
    );
    // WHY: shared bounded+re-roll selector (2026-07-17) — was an unbounded
    // textContent()+click() on a random option, same bug class.
    await this.selectRandomOptionWithRetry(assignedToOptions, 'Assigned To set');
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.quickTaskAssignedToButton(),
        'Quick task: the Assigned To button should show the picked user'
      ).not.toHaveText(/Assigned To/, { timeout: config.timeouts.expect })
    );

    // Priority — hover then click to open dropdown options
    logger.info(`Setting priority: ${data.priority}`);
    await this.quickTaskPriorityButton().hover();
    // WHY: Priority dropdown appears on hover — .priority-dropdown-options with .dropdown-option items
    const priorityContainer = this.page.locator('.priority-dropdown-options');
    await this.withSessionExpiryRecovery(() =>
      expect(priorityContainer, 'Quick task: the priority options should appear on hover').toBeVisible({
        timeout: config.timeouts.expect,
      })
    );
    await priorityContainer
      .locator('.dropdown-option', { hasText: data.priority })
      .click({ timeout: config.timeouts.expect });
    await this.withSessionExpiryRecovery(async () => {
      await expect(priorityContainer, 'Quick task: the priority menu should close after the pick').toBeHidden({
        timeout: config.timeouts.expect,
      });
      await expect(
        this.quickTaskPriorityButton(),
        `Quick task: the priority button should read "${data.priority}"`
      ).toContainText(data.priority, { timeout: config.timeouts.expect });
    });
    logger.success(`Priority set: ${data.priority}`);

    // Description / task name via CKEditor
    logger.info('Filling task description (becomes task name in list)');
    const editor = this.quickTaskDescriptionEditor();
    await editor.waitFor({ state: 'visible', timeout: 10000 });
    await editor.click();
    await editor.fill(data.name);
    logger.success('Quick task form filled');
  }

  // B6: the quick-task overlay must be gone after a save; fails by name when it stays
  private async waitForQuickTaskFormClosed(): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.quickTaskBackdrop(), 'The quick-task form should close after Add Task').toBeHidden({
        timeout: config.timeouts.expect,
      })
    );
  }

  async saveQuickTask(): Promise<number | null> {
    logger.info('Saving Quick Task');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.quickTaskAddButton(), 'Add Task button');
    const id = await idPromise;
    // WHY: Confirmed live (2026-07-07) — a failed save (e.g. backend 4xx/5xx) left this
    // silently returning null while logging success, and the backdrop below never hides
    // because the app never closed its own quick-task overlay; a later, unrelated click
    // then gets stuck behind it until the whole test's timeout kills the browser context.
    // Fail fast here instead, matching the "Fresh company ID not captured" convention.
    if (!id) {
      throw new Error('Quick task ID not captured after save — cannot proceed (save likely failed silently)');
    }
    // WHY: Quick task form closes after save — stays on same /sales/tasks/list URL
    // B6: the form must close (it used to be `.catch(() => {})`: a stuck overlay was only found by a later click)
    await this.waitForQuickTaskFormClosed();
    await this.waitForListReady();
    logger.success(`Quick task saved (ID: ${id})`);
    return id;
  }

  async saveQuickTaskFromEntityDetail(): Promise<number | null> {
    logger.info('Saving Quick Task from entity detail page');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.quickTaskAddButton(), 'Add Task button');
    const id = await idPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveQuickTask() above.
    if (!id) {
      throw new Error(
        'Quick task ID not captured after save from entity detail — cannot proceed (save likely failed silently)'
      );
    }
    // WHY: When saving from entity detail page — no list to wait for
    // B6: the form closing is the signal (replaces a swallowed wait plus a 1 s pause)
    await this.waitForQuickTaskFormClosed();
    logger.success(`Quick task saved from entity detail (ID: ${id})`);
    return id;
  }

  async switchQuickFormToDetailed(): Promise<void> {
    logger.info('Switching Quick Form to Detailed via toggle');
    const toggle = this.quickFormToggle();
    await toggle.waitFor({ state: 'attached', timeout: 10000 });
    // WHY: Click the label — it triggers the React onChange handler reliably
    // Clicking the hidden checkbox input directly does not fire React events
    const label = this.page.locator('.quick-task-card label.custom-control-label');
    const labelVisible = await label.isVisible().catch(() => false);
    if (labelVisible) {
      await label.click();
    } else {
      await toggle.click({ force: true });
    }
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 15000 });
    await this.taskNameInput().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Switched to Detailed Task form');
  }

  // ──────────────────────────────────────────────────────────
  // Detailed Task Form
  // ──────────────────────────────────────────────────────────

  async openDetailedTaskForm(): Promise<void> {
    logger.info('Opening Detailed Task form via dropdown');
    // B6 (owner decision 2026-11-17): bounded waits, no retry loop (the old 3-attempt loop with 1 s pauses
    // swallowed every wait with `.catch(() => {})`). Each step waits for the thing it needs and fails by name.
    // Sandbox 44533064234 (tasks.rbac:360/385, 13:43:20Z, two workers at once): the app showed its 429 page ("Too many
    // requests at once") when the Add dropdown was opened, right after a staging stall released. ADR 0014 allows a 429
    // retry: withRateLimitRecovery clicks the app's own Refresh once and opens the menu once more (nothing else).
    await this.withRateLimitRecovery(() =>
      this.openMenuAndWaitForItem(
        this.addDropdownToggle(),
        '.dropdown-menu.show',
        this.addDetailedTaskOption(),
        'Add dropdown: the "Detailed Task" option'
      )
    );
    await this.addDetailedTaskOption().click({ timeout: config.timeouts.expect });
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailedTaskModal(), 'The Detailed Task modal should open').toBeVisible({
        timeout: config.timeouts.expect,
      })
    );
    // WHY: Skeleton loader shows first — wait for actual name input to be ready
    await this.withSessionExpiryRecovery(() =>
      expect(this.taskNameInput(), 'The Detailed Task form (Name input) should finish loading').toBeVisible({
        timeout: 15000,
      })
    );
    logger.success('Detailed Task form opened');
  }

  // WHY this exists as its own public method (2026-09-23, Form Field Limit
  // feature, Task rollout): confirmed live that Task's Name field is
  // `[id="0_11_input_name"]`, NOT `input[name="name"]` — the same trap
  // already confirmed for Company (BasePage's generic fillStandardField()
  // hangs indefinitely against it). Extracted so a caller needing to fill
  // ONLY the Name field directly (e.g. this feature's own live-in-form-
  // correction test) has a correct, working alternative to the generic
  // helper.
  async fillTaskName(name: string): Promise<void> {
    await this.fill(this.taskNameInput(), name, 'task name');
  }

  // WHY the optional `options` param — mirrors CompaniesPage.fillCompanyForm()'s
  // own, more-detailed WHY comment (docs/known-issues/form-fields.md
  // §5): `options.minimal` skips Description/Due-Date-change/Reminder —
  // but, confirmed live via direct reproduction (a real 3-step diagnostic:
  // Name alone -> "This is a required field"; Name+Type -> still required;
  // Name+Type+Status+Priority -> HTTP 200), Task's own true save-required
  // minimum is FOUR fields, not one — Type/Status/Priority have no
  // pre-selected default (their own react-select controls show the
  // "Choose" placeholder on a fresh form, confirmed live), unlike Reminder
  // (which IS pre-filled with a real default, "1 hour before the due date
  // and time", confirmed live) — so minimal mode still fills Type/Status/
  // Priority unconditionally, skipping only what's genuinely optional.
  // Every existing caller omits `options` and gets byte-for-byte the
  // original full-form-fill behavior.
  async fillDetailedTaskForm(
    data: TaskData,
    assignedToName?: string,
    skipRelation = false,
    options?: { minimal?: boolean; onlyCustomField?: TaskCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<void> {
    logger.info(`Filling Detailed Task form: "${data.name}"`);
    const minimal = options?.minimal === true;

    // Task Name (required)
    await this.fillTaskName(data.name);

    // Type (required — no pre-selected default, confirmed live)
    await this.selectReactSelectOption('0_12_input_type', data.type);

    if (!minimal) {
      // Description
      await this.fill(this.taskDescriptionInput(), data.description, 'description');
    }

    // Status (required — no pre-selected default, confirmed live)
    await this.selectReactSelectOption('0_31_input_status', data.status);

    // Priority (required — no pre-selected default, confirmed live)
    await this.selectReactSelectOption('0_32_input_priority', data.priority);

    if (!minimal) {
      // Due Date — leave default (pre-filled as tomorrow)
      logger.info('Due date left as default (tomorrow)');

      // Reminder — already has a real, valid default ("1 hour before the
      // due date and time", confirmed live) — re-selecting it in minimal
      // mode would be redundant work, not a correctness requirement.
      await this.selectReactSelectOption('0_51_input_reminder', data.reminder);

      // Assigned To (optional — used in RBAC tests to assign to restricted user)
      if (assignedToName) {
        await this.fillAssignedTo(assignedToName);
      }
    }

    // Relation — add one entity of each type (Lead, Deal, Contact, Company)
    // WHY: Same pattern as MeetingsPage.fillRelatedTo — search each entity type
    // and pick a random result. WHY skipRelation stays caller-controlled
    // rather than folded into `minimal`: every one of this feature's own
    // call sites always passes skipRelation=true explicitly (Relation is
    // expensive — 4 entity-type searches — and irrelevant to a field-limit
    // check), documented at each call site rather than assumed here.
    if (!skipRelation) {
      await this.fillRelation();
    } else {
      logger.info('Skipping relation — skipRelation=true');
    }

    // Custom Fields
    // WHY conditional, not unconditional: mirrors CompaniesPage.fillCompanyForm()'s
    // identical, more-detailed WHY comment on its own equivalent call site.
    if (!minimal || options?.onlyCustomField) {
      await this.fillTaskCustomFields(data.customFields, options?.onlyCustomField, options?.onlyCustomFieldName);
    }

    logger.success('Detailed Task form filled');
  }

  // WHY: escapeRegExp() moved to BasePage (2026-07-16) — was duplicated
  // privately across Tasks/Companies/Contacts/Leads/Deals; now inherited.

  async fillAssignedTo(userName: string): Promise<void> {
    logger.info(`Assigning task to: ${userName}`);
    const input = this.taskAssignedToInput();
    const control = input.locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
    await control.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Click control to open dropdown — default options load immediately (only 2 users)
    // Do NOT type — typing triggers API search which returns No Options for short names
    await control.click();
    // B6: no pause: the option wait below is the signal that the options loaded. Both option class names are
    // matched at once (the class may differ between environments), so there is no instant isVisible() probe.
    const exactUserName = new RegExp(`^\\s*${this.escapeRegExp(userName)}\\s*$`);
    const option = this.page.locator('[class*="__option"]').filter({ hasText: exactUserName }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await this.withSessionExpiryRecovery(() =>
      expect(control, `Assigned To should show "${userName}" after the pick`).toContainText(userName, {
        timeout: config.timeouts.expect,
      })
    );
    logger.success(`Assigned to: ${userName}`);
  }

  // WHY: see fillRelation(). Bounded react-select pick of the relation entity type.
  private async selectRelationEntityType(entityType: string): Promise<void> {
    const maxAttempts = 3;
    const relationTypeControl = this.taskRelationTypeInput().locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    // WHY getByText resolves to multiple elements — use the dropdown option selector specifically
    const option = this.page
      .locator('.is-invalid__option, .is-invalid__option--is-focused')
      .filter({ hasText: new RegExp('^' + entityType + '$') })
      .first();
    // WHY the open-menu checks: clicking a react-select control that is already
    // open CLOSES it, and Escape with no menu open can close the surrounding
    // task drawer, so the control is only clicked when no menu is showing and
    // Escape is only pressed when one is.
    // Scoped to THIS control's own select container, so a menu left open by another
    // select (e.g. the entity search of the previous loop iteration) is not mistaken for it.
    const openMenu = relationTypeControl.locator('xpath=..').locator('.is-invalid__menu').first();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!(await openMenu.isVisible().catch(() => false))) {
        await relationTypeControl.click({ timeout: config.timeouts.expect }).catch((error: unknown) => {
          throw new Error(
            `fillRelation: the relation entity-type control could not be clicked while selecting "${entityType}": ${String(error)}`
          );
        });
      }
      const visible = await option
        .waitFor({ state: 'visible', timeout: config.timeouts.expect })
        .then(() => true)
        .catch(() => false);
      if (visible) {
        await option.click({ timeout: config.timeouts.expect });
        return;
      }
      logger.warn(
        `Relation entity type "${entityType}" option not visible after opening the dropdown (attempt ${attempt}/${maxAttempts}) — closing and reopening`
      );
      if (await openMenu.isVisible().catch(() => false)) {
        await this.page.keyboard.press('Escape');
      }
    }
    throw new Error(
      `fillRelation: the "${entityType}" option never appeared in the relation entity-type dropdown after ${maxAttempts} attempts`
    );
  }

  async fillRelation(targets?: TaskRelationTargets): Promise<void> {
    logger.info('Filling Relation field — all entity types');
    // run-owned records, never a random existing one another test may delete (see TaskRelationTargets)
    const owned = targets ?? (await getTaskRelationTargets(this.page));
    const entityTypes = ['Lead', 'Deal', 'Contact', 'Company'] as const;
    const nameOf: Record<(typeof entityTypes)[number], string> = {
      Lead: owned.lead,
      Deal: owned.deal,
      Contact: owned.contact,
      Company: owned.company,
    };

    for (const entityType of entityTypes) {
      const targetName = nameOf[entityType];
      logger.info(`Selecting relation entity type: ${entityType}`);

      // Step 1: Open the entity type dropdown (relation type selector) and pick the type.
      // WHY bounded, re-opened until the option is visible (sandbox run 40821683680,
      // tasks.rbac:312, 8.2 min): the option click was unbounded and the control click
      // was followed by a fixed sleep, so when the "Company" option never appeared the
      // click waited for the whole 480 s test timeout ("Target page ... has been closed")
      // with no hint of which entity type it was on. Each attempt now waits for the
      // option itself; a menu that did not open (or closed again) is closed and reopened.
      await this.selectRelationEntityType(entityType);

      // Step 2: Click the entity search dropdown and search
      // WHY: After selecting entity type, a search dropdown appears — same as meetings
      // B6 (staging probe 2026-11-17: all four types exist and answer a three-space search within ~25 ms): the
      // search control and the results are awaited, not slept on.
      const searchControl = this.page
        .locator('div')
        .filter({ hasText: /^Search \.\.\.$/ })
        .last();
      await this.withSessionExpiryRecovery(() =>
        expect(searchControl, `Relation: the ${entityType} search control should appear`).toBeVisible({
          timeout: config.timeouts.expect,
        })
      );
      await searchControl.click();

      // Step 3: search for THIS run's record by name and pick it. The lookups the search sends are watched, so a
      // miss says "sent, no answer" (staging hold), an HTTP status (429) or "never sent" (sandbox 44533064234,
      // tasks.rbac:360: "none found" after a held lookup, with nothing to tell which). Count-bounded: a
      // search that shows nothing is typed again (the lookup is answered from an index that can lag a create).
      const lookupWatch = this.watchRequests(
        (r) => r.method() === 'GET' && /^\/v1\/.*lookup/.test(new URL(r.url()).pathname),
        (r) => {
          const u = new URL(r.url());
          const q = u.searchParams.get('name') ?? u.searchParams.get('q') ?? '';
          return `GET ${u.pathname}${q ? ` q="${q.slice(0, 40)}"` : ''}`;
        }
      );
      // the Lead and Contact lookups query `firstName:<text>` (seen live: GET /v1/search/lead/lookup q="firstName:..."), so
      // the full name never matches: type the first name (unique per run), then match the full name in the option
      const searchText = entityType === 'Lead' || entityType === 'Contact' ? targetName.split(' ')[0] : targetName;
      const option = this.page.locator('.is-invalid__option').filter({ hasText: targetName }).first();
      try {
        await this.withSessionExpiryRecovery(() =>
          this.retryAttempts(this.retryConfig.retries, `Relation: the ${entityType} search for "${targetName}"`, async () => {
            await this.taskRelationTypeInput().fill('');
            await this.taskRelationTypeInput().fill(searchText);
            await expect(
              option,
              `Relation: the ${entityType} search should list this run's record "${targetName}"`
            ).toBeVisible({ timeout: config.timeouts.expect });
          })
        );
      } catch (error) {
        const lookups = lookupWatch.describe();
        throw new Error(`${String(error)}\n  Lookups seen: ${lookups}`);
      } finally {
        lookupWatch.stop();
      }
      await option.click();
      logger.success(`Selected ${entityType} relation: "${targetName}" (this run's record)`);
      // the pick adds one relation row (each row has a trash icon)
      await this.withSessionExpiryRecovery(() =>
        expect(
          this.detailedTaskModal().locator('i.fa-trash-alt'),
          `Relation: a ${entityType} row should be added after the pick`
        ).toHaveCount(entityTypes.indexOf(entityType) + 1, { timeout: config.timeouts.expect })
      );
    }
  }

  private classifyTaskInaccessibleEntityError(
    status: number,
    body: TaskSaveErrorBody
  ): { isInaccessibleEntityError: boolean; rawMessage: string } {
    const message: string = body?.message || '';
    // WHY: matches company.not.found, lead.not.found, deal.not.found,
    // contact.not.found — any of the four Relation entity types can be
    // the inaccessible one, and the API expresses all of them with this
    // same "<entity>.not.found" shape (confirmed live: 007043 company.not.found).
    const isKnownMessage = /\b(lead|deal|contact|company)\.not\.found\b/i.test(message);
    return { isInaccessibleEntityError: status === 400 && isKnownMessage, rawMessage: message };
  }

  async saveDetailedTask(): Promise<number | null> {
    logger.info('Saving Detailed Task');
    // ADR 0016 (B3, plan section 11 #4): ONE strict create wait armed before the click serves both the
    // error classification and the id (it used to be two listeners, one capped at 20 s and one that
    // ignored non-2xx answers); a missing id now names the create request's status/body or why no
    // answer was seen.
    const armedAt = Date.now();
    const responsePromise = this.armResponseWaitWithRecovery(
      (res) => /^\/v1\/tasks\/?$/.test(new URL(res.url()).pathname) && res.request().method() === 'POST',
      'saveDetailedTask (task create POST)',
      config.timeouts.navigation
    );
    let missedResponse: unknown = null;
    const settledResponse = responsePromise.catch((error: unknown) => {
      missedResponse = error;
      return null;
    });
    await this.click(this.detailedTaskSaveButton(), 'save button');
    const response = await settledResponse;

    if (response && response.status() >= 400) {
      const body = (await response.json().catch(() => ({}))) as TaskSaveErrorBody;
      const { isInaccessibleEntityError, rawMessage } = this.classifyTaskInaccessibleEntityError(
        response.status(),
        body
      );
      if (isInaccessibleEntityError) {
        // WHY: surface a typed signal the retry wrapper in createDetailedTask
        // can catch specifically — see that method for the retry-with-
        // skipRelation strategy. Chip-level removal for the Relation field
        // isn't confirmed supported (unlike quotations' Company/Contact
        // fields), so the retry re-does the whole form without any relation
        // rather than guessing at DOM removal.
        throw new InaccessibleRelationError(rawMessage);
      }
    }

    // WHY wrapped, not a bare call (2026-09-10, confirmed live on a main-
    // branch/prod GitHub Actions run — "admin should clone a task via
    // ellipsis menu" failed twice in a row with real toast text "Error
    // Contact not found✕"): assertNoFormErrors() is a generic BasePage
    // scrape of ANY visible toast/inline-error, with no way to know this
    // exact text is the SAME "randomly-selected Relation entity became
    // inaccessible between search and save" race classifyTaskInaccessible-
    // EntityError() above already anticipates and recovers from — it just
    // only ever inspected the create-POST response body for it. On this
    // occurrence the race surfaced as a toast instead (or in addition to,
    // but too late for the response listener above to classify), so it hit
    // this generic check first and threw a plain, unclassified Error —
    // which createDetailedTask()'s catch block below doesn't recognize as
    // InaccessibleRelationError, so its already-built skipRelation retry
    // never ran. Re-classifying the SAME message pattern here (now matching
    // the plain-English toast form, not just the API's dotted
    // "<entity>.not.found" shape) closes that gap without duplicating the
    // retry logic itself — createDetailedTask() already knows what to do
    // once it sees the right error type.
    try {
      await this.assertNoFormErrors('task create form');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b(lead|deal|contact|company)\b[^a-z0-9]{0,20}not found/i.test(message)) {
        throw new InaccessibleRelationError(message);
      }
      throw err;
    }
    let id: number | null = null;
    if (response?.ok()) {
      const created = (await response.json().catch(() => null)) as { id?: number; data?: { id?: number } } | null;
      id = created?.id ?? created?.data?.id ?? null;
      if (id) logger.success(`Captured task ID from POST response: ${id}`);
    }
    if (!id) {
      logger.warn('Could not capture task ID from POST response — trying toast');
      id = await this.captureIdFromToast();
    }
    if (!id) {
      const detail = response
        ? await this.describeMatchedResponse(response)
        : this.describeMissedResponse(missedResponse, Date.now() - armedAt);
      throw this.appendCreateDetail(
        new Error('Detailed task ID not captured after save — cannot proceed (save likely failed silently)'),
        detail
      );
    }
    await this.detailedTaskModal()
      .waitFor({ state: 'hidden', timeout: 15000 })
      .catch(() => {});
    await this.waitForListReady();
    logger.success(`Detailed task saved (ID: ${id})`);
    return id;
  }

  // ──────────────────────────────────────────────────────────
  // Open Task / Detail Panel
  // ──────────────────────────────────────────────────────────

  async openTaskInDetailPanel(name: string, taskId?: number | null): Promise<void> {
    logger.info(`Opening task detail panel: "${name}"`);
    // WHY: After task creation, smartlists (My Tasks/My Open Tasks) hide newly
    // created tasks because they don't match the list's filter criteria (e.g.,
    // owner, due date). Direct clicking fails because the task isn't in the
    // current DOM view. Solution: use URL parameter ?id=<taskId> to force the
    // task to display (same pattern as searchTaskById()), then click it.
    // Fallback to name search if ID approach isn't applicable.
    if (taskId) {
      logger.info(`Attempting to navigate to task by ID: ${taskId}`);
      await this.navigateTo(`${config.appUrl}/sales/tasks/list?id=${taskId}`);
      await this.waitForListReady();
      // WHY waitForRendered + one recovery (2026-11-04, FFRTK16, 2026-11-03 sandbox run): the list answered with the
      // app's "Too many requests at once" page; the old 120 s wait ended in the name-search fallback below, whose bare
      // click() then waited for the full 480 s test timeout. Now the rate-limit page is recognised within seconds,
      // the page is reloaded once (the app's own advice), and the fallback click is bounded.
      const listItem = this.taskListItemById(taskId);
      const seen = async (): Promise<boolean> =>
        this.waitForRendered(listItem, `Task ${taskId} list item`).then(() => true).catch(() => false);
      let found = await seen();
      if (!found && (await this.recoverIfRateLimitPage())) {
        await this.waitForListReady();
        found = await seen();
      }
      if (found) {
        await this.click(listItem, `Task ${taskId} list item`);
        logger.success(`Task ${taskId} opened via ID navigation`);
        return;
      }
      logger.warn(`Task ID ${taskId} not found via URL filter — falling back to name search`);
    }
    // Fallback to name search
    await this.click(this.taskListItemByName(name), `task "${name}" list item`);
    logger.success(`Task "${name}" opened`);
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditButtonInDetailPanel(): Promise<void> {
    logger.info('Clicking Edit button in detail panel');
    // WHY: Edit button is button[data-original-title="Edit"] inside .title-wrapper .page-header-action
    await this.click(this.detailPanelEditButton(), 'edit button');
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.taskNameInput().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Edit modal opened from detail panel');
  }

  // WHY the optional `options` param, and WHY minimal EDIT skips Type/
  // Status/Priority entirely (a genuine, deliberate ASYMMETRY from minimal
  // CREATE, which must still supply all three — see fillDetailedTaskForm()'s
  // own WHY comment): on EDIT, the form opens PRE-FILLED with the task's own
  // already-valid, already-saved Type/Status/Priority — unlike CREATE, which
  // starts every one of these three at a blank "Choose" placeholder with no
  // default. Leaving them untouched on edit keeps them at their existing,
  // already-valid values; there is no "blank required field" risk to guard
  // against here the way there is on create.
  async fillEditForm(
    data: TaskData,
    options?: { minimal?: boolean; onlyCustomField?: TaskCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<void> {
    logger.info('Filling edit form');
    const minimal = options?.minimal === true;

    await this.fillTaskName(data.name);

    if (!minimal) {
      await this.selectReactSelectOption('0_12_input_type', data.type);
      await this.fill(this.taskDescriptionInput(), data.description, 'description');
      await this.selectReactSelectOption('0_31_input_status', data.status);
      await this.selectReactSelectOption('0_32_input_priority', data.priority);
      // Due date — set to 3 days from today
      await this.fillDueDate(3);
      await this.selectReactSelectOption('0_51_input_reminder', data.reminder);
    }
    // WHY: Relation NOT touched — belongs to task owner

    // Custom Fields
    // WHY conditional — see fillDetailedTaskForm()'s identical, more-detailed
    // WHY comment on its own equivalent call site.
    if (!minimal || options?.onlyCustomField) {
      await this.fillTaskCustomFields(data.customFields, options?.onlyCustomField, options?.onlyCustomFieldName);
    }
    logger.success('Edit form filled');
  }

  async fillDueDate(daysFromNow: number): Promise<void> {
    logger.info(`Setting due date to ${daysFromNow} days from now`);
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);

    // WHY: Due date uses a text input with id 0_41_input_dueDate — type date directly
    // Format must match what the app expects: "Jun 12, 2026"
    const formatted = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const dueDateInput = this.page.locator('[id="0_41_input_dueDate"]');
    await dueDateInput.waitFor({ state: 'visible', timeout: 5000 });
    await dueDateInput.click({ clickCount: 3 });
    await dueDateInput.fill(formatted);
    await this.page.keyboard.press('Tab');
    // B6: the committed value is the signal (replaces a 500 ms pause after the blur)
    await this.withSessionExpiryRecovery(() =>
      expect(dueDateInput, `Due date input should hold "${formatted}" after the blur`).toHaveValue(formatted, {
        timeout: config.timeouts.expect,
      })
    );
    logger.success(`Due date set to: ${formatted}`);
  }

  async clearAllRelations(): Promise<void> {
    logger.info('Clearing all relation values from edit form');
    // WHY: Relation rows use a trash icon (fal fa-trash-alt) to delete
    // Keep clicking the first visible trash icon until none remain
    const modal = this.detailedTaskModal();
    const trashButtons = modal.locator('i.fa-trash-alt');
    let attempts = 0;
    while (attempts < 10) {
      const remaining = await trashButtons.count();
      if (remaining === 0) break;
      await trashButtons.first().click();
      // B6: the row is gone when the trash count drops by one (replaces a 300 ms pause per click)
      await this.withSessionExpiryRecovery(() =>
        expect(trashButtons, 'A relation row should be removed after its trash icon is clicked').toHaveCount(
          remaining - 1,
          { timeout: config.timeouts.expect }
        )
      );
      attempts++;
    }
    if ((await trashButtons.count()) > 0) {
      throw new Error('clearAllRelations: relation rows are still present after 10 removals');
    }
    logger.success(`Cleared ${attempts} relation values`);
  }

  async saveEditedTask(): Promise<void> {
    logger.info('Saving edited task');
    // B6 (ADR 0017 save confirmation): the update's own answer (PUT/PATCH /v1/tasks/{id}), armed before the
    // click, fails by name when missing or not 2xx. It used to look only for form errors and the modal closing,
    // so a refused or never-sent save could pass. Then the modal must close.
    const saved = await this.saveAndAwait(() => this.click(this.detailedTaskSaveButton(), 'save button'), {
      method: ['PUT', 'PATCH'],
      urlRe: /^\/v1\/tasks\/\d+\/?$/,
      description: 'Task update (PUT /v1/tasks/{id})',
    });
    await this.assertNoFormErrors('task edit form', saved);
    await this.detailedTaskModal().waitFor({ state: 'hidden', timeout: 15000 });
    logger.success('Task updated');
  }

  // B6 (staging trace 2026-11-17): marking a task complete, from the ellipsis or the detail panel, is
  // PUT /v1/tasks/{id}/complete -> 200. Its answer is armed before the click and awaited (replaces 500 ms pauses
  // that confirmed nothing); callers assert the resulting STATUS afterwards (a completed task may leave the
  // default list, so list visibility proves nothing).
  private async awaitTaskComplete(click: () => Promise<void>): Promise<void> {
    await this.saveAndAwait(click, {
      method: 'PUT',
      urlRe: /^\/v1\/tasks\/\d+\/complete\/?$/,
      description: 'Task mark complete (PUT /v1/tasks/{id}/complete)',
    });
  }

  async markTaskAsComplete(taskId?: number | null): Promise<void> {
    logger.info('Marking task as complete');
    if (taskId) {
      // WHY: Use 3-dot ellipsis on the list item row → Mark as Completed
      const ellipsis = this.listItemEllipsisButton(taskId);
      const ellipsisVisible = await ellipsis.isVisible().catch(() => false);
      if (ellipsisVisible) {
        await ellipsis.click();
        await this.dropdownMenuMarkCompleteOption().waitFor({ state: 'visible', timeout: 5000 });
        await this.awaitTaskComplete(() => this.dropdownMenuMarkCompleteOption().click());
        logger.success('Task marked as complete via list item ellipsis');
        return;
      }
    }
    // Fallback: use the Mark as complete button in the detail panel header
    await this.awaitTaskComplete(() =>
      this.click(this.detailPanelMarkCompleteButton(), 'Mark as complete button')
    );
    logger.success('Task marked as complete via detail panel button');
  }

  // ──────────────────────────────────────────────────────────
  // Filter by Task ID (same pattern as MeetingsPage.searchMeetingById)
  // ──────────────────────────────────────────────────────────

  async searchTaskById(taskId: number): Promise<boolean> {
    // WHY: Navigate directly to ?id=<taskId> — same native URL pattern as meetings.
    // Filter panel approach was unreliable: detail panel intercepts filter button clicks.
    logger.info(`Navigating to task by ID: ${taskId}`);
    await this.navigateTo(`${config.appUrl}/sales/tasks/list?id=${taskId}`);
    await this.waitForListReady();
    // WHY: Use try/catch instead of bare waitFor — if the item is not visible within
    // the timeout (e.g. search index lag), we want assertTaskInList to fall through
    // to the retryFindTask name-search fallback rather than throwing here. Returns
    // the outcome (2026-07-16 fix) so assertTaskInList can rely on this method's own
    // already-robust, auto-retrying wait instead of redundantly re-checking with a
    // weaker one-shot isVisible() snapshot that had no retry of its own.
    try {
      await this.taskListItemById(taskId).waitFor({
        state: 'visible',
        timeout: config.timeouts.navigation,
      });
      logger.success(`Task ID ${taskId} confirmed via direct URL navigation`);
      return true;
    } catch {
      logger.warn(
        `Task ID ${taskId} not visible via direct URL — assertTaskInList will fall back to name search`
      );
      return false;
    }
  }

  // WHY the optional `onlyField` param (2026-09-23, Form Field Limit
  // feature, Task rollout — reusing the exact reusable architecture proven
  // for Lead/Contact/Company, see docs/known-issues/form-fields.md
  // §5): the pre-existing per-field truthy checks below (`if (cf.textField)`
  // etc.) already made Text/Paragraph/Number/URL safely skippable via an
  // empty-string override, but Checkbox/Date/DateTimePicker/PickList had NO
  // such guard at all (a boolean/Date is never falsy from
  // generateTaskCustomFieldData()'s own random defaults, and PickList was
  // unconditional) — meaning every call, even with a "mostly blank" data
  // object, still touched all 4 of those fields regardless of what the
  // caller actually wanted. Harmless for THIS feature specifically (it only
  // ever configures constraints on Text/Number/Paragraph, never on
  // Checkbox/PickList/Date/DateTimePicker), but inconsistent with the
  // explicit, uniform `wants(onlyField)` gating every other entity in this
  // feature already uses — replaced here for the same clarity and
  // maintainability, not because the old shape was unsafe for this
  // specific feature's own scope.
  // WHY the optional `fieldNameOverride` param (2026-09-28, Form Field Limit
  // feature's cross-shard-collision fix — see TASK_FORM_FIELD_LIMIT_NAMES's
  // own comment in taskFactory.ts for the full incident): lets a caller fill
  // the ONE field `onlyField` selects using a DIFFERENT real internal name
  // than TASK_CUSTOM_FIELD_NAMES's own hardcoded value below, without
  // touching that shared constant (still used, unchanged, by every other
  // Task test). Every existing caller omits this and gets byte-for-byte the
  // original behavior.
  private async fillTaskCustomFields(
    cf: TaskCustomFieldData,
    onlyField?: TaskCustomFieldKey,
    fieldNameOverride?: string
  ): Promise<void> {
    logger.info('Filling Task custom fields');
    const wants = (key: TaskCustomFieldKey): boolean => onlyField === undefined || onlyField === key;

    // WHY 'legacy' (default, no suffixStyle passed) — CORRECTED 2026-08-06,
    // real evidence contradicts the previous claim below. Live DOM inspection
    // of the actual Detailed Task create form on staging (after custom
    // fields were added there) showed every field id as
    // "1_11_input_customFieldValues.cfTextField" etc. — the "customFieldValues."
    // segment IS present, matching Lead/Deal/Contact/Company/Quotation, NOT
    // Meeting/Call Log's shorter convention. The previous comment ("Task uses
    // 'plain' suffix convention... matching Meeting/Call Log, confirmed live
    // 2026-08-01") was never actually true for Task — it silently caused every
    // Task custom field to be reported "not found" on every environment,
    // including QA, from that date onward (see the dedicated re-verification
    // this correction was based on for whether QA was actually affected too).

    // TextField
    if (wants('textField') && cf.textField) {
      await this.fillTextLikeCustomField(fieldNameOverride ?? TASK_CUSTOM_FIELD_NAMES.textField, cf.textField, 'Task custom field: textField');
    }

    // ParagraphText
    if (wants('paragraphText') && cf.paragraphText) {
      await this.fillTextLikeCustomField(fieldNameOverride ?? TASK_CUSTOM_FIELD_NAMES.paragraphText, cf.paragraphText, 'Task custom field: paragraphText');
    }

    // Number
    if (wants('number') && cf.number !== undefined) {
      await this.fillTextLikeCustomField(fieldNameOverride ?? TASK_CUSTOM_FIELD_NAMES.number, String(cf.number), 'Task custom field: number');
    }

    // PickList
    if (wants('pickList')) {
      const pickListSelected = await this.selectPicklistCustomField(TASK_CUSTOM_FIELD_NAMES.pickList, 'Task custom field: pickList');
      if (pickListSelected) {
        cf.pickList = pickListSelected;
      }
    }

    // Checkbox
    if (wants('checkbox') && cf.checkbox !== undefined) {
      await this.setCheckboxCustomField(TASK_CUSTOM_FIELD_NAMES.checkbox, cf.checkbox, 'Task custom field: checkbox');
    }

    // Date
    if (wants('date') && cf.date) {
      await this.selectDateCustomField(TASK_CUSTOM_FIELD_NAMES.date, cf.date, 'Task custom field: date');
    }

    // DateTimePicker
    if (wants('dateTimePicker') && cf.dateTimePicker) {
      await this.selectDateTimeCustomField(TASK_CUSTOM_FIELD_NAMES.dateTimePicker, cf.dateTimePicker, 'Task custom field: dateTimePicker');
    }

    // URLField
    if (wants('urlField') && cf.urlField) {
      await this.fillTextLikeCustomField(TASK_CUSTOM_FIELD_NAMES.urlField, cf.urlField, 'Task custom field: urlField');
    }

    // WHY document.activeElement.blur() here, NOT a Tab keypress — mirrors
    // LeadsPage.fillLeadCustomFields()'s/ContactsPage.fillContactCustomFields()'s/
    // CompaniesPage.fillCompanyCustomFields()'s identical, incident-driven
    // fix (docs/known-issues/form-fields.md).
    if (onlyField !== undefined) {
      await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    }

    logger.success('Task custom fields filled');
  }

  async assertTaskCustomFieldsOnDetail(cf: TaskCustomFieldData): Promise<void> {
    logger.info('Asserting Task custom fields on detail page');

    // WHY: Click "Other Details" tab first — custom fields only exist in DOM when tab is active
    // Same pattern as Call Log/Meeting detail pages (all are tabbed with custom fields under "Other Details")
    const tab = this.page.locator('a.nav-item.nav-link, a.nav-link').filter({ hasText: 'Other Details' });
    const tabVisible = await tab.count() > 0;
    if (tabVisible) {
      await this.withSessionExpiryRecovery(() =>
        expect(tab, '"Other Details" tab should be visible').toBeVisible({ timeout: 5000 })
      );
      await this.withSessionExpiryRecovery(() =>
        this.click(tab.first(), '"Other Details" tab')
      );
      // WHY: Wait for the tab content to render. Custom fields appear under
      // "Other Details" tab in a div with role="tabpanel". Same pattern as
      // MeetingsPage.assertMeetingCustomFieldsOnDetail().
      await this.page
        .locator('[role="tabpanel"]')
        .first()
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
    }

    // TextField
    if (cf.textField) {
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.textField, cf.textField);
    }

    // ParagraphText
    if (cf.paragraphText) {
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.paragraphText, cf.paragraphText);
    }

    // Number
    if (cf.number !== undefined) {
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.number, String(cf.number));
    }

    // PickList
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.pickList, cf.pickList);
    }

    // Checkbox
    if (cf.checkbox !== undefined) {
      const checkboxText = cf.checkbox ? 'Yes' : 'No';
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.checkbox, checkboxText);
    }

    // Date
    if (cf.date) {
      const formattedDate = this.formatCustomFieldDetailDate(cf.date);
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.date, formattedDate);
    }

    // DateTimePicker
    if (cf.dateTimePicker) {
      const formattedDateTime = this.formatCustomFieldDetailDateTime(cf.dateTimePicker);
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.dateTimePicker, formattedDateTime);
    }

    // URLField
    if (cf.urlField) {
      await this.assertCustomFieldOnDetail(TASK_CUSTOM_FIELD_NAMES.urlField, cf.urlField);
    }

    logger.success('Task custom fields verified on detail page');
  }

  async skipIfCustomFieldsAbsent(): Promise<void> {
    // WHY 'legacy' (default, no suffixStyle passed) — CORRECTED 2026-08-06, see
    // the matching WHY comment on fillTaskCustomFields() above for the live
    // DOM evidence. Gracefully calls test.skip() if genuinely absent in this
    // environment, matching Lead/Deal/Contact/Company/Quotation's pattern —
    // NOT Meeting/Call Log, which really do use the shorter 'plain' convention.
    await this.skipDedicatedCustomFieldTestIfAbsent(Object.values(TASK_CUSTOM_FIELD_NAMES), 'Task');
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnTasksListPage(): Promise<void> {
    await this.assertUrl(/\/sales\/tasks\/list/);
    await this.withSessionExpiryRecovery(() =>
      expect(this.taskList()).toBeVisible({ timeout: config.timeouts.navigation })
    );
    logger.success('Confirmed on Tasks List page');
  }

  async assertTaskInList(name: string, taskId?: number | null): Promise<void> {
    if (taskId) {
      logger.info(`Verifying task via ID filter: ${taskId}`);
      // WHY: Use ID filter to bypass smartlist (My Tasks / My Open Tasks etc)
      // Smartlists filter by owner/due date and hide newly created tasks
      // ID filter always finds the task regardless of smartlist state.
      //
      // WHY relying on searchTaskById()'s own return value (2026-07-16 fix):
      // this used to ignore that method's result and re-check with its own
      // one-shot isVisible().catch(() => false) — a single, non-retrying
      // snapshot layered UNDER an already-robust, auto-retrying waitFor()
      // inside searchTaskById() itself. That made the real wait pointless:
      // by the time the immediate re-check ran, a still-loading row would
      // read as "not visible" and fall back to name-search even though the
      // primary ID path would have found it moments later. Using the
      // already-correct boolean directly is the same "primary ID / fallback
      // search" structure as Leads/Companies/Deals/Contacts' ID-direct-nav,
      // just with a query-param list view instead of a standalone detail
      // page since Tasks has no such page.
      const foundById = await this.searchTaskById(taskId);
      if (foundById) {
        logger.success(`Task ID ${taskId} confirmed in list`);
        return;
      }
      logger.warn(`Task ID ${taskId} not visible via filter — falling back to name search`);
    }
    const found = await this.retryFindTask(name);
    expect(found, `Task "${name}" should exist in list`).toBeTruthy();
    logger.success(`Task "${name}" confirmed in list`);
  }

  async assertTaskNotInList(name: string): Promise<void> {
    logger.info(`Validating task absent: "${name}"`);
    await this.goToTasksList();
    // B6: positive control first: the search answered (so the list was queried and rendered) before the
    // absence of the row means anything; a missing search input or answer fails by name
    await this.searchTaskByName(name, 'assertTaskNotInList');
    await this.waitForListReady();
    await this.withSessionExpiryRecovery(() =>
      expect(this.taskListItemByName(name)).toBeHidden({ timeout: 10000 })
    );
    logger.success(`Task absent confirmed: "${name}"`);
  }

  async assertTaskCreated(data: TaskData, taskId?: number | null): Promise<void> {
    await this.assertTaskInList(data.name, taskId);
  }

  async assertTaskUpdated(data: TaskData, taskId?: number | null): Promise<void> {
    await this.assertTaskInList(data.name, taskId);
  }

  async assertEditOptionVisible(): Promise<void> {
    // WHY: Verifies restricted user can edit a task assigned to them
    await this.assertVisible(this.detailPanelEditButton(), 'Edit button in detail panel');
    logger.success('Edit button confirmed visible');
  }

  async assertEditOptionNotVisible(): Promise<void> {
    // WHY: Verifies restricted user cannot edit a task not assigned to them
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailPanelEditButton()).toBeHidden({ timeout: 5000 })
    );
    logger.success('Edit button correctly absent');
  }

  // ──────────────────────────────────────────────────────────
  // Notes
  // ──────────────────────────────────────────────────────────

  async addNoteToTask(noteText: string): Promise<void> {
    logger.info(`Adding note to task: "${noteText}"`);
    // WHY: Note CKEditor initialises only after clicking the notes area
    const notesSection = this.page.locator('.notes-section');
    const noteEditor = notesSection.locator('.ck-editor__editable[role="textbox"]');

    // Click to initialise CKEditor
    await notesSection.click();
    await noteEditor.waitFor({ state: 'visible', timeout: 10000 });
    await noteEditor.click();
    await noteEditor.fill(noteText);

    // WHY: Add button is disabled until text is typed — wait for it to be enabled
    const addBtn = notesSection.locator('button.btn-primary.d-block');
    await expect(addBtn).toBeEnabled({ timeout: 5000 });
    // B6 (staging trace 2026-11-17: the add is POST /v1/notes/relation -> 200): its answer is armed before the
    // click and awaited, replacing a 1 s pause; assertNoteAdded() then proves the text is listed.
    await this.saveAndAwait(() => addBtn.click(), {
      method: 'POST',
      urlRe: /^\/v1\/notes\/relation\/?$/,
      description: 'Task note add (POST /v1/notes/relation)',
    });
    logger.success(`Note added: "${noteText}"`);
  }

  async assertNoteAdded(expectedNoteText: string): Promise<void> {
    logger.info(`Asserting note added with text: "${expectedNoteText}"`);
    // WHY: Click "View Task Notes" to expand the notes section first
    const viewNotesCta = this.page.locator('.view-notes-cta .cursor-pointer').first();
    await viewNotesCta.waitFor({ state: 'visible', timeout: 10000 });
    await viewNotesCta.scrollIntoViewIfNeeded();
    // B6 (staging trace 2026-11-17: expanding the notes loads GET /v1/tasks/{id}/notes): the answer is armed
    // before each click and awaited instead of 1.5 s pauses
    const notesLoaded = (): RegExp => /^\/v1\/tasks\/\d+\/notes\/?$/;
    await this.saveAndAwait(() => viewNotesCta.click(), {
      method: 'GET',
      urlRe: notesLoaded(),
      description: 'Task notes list (GET /v1/tasks/{id}/notes) after expanding',
    });
    // WHY: After expanding, refresh to load latest notes
    const refreshBtn = this.page.locator('.view-notes-cta .fa-sync-alt');
    if (await refreshBtn.isVisible().catch(() => false)) {
      await this.saveAndAwait(() => refreshBtn.click(), {
        method: 'GET',
        urlRe: notesLoaded(),
        description: 'Task notes list (GET /v1/tasks/{id}/notes) after refresh',
      });
    }
    // WHY: Note text is inside iframe srcdoc — read contentDocument to verify exact text
    // This handles cases where multiple notes exist — we find OUR specific note
    const noteIframes = this.page.locator('.note-text-container iframe');
    await noteIframes.first().waitFor({ state: 'attached', timeout: 15000 });
    // B6: poll for OUR note's text across the iframes (a one-shot read after a 500 ms pause could see empty iframes)
    await expect
      .poll(
        async () => {
          const count = await noteIframes.count();
          for (let i = 0; i < count; i++) {
            const text = await noteIframes
              .nth(i)
              .evaluate((el: HTMLIFrameElement) => el.contentDocument?.body?.textContent?.trim() ?? '')
              .catch(() => '');
            if (text.includes(expectedNoteText)) return true;
          }
          return false;
        },
        { timeout: config.timeouts.expect, message: `Note "${expectedNoteText}" should be listed in a note iframe` }
      )
      .toBe(true);
    logger.success(`Note confirmed: "${expectedNoteText}"`);
  }

  // ──────────────────────────────────────────────────────────
  // Ellipsis Menu Actions (list item)
  // ──────────────────────────────────────────────────────────

  async openListItemEllipsis(taskId: number): Promise<void> {
    logger.info(`Opening ellipsis menu for task ${taskId}`);
    const ellipsis = this.page.locator(`li#task_${taskId} button.btn-transparent`);
    await ellipsis.waitFor({ state: 'visible', timeout: 10000 });
    await ellipsis.click();
    await this.page.locator('.dropdown-menu.show').waitFor({ state: 'visible', timeout: 5000 });
    logger.success('Ellipsis menu opened');
  }

  // WHY (2026-09-07, PROD Build #4): previously a raw `.click()` with no
  // wait at all for the item's own visibility (worse than the hardcoded
  // 5000ms found elsewhere — see BasePage.clickDropdownMenuItemBounded()'s
  // own comment) — a textbook "click registers but nothing visibly happens"
  // race (rule 2). `taskId` is now required so a retry can re-open the
  // menu from scratch via openListItemEllipsis(), not just re-wait on a
  // menu that may have already closed.
  async clickEllipsisOption(taskId: number, option: string): Promise<void> {
    logger.info(`Clicking ellipsis option: ${option}`);
    await this.clickDropdownMenuItemBounded(
      () => this.openListItemEllipsis(taskId),
      (text) => this.page.locator('.dropdown-menu.show .dropdown-item', { hasText: text }),
      option,
      'Tasks ellipsis menu'
    );
  }

  async changeDueDateViaEllipsis(taskId: number, daysFromNow: number): Promise<void> {
    logger.info(`Changing due date for task ${taskId} to ${daysFromNow} days from now`);
    await this.clickEllipsisOption(taskId, 'Change Due Date');
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.fillDueDate(daysFromNow);
    // ADR 0016 (B3, plan section 11 #7): await the update's answer, then the modal closing.
    const saved = await this.saveAndAwait(() => this.click(this.detailedTaskSaveButton(), 'save button'), {
      method: ['PUT', 'PATCH'],
      urlRe: new RegExp(`/v1/tasks/${taskId}$`),
      description: `Task due-date update (PUT /v1/tasks/${taskId})`,
    });
    await this.assertNoFormErrors('change due date form', saved);
    await this.detailedTaskModal().waitFor({ state: 'hidden', timeout: 15000 });
    logger.success('Due date changed via ellipsis');
  }

  async markAsCompletedViaEllipsis(taskId: number): Promise<void> {
    logger.info(`Marking task ${taskId} as completed via ellipsis`);
    // B6: the PUT /complete answer is the signal; the old Refresh click + 1.5 s pause is gone (the callers
    // reopen the task by id and read its status, which is a fresh GET)
    await this.awaitTaskComplete(() => this.clickEllipsisOption(taskId, 'Mark as Completed'));
    logger.success('Task marked as completed');
  }

  async cloneTaskViaEllipsis(taskId: number): Promise<number | null> {
    logger.info(`Cloning task ${taskId} via ellipsis`);
    await this.clickEllipsisOption(taskId, 'Clone');
    // WHY: Clone opens modal with title "Clone Task" and name appended with " Copy"
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.taskNameInput().waitFor({ state: 'visible', timeout: 15000 });
    // WHY these two checks (2026-08-09, Task 3 sweep of the deals.rbac.spec.ts:1174
    // sandbox failure's underlying bug class): `#editEntityModal` (here scoped
    // `.tasks`) is a SHARED container reused for Edit/Change-Due-Date/Clone —
    // same architecture as DealsPage's clone modal, which silently proceeded
    // with a wrong/stale modal for 10s before failing with a confusing error.
    // Confirmed live this session (temporary diagnostic, since removed): a
    // genuine Clone flow shows title "Clone Task" and the name field already
    // contains "Copy" synchronously (unlike Deals' async pre-fill) — so this
    // is cheap insurance, not a new source of flakiness. Verifying BOTH before
    // Save is safer than DealsPage's title-only check, since this method
    // (unlike Deals' pre-fix version) previously had NO value check at all —
    // a wrong/stale modal here would have silently cloned with the ORIGINAL
    // name (no "Copy"), producing wrong saved data with zero error.
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailedTaskModal().locator('.modal-title'), 'Clone modal should show "Clone Task" title').toHaveText(
        'Clone Task',
        { timeout: 10000 }
      )
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.taskNameInput(), 'Clone modal Name field should be pre-filled with "Copy"').toHaveValue(
        /Copy/,
        { timeout: 10000 }
      )
    );
    logger.success('Clone Task modal opened');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.detailedTaskSaveButton(), 'save button');
    await this.assertNoFormErrors('clone task form');
    const id = await idPromise;
    // WHY: Confirmed live (2026-07-07) — same fail-fast guard as saveDetailedTask() above.
    if (!id) {
      throw new Error('Cloned task ID not captured after save — cannot proceed (save likely failed silently)');
    }
    await this.detailedTaskModal()
      .waitFor({ state: 'hidden', timeout: 15000 })
      .catch(() => {});
    await this.waitForListReady();
    logger.success(`Cloned task saved (ID: ${id})`);
    return id;
  }

  // B6: the detail panel is open when its status control renders (the same element assertTaskStatusOnDetail
  // reads); replaces fixed pauses after a list-item click in the RBAC specs
  async waitForDetailPanel(): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('#status span.title'), 'The task detail panel should open').toBeVisible({
        timeout: config.timeouts.expect,
      })
    );
  }

  async assertTaskStatusOnDetail(taskId: number, expectedStatus: string): Promise<void> {
    logger.info(`Asserting task ${taskId} status is: ${expectedStatus}`);
    await this.openTaskInDetailPanel('', taskId);
    const statusEl = this.page.locator('#status span.title');
    // B6: auto-retrying assertion instead of a one-shot textContent() read
    await this.withSessionExpiryRecovery(() =>
      expect(statusEl, `Task ${taskId} status should be "${expectedStatus}"`).toContainText(expectedStatus, {
        timeout: config.timeouts.expect,
      })
    );
    logger.success(`Status confirmed: ${expectedStatus}`);
  }

  async assertDeleteOptionNotVisible(taskId: number): Promise<void> {
    logger.info(`Asserting Delete option not visible for task ${taskId}`);
    await this.openListItemEllipsis(taskId);
    const deleteOption = this.page.locator('.dropdown-menu.show .dropdown-item', {
      hasText: 'Delete',
    });
    const visible = await deleteOption.isVisible().catch(() => false);
    if (visible) throw new Error('Delete option should NOT be visible for restricted user');
    await this.page.keyboard.press('Escape');
    logger.success('Delete option correctly absent');
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createQuickTask(data: TaskData): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Creating quick task: "${data.name}"`);
      await this.openQuickTaskForm();
      await this.fillQuickTaskForm(data);
      return await this.saveQuickTask();
    }, 'createQuickTask');
  }

 // WHY the optional `options` param (2026-09-23, Form Field Limit feature):
 // threaded straight through to fillDetailedTaskForm() — see that method's
 // own WHY comment. createDetailedTask()'s own retry/save control flow is
 // completely untouched; only what gets FILLED changes. Every existing
 // caller omits `options` and gets the original behavior.
 async createDetailedTask(
    data: TaskData,
    assignedToName?: string,
    skipRelation = false,
    options?: { minimal?: boolean; onlyCustomField?: TaskCustomFieldKey; onlyCustomFieldName?: string }
  ): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Creating detailed task: "${data.name}"`);
      await this.openDetailedTaskForm();
      await this.fillDetailedTaskForm(data, assignedToName, skipRelation, options);
      try {
        return await this.saveDetailedTask();
      } catch (error) {
        if (!(error instanceof InaccessibleRelationError) || skipRelation) {
          throw error;
        }
        // WHY: a randomly-selected Relation entity (Lead/Deal/Contact/Company)
        // was inaccessible to this user — same root cause as quotations'
        // "Invalid company" flake, different API error shape (007043
        // "<entity>.not.found"). No confirmed per-chip removal for the
        // Relation field, so retry the whole form once with relation skipped
        // entirely rather than guessing at DOM chip-removal.
        logger.warn(
          `Save failed due to inaccessible relation entity ("${error.message}") — ` +
            `retrying without relation`
        );
        await this.detailedTaskModal()
          .waitFor({ state: 'hidden', timeout: 5000 })
          .catch(() => {});
        await this.openDetailedTaskForm();
        await this.fillDetailedTaskForm(data, assignedToName, true, options);
        return await this.saveDetailedTask();
      }
    }, 'createDetailedTask');
  }
  async createQuickTaskThenSwitchToDetailed(data: TaskData): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Creating task via Quick → Detailed toggle: "${data.name}"`);
      await this.openQuickTaskForm();
      await this.switchQuickFormToDetailed();
      await this.fillDetailedTaskForm(data);
      return await this.saveDetailedTask();
    }, 'createQuickTaskThenSwitchToDetailed');
  }

  async updateTask(newData: TaskData, originalName: string, taskId?: number | null): Promise<void> {
    await this.withSessionExpiryRetry(async () => {
      logger.info(`Updating task "${originalName}" → "${newData.name}"`);
      await this.openTaskInDetailPanel(originalName, taskId);
      await this.clickEditButtonInDetailPanel();
      await this.fillEditForm(newData);
      await this.saveEditedTask();
      logger.success(`Task updated to "${newData.name}"`);
    }, 'updateTask');
  }
}
