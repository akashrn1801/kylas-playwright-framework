import { test as taskTest, expect } from '../../ui/formFields/taskFormFieldLock';
import { Page } from '@playwright/test';
import { TasksPage } from '../../../src/modules/tasks/TasksPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  TASK_FORM_FIELD_LIMIT_NAMES,
  TASK_LAYOUT_CACHE_KEY,
  generateTaskData,
  TaskData,
  TaskCustomFieldKey,
  generateTaskCustomFieldInvalidTextField,
  generateTaskCustomFieldInvalidParagraphText,
  generateValidPanCardValue as generateValidPanCardValueTk,
  generateInvalidPanCardValue as generateInvalidPanCardValueTk,
  generateValidEmailFormatValue as generateValidEmailFormatValueTk,
  generateInvalidEmailFormatValue as generateInvalidEmailFormatValueTk,
  generateValidDriverLicenceValue as generateValidDriverLicenceValueTk,
  generateInvalidDriverLicenceValue as generateInvalidDriverLicenceValueTk,
  generateValidVotingCardValue as generateValidVotingCardValueTk,
  generateInvalidVotingCardValue as generateInvalidVotingCardValueTk,
  generateValidPassportValue as generateValidPassportValueTk,
  generateInvalidPassportValue as generateInvalidPassportValueTk,
} from '../../../src/data/factories/taskFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';

// WHY this is its own standalone file, not nested inside a shared
// multi-entity RBAC file (split 2026-09-28 from the original
// formFields.rbac.spec.ts, which held all 6 entities' own blocks together):
// matches the same one-file-per-entity convention already used for this
// feature's own UI spec files (tests/ui/formFields/<entity>FieldLimits.spec.ts)
// and for every other module in this codebase (tests/rbac/<module>.rbac.spec.ts).
// Named "<Entity>FormFields" rather than plain "<entity>s" specifically to
// avoid colliding with that entity's own PRE-EXISTING, unrelated
// tests/rbac/<entity>s.rbac.spec.ts file (this feature's tests are
// additional Form-Field-Limit-specific coverage, not that file's own
// broader RBAC suite).
//
// WHY this file shares a cross-process lock with this SAME entity's own
// UI spec file (see the imported lock file above): the two files' tests
// configure/read the exact same shared, account-wide custom-field config
// on the Form Fields settings screen. Real CI pipelines
// (qa.yml/stage.yml/main.yml/staging-promotion-gate.yml on GitHub Actions;
// Jenkinsfile/Jenkinsfile.qa/Jenkinsfile.staging on Jenkins) all run these
// tests at --workers=2, confirmed live, making this a real, not
// hypothetical, risk. See the lock file's own header comment for the full
// worker-count evidence table and design reasoning.
//
// WHY RBAC assertions here never navigate to an individual field's edit
// URL directly (`/setup/fields/<slug>/edit/<id>`): a restricted user
// requesting that URL lands on the same "Forbidden" bootstrap-time page
// documented in .claude/known-issues.md — colliding with
// authManager.isSessionExpiryPage()'s own recognition of that exact page
// shape. Restricted-user RBAC here is proven entirely through the LIST
// page (visible, read-only, no Add Field button, rows not clickable).

// WHY this checks an inline error, not a toast: live reproduction confirmed
// Text field min/max is validated CLIENT-SIDE, inline, on blur — the exact
// same mechanism as Number/Regex. Network-request logging confirmed Save
// fires ZERO requests while this inline error is present, so a toast-based
// check can never observe anything here. Deliberately duplicated per
// entity file rather than imported from a shared location — matches this
// feature's own established "each file stays independently runnable"
// convention.
async function assertInlineErrorPresent(
  page: TasksPage,
  context: string
): Promise<void> {
  let errorPresent = false;
  try {
    await page.assertNoFormErrors(context);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
      errorPresent = true;
    } else {
      throw error;
    }
  }
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

