import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

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
// Requirement section (Requirement, Products or Services, Currency, Budget)
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-07-08) — Products/Currency/Budget are standard,
// always-present Lead fields (not environment-conditional custom fields),
// identical for admin and restricted user. Products or Services and
// Currency are react-select fields whose live options are read at fill time
// (Products is technically a lookup against real Product records, but
// confirmed live to show a default list without typing and to correctly
// repopulate its menu after clearing — same interaction shape as a plain
// picklist in practice). Budget is a plain native number input.
//
// WHY "requirementName" (2026-07-16, added later) — confirmed live this is
// a genuine, separate plain text field labeled "Requirement" (internal name
// `requirementName`, id `5_11_input_requirementName`) — distinct from the
// section's own "Requirement" h2 heading and from the 3 fields above. It's
// actually the FIRST field in the section (DOM order confirmed live:
// Requirement text → Products or Services → Currency → Budget), not fourth
// as the fields above were declared/filled in. No maxlength or client-side
// validation observed.
export interface LeadRequirementData {
  requirementName: string;
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
    requirementName: faker.lorem.sentence(),
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
  // WHY: two custom LOOKUP fields (entity-select). Values are the internal
  // Kylas field names (BasePage.customFieldInputLocator prepends "cf", giving
  // cfCompanyLookup / cfContactLookup — confirmed live 2026-07-21). Rendered
  // labels are "Company Lookup" / "Contact Lookup". Unlike the 8 fields above
  // they are live server-side searches (GET /v1/companies/lookup,
  // /v1/search/contact/lookup) whose results are RBAC-scoped per role.
  companyLookup: 'CompanyLookup',
  contactLookup: 'ContactLookup',
} as const;

export type LeadCustomFieldKey = keyof typeof LEAD_CUSTOM_FIELD_NAMES;

// WHY this separate constant, not reusing LEAD_CUSTOM_FIELD_NAMES's own
// textField/paragraphText/number (2026-09-28, post-sandbox-CI cross-shard
// collision fix — see COMPANY_FORM_FIELD_LIMIT_NAMES's identical comment in
// companyFactory.ts for the full incident, applied here unchanged): the
// human operator created 3 dedicated custom fields per entity, confirmed
// live on QA (internal names exactly cfFormFieldLimitText/
// cfFormFieldLimitNumber/cfFormFieldLimitParagraph, types Text Field/Number/
// Paragraph Text). This feature's own test files must use ONLY this
// constant, never LEAD_CUSTOM_FIELD_NAMES, for the 3 field types it
// exercises.
export const LEAD_FORM_FIELD_LIMIT_NAMES = {
  textField: 'FormFieldLimitText',
  paragraphText: 'FormFieldLimitParagraph',
  number: 'FormFieldLimitNumber',
} as const;

// WHY this constant, and why it must NOT be derived from LEAD_CUSTOM_FIELD_
// NAMES or the entity name (2026-09-21, Form Field Limit feature): confirmed
// live (docs/known-issues/form-fields.md) that the app's
// IndexedDB `layoutCache` key for an entity is not a fixed transformation of
// its name — Lead/Deal/Contact happen to be the simple lowercase plural, but
// Products & Services' real key is "products-services", which no derivation
// rule predicts. This is Lead's own hand-verified key, confirmed live, for
// BasePage.clearApplicationCache() — never guess this value for an entity
// not yet verified the same way; see BasePage.clearApplicationCache()'s own
// comment for the full reasoning.
export const LEAD_LAYOUT_CACHE_KEY = 'leads';

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
  // WHY: these are TARGET entity names to search-and-select in the two lookup
  // fields, NOT free-form generated data. They are optional and deliberately
  // left undefined by generateLeadCustomFieldData() — for RBAC correctness the
  // caller MUST pass a specific, known entity name (e.g. an admin-owned
  // company the restricted user should NOT see, or a self-owned one they
  // should) rather than a random value whose ownership/visibility is unknown.
  companyLookupTarget?: string;
  contactLookupTarget?: string;
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
// WHY an optional `max` param, defaulting to the field type's own absolute
// ceiling (2026-09-21, Form Field Limit feature — original doc §1.4's own
// flagged follow-up): confirmed via grep that this codebase's only 2 real
// callers (both in tests/ui/leads/leads.spec.ts) call this with zero
// arguments and must keep getting the exact same 256-char value as before —
// the default preserves that byte-for-byte. The Form Field Limit feature's
// own tests need "one character over whatever max THEY configured" instead,
// which can be anywhere in 0–255, not just the type's absolute ceiling.
export const generateLeadCustomFieldInvalidTextField = (max = 255): string => 'A'.repeat(max + 1);
// ParagraphText max is 2,550 chars — one over is the minimal invalid case.
// WHY optional `max` param: same reasoning as generateLeadCustomFieldInvalidTextField() above.
export const generateLeadCustomFieldInvalidParagraphText = (max = 2550): string =>
  'B'.repeat(max + 1);
