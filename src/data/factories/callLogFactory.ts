import { faker } from '@faker-js/faker';

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
    ...overrides,
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