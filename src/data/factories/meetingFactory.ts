import { faker } from '@faker-js/faker';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const MEETING_STATUS_OPTIONS = ['scheduled', 'conducted', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUS_OPTIONS)[number];

export const MEETING_MEDIUM_OPTIONS = ['OFFLINE', 'GOOGLE_MEET', 'OUTLOOK'] as const;
export type MeetingMedium = (typeof MEETING_MEDIUM_OPTIONS)[number];

export const MEETING_ENTITY_TYPES = ['lead', 'contact', 'deal', 'company'] as const;
export type MeetingEntityType = (typeof MEETING_ENTITY_TYPES)[number];

export const TIMEZONE_OPTION = '(GMT+05:30) Chennai, Kolkata, Mumbai, New Delhi / Sri Jayawardenapura';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface MeetingTimeConfig {
  fromHour: number;   // 24-hour format
  fromMinute: number;
  toHour: number;     // fromHour + 2
  toMinute: number;
  amPmFrom: 'am' | 'pm';
  amPmTo: 'am' | 'pm';
}

export interface MeetingData {
  title: string;
  status: MeetingStatus;
  timezone: string;
  location: string;
  description: string;
  inviteeSearchTerm: string;
  timeConfig: MeetingTimeConfig;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generates a from/to time config.
 * From = current time rounded to nearest 15 min.
 * To = from + 2 hours.
 * Ensures minimum 30-min gap.
 */
export function generateTimeConfig(): MeetingTimeConfig {
  const now = new Date();
  // Round up to next 15-min slot
  const minutes = Math.ceil(now.getMinutes() / 15) * 15;
  const fromDate = new Date(now);
  fromDate.setMinutes(minutes % 60, 0, 0);
  if (minutes === 60) fromDate.setHours(fromDate.getHours() + 1);

  const toDate = new Date(fromDate.getTime() + 2 * 60 * 60 * 1000);

  const fromHour24 = fromDate.getHours();
  const toHour24 = toDate.getHours();

  return {
    fromHour: fromHour24 % 12 === 0 ? 12 : fromHour24 % 12,
    fromMinute: fromDate.getMinutes(),
    toHour: toHour24 % 12 === 0 ? 12 : toHour24 % 12,
    toMinute: toDate.getMinutes(),
    amPmFrom: fromHour24 < 12 ? 'am' : 'pm',
    amPmTo: toHour24 < 12 ? 'am' : 'pm',
  };
}

/**
 * Returns a date string in "MMM D, YYYY" format (matching the date picker),
 * offset by the given number of days from today.
 */
export function getFutureDate(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function generateMeetingData(overrides: Partial<MeetingData> = {}): MeetingData {
  return {
    title: `${faker.company.buzzVerb()} ${faker.company.buzzNoun()} Meeting`,
    status: 'scheduled',
    timezone: TIMEZONE_OPTION,
    location: `${faker.location.streetAddress()}, ${faker.location.city()}, India`,
    description: `Meeting created by automation. Agenda: ${faker.lorem.sentence()}`,
    inviteeSearchTerm: 'playwright',
    timeConfig: generateTimeConfig(),
    ...overrides,
  };
}

/**
 * Admin-prefixed data for RBAC isolation tests.
 * The ADM<timestamp> prefix guarantees this record is unique across runs —
 * a restricted user searching for this title can never find data from a prior run.
 */
export function generateAdminMeetingData(overrides: Partial<MeetingData> = {}): MeetingData {
  const timestamp = Date.now().toString();
  return {
    title: `ADM${timestamp} Meeting`,
    status: 'scheduled',
    timezone: TIMEZONE_OPTION,
    location: `${faker.location.streetAddress()}, Pune, India`,
    description: `Admin meeting created at ${timestamp}. RBAC isolation test.`,
    inviteeSearchTerm: 'playwright',
    timeConfig: generateTimeConfig(),
    ...overrides,
  };
}

/**
 * Restricted-user-prefixed data for RBAC tests.
 */
export function generateRestrictedMeetingData(overrides: Partial<MeetingData> = {}): MeetingData {
  const timestamp = Date.now().toString();
  return {
    title: `RST${timestamp} Meeting`,
    status: 'scheduled',
    timezone: TIMEZONE_OPTION,
    location: `${faker.location.streetAddress()}, Mumbai, India`,
    description: `Restricted user meeting created at ${timestamp}.`,
    inviteeSearchTerm: 'playwright',
    timeConfig: generateTimeConfig(),
    ...overrides,
  };
}
// Re-exported here so MeetingsPage can import from one place
export function formatDateForCalendarLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
