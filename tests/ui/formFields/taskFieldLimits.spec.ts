import { test, expect, withTaskFormFieldLock } from './taskFormFieldLock';
// WHY a second, separate `test` import here — mirrors
// companyFieldLimits.spec.ts's own identical `baseTest` import (2026-09-29,
// Fix 2 for the dated docs/known-issues/sharding-and-locks.md entry, "A cross-process lock only
// protects workers on the SAME filesystem"): confirmed via a complete,
// per-test code-level audit that every Navigation test below only ever
// READS field config, never calls configureFieldLimit()/
// configureFieldRegex()/clearAllFieldConfigurations().
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { TasksPage } from '../../../src/modules/tasks/TasksPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  TASK_FORM_FIELD_LIMIT_NAMES,
  TASK_LAYOUT_CACHE_KEY,
  generateTaskData,
  TaskData,
  TaskCustomFieldKey,
  generateTaskCustomFieldInvalidTextField,
  generateTaskCustomFieldInvalidParagraphText,
  generateValidPanCardValue,
  generateInvalidPanCardValue,
  generateValidEmailFormatValue,
  generateInvalidEmailFormatValue,
  generateValidDriverLicenceValue,
  generateInvalidDriverLicenceValue,
  generateValidVotingCardValue,
  generateInvalidVotingCardValue,
  generateValidPassportValue,
  generateInvalidPassportValue,
} from '../../../src/data/factories/taskFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this is the Task rollout of the Form Field Limit feature — the SAME
// reusable architecture already proven for Lead/Contact/Company (see
// docs/known-issues/form-fields.md/
// docs/known-issues/form-fields.md), not a re-derivation. Design B (this file =
// admin-only, zero restrictedPage usage; all restricted-role tests live in
// tests/rbac/formFields.rbac.spec.ts's own Task block) and full 5-format
// Regex coverage are both applied from the start here, matching the
// baseline Company established.
//
// WHY Task's own live-confirmed facts (this session's own diagnostic pass,
// not assumed from any prior entity):
// - TWO distinct create flows exist: Quick Task (no custom fields — never
//   usable for this feature) and Detailed Task (has the custom-fields
//   section this feature needs). Every mutation in this file goes through
//   the Detailed Task flow exclusively (openDetailedTaskForm()/
//   fillDetailedTaskForm()/createDetailedTask()) — never Quick Task.
// - Task's true minimum-to-save field set on CREATE is FOUR fields, not
//   one: Name + Type + Status + Priority. Confirmed live via a 3-step
//   diagnostic (Name alone -> "This is a required field"; +Type -> still
//   required; +Status+Priority -> HTTP 200) — Type/Status/Priority have no
//   pre-selected default on a fresh Detailed Task form (unlike Reminder,
//   which does). TasksPage.fillDetailedTaskForm()'s own `minimal` mode
//   therefore always fills all four, skipping only genuinely optional
//   fields (Description, Reminder re-selection, Assigned To, Relation).
// - On EDIT, minimal mode is deliberately ASYMMETRIC from minimal CREATE —
//   Type/Status/Priority are pre-filled with the task's own already-valid
//   values when the edit form opens, so minimal EDIT skips them entirely,
//   touching only Name and custom fields (see TasksPage.fillEditForm()'s
//   own WHY comment for the full reasoning).
// - Task's Name field is `[id="0_11_input_name"]`, NOT `input[name="name"]`
//   — the same trap already confirmed for Company. TasksPage.fillTaskName()
//   is the correct, dedicated alternative to BasePage's generic
//   fillStandardField(), which hangs indefinitely against it.
// - The Form Fields settings page's own Task tab is labeled "Task" and its
//   URL slug is "tasks" (confirmed live: clicking the tab lands on
//   /setup/fields/tasks/list).
// - Task's detail panel's "Other Details" tab carries the same
//   `data-targetid="Other Details"` attribute Lead's/Contact's/Company's
//   does — BasePage.clickDetailPageTab() works unchanged.
// - Task's custom-field id suffix is the "legacy" style
//   (`_input_customFieldValues.cf<Name>`), matching Lead/Contact/Company/
//   Quotation — NOT the "plain" style Products & Services/Meeting/Call Log
//   use.
// - No "Show Required & Important Fields" toggle exists anywhere in Task's
//   create/edit forms, unlike Lead/Contact/Company — nothing in this file
//   needs to account for it.
// - Task's layoutCache key is "tasks" (hand-verified live via direct
//   IndexedDB dump, per docs/PATTERNS.md P30's warning that this key is
//   never derivable from the entity name).

