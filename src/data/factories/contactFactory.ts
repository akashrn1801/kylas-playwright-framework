import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

export const SALUTATION_OPTIONS = ['Mr', 'Mrs', 'Miss'] as const;
export const CAMPAIGN_OPTIONS = ['Organic'] as const;
export const SOURCE_OPTIONS = ['Google', 'Facebook', 'LinkedIn', 'Exhibition', 'Cold Calling'] as const;

// ──────────────────────────────────────────────────────────────────────────
// Contact Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-09 investigation) — Contact has the same 9
// custom fields as Lead, QA-only for now, with identical names/types and
// identical DOM/locator conventions (see BasePage's "Custom Field Helpers").
// CONTACT_CUSTOM_FIELD_NAMES is its own single source of truth, per
// CLAUDE.md's Custom Fields pattern — never import LEAD_CUSTOM_FIELD_NAMES
// here even though the values happen to be identical today: each module
// owns its own field-name constant so the two can diverge safely later
// (e.g. Contact gaining/losing a field independently of Lead) without any
// collision risk.
export const CONTACT_CUSTOM_FIELD_NAMES = {
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

export type ContactCustomFieldKey = keyof typeof CONTACT_CUSTOM_FIELD_NAMES;

export interface ContactCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList/MultiPickList options only exist live in the DOM (never
  // hardcode them) — these start as placeholders and are overwritten in
  // place by ContactsPage.fillContactForm()/fillEditForm() with whatever
  // was actually selected at fill time, so the same `data` object stays
  // accurate for later verification against the detail page.
  pickList: string;
  multiPickList: string[];
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateContactCustomFieldData(
  overrides: Partial<ContactCustomFieldData> = {}
): ContactCustomFieldData {
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
// WHY: confirmed live (2026-07-14) — same limits and same validation
// mechanisms as Lead's equivalent fields (see leadFactory.ts's own comment
// for the mechanism breakdown): TextField/UrlField reject client-side,
// inline, on blur; ParagraphText has no client-side check at all (its
// input has no `maxlength` attribute) and is only rejected server-side on
// Save via a generic toast. Number is excluded for the same reason as
// Lead's — confirmed live its input has type="number", so Playwright's
// fill() itself throws before the app ever sees an invalid value; there is
// no realistic UI path to trigger this case.
// generated programmatically at call time (string repetition), never
// stored as a literal block of text in this file.
export const generateContactCustomFieldInvalidTextField = (): string => 'A'.repeat(256);
export const generateContactCustomFieldInvalidParagraphText = (): string => 'B'.repeat(2551);
export const generateContactCustomFieldInvalidUrl = (): string => 'not a valid url###';

export interface ContactData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  facebook: string;
  twitter: string;
  linkedin: string; // contacts use lowercase 'linkedin' — differs from leads ('linkedIn')
  department: string;
  designation: string;
  subSource: string;
  salutation: string;
  campaign: string;
  source: string;
  utmSource: string;
  utmCampaign: string;
  utmMedium: string;
  utmContent: string;
  utmTerm: string;
  customFields: ContactCustomFieldData;
}

export function generateContactData(overrides: Partial<ContactData> = {}): ContactData {
  // WHY: destructure customFields out before spreading the rest of overrides —
  // otherwise a partial customFields override would replace the whole
  // generated object below instead of merging into it.
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    email: faker.internet.email({ firstName, lastName }),
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    // WHY: Sanitize username — remove special chars that fail URL validation on staging
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedin: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: faker.helpers.arrayElement(['organic', 'paid', 'referral', 'direct']),
    salutation: faker.helpers.arrayElement([...SALUTATION_OPTIONS]),
    campaign: faker.helpers.arrayElement([...CAMPAIGN_OPTIONS]),
    source: faker.helpers.arrayElement([...SOURCE_OPTIONS]),
    utmSource: faker.helpers.arrayElement(['google', 'facebook', 'twitter', 'email']),
    utmCampaign: faker.lorem.slug(2),
    utmMedium: faker.helpers.arrayElement(['cpc', 'email', 'social', 'banner']),
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Admin contact data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890_John" will NEVER find
// a contact from a previous test run — guaranteed uniqueness.
export function generateAdminContactData(overrides: Partial<ContactData> = {}): ContactData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  const timestamp = Date.now().toString();
  const firstName = `ADM${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    email: `adm${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    // WHY: Sanitize username — remove special chars that fail URL validation on staging
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedin: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: 'organic',
    salutation: faker.helpers.arrayElement([...SALUTATION_OPTIONS]),
    campaign: faker.helpers.arrayElement([...CAMPAIGN_OPTIONS]),
    source: faker.helpers.arrayElement([...SOURCE_OPTIONS]),
    utmSource: 'google',
    utmCampaign: faker.lorem.slug(2),
    utmMedium: 'cpc',
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Shared contact data uses SHR prefix — used for share permission RBAC tests.
// Admin creates the contact, then shares it with restricted user.
// SHR prefix guarantees no collision with ADM or RES contacts from other test runs.
export function generateSharedContactData(overrides: Partial<ContactData> = {}): ContactData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  const timestamp = Date.now().toString();
  const firstName = `SHR${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    email: `shr${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedin: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: 'organic',
    salutation: faker.helpers.arrayElement([...SALUTATION_OPTIONS]),
    campaign: faker.helpers.arrayElement([...CAMPAIGN_OPTIONS]),
    source: faker.helpers.arrayElement([...SOURCE_OPTIONS]),
    utmSource: 'google',
    utmCampaign: faker.lorem.slug(2),
    utmMedium: 'cpc',
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Restricted contact data uses RES prefix — restricted user's own contacts.
// Used in tests that verify admin cannot see restricted user's data.
// RES prefix guarantees no collision with ADM or SHR contacts.
export function generateRestrictedContactData(overrides: Partial<ContactData> = {}): ContactData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  const timestamp = Date.now().toString();
  const firstName = `RES${timestamp}`;
  const lastName = faker.person.lastName();
  const username = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  return {
    firstName,
    lastName,
    email: `res${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    twitter: `https://twitter.com/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    linkedin: `https://linkedin.com/in/${username.replace(/[^a-zA-Z0-9._-]/g, '')}`,
    department: faker.commerce.department(),
    designation: faker.person.jobTitle(),
    subSource: 'organic',
    salutation: faker.helpers.arrayElement([...SALUTATION_OPTIONS]),
    campaign: faker.helpers.arrayElement([...CAMPAIGN_OPTIONS]),
    source: faker.helpers.arrayElement([...SOURCE_OPTIONS]),
    utmSource: 'google',
    utmCampaign: faker.lorem.slug(2),
    utmMedium: 'cpc',
    utmContent: faker.lorem.slug(2),
    utmTerm: faker.lorem.word(),
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}
