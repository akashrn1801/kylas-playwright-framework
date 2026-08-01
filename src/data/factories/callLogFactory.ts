import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Call Log Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-31) — Call Log has the same 8 custom fields
// as Meeting (Text, Paragraph, Number, PickList, Checkbox, Date,
// DateTimePicker, UrlField — no MultiPickList, same as every child entity).
// Live on QA today. CALL_LOG_CUSTOM_FIELD_NAMES is its own single source of
// truth, per CLAUDE.md's Custom Fields pattern — never import another
// module's constant here even where values happen to coincide.
//
// WHY 'URLField' (capital URL), matching Meeting/Quotation: confirmed live
// via DOM inspection of the real input id (`..._input_cfURLField`) — the
// same naming drift vs. Lead/Deal/Contact/Company's `cfUrlField`, independently
// confirmed for Call Log, not assumed to transfer from the other entities.
//
// WHY the PLAIN suffix convention (`_input_cf<Name>`), matching Meeting, NOT
// Quotation/Task: confirmed live via the same DOM inspection — Call Log's
// custom-field ids have no "customFieldValues." segment
// (e.g. "2_41_input_cfTextField"), matching CLAUDE.md's own documented
// finding that Meetings AND Call Logs share this shorter convention.
export const CALL_LOG_CUSTOM_FIELD_NAMES = {
  textField: 'TextField',
  paragraphText: 'ParagraphText',
  number: 'Number',
  pickList: 'PickList',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTimePicker: 'DateTimePicker',
  urlField: 'URLField',
} as const;

export type CallLogCustomFieldKey = keyof typeof CALL_LOG_CUSTOM_FIELD_NAMES;