const TASK_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Task', urlSlug: 'tasks' };
const OTHER_DETAILS_TAB = 'Other Details';

const TK_TEXT_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.textField}`;
const TK_NUMBER_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.number}`;
const TK_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${TASK_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

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

// WHY a dedicated name generator, not a bare faker call at every site:
// mirrors leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's/
// companyFieldLimits.spec.ts's own per-call-site convention, adapted for
// Task's own identifying field (`name`).
function uniqueTaskName(): string {
  return `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Task ${Date.now()}`;
}

// ─── Shared local action helpers ──────────────────────────────────────────

async function clearTaskApplicationCache(targetPage: Page): Promise<void> {
  const tasksPage = new TasksPage(targetPage);
  const result = await tasksPage.clearApplicationCache(TASK_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Task application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Task create/update flow for this feature — architecture note
// ============================================================================
// WHY exactly two Task-mutation paths exist below: mirrors
// leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's/
// companyFieldLimits.spec.ts's own identical split exactly — see
// docs/known-issues/form-fields.md for the full evidence chain this reuses
// unchanged. Every create/edit call below always passes skipRelation=true
// (or simply omits assignedTo/relation entirely, on edit) — Relation is
// expensive (4 entity-type searches) and irrelevant to a field-limit check.
// ============================================================================

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

async function assertInlineErrorPresent(tasksPage: TasksPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(tasksPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

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

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

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

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
  await configPage.clearFieldConfiguration(TK_TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(TK_NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(TK_PARAGRAPH_FIELD_INTERNAL_NAME);
}

// WHY this block is a sibling of, not nested inside, 'Task Field Limits'
// below, using `baseTest` instead of `test` — mirrors
// companyFieldLimits.spec.ts's own identical 'Navigation' extraction.
baseTest.describe('Navigation', () => {
  baseTest(
    '@smoke @prodSafe FFTK1 admin should open the Task field settings page and see the entity tabs',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(tabs, 'Expected the "Task" tab to be present among the live tab labels').toContain('Task');
      logger.success('FFTK1 passed');
    }
  );

  baseTest(
    '@smoke @prodSafe FFTK2 admin should search the field list by internal name and see it filter correctly',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.open();
      await configPage.searchField(TK_TEXT_FIELD_INTERNAL_NAME);
      await configPage.openFieldForEdit(TK_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFTK2 passed');
    }
  );

  baseTest(
    "@smoke @prodSafe FFTK3 admin should open an individual custom field's edit page from the list",
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(TK_TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFTK3 passed');
    }
  );
}); // end describe('Navigation')

test.describe('Task Field Limits', () => {
  // WHY test.describe.configure({{ timeout: 480000 }}) here (2026-09-29,
  // real CI failures — sandbox run 36464460839: FFRTK6/FFC6/FFCO25/FFPS6 all
  // failed with "admin page failed to reach the app's /sales/ area (only
  // 0ms left before the fixture-setup deadline...)"): fixtures/index.ts's
  // createRolePage() computes its own fixture-setup deadline from
  // `testInfo.timeout * 0.85` BEFORE any test in this file ever calls
  // test.setTimeout(480000) inside its own body — too late to affect that
  // calculation, since fixture setup runs before the test body. Every test
  // here was therefore getting only the CI default 120000ms (a ~102000ms
  // deadline) for fixture setup, not the 480000ms the test actually needs —
  // and a single slow navigation attempt can legitimately consume that
  // entire 102000ms budget, leaving zero time for the already-correct
  // wrongPage recovery retry to ever run. describe.configure is resolved at
  // test-collection time, so testInfo.timeout is already correct by the
  // time ANY fixture (including adminPage/restrictedPage) initializes for
  // these tests — fixing the deadline math without touching
  // fixtures/index.ts's shared session-recovery logic at all. The existing
  // per-test test.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  test.describe.configure({ timeout: 480000 });

  test.afterAll(async ({ browser }) => {
    // WHY test.setTimeout(600000) here (2026-09-29, real CI failures —
    // sandbox run 36464460839: FFD37/FFD20 in dealFieldLimits.spec.ts and
    // FFTK38 in taskFieldLimits.spec.ts both failed with "Test timeout of
    // 120000ms exceeded while setting up formFieldLock" / "afterAll hook
    // timeout of 120000ms exceeded"): playwright.config.ts sets the CI
    // default test timeout to 120000ms — afterAll hooks get that same
    // default and do NOT inherit any individual test's own
    // test.setTimeout(480000) bump (that only extends the ONE test that
    // calls it). This hook's own lock acquisition can legitimately need to
    // wait up to ~480000ms for a DIFFERENT worker's still-in-progress,
    // full-length test on the SAME entity to finish and release the same
    // lock — 120000ms was never enough headroom for that, independent of
    // anything being actually wrong; it was a real, guaranteed-to
    // -eventually-fire timeout-budget mismatch. Sized generously above the
    // known ~480000ms worst case, not a guess.
    test.setTimeout(600000);
    const adminStorageStatePath = path.join(
      __dirname,
      '../../../src/auth/storageStates',
      config.env,
      'admin.json'
    );
    const context = await browser.newContext({ storageState: adminStorageStatePath });
    const page = await context.newPage();
    try {
      await withTaskFormFieldLock(() => clearAllFieldConfigurations(page));
      logger.success('afterAll safety-net cleanup completed');
    } catch (error) {
      logger.warn(`afterAll safety-net cleanup failed (non-fatal): ${String(error)}`);
    } finally {
      await context.close();
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────
  // WHY moved out of this block entirely (2026-09-29): see the top-level
  // `baseTest.describe('Navigation', ...)` block above this describe.

  // ─── Text field character-length limits ─────────────────────────────

  test.describe('Text field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFTK4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFTK4 passed');
    });

    test('@regression FFTK5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK5 passed');
    });

    test('@regression FFTK6 admin should confirm typing too many characters in the Text field is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateTaskCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK6 Add Task — Text over max');
      logger.success('FFTK6 passed');
    });

    test('@regression FFTK7 admin should confirm typing too few characters in the Text field is rejected when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK7 Edit Task — Text under min');
      logger.success('FFTK7 passed');
    });

    test('@regression FFTK8 admin should confirm typing exactly the maximum allowed characters in the Text field is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(TK_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK8 passed');
    });
  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ────────────────────────

  test.describe('Number field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFTK9 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await configPage.assertFieldConfigMatches(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFTK9 passed');
    });

    test('@regression FFTK10 admin should confirm typing exactly the minimum allowed digits in the Number field is accepted when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFTK10 passed');
    });

    test('@regression FFTK11 admin should confirm typing too many digits in the Number field is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK11 Add Task — Number over max');
      logger.success('FFTK11 passed');
    });

    test('@regression FFTK12 admin should confirm typing too few digits in the Number field is rejected when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK12 Edit Task — Number under min');
      logger.success('FFTK12 passed');
    });

    test('@regression FFTK13 admin should confirm typing exactly the maximum allowed digits in the Number field is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFTK13 passed');
    });
  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────

  test.describe('Paragraph field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFTK14 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFTK14 passed');
    });

    test('@regression FFTK15 admin should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFTK15 passed');
    });

    test('@regression FFTK16 admin should confirm typing too many characters in the Paragraph field is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateTaskCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK16 Add Task — Paragraph over max');
      logger.success('FFTK16 passed');
    });

    test('@regression FFTK17 admin should confirm typing too few characters in the Paragraph field is rejected when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK17 Edit Task — Paragraph under min');
      logger.success('FFTK17 passed');
    });

    test('@regression FFTK18 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFTK18 passed');
    });
  }); // end describe('Paragraph field limits')

  // ─── Format rules (Regex) — Text field ────────────────────────────────

  test.describe('Text field format rules (Regex)', () => {
    test.describe.configure({ mode: 'serial' });

    // WHY cross-checking the generated value against the pattern read LIVE
    // off the config page, not just trusting the generator: mirrors
    // leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's/
    // companyFieldLimits.spec.ts's identical function exactly.
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

    test('@regression FFTK19 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'PAN Card' },
        'Text field'
      );
      logger.success('FFTK19 passed');
    });

    test('@regression FFTK20 admin should confirm an invalid PAN Card value is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK20 Add Task — invalid PAN Card');
      logger.success('FFTK20 passed');
    });

    test('@regression FFTK21 admin should confirm a valid PAN Card value is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK21 passed');
    });

    test('@regression FFTK22 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Email' },
        'Text field'
      );
      logger.success('FFTK22 passed');
    });

    test('@regression FFTK23 admin should confirm a valid Email value is accepted when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK23 passed');
    });

    test('@regression FFTK24 admin should confirm an invalid Email value is rejected when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TK_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK24 Edit Task — invalid Email');
      logger.success('FFTK24 passed');
    });

    test('@regression FFTK25 admin sets the Text field format to Driver Licence and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Driver Licence' },
        'Text field'
      );
      logger.success('FFTK25 passed');
    });

    test('@regression FFTK26 admin should confirm an invalid Driver Licence value is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Driver Licence'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK26 Add Task — invalid Driver Licence');
      logger.success('FFTK26 passed');
    });

    test('@regression FFTK27 admin should confirm a valid Driver Licence value is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Driver Licence'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK27 passed');
    });

    test('@regression FFTK28 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Voting Card' },
        'Text field'
      );
      logger.success('FFTK28 passed');
    });

    test('@regression FFTK29 admin should confirm a valid Voting Card value is accepted when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Voting Card'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK29 passed');
    });

    test('@regression FFTK30 admin should confirm an invalid Voting Card value is rejected when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Voting Card'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await openEditTaskFormExpectingRejection(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK30 Edit Task — invalid Voting Card');
      logger.success('FFTK30 passed');
    });

    test('@regression FFTK31 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Passport' },
        'Text field'
      );
      logger.success('FFTK31 passed');
    });

    test('@regression FFTK32 admin should confirm an invalid Passport value is rejected when creating a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Passport'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(tasksPage, 'FFTK32 Add Task — invalid Passport');
      logger.success('FFTK32 passed');
    });

    test('@regression FFTK33 admin should confirm a valid Passport value is accepted when editing a task', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TK_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Passport'
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const name = uniqueTaskName();
      const taskId = await createBareTask(tasksPage, name);
      await updateTaskExpectingAccept(tasksPage, taskId, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK33 passed');
    });

    test('@regression FFTK34 admin should confirm choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.openFieldForEdit(TK_TEXT_FIELD_INTERNAL_NAME);
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFTK34 passed');
    });

    test('@regression FFTK35 admin should confirm choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFTK35 passed');
    });

    test('@regression FFTK36 admin should confirm switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(TK_TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(TK_TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        {
          minDisabled: false,
          maxDisabled: false,
          min: lockedSnapshot.min,
          max: lockedSnapshot.max,
        },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFTK36 passed');
    });
  }); // end describe('Text field format rules (Regex)')

  // ─── Cache behavior ────────────────────────────────────────────────────

  test.describe('Cache behavior', () => {
    test.describe.configure({ mode: 'serial' });

    const CACHE_TEST_STALE_MIN = 3;
    const CACHE_TEST_STALE_MAX = 6;
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;

    test('@regression FFTK37 admin should confirm a new limit is not applied on the task form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await tasksPage.assertNoFormErrors('FFTK37 seed Add Task');
      await configPage.configureFieldLimit(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await tasksPage.goToTasksList();
      await openTaskFormExpectingRejection(tasksPage, uniqueTaskName(), {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        tasksPage,
        'FFTK37 Add Task — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFTK37 passed');
    });
  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────

  test.describe('Cleanup', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFTK38 admin should confirm after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, TASK_ENTITY);
      await configPage.assertFieldConfigMatches(
        TK_TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        TK_NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        TK_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFTK38 passed');
    });

    test('@regression FFTK39 admin should confirm after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      await clearTaskApplicationCache(adminPage);
      const tasksPage = new TasksPage(adminPage);
      await tasksPage.goToTasksList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const name = uniqueTaskName();
      const taskId = await createTaskExpectingAccept(tasksPage, name, {
        fieldName: TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        tasksPage,
        taskId,
        TASK_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFTK39 passed');
    });
  }); // end describe('Cleanup')
});
