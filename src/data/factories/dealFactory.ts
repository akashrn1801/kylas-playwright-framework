import { faker } from '@faker-js/faker';
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
  productName: string;   // name to search in product lookup
  productQuantity: number;

  // Part payments
  numberOfInstallments: number; // 1–12

  // Attribution
  subSource: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
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
  return {
    name: `Deal-${faker.commerce.productName()}-${faker.string.alphanumeric(4)}`,
    estimatedClosureDate: futureDateFromToday(5),
    pipeline: 'Default Pipeline', // update if your org uses a different name
    productName: '',               // left blank — test will pick first available from dropdown
    productQuantity: faker.number.int({ min: 1, max: 10 }),
    numberOfInstallments: faker.number.int({ min: 2, max: 12 }),
    subSource: faker.helpers.arrayElement(['Organic', 'Paid', 'Referral', 'Direct']),
    utmSource: faker.helpers.arrayElement(['google', 'facebook', 'email', 'linkedin']),
    utmCampaign: `campaign_${faker.string.alphanumeric(6)}`,
    utmMedium: faker.helpers.arrayElement(['cpc', 'organic', 'email', 'social']),
    utmContent: `content_${faker.string.alphanumeric(6)}`,
    utmTerm: faker.helpers.arrayElement(['crm', 'sales', 'deals', 'pipeline']),
    ...overrides,
  };
}

// WHY: Admin deal data uses a unique timestamp prefix (ADM<timestamp>) so a
// restricted user searching for this name will NEVER find it — guaranteed
// no collision with any existing or previously created test data.
export function generateAdminDealData(overrides: Partial<DealData> = {}): DealData {
  const timestamp = Date.now().toString();
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
    ...overrides,
  };
}