// WHY: confirmed live (2026-07-08 custom-fields investigation) — this field
// renders as a native <input type="number">. Both Playwright's fill() and a
// real browser's keystroke handling reject non-numeric characters outright
// on that input type, so there is no realistic UI path to enter an invalid
// Number value — playwright's own fill() throws
// "Cannot type text into input[type=number]" before the app ever sees it.
// No invalid-Number generator is provided; the Step 5 negative test skips
// this field type for this reason instead of manufacturing a fake scenario.
export const generateLeadCustomFieldInvalidUrl = (): string => 'not a valid url###';

// ── Text field Regex format generators (Form Field Limit feature) ────────
// WHY these exist as named, shape-aware generators — not a single hardcoded
// "valid" and "invalid" string per option (2026-09-21, explicit
// requirement): the Text field's Regex dropdown offers 5 real, fixed-format
// options, confirmed live via docs/known-issues/form-fields.md's own
// pattern table. A hardcoded literal per option would silently drift from
// the app's real pattern if it's ever corrected or re-verified; generating
// a value FROM the known shape (and having the caller cross-check it
// against the actual live pattern read off the config page at test-run
// time, via FormFieldsConfigPage.getRegexPatternInfo()) proves the
// generator is right rather than assuming it, every single run — this is
// the same "never hardcode, always confirm live" discipline this codebase
// already applies to react-select dropdown options.
//
// WHY the invalid counterpart deliberately violates exactly ONE constraint
// of the pattern, not an unrelated random string: a completely different
// garbage string (e.g. "???") would still be rejected, but wouldn't prove
// the pattern's own boundary is being enforced precisely — e.g. that PAN
// Card genuinely requires exactly 5 leading letters, not "5 or fewer." Each
// invalid generator below removes exactly one character from the specific
// group most likely to reveal an off-by-one in the app's own validation,
// mirroring the exact shape of invalid example already confirmed live for
// that option in docs/known-issues/form-fields.md (e.g. Passport's
// real confirmed invalid example "A123456" is its own valid shape minus
// one trailing digit — the generator below reproduces that same kind of
// violation programmatically instead of hardcoding that literal).
const randomUppercaseLetters = (count: number): string =>
  faker.string.alpha({ length: count, casing: 'upper' });
const randomDigits = (count: number): string => faker.string.numeric(count);

export const generateValidPanCardValue = (): string =>
  `${randomUppercaseLetters(5)}${randomDigits(4)}${randomUppercaseLetters(1)}`;
// WHY 4 leading letters, not 5: one short of PAN Card's own confirmed
// `^[A-Z]{5}[0-9]{4}[A-Z]{1}$` pattern — the minimal, single-constraint
// violation described above.
export const generateInvalidPanCardValue = (): string =>
  `${randomUppercaseLetters(4)}${randomDigits(4)}${randomUppercaseLetters(1)}`;

