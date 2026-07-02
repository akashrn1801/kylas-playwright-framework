import { Page, Response, expect } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { logger } from '@utils/logger';
import { config } from '@config/config';
import { TaskData } from '@data/factories/taskFactory';

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
  async waitForTaskDetailsPage(): Promise<void> {
    await this.page.waitForURL(/sales\/tasks\/list\?.*id=/, { timeout: 20000 });
    await this.page.waitForLoadState('domcontentloaded');
    await this.page
      .waitForResponse(
        (res) => res.url().match(/\/v1\/tasks\/\d+$/) !== null && res.request().method() === 'GET',
        { timeout: 15000 }
      )
      .catch(() => null);
  }

  async goToTaskDetailsById(id: string | number): Promise<void> {
    logger.info(`Navigating to task details: ${id}`);
    await this.navigateTo(`${config.appUrl}/sales/tasks/list?id=${id}`);
    await this.waitForTaskDetailsPage();
  }

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
      const response = await this.page.waitForResponse(
        (res: Response) =>
          res.url().includes('/v1/tasks') &&
          res.request().method() === 'POST' &&
          res.status() === 200,
        { timeout: config.timeouts.navigation }
      );
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
    await control.click();
    await this.page.waitForTimeout(300);
    const option = this.page.locator('.is-invalid__option', { hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    logger.success(`Selected "${optionText}" for ${inputId}`);
  }

  private async retryFindTask(name: string): Promise<boolean> {
    const { retries, wait } = this.retryConfig;
    for (let attempt = 1; attempt <= retries; attempt++) {
      logger.info(`Looking for task "${name}" — attempt ${attempt}/${retries}`);
      await this.navigateTo(`${config.appUrl}/sales/tasks/list`);
      await this.waitForListReady();

      // WHY: Wrap name in double quotes for exact match search —
      // prevents partial matches and returns only the specific task.
      // Confirmed from DOM: #fulltext-search with quoted input returns exact results.
      const searchVisible = await this.taskSearchInput()
        .isVisible()
        .catch(() => false);
      if (searchVisible) {
        await this.taskSearchInput().fill(`"${name}"`);
        // WHY: Press Enter to trigger search — the input does not auto-search on type
        await this.taskSearchInput().press('Enter');
        // WHY: Wait for the API response after search is triggered
        await this.page
          .waitForResponse(
            (res) => res.url().includes('/v1/tasks') && res.request().method() === 'GET',
            { timeout: 10000 }
          )
          .catch(() => null);
        await this.page.waitForTimeout(500);
      }

      const found = await this.taskListItemByName(name)
        .isVisible()
        .catch(() => false);
      if (found) {
        logger.success(`Task "${name}" found via quoted search`);
        return true;
      }
      if (attempt < retries) await this.page.waitForTimeout(wait);
    }
    logger.warn(`Task "${name}" not found after ${retries} attempts`);
    return false;
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

  private async openFilterPanel(): Promise<void> {
    logger.info('Opening filter panel');
    const alreadyOpen = await this.page
      .locator('#filterModal')
      .evaluate((el) => el.classList.contains('show'))
      .catch(() => false);
    if (alreadyOpen) return;

    // WHY: Same pattern as MeetingsPage — retry up to 3 times on CI
    let opened = false;
    for (let i = 0; i < 3; i++) {
      // WHY: Use #filter-action button ID — reliable selector confirmed from DOM
      const filterBtn = this.page.locator('#filter-action');
      await filterBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      await filterBtn.click({ force: true });

      try {
        await this.page.locator('#filterModal').waitFor({ state: 'visible', timeout: 10000 });
        opened = true;
        break;
      } catch {
        logger.warn(`Filter panel did not open on attempt ${i + 1}`);
        await this.page.waitForTimeout(1000);
      }
    }
    if (!opened) throw new Error('Filter panel did not open after 3 attempts');
    await this.page.waitForTimeout(500);
    logger.success('Filter panel opened');
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
    await this.click(this.addDropdownToggle(), 'add dropdown toggle');
    await this.addQuickTaskOption().waitFor({ state: 'visible', timeout: 5000 });
    await this.addQuickTaskOption().click();
    await this.quickTaskCard().waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Wait for CKEditor to initialise before interacting with it
    await this.quickTaskDescriptionEditor().waitFor({ state: 'visible', timeout: 10000 });
    logger.success('Quick Task form opened');
  }

  async fillQuickTaskForm(data: TaskData): Promise<void> {
    logger.info(`Filling Quick Task form: "${data.name}"`);

    // Due date — click calendar button, select "Tomorrow" from quick options
    logger.info('Setting due date to Tomorrow');
    await this.click(this.quickTaskDateButton(), 'calendar button');
    await this.page.waitForTimeout(500);
    const tomorrowOption = this.page.locator('.duedate-dropdown-options .dropdown-option', {
      hasText: 'Tomorrow',
    });
    try {
      await tomorrowOption.waitFor({ state: 'visible', timeout: 3000 });
      await tomorrowOption.click();
      logger.success('Due date set to Tomorrow');
    } catch {
      logger.warn('Tomorrow option not found — using default');
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(300);

    // Assigned To — click button, wait for dropdown, pick random user
    logger.info('Setting Assigned To');
    await this.click(this.quickTaskAssignedToButton(), 'assigned to button');
    await this.page.waitForTimeout(1000);
    // WHY: Assigned To uses .assigned-to-menu-list with .is-invalid__option items
    try {
      const assignedToOptions = this.page.locator('.assigned-to-menu-list .is-invalid__option');
      await assignedToOptions.first().waitFor({ state: 'visible', timeout: 5000 });
      const count = await assignedToOptions.count();
      const idx = Math.floor(Math.random() * count);
      const selectedUser = await assignedToOptions.nth(idx).textContent();
      await assignedToOptions.nth(idx).click();
      logger.success(`Assigned To set: ${selectedUser?.trim()}`);
    } catch {
      logger.warn('Assigned To options not found — skipping');
      await this.page.keyboard.press('Escape');
    }
    await this.page.waitForTimeout(300);

    // Priority — hover then click to open dropdown options
    logger.info(`Setting priority: ${data.priority}`);
    const priorityBtn = this.quickTaskPriorityButton();
    await priorityBtn.hover();
    await this.page.waitForTimeout(500);
    // WHY: Priority dropdown appears on hover — .priority-dropdown-options with .dropdown-option items
    const priorityContainer = this.page.locator('.priority-dropdown-options');
    try {
      await priorityContainer.waitFor({ state: 'visible', timeout: 5000 });
      await priorityContainer.locator('.dropdown-option', { hasText: data.priority }).click();
      logger.success(`Priority set: ${data.priority}`);
    } catch {
      // Fallback: try clicking the button first then select
      await priorityBtn.click();
      await this.page.waitForTimeout(500);
      try {
        await priorityContainer.waitFor({ state: 'visible', timeout: 3000 });
        await priorityContainer.locator('.dropdown-option', { hasText: data.priority }).click();
        logger.success(`Priority set via click fallback: ${data.priority}`);
      } catch {
        logger.warn(`Priority option not found — skipping`);
      }
    }
    await this.page.waitForTimeout(300);

    // Description / task name via CKEditor
    logger.info('Filling task description (becomes task name in list)');
    const editor = this.quickTaskDescriptionEditor();
    await editor.waitFor({ state: 'visible', timeout: 10000 });
    await editor.click();
    await editor.fill(data.name);
    logger.success('Quick task form filled');
  }

  async saveQuickTask(): Promise<number | null> {
    logger.info('Saving Quick Task');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.quickTaskAddButton(), 'Add Task button');
    const id = await idPromise;
    // WHY: Quick task form closes after save — stays on same /sales/tasks/list URL
    await this.quickTaskBackdrop()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await this.waitForListReady();
    logger.success(`Quick task saved (ID: ${id})`);
    return id;
  }

  async saveQuickTaskFromEntityDetail(): Promise<number | null> {
    logger.info('Saving Quick Task from entity detail page');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.quickTaskAddButton(), 'Add Task button');
    const id = await idPromise;
    // WHY: When saving from entity detail page — no list to wait for
    await this.quickTaskBackdrop()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await this.page.waitForTimeout(1000);
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
    // WHY: Retry up to 3 times — parallel workers can cause dropdown to close prematurely
    let formOpened = false;
    for (let i = 0; i < 3; i++) {
      await this.click(this.addDropdownToggle(), 'add dropdown toggle');
      await this.addDetailedTaskOption()
        .waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => {});
      const optionVisible = await this.addDetailedTaskOption()
        .isVisible()
        .catch(() => false);
      if (!optionVisible) {
        logger.warn(`Detailed task option not visible on attempt ${i + 1} — retrying`);
        await this.page.waitForTimeout(1000);
        continue;
      }
      await this.addDetailedTaskOption().click();
      await this.detailedTaskModal()
        .waitFor({ state: 'visible', timeout: 10000 })
        .catch(() => {});
      const modalVisible = await this.detailedTaskModal()
        .isVisible()
        .catch(() => false);
      if (!modalVisible) {
        logger.warn(`Detailed task modal not visible on attempt ${i + 1} — retrying`);
        await this.page.waitForTimeout(1000);
        continue;
      }
      try {
        // WHY: Skeleton loader shows first — wait for actual name input to be ready
        await this.taskNameInput().waitFor({ state: 'visible', timeout: 15000 });
        formOpened = true;
        break;
      } catch {
        logger.warn(`Task name input not visible on attempt ${i + 1} — retrying`);
        await this.page.waitForTimeout(1000);
      }
    }
    if (!formOpened) throw new Error('Detailed Task form did not open after 3 attempts');
    logger.success('Detailed Task form opened');
  }

  async fillDetailedTaskForm(
    data: TaskData,
    assignedToName?: string,
    skipRelation = false
  ): Promise<void> {
    logger.info(`Filling Detailed Task form: "${data.name}"`);

    // Task Name (required)
    await this.fill(this.taskNameInput(), data.name, 'task name');

    // Type
    await this.selectReactSelectOption('0_12_input_type', data.type);

    // Description
    await this.fill(this.taskDescriptionInput(), data.description, 'description');

    // Status
    await this.selectReactSelectOption('0_31_input_status', data.status);

    // Priority
    await this.selectReactSelectOption('0_32_input_priority', data.priority);

    // Due Date — leave default (pre-filled as tomorrow)
    logger.info('Due date left as default (tomorrow)');

    // Reminder
    await this.selectReactSelectOption('0_51_input_reminder', data.reminder);

    // Assigned To (optional — used in RBAC tests to assign to restricted user)
    if (assignedToName) {
      await this.fillAssignedTo(assignedToName);
    }

    // Relation — add one entity of each type (Lead, Deal, Contact, Company)
    // WHY: Same pattern as MeetingsPage.fillRelatedTo — search each entity type
    // and pick a random result
    if (!skipRelation) {
      await this.fillRelation();
    } else {
      logger.info('Skipping relation — skipRelation=true');
    }

    logger.success('Detailed Task form filled');
  }

  async fillAssignedTo(userName: string): Promise<void> {
    logger.info(`Assigning task to: ${userName}`);
    const input = this.taskAssignedToInput();
    const control = input.locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
    await control.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Click control to open dropdown — default options load immediately (only 2 users)
    // Do NOT type — typing triggers API search which returns No Options for short names
    await control.click();
    // WHY: Increased wait — staging env loads dropdown options slower than QA
    await this.page.waitForTimeout(1500);
    // WHY: Try both .is-invalid__option and generic react-select option selectors
    // as the class name may differ between environments
    let option = this.page.locator('.is-invalid__option').filter({ hasText: userName }).first();
    const isVisible = await option.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      logger.warn(`'.is-invalid__option' not found — trying generic react-select option`);
      option = this.page.locator('[class*="__option"]').filter({ hasText: userName }).first();
    }
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    logger.success(`Assigned to: ${userName}`);
  }

  async fillRelation(): Promise<void> {
    logger.info('Filling Relation field — all entity types');
    const entityTypes = ['Lead', 'Deal', 'Contact', 'Company'];

    for (const entityType of entityTypes) {
      logger.info(`Selecting relation entity type: ${entityType}`);

      // Step 1: Click the entity type dropdown (relation type selector)
      const relationTypeControl = this.taskRelationTypeInput().locator(
        'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
      );
      await relationTypeControl.click();
      await this.page.waitForTimeout(400);

      // Select entity type
      // WHY: getByText resolves to multiple elements — use dropdown option selector specifically
      await this.page
        .locator('.is-invalid__option, .is-invalid__option--is-focused')
        .filter({ hasText: new RegExp('^' + entityType + '$') })
        .first()
        .click();
      await this.page.waitForTimeout(500);

      // Step 2: Click the entity search dropdown and search
      // WHY: After selecting entity type, a search dropdown appears — same as meetings
      const searchControl = this.page
        .locator('div')
        .filter({ hasText: /^Search \.\.\.$/ })
        .last();
      const searchVisible = await searchControl.isVisible().catch(() => false);
      if (searchVisible) await searchControl.click();
      await this.page.waitForTimeout(400);

      // Step 3: Type spaces to load first results, then try search terms on failure
      const entitySearchInput = this.taskRelationTypeInput();
      await entitySearchInput.fill('   ');
      await this.page.waitForTimeout(1500);

      const options = this.page.locator('.is-invalid__option');
      let hasOptions = await options
        .first()
        .isVisible()
        .catch(() => false);

      if (!hasOptions) {
        for (const term of ['a', 'e', 'the', 'inc', 'co']) {
          await entitySearchInput.fill(term);
          await this.page.waitForTimeout(1000);
          hasOptions = await options
            .first()
            .isVisible()
            .catch(() => false);
          if (hasOptions) {
            logger.info(`Found ${entityType} results with term: "${term}"`);
            break;
          }
          await entitySearchInput.clear();
        }
      }

      // Step 4: Pick a random option
      const count = await options.count().catch(() => 0);
      if (count > 0) {
        const idx = Math.floor(Math.random() * Math.min(count, 5));
        const optionText = await options.nth(idx).textContent();
        await options.nth(idx).click();
        await this.page.waitForTimeout(300);
        logger.success(`Selected ${entityType} relation: ${optionText?.trim()}`);
      } else {
        logger.warn(`No ${entityType} records found — skipping`);
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(600);
    }
  }

  async saveDetailedTask(): Promise<number | null> {
    logger.info('Saving Detailed Task');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.detailedTaskSaveButton(), 'save button');
    await this.assertNoFormErrors('task create form');
    const id = await idPromise;
    // WHY: Modal closes on successful save — wait for it to hide
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
    // WHY: Row click doesn't always navigate (panel can open in-place), so we
    // wait for the task GET response directly instead of a URL change —
    // confirms the panel's data actually loaded, not just that time passed.
    if (taskId) {
      const itemById = this.taskListItemById(taskId);
      const visible = await itemById.isVisible().catch(() => false);
      if (visible) {
        await itemById.click();
        await this.page
          .waitForResponse(
            (res) => res.url().match(/\/v1\/tasks\/\d+$/) !== null && res.request().method() === 'GET',
            { timeout: 10000 }
          )
          .catch(() => null);
        logger.success(`Task ${taskId} opened via ID`);
        return;
      }
    }
    // Fallback to name
    await this.taskListItemByName(name).click();
    await this.page
      .waitForResponse(
        (res) => res.url().match(/\/v1\/tasks\/\d+$/) !== null && res.request().method() === 'GET',
        { timeout: 10000 }
      )
      .catch(() => null);
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

  async fillEditForm(data: TaskData): Promise<void> {
    logger.info('Filling edit form');
    await this.fill(this.taskNameInput(), data.name, 'task name');
    await this.selectReactSelectOption('0_12_input_type', data.type);
    await this.fill(this.taskDescriptionInput(), data.description, 'description');
    await this.selectReactSelectOption('0_31_input_status', data.status);
    await this.selectReactSelectOption('0_32_input_priority', data.priority);
    // Due date — set to 3 days from today
    await this.fillDueDate(3);
    await this.selectReactSelectOption('0_51_input_reminder', data.reminder);
    // WHY: Relation NOT touched — belongs to task owner
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
    await this.page.waitForTimeout(500);
    logger.success(`Due date set to: ${formatted}`);
  }

  async clearAllRelations(): Promise<void> {
    logger.info('Clearing all relation values from edit form');
    // WHY: Relation rows use a trash icon (fal fa-trash-alt) to delete
    // Keep clicking the first visible trash icon until none remain
    const modal = this.detailedTaskModal();
    let attempts = 0;
    while (attempts < 10) {
      const trashBtn = modal.locator('i.fa-trash-alt').first();
      const visible = await trashBtn.isVisible().catch(() => false);
      if (!visible) break;
      await trashBtn.click();
      await this.page.waitForTimeout(300);
      attempts++;
    }
    logger.success(`Cleared ${attempts} relation values`);
  }

  async saveEditedTask(): Promise<void> {
    logger.info('Saving edited task');
    await this.click(this.detailedTaskSaveButton(), 'save button');
    await this.assertNoFormErrors('task edit form');
    await this.detailedTaskModal().waitFor({ state: 'hidden', timeout: 15000 });
    logger.success('Task updated');
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
        await this.dropdownMenuMarkCompleteOption().click();
        await this.page.waitForTimeout(500);
        logger.success('Task marked as complete via list item ellipsis');
        return;
      }
    }
    // Fallback: use the Mark as complete button in the detail panel header
    await this.click(this.detailPanelMarkCompleteButton(), 'Mark as complete button');
    await this.page.waitForTimeout(500);
    logger.success('Task marked as complete via detail panel button');
  }

  // ──────────────────────────────────────────────────────────
  // Filter by Task ID (same pattern as MeetingsPage.searchMeetingById)
  // ──────────────────────────────────────────────────────────

  async searchTaskById(taskId: number): Promise<void> {
    // WHY: Navigate directly to ?id=<taskId> — same native URL pattern as meetings.
    // Filter panel approach was unreliable: detail panel intercepts filter button clicks.
    logger.info(`Navigating to task by ID: ${taskId}`);
    await this.navigateTo(`${config.appUrl}/sales/tasks/list?id=${taskId}`);
    await this.waitForListReady();
    // WHY: Use try/catch instead of bare waitFor — if the item is not visible within
    // the timeout (e.g. search index lag), we want assertTaskInList to fall through
    // to the retryFindTask name-search fallback rather than throwing here.
    try {
      await this.taskListItemById(taskId).waitFor({
        state: 'visible',
        timeout: config.timeouts.navigation,
      });
      logger.success(`Task ID ${taskId} confirmed via direct URL navigation`);
    } catch {
      logger.warn(
        `Task ID ${taskId} not visible via direct URL — assertTaskInList will fall back to name search`
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnTasksListPage(): Promise<void> {
    await this.assertUrl(/\/sales\/tasks\/list/);
    await expect(this.taskList()).toBeVisible({ timeout: config.timeouts.navigation });
    logger.success('Confirmed on Tasks List page');
  }

  async assertTaskInList(name: string, taskId?: number | null): Promise<void> {
    if (taskId) {
      logger.info(`Verifying task via ID filter: ${taskId}`);
      // WHY: Use ID filter to bypass smartlist (My Tasks / My Open Tasks etc)
      // Smartlists filter by owner/due date and hide newly created tasks
      // ID filter always finds the task regardless of smartlist state
      await this.searchTaskById(taskId);
      const itemById = this.taskListItemById(taskId);
      const visibleById = await itemById.isVisible().catch(() => false);
      if (visibleById) {
        logger.success(`Task ID ${taskId} confirmed in list`);
        return;
      }
      logger.warn(`Task ID ${taskId} not visible via filter — falling back to name search`);
    }
    const found = await this.retryFindTask(name);
    expect(found).toBeTruthy();
    logger.success(`Task "${name}" confirmed in list`);
  }

  async assertTaskNotInList(name: string): Promise<void> {
    logger.info(`Validating task absent: "${name}"`);
    await this.goToTasksList();
    const searchVisible = await this.taskSearchInput()
      .isVisible()
      .catch(() => false);
    if (searchVisible) {
      // WHY: Quoted search returns exact matches only — if task is absent,
      // list will be empty. More reliable than unquoted partial search.
      await this.taskSearchInput().fill(`"${name}"`);
      // WHY: Press Enter to trigger search
      await this.taskSearchInput().press('Enter');
      await this.page
        .waitForResponse(
          (res) => res.url().includes('/v1/tasks') && res.request().method() === 'GET',
          { timeout: 10000 }
        )
        .catch(() => null);
      await this.page.waitForTimeout(500);
    }
    await expect(this.taskListItemByName(name)).toBeHidden({ timeout: 10000 });
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
    await expect(this.detailPanelEditButton()).toBeHidden({ timeout: 5000 });
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
    await this.page.waitForTimeout(300);

    // WHY: Add button is disabled until text is typed — wait for it to be enabled
    const addBtn = notesSection.locator('button.btn-primary.d-block');
    await expect(addBtn).toBeEnabled({ timeout: 5000 });
    await addBtn.click();
    await this.page.waitForTimeout(1000);
    logger.success(`Note added: "${noteText}"`);
  }

  async assertNoteAdded(expectedNoteText: string): Promise<void> {
    logger.info(`Asserting note added with text: "${expectedNoteText}"`);
    // WHY: Click "View Task Notes" to expand the notes section first
    const viewNotesCta = this.page.locator('.view-notes-cta .cursor-pointer').first();
    await viewNotesCta.waitFor({ state: 'visible', timeout: 10000 });
    await viewNotesCta.scrollIntoViewIfNeeded();
    await viewNotesCta.click();
    await this.page.waitForTimeout(1500);
    // WHY: After expanding, refresh to load latest notes
    const refreshBtn = this.page.locator('.view-notes-cta .fa-sync-alt');
    const refreshVisible = await refreshBtn.isVisible().catch(() => false);
    if (refreshVisible) {
      await refreshBtn.click();
      await this.page.waitForTimeout(1500);
    }
    // WHY: Note text is inside iframe srcdoc — read contentDocument to verify exact text
    // This handles cases where multiple notes exist — we find OUR specific note
    const noteIframes = this.page.locator('.note-text-container iframe');
    await noteIframes.first().waitFor({ state: 'attached', timeout: 15000 });
    await this.page.waitForTimeout(500);
    const count = await noteIframes.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const iframe = noteIframes.nth(i);
      const noteText = await iframe.evaluate((el: any) => {
        return el.contentDocument?.body?.textContent?.trim() ?? '';
      });
      logger.info(`Note ${i} text: "${noteText}"`);
      if (noteText.includes(expectedNoteText)) {
        found = true;
        logger.success(`Note confirmed: "${noteText}"`);
        break;
      }
    }
    if (!found) throw new Error(`Note "${expectedNoteText}" not found in any note iframe`);
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

  async clickEllipsisOption(option: string): Promise<void> {
    logger.info(`Clicking ellipsis option: ${option}`);
    await this.page.locator('.dropdown-menu.show .dropdown-item', { hasText: option }).click();
    await this.page.waitForTimeout(500);
    logger.success(`Clicked: ${option}`);
  }

  async changeDueDateViaEllipsis(taskId: number, daysFromNow: number): Promise<void> {
    logger.info(`Changing due date for task ${taskId} to ${daysFromNow} days from now`);
    await this.openListItemEllipsis(taskId);
    await this.clickEllipsisOption('Change Due Date');
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.fillDueDate(daysFromNow);
    await this.click(this.detailedTaskSaveButton(), 'save button');
    await this.assertNoFormErrors('change due date form');
    await this.detailedTaskModal().waitFor({ state: 'hidden', timeout: 15000 });
    logger.success('Due date changed via ellipsis');
  }

  async markAsCompletedViaEllipsis(taskId: number): Promise<void> {
    logger.info(`Marking task ${taskId} as completed via ellipsis`);
    await this.openListItemEllipsis(taskId);
    await this.clickEllipsisOption('Mark as Completed');
    // WHY: Refresh the list after marking complete to update status
    await this.page.locator('button[data-original-title="Refresh"]').click();
    await this.page.waitForTimeout(1500);
    await this.waitForListReady();
    logger.success('Task marked as completed and list refreshed');
  }

  async cloneTaskViaEllipsis(taskId: number): Promise<number | null> {
    logger.info(`Cloning task ${taskId} via ellipsis`);
    await this.openListItemEllipsis(taskId);
    await this.clickEllipsisOption('Clone');
    // WHY: Clone opens modal with title "Clone Task" and name appended with " Copy"
    await this.detailedTaskModal().waitFor({ state: 'visible', timeout: 10000 });
    await this.taskNameInput().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Clone Task modal opened');
    const idPromise = this.captureIdFromResponse();
    await this.click(this.detailedTaskSaveButton(), 'save button');
    await this.assertNoFormErrors('clone task form');
    const id = await idPromise;
    await this.detailedTaskModal()
      .waitFor({ state: 'hidden', timeout: 15000 })
      .catch(() => {});
    await this.waitForListReady();
    logger.success(`Cloned task saved (ID: ${id})`);
    return id;
  }

  async assertTaskStatusOnDetail(taskId: number, expectedStatus: string): Promise<void> {
    logger.info(`Asserting task ${taskId} status is: ${expectedStatus}`);
    await this.openTaskInDetailPanel('', taskId);
    const statusEl = this.page.locator('#status span.title');
    await statusEl.waitFor({ state: 'visible', timeout: 10000 });
    const statusText = await statusEl.textContent();
    if (!statusText?.includes(expectedStatus)) {
      throw new Error(`Expected status "${expectedStatus}" but got "${statusText}"`);
    }
    logger.success(`Status confirmed: ${statusText}`);
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
    logger.info(`Creating quick task: "${data.name}"`);
    await this.openQuickTaskForm();
    await this.fillQuickTaskForm(data);
    return await this.saveQuickTask();
  }

  async createDetailedTask(
    data: TaskData,
    assignedToName?: string,
    skipRelation = false
  ): Promise<number | null> {
    logger.info(`Creating detailed task: "${data.name}"`);
    await this.openDetailedTaskForm();
    await this.fillDetailedTaskForm(data, assignedToName, skipRelation);
    return await this.saveDetailedTask();
  }

  async createQuickTaskThenSwitchToDetailed(data: TaskData): Promise<number | null> {
    logger.info(`Creating task via Quick → Detailed toggle: "${data.name}"`);
    await this.openQuickTaskForm();
    await this.switchQuickFormToDetailed();
    await this.fillDetailedTaskForm(data);
    return await this.saveDetailedTask();
  }

  async updateTask(newData: TaskData, originalName: string, taskId?: number | null): Promise<void> {
    logger.info(`Updating task "${originalName}" → "${newData.name}"`);
    await this.openTaskInDetailPanel(originalName, taskId);
    await this.clickEditButtonInDetailPanel();
    await this.fillEditForm(newData);
    await this.saveEditedTask();
    logger.success(`Task updated to "${newData.name}"`);
  }
}
