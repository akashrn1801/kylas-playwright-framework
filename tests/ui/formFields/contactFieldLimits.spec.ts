import { test, expect, withContactFormFieldLock } from './contactFormFieldLock';
// WHY a second, separate `test` import here — mirrors
// companyFieldLimits.spec.ts's own identical `baseTest` import (2026-09-29,
// Fix 2 for the dated known-issues.md entry, "A cross-process lock only
// protects workers on the SAME filesystem"): confirmed via a complete,
// per-test code-level audit that every Navigation test below only ever
// READS field config, never calls configureFieldLimit()/
// configureFieldRegex()/clearAllFieldConfigurations().
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  CONTACT_FORM_FIELD_LIMIT_NAMES,
  CONTACT_LAYOUT_CACHE_KEY,
  generateContactData,
  ContactData,
  generateContactCustomFieldInvalidTextField,
  generateInvalidPanCardValue,
  generateValidEmailFormatValue,
  generateInvalidEmailFormatValue,
  generateValidDriverLicenceValue,
  generateInvalidDriverLicenceValue,
  generateValidVotingCardValue,
  generateInvalidVotingCardValue,
  generateValidPassportValue,
  generateInvalidPassportValue,
} from '../../../src/data/factories/contactFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this is the Contact rollout of the Form Field Limit feature — the
// SAME reusable architecture already proven for Lead (58/58 tests passing,
// 0 failed/flaky/skipped — see LEAD_FEATURE_RETROSPECTIVE.md and
// LEAD_FEATURE_IMPLEMENTATION_CONTEXT.md), not a re-derivation. Every
// structural choice below (per-field serial blocks, the accept/reject save
// split, the minimal-fill architecture) mirrors leadFieldLimits.spec.ts
// exactly — see that file's own top-of-file comment for the full original
// reasoning, restated here only where Contact's own confirmed facts differ.
//
// WHY a SEPARATE lock (contactFormFieldLock.ts, entity key "contacts"), not
// Lead's own leadFormFieldLock: Contact's tests mutate cfTextField/cfNumber/
// cfParagraphText on the CONTACT tab of the shared Form Fields screen — a
// genuinely independent piece of account-wide config from Lead's own same-
// named fields on the LEAD tab. Serializing Contact's tests against Lead's
// would cost real wall-clock time for zero correctness benefit — see
// formFieldLockFactory.ts's own header comment for the full reasoning on
// why this is a parameterized factory rather than a 2nd hand-copied lock
// file.
//
// WHY Contact's own live-confirmed facts (REMAINING_ENTITIES_INVESTIGATION.md,
// cross-checked live again during this implementation — see this session's
// own diagnostic pass): Contact's CREATE form is a standalone page, NOT
// `#editEntityModal` (confirmed live: clickAddContact() navigates within
// the create page, `saveButton()` is `button[type="submit"].save-button`,
// page-wide, not modal-scoped) — but Contact's EDIT form IS
// `#editEntityModal` (confirmed via ContactsPage.clickEditIcon()). This
// asymmetry has NO impact on this file's own reject-path tests, because —
// confirmed directly from leadFieldLimits.spec.ts's own real behavior —
// the reject path NEVER clicks Save at all (the inline error renders on
// blur, before Save is ever reached), so BasePage.clickModalSaveButton()'s
// modal-only locator is never a dependency here regardless of which
// surface Save happens to live on for a given entity. Only lastName is
// confirmed live to be required for Contact to save (a fresh diagnostic
// create with ONLY lastName filled succeeded, id captured) — Contact has no
// Lead-equivalent "Pipeline" dependency, so the minimal-fill set is even
// smaller than Lead's own. Contact's detail-page "Other Details" tab DOES
// carry the same `data-targetid="Other Details"` attribute Lead's does
// (confirmed live via direct DOM read) — BasePage.clickDetailPageTab()
// works unchanged, no Contact-specific tab-click method needed.

const CONTACT_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Contact', urlSlug: 'contacts' };
const OTHER_DETAILS_TAB = 'Other Details';

const TEXT_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.textField}`;
const NUMBER_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.number}`;
const PARAGRAPH_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