// WHY the domain is the fixed, real `example.com` (RFC 2606's reserved
// documentation/testing domain — genuinely resolves in DNS, never delivers
// real mail to an arbitrary local-part), not a random fake domain like the
// original `${faker.string.alpha(6)}.com` (real, confirmed live finding,
// 2026-09-21): FFL36 (the only test consuming this value) failed with a
// genuine `TimeoutError: page.waitForResponse: Timeout 60000ms exceeded`
// on the lead create POST in 2 of 2 real --workers=2 full-suite runs, and
// ONLY this test — no other Add-Lead-creating test in either file (PAN
// Card, Driver Licence, Voting Card, Passport, or any Number/Paragraph
// boundary test) ever showed this symptom, across every run today,
// including runs where the cross-process-lock bug (a separate, confirmed,
// already-fixed issue — see formFieldsTestLock.ts) was ruled out as the
// cause via ground-truth marker-file verification. FFL36 also passed
// cleanly (40.5s) in true single-worker isolation, matching this
// codebase's own established pattern (rule 21) for a load-dependent
// symptom, not proof of no bug. The one property unique to THIS test's own
// value, never shared by any of the other regex tests' structurally
// different values, is that it is the only one shaped like a genuine email
// address — a plausible trigger for server-side email-format
// validation/enrichment logic (common in CRMs, not necessarily scoped to a
// dedicated "Email" system field) attempting a live DNS/MX lookup against
// whatever domain is submitted. A lookup against a domain that has never
// existed (a fresh random string every run) is a materially different,
// plausibly slower case for a resolver than one against a real,
// permanently-registered domain. This is a hardened fix based on this
// reasoning, not a confirmed root cause (no backend/network access to
// prove it directly) — labeled honestly per this codebase's own standing
// rule for exactly this situation. If FFL36 continues failing after this
// change, the email-shape-triggers-a-slow-lookup hypothesis is disproven
// and a different explanation is needed.
export const generateValidEmailFormatValue = (): string =>
  `${faker.string.alpha({ length: 8, casing: 'lower' })}@example.com`;
// WHY omitting the TLD segment entirely, not just shortening it: mirrors
// the exact confirmed invalid example shape from
// docs/known-issues/form-fields.md ("john.doe@example" — a real local-part@domain
// with no ".tld" at all), the most direct single-constraint violation of
// the pattern's own `\.[A-Za-z]{2,}$` requirement.
export const generateInvalidEmailFormatValue = (): string =>
  `${faker.string.alpha({ length: 8, casing: 'lower' })}@${faker.string.alpha({
    length: 6,
    casing: 'lower',
  })}`;

export const generateValidDriverLicenceValue = (): string =>
  `${randomUppercaseLetters(2)} ${randomDigits(2)} ${randomDigits(4)} ${randomDigits(7)}`;
// WHY 6 trailing digits, not 7: one short of Driver Licence's own confirmed
// `^[A-Za-z]{2}[- ]?[0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{7}$` pattern.
export const generateInvalidDriverLicenceValue = (): string =>
  `${randomUppercaseLetters(2)} ${randomDigits(2)} ${randomDigits(4)} ${randomDigits(6)}`;

export const generateValidVotingCardValue = (): string =>
  `${randomUppercaseLetters(3)}${randomDigits(7)}`;
// WHY 5 trailing digits, not 7: reproduces the exact confirmed invalid
// example shape ("ABC12345") for Voting Card's own `^[A-Z]{3}[0-9]{7}$`
// pattern.
export const generateInvalidVotingCardValue = (): string =>
  `${randomUppercaseLetters(3)}${randomDigits(5)}`;

export const generateValidPassportValue = (): string =>
  `${randomUppercaseLetters(1)}${randomDigits(7)}`;
