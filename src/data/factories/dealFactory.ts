import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Deal Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-24 investigation) — Deal has the same 9
// custom fields as Lead/Contact, QA-only for now, with identical names/types
// and identical DOM/locator conventions (see BasePage's "Custom Field
// Helpers"). Deal has NO lookup-type custom field (no Company/Contact
// Lookup equivalent), unlike Lead. DEAL_CUSTOM_FIELD_NAMES is its own
// single source of truth, per CLAUDE.md's Custom Fields pattern — never
// import LEAD_CUSTOM_FIELD_NAMES/CONTACT_CUSTOM_FIELD_NAMES here even
// though the values happen to be identical today: each module owns its own
// field-name constant so the two can diverge safely later.
export const DEAL_CUSTOM_FIELD_NAMES = {
  textField: 'TextField',
  paragraphText: 'ParagraphText',
  number: 'Number',
  pickList: 'PickList',
  multiPickList: 'MultiPickList',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTimePicker: 'DateTimePicker',
  urlField: 'UrlField',
} as const;

export type DealCustomFieldKey = keyof typeof DEAL_CUSTOM_FIELD_NAMES;

export interface DealCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList/MultiPickList options only exist live in the DOM (never
  // hardcode them) — these start as placeholders and are overwritten in
  // place by DealsPage.fillDealForm()/fillEditForm() with whatever was
  // actually selected at fill time, so the same `data` object stays
  // accurate for later verification against the detail page.
  pickList: string;
  multiPickList: string[];
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateDealCustomFieldData(
  overrides: Partial<DealCustomFieldData> = {}
): DealCustomFieldData {
  return {
    textField: `CF-Text-${faker.string.alphanumeric(12)}`,
    paragraphText: faker.lorem.paragraph(),
    number: faker.number.int({ min: 1, max: 100000 }),
    pickList: '',
    multiPickList: [],
    // WHY: random true/false each run, not a fixed constant — per explicit instruction.
    checkbox: faker.datatype.boolean(),
    date: randomFutureDateWithinOneMonth(),
    dateTimePicker: randomFutureDateWithinOneMonth(),
    urlField: `https://example.com/${faker.string.alphanumeric(10)}`,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────
// Enums — must match exact app-rendered option text
// ──────────────────────────────────────────────────────────

export type DealPipelineStage =
  | 'Open'
  | 'Proposal Sent'
  | 'Negotiation'
  | 'Won'
  | 'Closed Unqualified'
  | 'Closed Lost';

export type DealClosedLostReason =
  | 'No followup'
  | 'Not interested'
  | 'Booked with competitor'
  | 'Not answering/responding'
  | 'Bought product/service with competitor';

export type DealClosedUnqualifiedReason =
  | 'Budget does not match'
  | 'False enquiry'
  | 'Wrong number'
  | 'Customer already bought the product/service'
  | 'Bought product/service with competitor';

export type DealPipelineStageReason = DealClosedLostReason | DealClosedUnqualifiedReason;

export const CLOSED_LOST_REASONS: DealClosedLostReason[] = [
  'No followup',
  'Not interested',
  'Booked with competitor',
  'Not answering/responding',
  'Bought product/service with competitor',
];

export const CLOSED_UNQUALIFIED_REASONS: DealClosedUnqualifiedReason[] = [
  'Budget does not match',
  'False enquiry',
  'Wrong number',
  'Customer already bought the product/service',
  'Bought product/service with competitor',
];

// ──────────────────────────────────────────────────────────
// Enums — must match exact app-rendered option text
// ──────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────
// Interface
// ──────────────────────────────────────────────────────────

export interface DealData {
  // Core
  name: string;

  // Date — always 5 days from today (set at generation time)
  estimatedClosureDate: Date;

  // Pipeline (React Select — dependent: stage auto-populates on pipeline select)
  // These are left as strings so tests can pass dynamic values fetched from the UI
  // if the org has custom pipelines. The factory picks a sensible default.
  pipeline: string;

  // Products
  productName: string; // name to search in product lookup
  productQuantity: number;

  // Part payments
  numberOfInstallments: number; // 1–12

  // WHY: When true, fillDealForm skips associatedContacts and associatedCompany.
  // Used in RBAC tests where we need a deal with no accessible entities so
  // the restricted user cannot see quotations linked to it.
  skipAssociatedEntities?: boolean;

  // WHY: When set, fillDealForm selects this exact contact/company by name
  // instead of a random pre-existing one. Required for any test where the
  // associated entity's ownership/share-state matters (permission tests) —
  // a random pick could land on an entity already owned/shared unpredictably
  // by either test user, per a confirmed live investigation (2026-07-06).
  associatedContactName?: string;
  associatedCompanyName?: string;

  // Attribution
  subSource: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;

  customFields: DealCustomFieldData;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

/**
 * Returns a Date that is `days` calendar days after today (midnight local time).
 * Used for estimatedClosureDate so the date picker always has a future date.
 */
export function futureDateFromToday(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Formats a Date as "MMMM D, YYYY" which matches the aria-label the
 * Kylas date picker emits, e.g. "Friday, May 29, 2026".
 * We use this to click the correct CalendarDay cell.
 */
export function formatDateForCalendarLabel(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Formats a Date as "MMM YYYY" for the month dropdown label, e.g. "May 2026".
 */
export function formatMonthYear(date: Date): { month: string; year: string } {
  return {
    month: date.toLocaleDateString('en-US', { month: 'long' }),
    year: date.getFullYear().toString(),
  };
}

// ──────────────────────────────────────────────────────────
// Factory functions
// ──────────────────────────────────────────────────────────

export function generateDealData(overrides: Partial<DealData> = {}): DealData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return {
    name: `Deal-${faker.commerce.productName()}-${faker.string.alphanumeric(4)}`,
    estimatedClosureDate: futureDateFromToday(5),
    pipeline: 'Default Pipeline', // update if your org uses a different name
    productName: '', // left blank — test will pick first available from dropdown
    productQuantity: faker.number.int({ min: 1, max: 10 }),
    numberOfInstallments: faker.number.int({ min: 2, max: 12 }),
    subSource: faker.helpers.arrayElement(['Organic', 'Paid', 'Referral', 'Direct']),
    utmSource: faker.helpers.arrayElement(['google', 'facebook', 'email', 'linkedin']),
    utmCampaign: `campaign_${faker.string.alphanumeric(6)}`,
    utmMedium: faker.helpers.arrayElement(['cpc', 'organic', 'email', 'social']),
    utmContent: `content_${faker.string.alphanumeric(6)}`,
    utmTerm: faker.helpers.arrayElement(['crm', 'sales', 'deals', 'pipeline']),
    customFields: generateDealCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Admin deal data uses a unique timestamp prefix (ADM<timestamp>) so a
// restricted user searching for this name will NEVER find it — guaranteed
// no collision with any existing or previously created test data.
export function generateAdminDealData(overrides: Partial<DealData> = {}): DealData {
  const timestamp = Date.now().toString();
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return {
    name: `ADM${timestamp}-Deal`,
    estimatedClosureDate: futureDateFromToday(5),
    pipeline: 'Default Pipeline',
    productName: '',
    productQuantity: faker.number.int({ min: 1, max: 5 }),
    numberOfInstallments: 2,
    subSource: 'Organic',
    utmSource: 'google',
    utmCampaign: `adm_campaign_${timestamp}`,
    utmMedium: 'cpc',
    utmContent: `adm_content_${timestamp}`,
    utmTerm: 'crm',
    customFields: generateDealCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Shared deal data uses a unique timestamp prefix (SHR<timestamp>) —
// admin creates it, then shares/reassigns it to the restricted user for
// share/reassign RBAC isolation, mirroring generateSharedLeadData/
// generateSharedContactData/generateSharedCompanyData exactly.
export function generateSharedDealData(overrides: Partial<DealData> = {}): DealData {
  const timestamp = Date.now().toString();
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return {
    name: `SHR${timestamp}-Deal`,
    estimatedClosureDate: futureDateFromToday(5),
    pipeline: 'Default Pipeline',
    productName: '',
    productQuantity: faker.number.int({ min: 1, max: 5 }),
    numberOfInstallments: 2,
    subSource: 'Organic',
    utmSource: 'google',
    utmCampaign: `shr_campaign_${timestamp}`,
    utmMedium: 'cpc',
    utmContent: `shr_content_${timestamp}`,
    utmTerm: 'crm',
    customFields: generateDealCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}