// WHY these specific min/max pairs: same reasoning as leadFieldLimits.spec.ts
// — small, fast-to-type values sufficient to exercise the real under/at/over
// boundary logic without the runtime cost of typing hundreds of characters.
const TEXT_MIN = 3;
const TEXT_MAX = 6;
const TEXT_REPEAT_CHAR = 'A';

const PARAGRAPH_MIN = 5;
const PARAGRAPH_MAX = 9;
const PARAGRAPH_REPEAT_CHAR = 'B';

const NUMBER_MIN = 3;
const NUMBER_MAX = 6;
const NUMBER_REPEAT_CHAR = '1';

function repeatChar(char: string, length: number): string {
  return char.repeat(Math.max(0, length));
}

// ─── Shared local action helpers ──────────────────────────────────────────
// WHY these live only in this spec file: thin, test-shaped compositions of
// already-public page-object methods — see leadFieldLimits.spec.ts's
// identical top-of-block note for the full reasoning.

// WHY 'key-not-found' is a successful no-op, not a failure: mirrors
// leadFieldLimits.spec.ts's clearLeadApplicationCache() exactly — a session
// that has never opened the Contact create/edit form yet has nothing
// cached, which already IS the desired end state.
async function clearContactApplicationCache(targetPage: Page): Promise<void> {
  const contactsPage = new ContactsPage(targetPage);
  const result = await contactsPage.clearApplicationCache(CONTACT_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Contact application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Contact create/update flow for this feature — architecture note
// ============================================================================
// WHY exactly two Contact-mutation paths exist below, deliberately
// different, never merged into one shared function: mirrors
// leadFieldLimits.spec.ts's own identical split exactly — see that file's
// top-of-block architecture note (and LEAD_FEATURE_RETROSPECTIVE.md §1) for
// the full evidence chain this reuses unchanged. In short: a "Save click
// resolves, zero network request ever fires" symptom is a client-side
// validation block, not a backend/timing bug — retrying it as transient
// only wastes minutes reproducing the identical failure. PATH 1 (ACCEPT)
// delegates entirely to ContactsPage.createContact()/its own edit-path
// equivalent, which already contain the proven transient-retry/reset logic.
// PATH 2 (REJECT) performs ONLY the open+fill half — no Save click at all —
// asserting the inline error directly.
// ============================================================================

type SupportedCustomFieldKey = 'textField' | 'paragraphText' | 'number';

function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
  if (fieldName === CONTACT_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
  if (fieldName === CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
  if (fieldName === CONTACT_FORM_FIELD_LIMIT_NAMES.number) return 'number';
  throw new Error(
    `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
  );
}

interface ContactFieldUnderTest {
  fieldName: string;
  value: string;
}

function buildContactDataWithFieldOverride(lastName: string, field: ContactFieldUnderTest): ContactData {
  const contactData = generateContactData({ lastName });
  const dataKey = customFieldNameToDataKey(field.fieldName);
  if (dataKey === 'number') {
    // WHY a separate branch, not a shared cast: ContactCustomFieldData.number
    // is a real `number`, never a string — same reasoning as
    // leadFieldLimits.spec.ts's identical branch.
    contactData.customFields.number = Number(field.value);
  } else {
    contactData.customFields[dataKey] = field.value;
  }
  return contactData;
}

// Client-side-blocked rejection — applies to every min/max/regex violation
// in this suite. Confirmed live for Lead (and architecturally identical for
// Contact — the same shared BasePage custom-field validation component):
// the inline error appears on blur, before any Save click, and Save itself
// fires no network request while it's present.
async function hasInlineFormError(contactsPage: ContactsPage, context: string): Promise<boolean> {
  try {
    await contactsPage.assertNoFormErrors(context);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
      return true;
    }
    throw error;
  }
}

async function assertInlineErrorPresent(contactsPage: ContactsPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(contactsPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

async function createContactExpectingAccept(
  contactsPage: ContactsPage,
  lastName: string,
  field: ContactFieldUnderTest
): Promise<number> {
  const contactData = buildContactDataWithFieldOverride(lastName, field);
  const contactId = await contactsPage.createContact(contactData, {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  expect(
    contactId,
    `Expected Contact creation to succeed (field="${field.fieldName}", value="${field.value}") but createContact() returned null`
  ).not.toBeNull();
  return contactId as number;
}

// WHY kept as a named, single-purpose wrapper: mirrors createBareLead()'s
// own identical reasoning — a plain edit TARGET, zero custom fields filled.
async function createBareContact(contactsPage: ContactsPage, lastName: string): Promise<number> {
  const contactId = await contactsPage.createContact(generateContactData({ lastName }), {
    minimal: true,
  });
  expect(
    contactId,
    `Expected a bare minimal Contact ("${lastName}") to be created successfully`
  ).not.toBeNull();
  return contactId as number;
}

async function updateContactExpectingAccept(
  contactsPage: ContactsPage,
  contactId: number,
  lastName: string,
  field: ContactFieldUnderTest
): Promise<void> {
  await contactsPage.searchAndOpenContact('', contactId);
  await contactsPage.clickEditIcon();
  await contactsPage.fillEditForm(buildContactDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  await contactsPage.saveEditedContact();
}

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

async function openContactFormExpectingRejection(
  contactsPage: ContactsPage,
  lastName: string,
  field: ContactFieldUnderTest
): Promise<void> {
  await contactsPage.clickAddContact();
  await contactsPage.fillContactForm(buildContactDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

async function openEditContactFormExpectingRejection(
  contactsPage: ContactsPage,
  contactId: number,
  lastName: string,
  field: ContactFieldUnderTest
): Promise<void> {
  await contactsPage.searchAndOpenContact('', contactId);
  await contactsPage.clickEditIcon();
  await contactsPage.fillEditForm(buildContactDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

async function assertCustomFieldPersistedOnDetail(
  contactsPage: ContactsPage,
  contactId: number,
  fieldName: string,
  expectedValue: string,
  description: string
): Promise<void> {
  await contactsPage.searchAndOpenContact('', contactId);
  await contactsPage.clickDetailPageTab(OTHER_DETAILS_TAB);
  await contactsPage.assertCustomFieldOnDetail(fieldName, expectedValue, description);
}

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
  await configPage.clearFieldConfiguration(TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(PARAGRAPH_FIELD_INTERNAL_NAME);
}

// WHY this block is a sibling of, not nested inside, 'Contact Field Limits'
// below, using `baseTest` instead of `test` — mirrors
// companyFieldLimits.spec.ts's own identical 'Navigation' extraction (see
// the `baseTest` import's own WHY comment above and that file's for the
// full reasoning, including why extraction loses nothing the original
// nesting provided).
baseTest.describe('Navigation', () => {
  baseTest(
    '@smoke @prodSafe FFC1 admin should open the Contact field settings page and see the entity tabs',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(tabs, 'Expected the "Contact" tab to be present among the live tab labels').toContain(
        'Contact'
      );
      logger.success('FFC1 passed');
    }
  );

  baseTest(
    '@smoke @prodSafe FFC2 admin should search the field list by internal name and see it filter correctly',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.open();
      await configPage.searchField(TEXT_FIELD_INTERNAL_NAME);
      await configPage.openFieldForEdit(TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFC2 passed');
    }
  );

  baseTest(
    "@smoke @prodSafe FFC3 admin should open an individual custom field's edit page from the list",
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFC3 passed');
    }
  );
}); // end describe('Navigation')

test.describe('Contact Field Limits', () => {
  // WHY no test.describe.configure({ mode: 'serial' }) at THIS, outer level
  // — mirrors leadFieldLimits.spec.ts's identical top-of-file comment (see
  // that file for the full reasoning): each of the 6 field-mutating
  // sub-blocks below carries its own `.serial` instead, restored 2026-09-29
  // as CI-carve-out defense-in-depth (see .claude/known-issues.md's dated
  // 2026-09-29 entry) — kept OUT of this outer block so a failure in one
  // field's tests never skip-cascades an unrelated field's tests in the
  // same file. contactFormFieldLock.ts's own cross-process lock only ever
  // protected same-filesystem concurrency; it never protected against this
  // file (or its RBAC sibling, targeting the same 3 dedicated fields)
  // landing on a different GitHub Actions shard, which real sandbox run
  // 36520337903 proved happens.

  // WHY test.describe.configure({ timeout: 480000 }) here (2026-09-29,
  // real CI failures — sandbox run 36464460839: FFRTK6/FFC6/FFCO25/FFPS6 all
  // failed with "admin page failed to reach the app's /sales/ area (only
  // 0ms left before the fixture-setup deadline...)"): fixtures/index.ts's
  // createRolePage() computes its own fixture-setup deadline from
  // `testInfo.timeout * 0.85` BEFORE any test in this file ever calls
  // test.setTimeout(480000) inside its own body — too late to affect that
  // calculation, since fixture setup runs before the test body. Every test
  // here was therefore getting only the CI default 120000ms (a ~102000ms
  // deadline) for fixture setup, not the 480000ms the test actually needs —
  // and a single slow navigation attempt can legitimately consume that
  // entire 102000ms budget, leaving zero time for the already-correct
  // wrongPage recovery retry to ever run. describe.configure is resolved at
  // test-collection time, so testInfo.timeout is already correct by the
  // time ANY fixture (including adminPage/restrictedPage) initializes for
  // these tests — fixing the deadline math without touching
  // fixtures/index.ts's shared session-recovery logic at all. The existing
  // per-test test.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  test.describe.configure({ timeout: 480000 });

  test.afterAll(async ({ browser }) => {
    // WHY test.setTimeout(600000) here (2026-09-29, real CI failures —
    // sandbox run 36464460839: FFD37/FFD20 in dealFieldLimits.spec.ts and
    // FFTK38 in taskFieldLimits.spec.ts both failed with "Test timeout of
    // 120000ms exceeded while setting up formFieldLock" / "afterAll hook
    // timeout of 120000ms exceeded"): playwright.config.ts sets the CI
    // default test timeout to 120000ms — afterAll hooks get that same
    // default and do NOT inherit any individual test's own
    // test.setTimeout(480000) bump (that only extends the ONE test that
    // calls it). This hook's own lock acquisition can legitimately need to
    // wait up to ~480000ms for a DIFFERENT worker's still-in-progress,
    // full-length test on the SAME entity to finish and release the same
    // lock — 120000ms was never enough headroom for that, independent of
    // anything being actually wrong; it was a real, guaranteed-to
    // -eventually-fire timeout-budget mismatch. Sized generously above the
    // known ~480000ms worst case, not a guess.
    test.setTimeout(600000);
    // WHY this doesn't request the adminPage fixture, and WHY wrapped in
    // withContactFormFieldLock(): mirrors leadFieldLimits.spec.ts's own
    // afterAll hook exactly — see that file's own WHY comment for the full
    // reasoning (afterAll hooks can only depend on worker-scoped fixtures,
    // and this describe block's lack of a .serial override means
    // Playwright's parallelWithHooks chunking can run multiple copies of
    // this hook concurrently).
    const adminStorageStatePath = path.join(
      __dirname,
      '../../../src/auth/storageStates',
      config.env,
      'admin.json'
    );
    const context = await browser.newContext({ storageState: adminStorageStatePath });
    const page = await context.newPage();
    try {
      await withContactFormFieldLock(() => clearAllFieldConfigurations(page));
      logger.success('afterAll safety-net cleanup completed');
    } catch (error) {
      logger.warn(`afterAll safety-net cleanup failed (non-fatal): ${String(error)}`);
    } finally {
      await context.close();
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────
  // WHY moved out of this block entirely (2026-09-29): see the top-level
  // `baseTest.describe('Navigation', ...)` block above this describe.

  // ─── Text field character-length limits ─────────────────────────────

  test.describe('Text field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFC4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFC4 passed');
    });

    test('@regression FFC6 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFC6 passed');
    });

    test('@regression FFC8 admin should confirm typing too many characters in the Text field is rejected when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateContactCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC8 Add Contact — Text over max');
      logger.success('FFC8 passed');
    });

    test('@regression FFC9 admin should confirm typing too few characters in the Text field is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC9 Edit Contact — Text under min');
      logger.success('FFC9 passed');
    });

    test('@regression FFC11 admin should confirm typing exactly the maximum allowed characters in the Text field is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFC11 passed');
    });

  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ─────────────────────────────────

  test.describe('Number field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFC13 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await configPage.assertFieldConfigMatches(
        NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFC13 passed');
    });

    test('@regression FFC15 admin should confirm typing exactly the minimum allowed digits in the Number field is accepted when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFC15 passed');
    });

    test('@regression FFC17 admin should confirm typing too many digits in the Number field is rejected when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC17 Add Contact — Number over max');
      logger.success('FFC17 passed');
    });

    test('@regression FFC18 admin should confirm typing too few digits in the Number field is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC18 Edit Contact — Number under min');
      logger.success('FFC18 passed');
    });

    test('@regression FFC20 admin should confirm typing exactly the maximum allowed digits in the Number field is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFC20 passed');
    });

  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────────────────

  test.describe('Paragraph field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFC23 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFC23 passed');
    });

    test('@regression FFC24 admin should confirm typing too few characters in the Paragraph field is rejected when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC24 Add Contact — Paragraph under min');
      logger.success('FFC24 passed');
    });

    test('@regression FFC26 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFC26 passed');
    });

    test('@regression FFC28 admin should confirm typing too few characters in the Paragraph field is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFC28 Edit Contact — Paragraph under min');
      logger.success('FFC28 passed');
    });

    test('@regression FFC30 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFC30 passed');
    });

  }); // end describe('Paragraph field limits')

  // ─── Format rules (Regex) — Text field ────────────────────────────────

  test.describe('Text field format rules (Regex)', () => {
    test.describe.configure({ mode: 'serial' });

    // WHY cross-checking the generated value against the pattern read LIVE
    // off the config page, not just trusting the generator: mirrors
    // leadFieldLimits.spec.ts's identical function exactly.
    async function assertGeneratedValueMatchesLivePattern(
      configPage: FormFieldsConfigPage,
      internalName: string,
      value: string,
      shouldMatch: boolean,
      description: string
    ): Promise<void> {
      await configPage.openFieldForEdit(internalName);
      const { pattern } = await configPage.getRegexPatternInfo();
      const actuallyMatches = new RegExp(pattern).test(value);
      expect(
        actuallyMatches,
        `Expected generated value "${value}" to ${shouldMatch ? '' : 'NOT '}match the live pattern ` +
          `"${pattern}" for ${description}, but it ${actuallyMatches ? 'did' : 'did not'}`
      ).toBe(shouldMatch);
    }

    test('@regression FFC32 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'PAN Card' },
        'Text field'
      );
      logger.success('FFC32 passed');
    });

    test('@regression FFC35 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Email' },
        'Text field'
      );
      logger.success('FFC35 passed');
    });

    test('@regression FFC37 admin sets the Text field format to Driver Licence and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Driver Licence' },
        'Text field'
      );
      logger.success('FFC37 passed');
    });

    test('@regression FFC39 admin should confirm an invalid Driver Licence value is rejected when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Driver Licence'
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC39 Add Contact — invalid Driver Licence');
      logger.success('FFC39 passed');
    });

    test('@regression FFC40 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Voting Card' },
        'Text field'
      );
      logger.success('FFC40 passed');
    });

    test('@regression FFC41 admin should confirm a valid Voting Card value is accepted when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Voting Card'
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFC41 passed');
    });

    test('@regression FFC43 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Passport' },
        'Text field'
      );
      logger.success('FFC43 passed');
    });

    test('@regression FFC45 admin should confirm an invalid Passport value is rejected when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Passport'
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC45 Add Contact — invalid Passport');
      logger.success('FFC45 passed');
    });

    // WHY only ONE option (PAN Card) gets a representative update pair:
    // mirrors leadFieldLimits.spec.ts's identical reasoning — create/update
    // are already confirmed to behave identically for regex, one full
    // create+update pair proves that equivalence.
    test('@regression FFC47 admin should confirm an invalid PAN number is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'PAN Card'
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC47 Edit Contact — invalid PAN Card');
      logger.success('FFC47 passed');
    });

    // ─── Regex mechanism tests (config-page-only, no Contact form involved) ──

    test('@regression FFC48 admin should confirm choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.openFieldForEdit(TEXT_FIELD_INTERNAL_NAME);
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFC48 passed');
    });

    test('@regression FFC49 admin should confirm choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFC49 passed');
    });

    test('@regression FFC50 admin should confirm switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        {
          minDisabled: false,
          maxDisabled: false,
          min: lockedSnapshot.min,
          max: lockedSnapshot.max,
        },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFC50 passed');
    });

    // WHY FFC55-63 added 2026-09-23 (final cleanup pass, explicit
    // instruction): backfills Contact's Regex coverage to full 5-format
    // parity, mirroring the identical backfill just applied to
    // leadFieldLimits.spec.ts (FFL56-64) — PAN Card already had valid+
    // invalid × create+edit coverage (FFC32/47/48 here plus FFRC21/22/27 in
    // the RBAC file); Email/Driver Licence/Voting Card/Passport each only
    // had partial coverage until now. Email's own "valid value accepted"
    // test was previously omitted out of caution (a load-dependent
    // create-POST timeout was once traced to a random-domain email value)
    // — included here using the already-hardened generator (a fixed, real
    // `example.com` domain, never a random one).
    test('@regression FFC55 admin should confirm a valid Email value is accepted when creating a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(contactsPage, contactId, CONTACT_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFC55 passed');
    });

    test('@regression FFC56 admin should confirm a valid Email value is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(contactsPage, contactId, CONTACT_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFC56 passed');
    });

    test('@regression FFC57 admin should confirm an invalid Email value is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC57 Edit Contact — invalid Email');
      logger.success('FFC57 passed');
    });

    test('@regression FFC58 admin should confirm a valid Driver Licence value is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(contactsPage, contactId, CONTACT_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFC58 passed');
    });

    test('@regression FFC59 admin should confirm an invalid Driver Licence value is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC59 Edit Contact — invalid Driver Licence');
      logger.success('FFC59 passed');
    });

    test('@regression FFC60 admin should confirm a valid Voting Card value is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(contactsPage, contactId, CONTACT_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFC60 passed');
    });

    test('@regression FFC61 admin should confirm an invalid Voting Card value is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC61 Edit Contact — invalid Voting Card');
      logger.success('FFC61 passed');
    });

    test('@regression FFC62 admin should confirm a valid Passport value is accepted when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await updateContactExpectingAccept(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(contactsPage, contactId, CONTACT_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFC62 passed');
    });

    test('@regression FFC63 admin should confirm an invalid Passport value is rejected when editing a contact', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFC63 Edit Contact — invalid Passport');
      logger.success('FFC63 passed');
    });
  }); // end describe('Text field format rules (Regex)')

  // ─── Cache behavior ────────────────────────────────────────────────────

  test.describe('Cache behavior', () => {
    test.describe.configure({ mode: 'serial' });

    const CACHE_TEST_STALE_MIN = 3;
    const CACHE_TEST_STALE_MAX = 6;
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    // WHY CACHE_TEST_FRESH_MIN itself, not CACHE_TEST_STALE_MAX + 1: mirrors
    // leadFieldLimits.spec.ts's own confirmed-live fix exactly — 8 is the
    // smallest value simultaneously invalid under stale (8 > 6) AND valid
    // under fresh (8 is within [8, 12]).
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;

    test('@regression FFC51 admin should confirm a new limit is not applied on the contact form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      // WHY this one open-and-close is needed before reconfiguring: it's
      // what actually populates the cache with the stale (3–6) config in
      // the first place — mirrors leadFieldLimits.spec.ts's identical WHY.
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await contactsPage.assertNoFormErrors('FFC51 seed Add Contact');
      // WHY NOT clearing the cache here: this is the exact behavior under test.
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        contactsPage,
        'FFC51 Add Contact — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFC51 passed');
    });

  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────

  test.describe('Cleanup', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFC53 admin should confirm after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFC53 passed');
    });

    test('@regression FFC54 admin should confirm after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      // WHY this test doesn't depend on FFC53 having already run: test
      // independence — re-runs the same clear itself rather than trusting
      // declaration order.
      await clearAllFieldConfigurations(adminPage);
      await clearContactApplicationCache(adminPage);
      const contactsPage = new ContactsPage(adminPage);
      await contactsPage.goToContactsList();
      // WHY this exact value: TEXT_MAX + 5 characters was confirmed
      // rejected earlier in this file (FFC8) while that limit was active.
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const lastName = faker.person.lastName();
      const contactId = await createContactExpectingAccept(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFC54 passed');
    });
  }); // end describe('Cleanup')
});
