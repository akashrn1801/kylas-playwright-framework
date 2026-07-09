import { faker } from '@faker-js/faker';

// ──────────────────────────────────────────────────────────────────────────
// Campaign Information
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-08) — Lead's Campaign Information section has
// 8 fields: Campaign and Source are react-select dropdowns (options are
// account-configured, read live — never hardcode a value), the rest are
// plain text inputs. This is one field MORE than Contact/Deal's equivalent
// section (contactFactory.ts / dealFactory.ts) — they have no standalone
// "Source" field, only "Sub Source" — confirmed by reading Lead's live DOM
// directly rather than assuming the sections are identical.
export interface LeadCampaignData {
  // WHY: placeholders, overwritten in place by LeadsPage.fillLeadForm() with
  // whichever live option was actually selected — same pattern as
  // LeadCustomFieldData.pickList/multiPickList below, for the same reason.
  campaign: string;
  source: string;
  subSource: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
}

export function generateLeadCampaignData(
  overrides: Partial<LeadCampaignData> = {}
): LeadCampaignData {
  return {
    campaign: '',
    source: '',
    subSource: faker.helpers.arrayElement(['Organic', 'Paid', 'Referral', 'Direct']),
    utmSource: faker.helpers.arrayElement(['google', 'facebook', 'email', 'linkedin']),
    utmCampaign: `campaign_${faker.string.alphanumeric(6)}`,
    utmMedium: faker.helpers.arrayElement(['cpc', 'organic', 'email', 'social']),
    utmContent: `content_${faker.string.alphanumeric(6)}`,
    utmTerm: faker.helpers.arrayElement(['crm', 'sales', 'deals', 'pipeline']),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Requirement section (Products or Services, Currency, Budget)
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-08) — these are standard, always-present Lead
// fields (not environment-conditional custom fields), identical for admin
// and restricted user. Products or Services and Currency are react-select
// fields whose live options are read at fill time (Products is technically a
// lookup against real Product records, but confirmed live to show a default
// list without typing and to correctly repopulate its menu after clearing —
// same interaction shape as a plain picklist in practice). Budget is a plain
// native number input.
export interface LeadRequirementData {
  // WHY: placeholders, overwritten in place by LeadsPage at fill time with
  // whatever was actually selected live — same reasoning as
  // LeadCustomFieldData.pickList/multiPickList above.
  productsOrServices: string[];
  currency: string;
  budget: number;
}

export function generateLeadRequirementData(
  overrides: Partial<LeadRequirementData> = {}
): LeadRequirementData {
  return {
    productsOrServices: [],
    currency: '',
    budget: faker.number.int({ min: 1000, max: 1000000 }),
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Lead Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: These 9 fields exist ONLY on the Lead entity on QA as of 2026-07-08.
// They are expected to be added to Stage/Prod later by hand, with identical
// names and types. LEAD_CUSTOM_FIELD_NAMES is the single source of truth for
// the exact (case-sensitive) Kylas field names — BasePage's fill/verify
// helpers, LeadsPage, and leads.spec.ts all import from here instead of
// retyping the strings, so a typo in one place can't silently break another.
export const LEAD_CUSTOM_FIELD_NAMES = {
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

export type LeadCustomFieldKey = keyof typeof LEAD_CUSTOM_FIELD_NAMES;

export interface LeadCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList/MultiPickList options only exist live in the DOM (never
  // hardcode them) — these start as placeholders and are overwritten in
  // place by LeadsPage.fillLeadForm()/fillEditForm() with whatever was
  // actually selected at fill time, so the same `data` object stays
  // accurate for later verification against the detail page.
  pickList: string;
  multiPickList: string[];
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

// WHY: today through today+1 month, computed relative to the real current
// date at runtime — never a hardcoded date. Includes a random hour/minute
// for dateTimePicker's use; the plain Date field simply ignores the time
// portion when it's filled.
function randomFutureDateWithinOneMonth(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offsetDays = Math.floor(Math.random() * 31); // 0..30 inclusive
  const result = new Date(today);
  result.setDate(result.getDate() + offsetDays);
  result.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), 0, 0);
  return result;
}

export function generateLeadCustomFieldData(
  overrides: Partial<LeadCustomFieldData> = {}
): LeadCustomFieldData {
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

// ── Invalid values for negative testing ─────────────────────────────────
// WHY: generated programmatically at call time (string repetition), never
// stored as a literal block of text in this file.
// TextField max is 255 chars — one over is the minimal invalid case.
export const generateLeadCustomFieldInvalidTextField = (): string => 'A'.repeat(256);
// ParagraphText max is 2,550 chars — one over is the minimal invalid case.
export const generateLeadCustomFieldInvalidParagraphText = (): string => 'B'.repeat(2551);
// WHY: confirmed live (2026-07-08 custom-fields investigation) — this field
// renders as a native <input type="number">. Both Playwright's fill() and a
// real browser's keystroke handling reject non-numeric characters outright
// on that input type, so there is no realistic UI path to enter an invalid
// Number value — playwright's own fill() throws
// "Cannot type text into input[type=number]" before the app ever sees it.
// No invalid-Number generator is provided; the Step 5 negative test skips
// this field type for this reason instead of manufacturing a fake scenario.
export const generateLeadCustomFieldInvalidUrl = (): string => 'not a valid url###';

export type LeadPipelineStage =
  | 'Open'
  | 'Prospect/Contacted'
  | 'Requirements Gathered'
  | 'Demo/Meeting Conducted'
  | 'Won'
  | 'Closed Unqualified'
  | 'Closed Lost';

export const LEAD_PIPELINE_STAGES: LeadPipelineStage[] = [
  'Open',
  'Prospect/Contacted',
  'Requirements Gathered',
  'Demo/Meeting Conducted',
  'Won',
  'Closed Unqualified',
  'Closed Lost',
];

export interface LeadData {
  firstName: string;
  lastName: string;
  // WHY: was a hardcoded 'Mr' | 'Mrs' | 'Miss' union, but never actually
  // filled into the form (dead data) until 2026-07-08. Now that it's wired
  // up, the value is selected live from the DOM at fill time (per "never
  // hardcode option values") and this field is just the placeholder that
  // gets overwritten in place with whatever was actually picked — a plain
  // `string` reflects that it's no longer a fixed, hardcoded set.
  salutation: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  country: string;
  facebook: string;
  twitter: string;
  linkedIn: string;
  companyName: string;
  department: string;
  designation: string;
  companyAddress: string;
  companyCity: string;
  companyState: string;
  companyZipcode: string;
  companyCountry: string;
  pipelineStage?: LeadPipelineStage;
  customFields: LeadCustomFieldData;
  campaignInfo: LeadCampaignData;
  requirement: LeadRequirementData;
}

export function generateLeadData(overrides: Partial<LeadData> = {}): LeadData {
  // WHY: destructure customFields out before spreading the rest of overrides —
  // otherwise a partial customFields override would replace the whole
  // generated object below instead of merging into it.
  const {
    customFields: customFieldOverrides,
    campaignInfo: campaignInfoOverrides,
    requirement: requirementOverrides,
    ...restOverrides
  } = overrides;
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    salutation: '', // WHY: placeholder — selected live from the DOM at fill time, never hardcoded
    email: faker.internet.email({ firstName, lastName }),
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    country: 'India',
    // WHY: Sanitize username — remove special chars that fail URL validation
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedIn: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    pipelineStage: 'Open' as LeadPipelineStage,
    customFields: generateLeadCustomFieldData(customFieldOverrides),
    campaignInfo: generateLeadCampaignData(campaignInfoOverrides),
    requirement: generateLeadRequirementData(requirementOverrides),
    ...restOverrides,
  };
}

// WHY: Admin lead data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890_John" will NEVER find
// a lead from a previous test run — guaranteed uniqueness.
export function generateAdminLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const {
    customFields: customFieldOverrides,
    campaignInfo: campaignInfoOverrides,
    requirement: requirementOverrides,
    ...restOverrides
  } = overrides;
  const timestamp = Date.now().toString();
  const firstName = `ADM${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    salutation: '', // WHY: placeholder — selected live from the DOM at fill time, never hardcoded
    email: `adm${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    country: 'India',
    // WHY: Sanitize username — remove special chars that fail URL validation
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedIn: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    pipelineStage: 'Open' as LeadPipelineStage,
    customFields: generateLeadCustomFieldData(customFieldOverrides),
    campaignInfo: generateLeadCampaignData(campaignInfoOverrides),
    requirement: generateLeadRequirementData(requirementOverrides),
    ...restOverrides,
  };
}

// WHY: Shared lead data uses SHR prefix — guarantees uniqueness for share/reassign tests
// Admin creates SHR-prefixed lead, shares with restricted user
// Restricted user searches by SHR prefix — never collides with ADM or random leads
export function generateSharedLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const {
    customFields: customFieldOverrides,
    campaignInfo: campaignInfoOverrides,
    requirement: requirementOverrides,
    ...restOverrides
  } = overrides;
  const timestamp = Date.now().toString();
  const firstName = `SHR${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    salutation: '', // WHY: placeholder — selected live from the DOM at fill time, never hardcoded
    email: `shr${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    country: 'India',
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedIn: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    companyName: faker.company.name(),
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    companyAddress: faker.location.streetAddress(),
    companyCity: faker.location.city(),
    companyState: faker.location.state(),
    companyZipcode: faker.location.zipCode('#####'),
    companyCountry: 'India',
    pipelineStage: 'Open' as LeadPipelineStage,
    customFields: generateLeadCustomFieldData(customFieldOverrides),
    campaignInfo: generateLeadCampaignData(campaignInfoOverrides),
    requirement: generateLeadRequirementData(requirementOverrides),
    ...restOverrides,
  };
}
