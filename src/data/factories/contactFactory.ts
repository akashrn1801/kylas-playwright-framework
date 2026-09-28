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

// WHY this constant, and why it must NOT be derived from CONTACT_CUSTOM_
// FIELD_NAMES or the entity name (2026-09-22, Form Field Limit feature,
// Contact rollout — same reasoning as LEAD_LAYOUT_CACHE_KEY in
// leadFactory.ts, confirmed live independently for Contact via
// REMAINING_ENTITIES_INVESTIGATION.md's own live IndexedDB dump): the app's
// IndexedDB `layoutCache` key is not a fixed transformation of the entity
// name — Lead/Deal/Contact/Company happen to be the simple lowercase
// plural, but Products & Services' real key is "products-services". This is
// Contact's own hand-verified key, confirmed live, for
// BasePage.clearApplicationCache() — never guess this value.
export const CONTACT_LAYOUT_CACHE_KEY = 'contacts';

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
// WHY an optional `max` param, defaulting to the field type's own absolute
// ceiling (2026-09-22, Form Field Limit feature, Contact rollout — mirrors
// leadFactory.ts's identical fix): the existing 2 callers (both in
// contacts.spec.ts) call this with zero arguments and must keep getting the
// exact same 256/2551-char value as before — the default preserves that
// byte-for-byte (confirmed via grep, only 2 real call sites, both
// zero-arg). This feature's own tests need "one character over whatever
// max THEY configured" instead, which can be anywhere in 0-255/0-2550.
export const generateContactCustomFieldInvalidTextField = (max = 255): string => 'A'.repeat(max + 1);
export const generateContactCustomFieldInvalidParagraphText = (max = 2550): string =>
  'B'.repeat(max + 1);
export const generateContactCustomFieldInvalidUrl = (): string => 'not a valid url###';

// ── Text field Regex format generators (Form Field Limit feature) ────────
// WHY duplicated here rather than imported from leadFactory.ts (2026-09-22,
// Contact rollout — deliberate, matching this file's own established
// convention, not an oversight): CLAUDE.md's Custom Fields pattern already
// establishes "never import one module's [field] constants into another's —
// each module owns its own... field sets diverge over time"
// (reference-patterns.md §9) for exactly this reason. These generators
// encode the Text field's Regex dropdown's real pattern SHAPES — confirmed
// live (REMAINING_ENTITIES_INVESTIGATION.md) to be identical across every
// entity today, but there is no guarantee that holds forever, and this
// module should not silently start emitting a different (Lead's own) value
// shape the moment Lead's own investigation is updated for a Lead-specific
// reason. Every value here is still cross-checked against the pattern read
// LIVE off the config page at test-run time (never trusted from the
// generator alone) — see contactFieldLimits.spec.ts's own
// assertGeneratedValueMatchesLivePattern().
const randomUppercaseLetters = (count: number): string =>
  faker.string.alpha({ length: count, casing: 'upper' });
const randomDigits = (count: number): string => faker.string.numeric(count);

export const generateValidPanCardValue = (): string =>
  `${randomUppercaseLetters(5)}${randomDigits(4)}${randomUppercaseLetters(1)}`;
export const generateInvalidPanCardValue = (): string =>
  `${randomUppercaseLetters(4)}${randomDigits(4)}${randomUppercaseLetters(1)}`;

// WHY the fixed, real `example.com` domain, not a random fake one: mirrors
// leadFactory.ts's own generateValidEmailFormatValue() and its documented
// reasoning (a random-domain value was the confirmed trigger for a
// load-dependent Lead create-POST timeout, FFL36) — applied here
// preemptively rather than waiting for the identical symptom to recur on
// Contact's own create form.
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
  // WHY: placeholders, overwritten in place by ContactsPage.fillContactForm()
  // with whatever was actually selected live — same reasoning as
  // salutation/campaign/source above. Company specifically is a live,
  // role-scoped async lookup against real Company records (confirmed live
  // 2026-07-16 that admin and restricted user see genuinely different result
  // sets for the same search term) — never hardcode a company name here.
  timezone: string;
  company: string;
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
    timezone: '',
    company: '',
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}

// WHY this specific subset: confirmed live via ContactsPage.fillContactForm()
// that Company (a live async lookup) is unconditionally random-picked
// regardless of what's passed here (`data.company || undefined` falls
// through to the random-pick branch on falsy input) — same class of gap as
// LeadsPage's unconditional react-selects — so Professional never goes
// fully empty, only mixed. Campaign/Source ARE genuinely conditional here
// (`if (data.campaign)`/`if (data.source)`), unlike Lead's equivalent —
// confirmed live via direct code read, not assumed to transfer from Lead —
// so Campaign Information (unlike Lead's) CAN be driven to a true 100%-empty
// state, giving Contact a second tab-collapse target beyond Social.
export function generateMinimalContactData(overrides: Partial<ContactData> = {}): ContactData {
  const { customFields: customFieldOverrides, ...restOverrides } = overrides;
  return generateContactData({
    facebook: '',
    twitter: '',
    linkedin: '',
    department: '',
    designation: '',
    campaign: '',
    source: '',
    subSource: '',
    utmSource: '',
    utmCampaign: '',
    utmMedium: '',
    utmContent: '',
    utmTerm: '',
    customFields: generateContactCustomFieldData({
      textField: '',
      paragraphText: '',
      urlField: '',
      ...customFieldOverrides,
    }),
    ...restOverrides,
  });
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
    timezone: '',
    company: '',
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
    timezone: '',
    company: '',
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
    timezone: '',
    company: '',
    customFields: generateContactCustomFieldData(customFieldOverrides),
    ...restOverrides,
  };
}
