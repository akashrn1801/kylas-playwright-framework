import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Task Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: Task has the same 8 custom fields as Meeting (Text, Paragraph, Number,
// PickList, Checkbox, Date, DateTimePicker, UrlField — no MultiPickList;
// child entities never get one). TASK_CUSTOM_FIELD_NAMES is its own single
// source of truth, per CLAUDE.md's Custom Fields pattern — never import
// MEETING_CUSTOM_FIELD_NAMES here even where values happen to coincide.
//
// CORRECTED 2026-08-06, real live evidence, not the 2026-08-01 claim this
// replaces: after custom fields were added to Staging, live DOM inspection of
// the real Detailed Task create form there showed every field id as
// "1_11_input_customFieldValues.cf<Name>" (e.g. "...cfUrlField", lowercase
// "rl") — i.e. Task actually matches Lead/Deal/Contact/Company/Quotation's
// convention on BOTH counts: the "customFieldValues." suffix segment IS
// present (see the suffixStyle fix in TasksPage.ts), and the URL field's
// internal name is 'UrlField', not 'URLField'. The previous comment's claim
// that Task matches Meeting on both points was never actually verified live
// for Task and was wrong — it silently caused every Task custom field to be
// reported "not found" regardless of environment.
export const TASK_CUSTOM_FIELD_NAMES = {
  textField: 'TextField',
  paragraphText: 'ParagraphText',
  number: 'Number',
  pickList: 'PickList',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTimePicker: 'DateTimePicker',
  urlField: 'UrlField',
} as const;

export type TaskCustomFieldKey = keyof typeof TASK_CUSTOM_FIELD_NAMES;

// WHY this constant, and why it must NOT be derived from TASK_CUSTOM_FIELD_
// NAMES or the entity name (2026-09-23, Form Field Limit feature, Task
// rollout — same reasoning as LEAD_LAYOUT_CACHE_KEY/CONTACT_LAYOUT_CACHE_KEY/
// COMPANY_LAYOUT_CACHE_KEY): the app's IndexedDB `layoutCache` key is not a
// fixed transformation of the entity name. This is Task's own hand-verified
// key, confirmed live via a direct IndexedDB dump, for
// BasePage.clearApplicationCache() — never guess this value.
export const TASK_LAYOUT_CACHE_KEY = 'tasks';

// ── Invalid values for negative testing (Form Field Limit feature) ──────
export const generateTaskCustomFieldInvalidTextField = (max = 255): string => 'A'.repeat(max + 1);
export const generateTaskCustomFieldInvalidParagraphText = (max = 2550): string =>
  'B'.repeat(max + 1);

// ── Text field Regex format generators (Form Field Limit feature) ────────
// WHY duplicated here rather than imported from lead/contact/companyFactory.ts:
// mirrors this file's own top-of-file "never import another module's
// constants" reasoning — each module owns its own field-name/value-shape
// constants so they can diverge safely later. Every value here is still
// cross-checked against the pattern read LIVE off the config page at
// test-run time (never trusted from the generator alone).
const randomUppercaseLetters = (count: number): string =>
  faker.string.alpha({ length: count, casing: 'upper' });
const randomDigits = (count: number): string => faker.string.numeric(count);

export const generateValidPanCardValue = (): string =>
  `${randomUppercaseLetters(5)}${randomDigits(4)}${randomUppercaseLetters(1)}`;
export const generateInvalidPanCardValue = (): string =>
  `${randomUppercaseLetters(4)}${randomDigits(4)}${randomUppercaseLetters(1)}`;

export const generateValidEmailFormatValue = (): string =>
  `${faker.string.alpha({ length: 8, casing: 'lower' })}@example.com`;
export const generateInvalidEmailFormatValue = (): string =>
  `${faker.string.alpha({ length: 8, casing: 'lower' })}@${faker.string.alpha({
    length: 6,
    casing: 'lower',
  })}`;

export const generateValidDriverLicenceValue = (): string =>
  `${randomUppercaseLetters(2)} ${randomDigits(2)} ${randomDigits(4)} ${randomDigits(7)}`;
export const generateInvalidDriverLicenceValue = (): string =>
  `${randomUppercaseLetters(2)} ${randomDigits(2)} ${randomDigits(4)} ${randomDigits(6)}`;

export const generateValidVotingCardValue = (): string =>
  `${randomUppercaseLetters(3)}${randomDigits(7)}`;
export const generateInvalidVotingCardValue = (): string =>
  `${randomUppercaseLetters(3)}${randomDigits(5)}`;

export const generateValidPassportValue = (): string =>
  `${randomUppercaseLetters(1)}${randomDigits(7)}`;
export const generateInvalidPassportValue = (): string =>
  `${randomUppercaseLetters(1)}${randomDigits(6)}`;

export interface TaskCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList options only exist live in the DOM (never hardcode them) —
  // this starts as a placeholder and is overwritten in place by
  // TasksPage.fillTaskCustomFields() with whatever was actually selected at
  // fill time, so the same `data` object stays accurate for later verification
  // against the detail page.
  pickList: string;
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateTaskCustomFieldData(
  overrides: Partial<TaskCustomFieldData> = {}
): TaskCustomFieldData {
  return {
    textField: `CF-Text-${faker.string.alphanumeric(12)}`,
    paragraphText: faker.lorem.paragraph(),
    number: faker.number.int({ min: 1, max: 100000 }),
    pickList: '',
    checkbox: faker.datatype.boolean(),
    date: randomFutureDateWithinOneMonth(),
    dateTimePicker: randomFutureDateWithinOneMonth(),
    urlField: `https://example.com/${faker.string.alphanumeric(10)}`,
    ...overrides,
  };
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TASK_TYPE_OPTIONS = ['Call', 'Follow Up', 'Reminder', 'Todo'] as const;
export type TaskType = (typeof TASK_TYPE_OPTIONS)[number];

export const TASK_STATUS_OPTIONS = ['Open', 'In Progress', 'Completed', 'Cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUS_OPTIONS)[number];

export const TASK_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITY_OPTIONS)[number];

export const TASK_REMINDER_OPTIONS = [
  'No reminder',
  '15 minutes before the due date and time',
  '30 minutes before the due date and time',
  '1 hour before the due date and time',
  '2 hours before the due date and time',
  '1 day before the due date and time',
] as const;
export type TaskReminder = (typeof TASK_REMINDER_OPTIONS)[number];

// ─── Interface ────────────────────────────────────────────────────────────────

export interface TaskData {
  name: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  reminder: TaskReminder;
  customFields: TaskCustomFieldData;
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function generateTaskData(overrides: Partial<TaskData> = {}): TaskData {
  return {
    name: `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Task`,
    type: faker.helpers.arrayElement(TASK_TYPE_OPTIONS),
    description: faker.lorem.sentence(),
    status: 'Open',
    priority: faker.helpers.arrayElement(TASK_PRIORITY_OPTIONS),
    reminder: '1 hour before the due date and time',
    customFields: generateTaskCustomFieldData(),
    ...overrides,
  };
}

// WHY no fully-collapsible tab target for Task, unlike every other module
// in this feature's coverage so far — confirmed live via direct code read
// of TasksPage.fillDetailedTaskForm()/fillEditForm(): Type/Status/Priority/
// Reminder are all real, data-driven react-selects with no blankable
// placeholder (literal-union types, always populated), and PickList is
// unconditionally random-picked by the custom-field fill method regardless
// of the `''` default — so neither Basic Info nor Other Details can ever be
// driven to a genuine 100%-empty state through this form. Description
// (Basic Info) and Text Field/Paragraph Text/URL Field (Other Details) are
// the only genuinely blankable fields — this factory blanks exactly those,
// giving Task a MIXED-section-only test surface (both tabs always stay
// visible; only individual fields hide) — a real, confirmed exception to
// document explicitly, not a gap to force-fit the tab-collapse pattern onto.
export function generateMinimalTaskData(overrides: Partial<TaskData> = {}): TaskData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return generateTaskData({
    description: '',
    customFields: generateTaskCustomFieldData({
      textField: '',
      paragraphText: '',
      urlField: '',
      ...customFieldOverrides,
    }),
    ...restOverrides,
  });
}

// WHY: Admin task data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890 Task" will NEVER find
// a task from a previous test run — guaranteed uniqueness.
export function generateAdminTaskData(overrides: Partial<TaskData> = {}): TaskData {
  const timestamp = Date.now().toString();
  return {
    name: `ADM${timestamp} Task`,
    type: faker.helpers.arrayElement(TASK_TYPE_OPTIONS),
    description: `Admin task created at ${timestamp}. RBAC isolation test.`,
    status: 'Open',
    priority: faker.helpers.arrayElement(TASK_PRIORITY_OPTIONS),
    reminder: '1 hour before the due date and time',
    customFields: generateTaskCustomFieldData(),
    ...overrides,
  };
}