export interface CallLogCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList options only exist live in the DOM (never hardcode them) —
  // this starts as a placeholder and is overwritten in place by
  // CallLogsPage.fillCallLogCustomFields() with whatever was actually
  // selected at fill time, so the same `data` object stays accurate for
  // later verification against the detail page.
  pickList: string;
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateCallLogCustomFieldData(
  overrides: Partial<CallLogCustomFieldData> = {}
): CallLogCustomFieldData {
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

// ─────────────────────────────────────────────────────────────────────────────
// Types & Enums
// ─────────────────────────────────────────────────────────────────────────────

export type CallLogEntityType = 'Lead' | 'Contact' | 'Deal';

export type CallLogOutcome =
  | 'Connected'
  | 'Busy'
  | 'Rejected'
  | 'No Answer'
  | 'Missed Call';

export type CallLogDurationType = 'seconds' | 'minutes' | 'hours';

// WHY: Type options differ per entity — Lead uses "Lead", Contact/Deal use "Contact"
export type CallLogTypeForLead = 'I called the Lead' | 'Lead called me';
export type CallLogTypeForContactDeal = 'I called the Contact' | 'Contact called me';
export type CallLogType = CallLogTypeForLead | CallLogTypeForContactDeal;

export const CALL_LOG_OUTCOMES: CallLogOutcome[] = [
  'Connected',
  'Busy',
  'Rejected',
  'No Answer',
  'Missed Call',
];

export const CALL_LOG_OUTCOMES_NO_DURATION: CallLogOutcome[] = [
  'Busy',
  'Rejected',
  'No Answer',
  'Missed Call',
];

export const CALL_LOG_TYPE_LEAD: CallLogTypeForLead[] = [
  'I called the Lead',
  'Lead called me',
];

export const CALL_LOG_TYPE_CONTACT_DEAL: CallLogTypeForContactDeal[] = [
  'I called the Contact',
  'Contact called me',
];

export const CALL_LOG_DURATION_TYPES: CallLogDurationType[] = [
  'seconds',
  'minutes',
  'hours',
];

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface CallLogDuration {
  value: number;           // 1–60 (validated by app)
  type: CallLogDurationType;
}

export interface CallLogTimeConfig {
  hour: number;    // 1–12
  minute: number;  // 0–59
  second: number;  // 0–59
  amPm: 'am' | 'pm';
}

export interface CallLogData {
  entityType: CallLogEntityType;
  // WHY: callType is derived from entityType — Lead uses Lead type, Contact/Deal uses Contact type
  callType: CallLogType;
  outcome: CallLogOutcome;
  // WHY: duration only required when outcome = Connected
  duration?: CallLogDuration;
  date: Date;               // today or past date only
  timeConfig: CallLogTimeConfig;
  // WHY: disposition, sentiment, customerEmotion are selected randomly from live dropdown
  // Values not hardcoded — selectRandomFromDropdown() reads live options
  callSummary: string;
  recording?: string;
  notes: string;
  // WHY: includeAssociatedDeal only relevant for Contact entity — optional
  includeAssociatedDeal?: boolean;
  customFields: CallLogCustomFieldData;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateTimeConfig(): CallLogTimeConfig {
  return {
    hour: faker.number.int({ min: 1, max: 12 }),
    minute: faker.number.int({ min: 0, max: 59 }),
    second: faker.number.int({ min: 0, max: 59 }),
    amPm: faker.helpers.arrayElement(['am', 'pm']),
  };
}

function generateDuration(): CallLogDuration {
  return {
    // WHY: max 60 is app enforced — automation stays within valid range
    value: faker.number.int({ min: 1, max: 60 }),
    type: faker.helpers.arrayElement(CALL_LOG_DURATION_TYPES),
  };
}

function generatePastDate(): Date {
  // WHY: App only allows today or past dates — never future
  const d = new Date();
  // WHY: Random past date within last 30 days (inclusive of today)
  d.setDate(d.getDate() - faker.number.int({ min: 0, max: 30 }));
  return d;
}

function getCallTypeForEntity(entityType: CallLogEntityType): CallLogType {
  if (entityType === 'Lead') {
    return faker.helpers.arrayElement(CALL_LOG_TYPE_LEAD);
  }
  return faker.helpers.arrayElement(CALL_LOG_TYPE_CONTACT_DEAL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ─────────────────────────────────────────────────────────────────────────────

export function generateCallLogData(overrides: Partial<CallLogData> = {}): CallLogData {
  const entityType: CallLogEntityType =
    overrides.entityType ?? faker.helpers.arrayElement(['Lead', 'Contact', 'Deal']);
  const outcome: CallLogOutcome =
    overrides.outcome ?? faker.helpers.arrayElement(CALL_LOG_OUTCOMES);
  const callType = overrides.callType ?? getCallTypeForEntity(entityType);
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;

  return {
    entityType,
    callType,
    outcome,
    // WHY: Duration generated only when outcome = Connected
    duration: outcome === 'Connected' ? generateDuration() : undefined,
    date: overrides.date ?? generatePastDate(),
    timeConfig: overrides.timeConfig ?? generateTimeConfig(),
    callSummary: `Summary: ${faker.lorem.sentence()} — ${Date.now()}`,
    notes: `Note: ${faker.lorem.sentence()} — ${Date.now()}`,
    includeAssociatedDeal: overrides.includeAssociatedDeal ?? false,
    customFields: generateCallLogCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Admin call log data uses ADM<timestamp> prefix in summary
// Restricted user searching for this summary can NEVER find a call log
// from a previous test run — guaranteed uniqueness across all runs
export function generateAdminCallLogData(overrides: Partial<CallLogData> = {}): CallLogData {
  const ts = Date.now().toString();
  return generateCallLogData({
    entityType: 'Lead',
    outcome: 'Connected',
    callSummary: `ADM${ts} - Admin call log summary`,
    notes: `ADM${ts} - Admin note`,
    ...overrides,
  });
}

// WHY: Restricted call log data uses RES<timestamp> prefix in summary
export function generateRestrictedCallLogData(overrides: Partial<CallLogData> = {}): CallLogData {
  const ts = Date.now().toString();
  return generateCallLogData({
    entityType: 'Lead',
    outcome: 'Connected',
    callSummary: `RES${ts} - Restricted call log summary`,
    notes: `RES${ts} - Restricted note`,
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Date Formatting Helpers
// ─────────────────────────────────────────────────────────────────────────────

// WHY: SingleDatePicker uses aria-label format "day month year"
// e.g. "Thursday, June 19, 2026" — must match exactly for calendar cell click
export function formatDateForCalendarLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// WHY: DateInput value format is MM/DD/YYYY e.g. "06/19/2026"
export function formatDateForInput(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}