taskTest.describe('Form Field Limits — RBAC › Task', () => {
  taskTest.describe.configure({ mode: 'serial' });

  const TASK_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Task', urlSlug: 'tasks' };
  const OTHER_DETAILS_TAB = 'Other Details';

  const TK_TEXT_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.textField}`;
  const TK_NUMBER_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.number}`;
  const TK_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

  // WHY these constants/helpers are duplicated here from
  // taskFieldLimits.spec.ts rather than imported: mirrors the Contact/
  // Company blocks' own identical, already-established "these two files
  // must remain independently runnable" convention — applied here for a
  // FOURTH entity, unchanged in reasoning.
  const TEXT_MIN = 3;
  const TEXT_MAX = 6;
  const TEXT_REPEAT_CHAR = 'A';

  const PARAGRAPH_MIN = 5;
  const PARAGRAPH_MAX = 9;
  const PARAGRAPH_REPEAT_CHAR = 'B';

  const NUMBER_MIN = 3;
  const NUMBER_MAX = 6;
  const NUMBER_REPEAT_CHAR = '1';

  function repeatChar(char: string, length: number): string {
    return char.repeat(Math.max(0, length));
  }

  function uniqueTaskName(): string {
    return `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Task ${Date.now()}`;
  }

  async function clearTaskApplicationCache(targetPage: Page): Promise<void> {
    const tasksPage = new TasksPage(targetPage);
    const result = await tasksPage.clearApplicationCache(TASK_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Task application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

  type SupportedCustomFieldKey = Extract<TaskCustomFieldKey, 'textField' | 'paragraphText' | 'number'>;

  function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
    if (fieldName === TASK_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
    if (fieldName === TASK_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
    if (fieldName === TASK_FORM_FIELD_LIMIT_NAMES.number) return 'number';
    throw new Error(
      `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
    );
  }

  interface TaskFieldUnderTest {
    fieldName: string;
    value: string;
  }

  function buildTaskDataWithFieldOverride(name: string, field: TaskFieldUnderTest): TaskData {
    const taskData = generateTaskData({ name });
    const dataKey = customFieldNameToDataKey(field.fieldName);
    if (dataKey === 'number') {
      taskData.customFields.number = Number(field.value);
    } else {
      taskData.customFields[dataKey] = field.value;
    }
    return taskData;
  }

  async function hasInlineFormError(tasksPage: TasksPage, context: string): Promise<boolean> {
    try {
      await tasksPage.assertNoFormErrors(context);
      return false;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
        return true;
      }
      throw error;
    }
  }

  async function createTaskExpectingAccept(
    tasksPage: TasksPage,
    name: string,
    field: TaskFieldUnderTest
  ): Promise<number> {
    const taskData = buildTaskDataWithFieldOverride(name, field);
    const taskId = await tasksPage.createDetailedTask(taskData, undefined, true, {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    expect(
      taskId,
      `Expected Task creation to succeed (field="${field.fieldName}", value="${field.value}") but createDetailedTask() returned null`
    ).not.toBeNull();
    return taskId as number;
  }

  async function createBareTask(tasksPage: TasksPage, name: string): Promise<number> {
    const taskId = await tasksPage.createDetailedTask(generateTaskData({ name }), undefined, true, {
      minimal: true,
    });
    expect(taskId, `Expected a bare minimal Task ("${name}") to be created successfully`).not.toBeNull();
    return taskId as number;
  }

  async function updateTaskExpectingAccept(
    tasksPage: TasksPage,
    taskId: number,
    name: string,
    field: TaskFieldUnderTest
  ): Promise<void> {
    await tasksPage.openTaskInDetailPanel('', taskId);
    await tasksPage.clickEditButtonInDetailPanel();
    await tasksPage.fillEditForm(buildTaskDataWithFieldOverride(name, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    await tasksPage.saveEditedTask();
  }

  async function openTaskFormExpectingRejection(
    tasksPage: TasksPage,
    name: string,
    field: TaskFieldUnderTest
  ): Promise<void> {
    await tasksPage.openDetailedTaskForm();
    await tasksPage.fillDetailedTaskForm(buildTaskDataWithFieldOverride(name, field), undefined, true, {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function openEditTaskFormExpectingRejection(
    tasksPage: TasksPage,
    taskId: number,
    name: string,
    field: TaskFieldUnderTest
  ): Promise<void> {
    await tasksPage.openTaskInDetailPanel('', taskId);
    await tasksPage.clickEditButtonInDetailPanel();
    await tasksPage.fillEditForm(buildTaskDataWithFieldOverride(name, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function assertCustomFieldPersistedOnDetail(
    tasksPage: TasksPage,
    taskId: number,
    fieldName: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    await tasksPage.openTaskInDetailPanel('', taskId);
    await tasksPage.clickDetailPageTab(OTHER_DETAILS_TAB);
    await tasksPage.assertCustomFieldOnDetail(fieldName, expectedValue, description);
  }

  // WHY cross-checking the generated value against the pattern read LIVE
  // off the config page: mirrors the UI file's/Contact/Company blocks'
  // identical function exactly.
  async function assertGeneratedValueMatchesLivePattern(
    configPage: FormFieldsConfigPage,
    internalName: string,
    value: string,
    shouldMatch: boolean,
    description: string
  ): Promise<void> {
    await configPage.openFieldForEdit(internalName);
    const { pattern } = await configPage.getRegexPatternInfo();
    const actuallyMatches = new RegExp(pattern).test(value);
    expect(
      actuallyMatches,
      `Expected generated value "${value}" to ${shouldMatch ? '' : 'NOT '}match the live pattern ` +
        `"${pattern}" for ${description}, but it ${actuallyMatches ? 'did' : 'did not'}`
    ).toBe(shouldMatch);
  }

  taskTest('@regression FFRTK1 restricted user can see the field settings list but nothing else on that page', async ({
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, TASK_ENTITY);
    await configPage.assertListVisibleReadOnly();
    logger.success('FFRTK1 passed');
  });

  taskTest('@regression FFRTK2 restricted user does not see the "Add Field" button', async ({
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, TASK_ENTITY);
    await configPage.assertAddFieldButtonAbsent();
    logger.success('FFRTK2 passed');
  });

  taskTest('@regression FFRTK3 restricted user cannot click into any field to open it for editing', async ({
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, TASK_ENTITY);
    await configPage.assertRowNotClickable(TK_TEXT_FIELD_INTERNAL_NAME);
    logger.success('FFRTK3 passed');
  });

  taskTest("@regression FFRTK4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      TK_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    const cacheResult = await new TasksPage(restrictedPage).clearApplicationCache(TASK_LAYOUT_CACHE_KEY);
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Task application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedTasksPage = new TasksPage(restrictedPage);
    await restrictedTasksPage.goToTasksList();
    await restrictedTasksPage.openDetailedTaskForm();
    const name = uniqueTaskName();
    const taskData = generateTaskData({ name });
    taskData.customFields.textField = 'A'.repeat(max + 1);
    await restrictedTasksPage.fillDetailedTaskForm(taskData, undefined, true, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent1 = await hasInlineFormError(
      restrictedTasksPage,
      'FFRTK4 Add Task — restricted, over admin-set max'
    );
    expect(errorPresent1, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRTK4 passed');
  });

  taskTest("@regression FFRTK5 after admin sets a Number limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      TK_NUMBER_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Number field'
    );

    await clearTaskApplicationCache(restrictedPage);
    const restrictedTasksPage = new TasksPage(restrictedPage);
    await restrictedTasksPage.goToTasksList();

    const acceptValue = '1'.repeat(min);
    const acceptData = generateTaskData({ name: uniqueTaskName() });
    acceptData.customFields.number = Number(acceptValue);
    const taskId = await restrictedTasksPage.createDetailedTask(acceptData, undefined, true, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
    });
    expect(
      taskId,
      'Expected restricted user to successfully create a Task with a Number value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedTasksPage.openTaskInDetailPanel('', taskId as number);
    await restrictedTasksPage.clickDetailPageTab('Other Details');
    await restrictedTasksPage.assertCustomFieldOnDetail(
      TASK_FORM_FIELD_LIMIT_NAMES.number,
      acceptValue,
      'Number field'
    );

    await restrictedTasksPage.goToTasksList();
    await restrictedTasksPage.openDetailedTaskForm();
    const rejectData = generateTaskData({ name: uniqueTaskName() });
    rejectData.customFields.number = Number('1'.repeat(max + 1));
    await restrictedTasksPage.fillDetailedTaskForm(rejectData, undefined, true, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
    });
    const errorPresent2 = await hasInlineFormError(
      restrictedTasksPage,
      'FFRTK5 Add Task — restricted, Number over admin-set max'
    );
    expect(errorPresent2, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRTK5 passed');
  });

  taskTest("@regression FFRTK6 after admin sets a Paragraph limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const min = 6;
    const max = 10;
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_PARAGRAPH_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      TK_PARAGRAPH_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Paragraph field'
    );

    await clearTaskApplicationCache(restrictedPage);
    const restrictedTasksPage = new TasksPage(restrictedPage);
    await restrictedTasksPage.goToTasksList();

    const acceptValue = 'B'.repeat(min);
    const acceptData = generateTaskData({ name: uniqueTaskName() });
    acceptData.customFields.paragraphText = acceptValue;
    const taskId = await restrictedTasksPage.createDetailedTask(acceptData, undefined, true, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    expect(
      taskId,
      'Expected restricted user to successfully create a Task with a Paragraph value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedTasksPage.openTaskInDetailPanel('', taskId as number);
    await restrictedTasksPage.clickDetailPageTab('Other Details');
    await restrictedTasksPage.assertCustomFieldOnDetail(
      TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
      acceptValue,
      'Paragraph field'
    );

    await restrictedTasksPage.goToTasksList();
    await restrictedTasksPage.openDetailedTaskForm();
    const rejectData = generateTaskData({ name: uniqueTaskName() });
    rejectData.customFields.paragraphText = 'B'.repeat(max + 1);
    await restrictedTasksPage.fillDetailedTaskForm(rejectData, undefined, true, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    const errorPresent3 = await hasInlineFormError(
      restrictedTasksPage,
      'FFRTK6 Add Task — restricted, Paragraph over admin-set max'
    );
    expect(errorPresent3, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRTK6 passed');
  });

  taskTest("@regression FFRTK7 after admin sets a Regex format (PAN Card) and restricted user's cache is cleared, restricted user's values are enforced for both a valid and an invalid value", async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    await configPage.assertFieldConfigMatches(
      TK_TEXT_FIELD_INTERNAL_NAME,
      { regexLabel: 'PAN Card' },
      'Text field'
    );

    await clearTaskApplicationCache(restrictedPage);
    const restrictedTasksPage = new TasksPage(restrictedPage);
    await restrictedTasksPage.goToTasksList();

    const acceptValue = generateValidPanCardValueTk();
    const acceptData = generateTaskData({ name: uniqueTaskName() });
    acceptData.customFields.textField = acceptValue;
    const taskId = await restrictedTasksPage.createDetailedTask(acceptData, undefined, true, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
    });
    expect(
      taskId,
      'Expected restricted user to successfully create a Task with a valid PAN Card value'
    ).not.toBeNull();
    await restrictedTasksPage.openTaskInDetailPanel('', taskId as number);
    await restrictedTasksPage.clickDetailPageTab('Other Details');
    await restrictedTasksPage.assertCustomFieldOnDetail(
      TASK_FORM_FIELD_LIMIT_NAMES.textField,
      acceptValue,
      'Text field'
    );

    await restrictedTasksPage.goToTasksList();
    await restrictedTasksPage.openDetailedTaskForm();
    const rejectData = generateTaskData({ name: uniqueTaskName() });
    rejectData.customFields.textField = generateInvalidPanCardValueTk();
    await restrictedTasksPage.fillDetailedTaskForm(rejectData, undefined, true, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent4 = await hasInlineFormError(
      restrictedTasksPage,
      'FFRTK7 Add Task — restricted, invalid PAN Card'
    );
    expect(errorPresent4, 'Expected an inline validation error for the invalid PAN Card value').toBe(true);
    logger.success('FFRTK7 passed');
  });

  taskTest('@regression FFRTK8 restricted user should confirm typing too few characters in the Text field is rejected when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK8 Add Task — Text under min');
    logger.success('FFRTK8 passed');
  });

  taskTest('@regression FFRTK9 restricted user should confirm typing exactly the maximum allowed characters in the Text field is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK9 passed');
  });

  taskTest('@regression FFRTK10 restricted user should confirm typing exactly the minimum allowed characters in the Text field is accepted when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
    await updateTaskExpectingAccept(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK10 passed');
  });

  taskTest('@regression FFRTK11 restricted user should confirm typing too many characters in the Text field is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value: generateTaskCustomFieldInvalidTextField(TEXT_MAX),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK11 Edit Task — Text over max');
    logger.success('FFRTK11 passed');
  });

  taskTest('@regression FFRTK12 restricted user should confirm typing too few digits in the Number field is rejected when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK12 Add Task — Number under min');
    logger.success('FFRTK12 passed');
  });

  taskTest('@regression FFRTK13 restricted user should confirm typing exactly the maximum allowed digits in the Number field is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRTK13 passed');
  });

  taskTest('@regression FFRTK14 restricted user should confirm typing exactly the minimum allowed digits in the Number field is accepted when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await updateTaskExpectingAccept(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRTK14 passed');
  });

  taskTest('@regression FFRTK15 restricted user should confirm typing too many digits in the Number field is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK15 Edit Task — Number over max');
    logger.success('FFRTK15 passed');
  });

  taskTest('@regression FFRTK16 restricted user should confirm fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
    restrictedPage,
    adminPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    await openTaskFormExpectingRejection(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK16 Add Task — Number initially invalid');
    const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await tasksPage.fillTextLikeCustomField(
      TASK_FORM_FIELD_LIMIT_NAMES.number,
      validValue,
      TASK_FORM_FIELD_LIMIT_NAMES.number
    );
    await tasksPage.fillTaskName(name);
    const errorStillPresent = await hasInlineFormError(
      tasksPage,
      'FFRTK16 Add Task — Number corrected to valid'
    );
    expect(
      errorStillPresent,
      'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
    ).toBe(false);
    const savedTaskId = await tasksPage.saveDetailedTask();
    expect(savedTaskId, 'Expected the corrected Number value to save successfully').not.toBeNull();
    const taskId = savedTaskId as number;
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.number, validValue, 'Number field');
    logger.success('FFRTK16 passed');
  });

  taskTest('@regression FFRTK17 restricted user should confirm typing too few characters in the Paragraph field is rejected when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK17 Add Task — Paragraph under min');
    logger.success('FFRTK17 passed');
  });

  taskTest('@regression FFRTK18 restricted user should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRTK18 passed');
  });

  taskTest('@regression FFRTK19 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
    await updateTaskExpectingAccept(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRTK19 passed');
  });

  taskTest('@regression FFRTK20 restricted user should confirm typing too many characters in the Paragraph field is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(TK_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: generateTaskCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK20 Edit Task — Paragraph over max');
    logger.success('FFRTK20 passed');
  });

  taskTest('@regression FFRTK21 restricted user should confirm a valid PAN Card value is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateValidPanCardValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK21 passed');
  });

  taskTest('@regression FFRTK22 restricted user should confirm an invalid PAN Card value is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateInvalidPanCardValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK22 Edit Task — invalid PAN Card');
    logger.success('FFRTK22 passed');
  });

  taskTest('@regression FFRTK23 restricted user should confirm an invalid Email value is rejected when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateInvalidEmailFormatValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK23 Add Task — invalid Email');
    logger.success('FFRTK23 passed');
  });

  taskTest('@regression FFRTK24 restricted user should confirm a valid Email value is accepted when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateValidEmailFormatValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await updateTaskExpectingAccept(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK24 passed');
  });

  taskTest('@regression FFRTK25 restricted user should confirm a valid Driver Licence value is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateValidDriverLicenceValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK25 passed');
  });

  taskTest('@regression FFRTK26 restricted user should confirm an invalid Driver Licence value is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateInvalidDriverLicenceValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK26 Edit Task — invalid Driver Licence');
    logger.success('FFRTK26 passed');
  });

  taskTest('@regression FFRTK27 restricted user should confirm an invalid Voting Card value is rejected when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateInvalidVotingCardValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK27 Add Task — invalid Voting Card');
    logger.success('FFRTK27 passed');
  });

  taskTest('@regression FFRTK28 restricted user should confirm a valid Voting Card value is accepted when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateValidVotingCardValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await updateTaskExpectingAccept(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK28 passed');
  });

  taskTest('@regression FFRTK29 restricted user should confirm a valid Passport value is accepted when creating a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateValidPassportValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRTK29 passed');
  });

  taskTest('@regression FFRTK30 restricted user should confirm an invalid Passport value is rejected when editing a task', async ({
    adminPage,
    restrictedPage,
  }) => {
    taskTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateInvalidPassportValueTk();
    await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const name = uniqueTaskName();
    const taskId = await createBareTask(tasksPage, name);
    await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(tasksPage, 'FFRTK30 Edit Task — invalid Passport');
    logger.success('FFRTK30 passed');
  });

  taskTest("@regression FFRTK31 restricted user should confirm after the cache is cleared, the new limit is correctly applied on a new task", async ({
    restrictedPage,
    adminPage,
  }) => {
    taskTest.setTimeout(480000);
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
    const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
    await configPage.configureFieldLimit(
      TK_NUMBER_FIELD_INTERNAL_NAME,
      String(CACHE_TEST_FRESH_MIN),
      String(CACHE_TEST_FRESH_MAX)
    );
    await clearTaskApplicationCache(restrictedPage);
    const tasksPage = new TasksPage(restrictedPage);
    await tasksPage.goToTasksList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
    const name = uniqueTaskName();
    const taskId = await createTaskExpectingAccept(tasksPage, name, {
      fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(tasksPage, taskId, TASK_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRTK31 passed');
  });
});