// WHY 6 trailing digits, not 7: reproduces the exact confirmed invalid
// example shape ("A123456") for Passport's own `^[A-Z][0-9]{7}$` pattern.
export const generateInvalidPassportValue = (): string =>
  `${randomUppercaseLetters(1)}${randomDigits(6)}`;

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
  // WHY: placeholders, overwritten in place by LeadsPage.fillLeadForm() with
  // whichever live option was actually selected — same pattern as
  // salutation/campaign/source above. Country specifically may also end up
  // populated by a successful GPS address selection rather than an explicit
  // random pick — confirmed live (2026-07-16) that a real GPS-selected
  // address auto-fills Country, so this placeholder gets overwritten either
  // way, just via a different path depending on whether GPS or the manual
  // fallback was used.
  timezone: string;
  companyIndustry: string;
  companyBusinessType: string;
  companyEmployees: string;
  companyAnnualRevenue: number;
  companyWebsite: string;
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
    timezone: '',
    companyIndustry: '',
    companyBusinessType: '',
    companyEmployees: '',
    companyAnnualRevenue: faker.number.int({ min: 10000, max: 10000000 }),
    companyWebsite: faker.internet.url(),
    pipelineStage: 'Open' as LeadPipelineStage,
    customFields: generateLeadCustomFieldData(customFieldOverrides),
    campaignInfo: generateLeadCampaignData(campaignInfoOverrides),
    requirement: generateLeadRequirementData(requirementOverrides),
    ...restOverrides,
  };
}

// WHY this specific subset, not every optional field: Timezone, Country,
// Company Industry/Business Type/Company Employees, Campaign/Source, and
// Requirement's Products-or-Services/Currency are all confirmed live to be
// UNCONDITIONALLY random-picked by LeadsPage.fillLeadForm() regardless of
// what value is passed here (the same class of gap fixed with
// skipOptionalFields on CallLogsPage — see docs/known-issues/locators-and-timing.md) —
// so blanking them via override would silently have no effect, not
// genuinely leave them empty. PickList/MultiPickList custom fields are the
// same. The fields below are the ones CONFIRMED to respect a plain empty-
// string override (verified live via the Hide-Empty-Fields investigation):
// blanking all 3 Social fields empties that entire tab (confirmed live to
// fully collapse it), and blanking these specific Professional/Requirement/
// Other-Details fields leaves each of those tabs genuinely mixed (some
// fields populated, some empty) — the two distinct shapes the Hide-Empty-
// Fields tests need.
export function generateMinimalLeadData(overrides: Partial<LeadData> = {}): LeadData {
  const { requirement: requirementOverrides, customFields: customFieldOverrides, ...restOverrides } =
    overrides;
  return generateLeadData({
    facebook: '',
    twitter: '',
    linkedIn: '',
    companyName: '',
    department: '',
    designation: '',
    companyAddress: '',
    companyCity: '',
    companyState: '',
    companyZipcode: '',
    companyWebsite: '',
    requirement: generateLeadRequirementData({ requirementName: '', ...requirementOverrides }),
    customFields: generateLeadCustomFieldData({
      textField: '',
      paragraphText: '',
      urlField: '',
      ...customFieldOverrides,
    }),
    ...restOverrides,
  });
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
    timezone: '',
    companyIndustry: '',
    companyBusinessType: '',
    companyEmployees: '',
    companyAnnualRevenue: faker.number.int({ min: 10000, max: 10000000 }),
    companyWebsite: faker.internet.url(),
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
    timezone: '',
    companyIndustry: '',
    companyBusinessType: '',
    companyEmployees: '',
    companyAnnualRevenue: faker.number.int({ min: 10000, max: 10000000 }),
    companyWebsite: faker.internet.url(),
    pipelineStage: 'Open' as LeadPipelineStage,
    customFields: generateLeadCustomFieldData(customFieldOverrides),
    campaignInfo: generateLeadCampaignData(campaignInfoOverrides),
    requirement: generateLeadRequirementData(requirementOverrides),
    ...restOverrides,
  };
}
