import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Company Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-28 investigation) — Company has the same 9
// custom fields as Lead/Contact/Deal, with identical names/types and
// identical DOM/locator conventions (see BasePage's "Custom Field Helpers").
// Company has NO lookup-type custom field, same as Deal. COMPANY_CUSTOM_FIELD_NAMES
// is its own single source of truth, per CLAUDE.md's Custom Fields pattern —
// never import LEAD_CUSTOM_FIELD_NAMES/CONTACT_CUSTOM_FIELD_NAMES/
// DEAL_CUSTOM_FIELD_NAMES here even though the values happen to be identical
// today: each module owns its own field-name constant so the two can diverge
// safely later.
export const COMPANY_CUSTOM_FIELD_NAMES = {
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

export type CompanyCustomFieldKey = keyof typeof COMPANY_CUSTOM_FIELD_NAMES;

// WHY this separate constant exists, not reusing COMPANY_CUSTOM_FIELD_NAMES's
// own textField/paragraphText/number values (2026-09-28, post-sandbox-CI
// cross-shard collision fix): COMPANY_CUSTOM_FIELD_NAMES's cfTextField/
// cfParagraphText/cfNumber are real, shared, account-wide fields that every
// OTHER Company test (not just this feature) also fills with realistic,
// unconstrained random data. The Form Field Limit feature's own tests
// transiently set/clear Regex and Min/Max Length constraints on whichever
// field they target — confirmed live via a real 8-shard sandbox CI run
// (160/898 unrelated test failures, spread across 10 modules) that any other
// concurrently-running test filling the SAME shared field can catch it
// mid-mutation and fail validation, with no cross-shard mutual exclusion
// possible (the config lock is a local-filesystem lock, scoped to one CI
// runner — see formFieldLockFactory.ts's own header comment). The human
// operator created 3 brand-new, dedicated custom fields per entity
// (confirmed live on QA, 2026-09-28: internal names exactly
// cfFormFieldLimitText/cfFormFieldLimitNumber/cfFormFieldLimitParagraph,
// types Text Field/Number/Paragraph Text, rendering correctly on the real
// create form) that NOTHING else in this codebase touches — eliminating the
// collision at its root instead of trying to synchronize around it. This
// feature's own test files must use ONLY this constant, never
// COMPANY_CUSTOM_FIELD_NAMES, for the 3 field types it exercises.
export const COMPANY_FORM_FIELD_LIMIT_NAMES = {
  textField: 'FormFieldLimitText',
  paragraphText: 'FormFieldLimitParagraph',
  number: 'FormFieldLimitNumber',
} as const;

// WHY this constant, and why it must NOT be derived from COMPANY_CUSTOM_
// FIELD_NAMES or the entity name (2026-09-22, Form Field Limit feature,
// Company rollout — same reasoning as LEAD_LAYOUT_CACHE_KEY/
// CONTACT_LAYOUT_CACHE_KEY): the app's IndexedDB `layoutCache` key is not a
// fixed transformation of the entity name. This is Company's own hand-
// verified key, confirmed live via a direct IndexedDB dump, for
// BasePage.clearApplicationCache() — never guess this value.
export const COMPANY_LAYOUT_CACHE_KEY = 'companies';

// ── Invalid values for negative testing (Form Field Limit feature) ──────
// WHY an optional `max` param, defaulting to the field type's own absolute
// ceiling: mirrors leadFactory.ts's/contactFactory.ts's identical fix —
// this file has no pre-existing callers of these two generators (Company's
// factory never needed them before this feature), so there is no
// backward-compatibility constraint to preserve; the optional-default
// shape is adopted from the start for consistency with the other 2
// entities' identical generators.
export const generateCompanyCustomFieldInvalidTextField = (max = 255): string => 'A'.repeat(max + 1);
export const generateCompanyCustomFieldInvalidParagraphText = (max = 2550): string =>
  'B'.repeat(max + 1);

// ── Text field Regex format generators (Form Field Limit feature) ────────
// WHY duplicated here rather than imported from leadFactory.ts/
// contactFactory.ts (2026-09-22, Company rollout — same "each module owns
// its own field-name constant so the two can diverge safely later"
// reasoning already established in this file's own top-of-file comment,
// applied here to Regex-shape generators too): confirmed live
// (REMAINING_ENTITIES_INVESTIGATION.md, and directly re-confirmed for
// Company this session) that the Text field's Regex dropdown offers the
// identical 5 real format options on every entity — but there is no
// guarantee that holds forever, and this module should not silently start
// emitting a different value shape the moment another entity's own
// investigation is updated for an unrelated reason. Every value here is
// still cross-checked against the pattern read LIVE off the config page at
// test-run time (never trusted from the generator alone).
const randomUppercaseLetters = (count: number): string =>
  faker.string.alpha({ length: count, casing: 'upper' });
const randomDigits = (count: number): string => faker.string.numeric(count);

export const generateValidPanCardValue = (): string =>
  `${randomUppercaseLetters(5)}${randomDigits(4)}${randomUppercaseLetters(1)}`;
export const generateInvalidPanCardValue = (): string =>
  `${randomUppercaseLetters(4)}${randomDigits(4)}${randomUppercaseLetters(1)}`;

// WHY the fixed, real `example.com` domain, not a random fake one: mirrors
// leadFactory.ts's/contactFactory.ts's own generateValidEmailFormatValue()
// and its documented reasoning (a random-domain value was the confirmed
// trigger for a load-dependent Lead create-POST timeout, FFL36) — applied
// here preemptively.
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

export interface CompanyCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList/MultiPickList options only exist live in the DOM (never
  // hardcode them) — these start as placeholders and are overwritten in
  // place by CompaniesPage.fillCompanyForm()/fillEditForm() with whatever
  // was actually selected at fill time, so the same `data` object stays
  // accurate for later verification against the detail page.
  pickList: string;
  multiPickList: string[];
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateCompanyCustomFieldData(
  overrides: Partial<CompanyCustomFieldData> = {}
): CompanyCustomFieldData {
  return {
    textField: `CF-Text-${faker.string.alphanumeric(12)}`,
    paragraphText: faker.lorem.paragraph(),
    number: faker.number.int({ min: 1, max: 100000 }),
    pickList: '',
    multiPickList: [],
    checkbox: faker.datatype.boolean(),
    date: randomFutureDateWithinOneMonth(),
    dateTimePicker: randomFutureDateWithinOneMonth(),
    urlField: `https://example.com/${faker.string.alphanumeric(10)}`,
    ...overrides,
  };
}

// WHY: these are the exact values rendered by the numberOfEmployees picklist
// in the app — selecting outside this set will cause option-not-found failures
export const NUMBER_OF_EMPLOYEES_OPTIONS = [
  '1-4',
  '5-9',
  '10-19',
  '20-49',
  '50-99',
  '100-249',
  '250-499',
  '500-999',
  '1000+',
] as const;
export type NumberOfEmployees = (typeof NUMBER_OF_EMPLOYEES_OPTIONS)[number];

// WHY: these are the exact values rendered by the industry picklist
export const INDUSTRY_OPTIONS = [
  'Accounting',
  'Airlines/Aviation',
  'Alternative Dispute Resolution',
  'Alternative Medicine',
  'Animation',
  'Apparel & Fashion',
  'Architecture & Planning',
  'Arts and Crafts',
  'Automotive',
  'Aviation & Aerospace',
] as const;

export type Industry = (typeof INDUSTRY_OPTIONS)[number];

// WHY: these are the exact values rendered by the businessType picklist
export const BUSINESS_TYPE_OPTIONS = [
  'Analyst',
  'Competitor',
  'Customer',
  'Integrator',
  'Investor',
  'Partner',
  'Press',
  'Prospect',
  'Reseller',
  'Other',
] as const;

export type BusinessType = (typeof BUSINESS_TYPE_OPTIONS)[number];

export interface CompanyData {
  name: string;
  numberOfEmployees: NumberOfEmployees;
  industry: Industry;
  businessType: BusinessType;
  annualRevenue: number;
  website: string;
  uniqueText1: string;
  uniqueText2: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipcode: string;
  facebook: string;
  twitter: string;
  linkedIn: string; // companies use 'linkedIn' (capital N) — same as leads
  customFields: CompanyCustomFieldData;
}

export function generateCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const companyName = `${faker.company.name()}-${Date.now()}`;
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;

  return {
    name: companyName,
    numberOfEmployees: faker.helpers.arrayElement(NUMBER_OF_EMPLOYEES_OPTIONS),
    industry: faker.helpers.arrayElement(INDUSTRY_OPTIONS),
    businessType: faker.helpers.arrayElement(BUSINESS_TYPE_OPTIONS),
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: faker.internet.email(),
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    customFields: generateCompanyCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY only Social + Other Details, not a third mixed section: confirmed
// live via the Hide-Empty-Fields investigation that Company's detail page
// has no "Professional"-equivalent tab at all (its confirmed tab set is
// Communication/Location/Social/Other Details/Internals) — numberOfEmployees/
// industry/businessType are literal-string-union types (never `''`) filled
// via CompaniesPage.fillCompanyForm()'s selectPicklistOption(), which is
// data-driven but requires a real, valid option, so they can't be left
// blank via a factory override at all. Social (Facebook/Twitter/LinkedIn)
// is the one genuinely, fully-blankable tab; Other Details (custom fields)
// is the one mixed-state target — same two-target shape already proven
// sufficient for Leads/Contacts.
export function generateMinimalCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return generateCompanyData({
    facebook: '',
    twitter: '',
    linkedIn: '',
    customFields: generateCompanyCustomFieldData({
      textField: '',
      paragraphText: '',
      urlField: '',
      ...customFieldOverrides,
    }),
    ...restOverrides,
  });
}

// WHY: Admin company data uses a unique timestamp prefix to avoid collision
// with old test data in staging/qa databases from previous test runs.
// Restricted user searching for "ADM1234567890 Corp" will NEVER find
// a company from a previous test run — guaranteed uniqueness.
export function generateAdminCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const timestamp = Date.now().toString();
  const name = `ADM${timestamp} Corp`;
  const slug = `adm${timestamp}corp`;
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;

  return {
    name,
    numberOfEmployees: '100-249',
    industry: 'Accounting',
    businessType: 'Prospect',
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: `adm${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    customFields: generateCompanyCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Restricted user's own company data — RES prefix guarantees uniqueness
export function generateRestrictedCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const timestamp = Date.now().toString();
  const name = `RES${timestamp} Corp`;
  const slug = `res${timestamp}corp`;
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;

  return {
    name,
    numberOfEmployees: '100-249',
    industry: 'Accounting',
    businessType: 'Prospect',
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: `res${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    customFields: generateCompanyCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY: Shared company data — SHR prefix, used for share-permission RBAC tests.
// Admin creates the company, then shares it with restricted user.
export function generateSharedCompanyData(overrides: Partial<CompanyData> = {}): CompanyData {
  const timestamp = Date.now().toString();
  const name = `SHR${timestamp} Corp`;
  const slug = `shr${timestamp}corp`;
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;

  return {
    name,
    numberOfEmployees: '100-249',
    industry: 'Accounting',
    businessType: 'Prospect',
    annualRevenue: faker.number.int({ min: 100000, max: 10000000 }),
    website: `https://www.${slug}.com`,
    uniqueText1: `${faker.lorem.word()}_${Date.now()}`,
    uniqueText2: `${faker.lorem.word()}_${Date.now() + 1}`,
    email: `shr${timestamp}@testkylas.com`,
    phone: faker.helpers.arrayElement(['6', '7', '8', '9']) + faker.string.numeric(9),
    address: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipcode: faker.location.zipCode('#####'),
    facebook: `https://facebook.com/${slug}`,
    twitter: `https://twitter.com/${slug}`,
    linkedIn: `https://linkedin.com/company/${slug}`,
    customFields: generateCompanyCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}
