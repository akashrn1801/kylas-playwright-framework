import { test as contactTest, expect } from '../../ui/formFields/contactFormFieldLock';
// WHY this second `test` import — mirrors companyFieldLimits.rbac.spec.ts's
// own identical `baseTest` import (2026-09-29, Fix 2 for the dated
// known-issues.md entry, "A cross-process lock only protects workers on the
// SAME filesystem"): confirmed via a complete, per-test code-level audit
// that FFRC1/2/3 below are the only 3 of this file's 28 tests that never
// call configureFieldLimit()/configureFieldRegex()/
// clearAllFieldConfigurations() via adminPage.
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  CONTACT_FORM_FIELD_LIMIT_NAMES,
  CONTACT_LAYOUT_CACHE_KEY,
  generateContactData,
  ContactData,
  generateContactCustomFieldInvalidTextField,
  generateContactCustomFieldInvalidParagraphText,
  generateValidPanCardValue,
  generateInvalidPanCardValue,
  generateInvalidEmailFormatValue,
  generateValidDriverLicenceValue,
  generateInvalidVotingCardValue,
  generateValidPassportValue,
} from '../../../src/data/factories/contactFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';

// WHY this is its own standalone file, not nested inside a shared
// multi-entity RBAC file (split 2026-09-28 from the original
// formFields.rbac.spec.ts, which held all 6 entities' own blocks together):
// matches the same one-file-per-entity convention already used for this
// feature's own UI spec files (tests/ui/formFields/<entity>FieldLimits.spec.ts)
// and for every other module in this codebase (tests/rbac/<module>.rbac.spec.ts).
// Named "<Entity>FormFields" rather than plain "<entity>s" specifically to
// avoid colliding with that entity's own PRE-EXISTING, unrelated
// tests/rbac/<entity>s.rbac.spec.ts file (this feature's tests are
// additional Form-Field-Limit-specific coverage, not that file's own
// broader RBAC suite).
//
// WHY this file shares a cross-process lock with this SAME entity's own
// UI spec file (see the imported lock file above): the two files' tests
// configure/read the exact same shared, account-wide custom-field config
// on the Form Fields settings screen. Real CI pipelines
// (qa.yml/stage.yml/main.yml/staging-promotion-gate.yml on GitHub Actions;
// Jenkinsfile/Jenkinsfile.qa/Jenkinsfile.staging on Jenkins) all run these
// tests at --workers=2, confirmed live, making this a real, not
// hypothetical, risk. See the lock file's own header comment for the full
// worker-count evidence table and design reasoning.
//
// WHY RBAC assertions here never navigate to an individual field's edit
// URL directly (`/setup/fields/<slug>/edit/<id>`): a restricted user
// requesting that URL lands on the same "Forbidden" bootstrap-time page
// documented in .claude/known-issues.md — colliding with
// authManager.isSessionExpiryPage()'s own recognition of that exact page
// shape. Restricted-user RBAC here is proven entirely through the LIST
// page (visible, read-only, no Add Field button, rows not clickable).

const CONTACT_TEXT_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.textField}`;
const CONTACT_NUMBER_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.number}`;
const CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

// WHY this checks an inline error, not a toast: live reproduction confirmed
// Text field min/max is validated CLIENT-SIDE, inline, on blur — the exact
// same mechanism as Number/Regex. Network-request logging confirmed Save
// fires ZERO requests while this inline error is present, so a toast-based
// check can never observe anything here. Deliberately duplicated per
// entity file rather than imported from a shared location — matches this
// feature's own established "each file stays independently runnable"
// convention.
async function assertInlineErrorPresent(
  page: ContactsPage,
  context: string
): Promise<void> {
  let errorPresent = false;
  try {
    await page.assertNoFormErrors(context);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
      errorPresent = true;
    } else {
      throw error;
    }
  }
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// WHY this constant lives at file (not describe-block) scope (2026-09-29):
// both the lock-free block below AND the main, lock-wrapped block need it —
// mirrors companyFieldLimits.rbac.spec.ts's identical hoist.
const CONTACT_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Contact', urlSlug: 'contacts' };

// WHY this block is separate from, not nested inside, the main
// 'Form Field Limits — RBAC › Contact' describe below, using `baseTest`
// instead of `contactTest` — mirrors companyFieldLimits.rbac.spec.ts's own
// identical extraction (see that file's WHY comment for the full
// reasoning, including why `.serial` isn't needed here either).
baseTest.describe('Form Field Limits — RBAC › Contact (read-only, lock-free)', () => {
  baseTest(
    '@regression FFRC1 restricted user can see the field settings list but nothing else on that page',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, CONTACT_ENTITY);
      await configPage.assertListVisibleReadOnly();
      logger.success('FFRC1 passed');
    }
  );

  baseTest(
    '@regression FFRC2 restricted user does not see the "Add Field" button',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, CONTACT_ENTITY);
      await configPage.assertAddFieldButtonAbsent();
      logger.success('FFRC2 passed');
    }
  );

  baseTest(
    '@regression FFRC3 restricted user cannot click into any field to open it for editing',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, CONTACT_ENTITY);
      await configPage.assertRowNotClickable(CONTACT_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFRC3 passed');
    }
  );
});

contactTest.describe('Form Field Limits — RBAC › Contact', () => {
  // WHY contactTest.describe.configure({ mode: 'serial' }) IS here (restored
  // 2026-09-29 — see .claude/known-issues.md's dated 2026-09-29 entry "A
  // cross-process lock only protects workers on the SAME filesystem"):
  // removed earlier the same day on the reasoning that the auto-applied,
  // scope:'test' contactFormFieldLock fixture's own cross-process lock already makes
  // concurrent execution of this file's own tests impossible, so serial
  // mode was "only" causing an unwanted skip-cascade side effect. That
  // reasoning is true only for two tests sharing one filesystem — it said
  // nothing about GitHub Actions sharding, which runs each shard on a
  // SEPARATE machine
  // with its own separate filesystem, where this lock (like every lock
  // built this way) provides zero cross-machine protection. Removing
  // .serial mode here removed the one property (this whole block staying
  // in ONE Playwright shard-distribution group, confirmed via this repo's
  // own 2026-09-09 sharding-internals audit) that had been keeping this
  // file's own tests — and, just as importantly, this file's sibling UI
  // spec file, which shares the exact same entity's dedicated custom
  // fields — from ever landing on two different shards at the same time.
  // Real sandbox run 36520337903 (2026-09-29) proved this happens: this
  // entity's UI and RBAC files ran concurrently on two different shards,
  // each mutating the same shared account-wide field config with no
  // cross-shard mutual exclusion, producing genuine, evidence-confirmed
  // test failures (not flakes). Correctness now comes from a CI-level fix
  // instead (formFields tests are carved into their own always-single-
  // shard-per-entity job, never sharded by Playwright's own count-based
  // splitting — see sandbox.yml/qa.yml/stage.yml/main.yml's own
  // run-formfields-tests job) — restoring .serial here is defense-in-depth
  // for same-shard interleaving, now safe to re-add since the CI carve-out
  // means the original skip-cascade downside this was removed to avoid no
  // longer trades away real cross-shard correctness to get it.

  // WHY contactTest.describe.configure({ timeout: 480000 }) here (2026-09-29,
  // real CI failures — sandbox run 36464460839: FFRTK6/FFC6/FFCO25/FFPS6 all
  // failed with "admin page failed to reach the app's /sales/ area (only
  // 0ms left before the fixture-setup deadline...)"): fixtures/index.ts's
  // createRolePage() computes its own fixture-setup deadline from
  // `testInfo.timeout * 0.85` BEFORE this describe block's own tests ever
  // call test.setTimeout(480000) inside their bodies — too late to affect
  // that calculation, since fixture setup runs before the test body. Every
  // test in this file was therefore getting only the CI default 120000ms
  // (a ~102000ms deadline) for fixture setup, not the 480000ms the test
  // actually needs — and a single slow navigation attempt can legitimately
  // consume that entire 102000ms budget, leaving zero time for the
  // already-correct wrongPage recovery retry to ever run. describe.configure
  // is resolved at test-collection time, so testInfo.timeout is already
  // correct by the time ANY fixture (including adminPage/restrictedPage)
  // initializes for these tests — fixing the deadline math without touching
  // fixtures/index.ts's shared session-recovery logic at all. The existing
  // per-test contactTest.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  contactTest.describe.configure({ mode: 'serial' });

  contactTest.describe.configure({ timeout: 480000 });

  // WHY CONTACT_ENTITY is NOT re-declared here (2026-09-29): it now lives at
  // file scope (see the top of this file) — shared with the lock-free
  // 'read-only' block above, not duplicated.
  const OTHER_DETAILS_TAB = 'Other Details';

  // WHY these constants/helpers live here, duplicated from
  // contactFieldLimits.spec.ts rather than imported (2026-09-22, UI/RBAC
  // separation redesign — see this file's own top-of-file WHY comment):
  // every genuinely single-restricted-role functional test (accept/reject
  // boundaries, Regex validation) was moved OUT of the UI file and INTO
  // this RBAC file, to match this codebase's own real, established
  // convention (confirmed live via `leads.spec.ts`/`leads.rbac.spec.ts` and
  // 4 other module pairs: the UI file is admin-only, and EVERY
  // restricted-role test — including plain single-role functional ones,
  // not just access-boundary checks — lives in the RBAC file). These moved
  // tests still need the same minimal-fill accept/reject architecture
  // (LEAD_FEATURE_RETROSPECTIVE.md §1) their UI-file siblings use — mirrored
  // here rather than imported, matching this file's own pre-existing
  // "these two files must remain independently runnable" convention
  // (see FFR4/FFRC4's own identical reasoning on their local min/max
  // constants) applied one level up, to whole helper functions.
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

  async function clearContactApplicationCache(targetPage: Page): Promise<void> {
    const contactsPage = new ContactsPage(targetPage);
    const result = await contactsPage.clearApplicationCache(CONTACT_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Contact application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

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
      contactData.customFields.number = Number(field.value);
    } else {
      contactData.customFields[dataKey] = field.value;
    }
    return contactData;
  }

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

  // WHY duplicated here rather than imported from contactFieldLimits.spec.ts
  // (same file-independence reasoning as every other duplicated helper
  // above): cross-checks a generated Regex value against the pattern read
  // LIVE off the config page, never trusting the generator alone.
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

  // WHY FFRC1/2/3 are no longer here (2026-09-29): moved to the lock-free
  // 'Form Field Limits — RBAC › Contact (read-only, lock-free)' describe
  // block near the top of this file.

  contactTest("@regression FFRC4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    contactTest.setTimeout(480000);
    // WHY these two constants aren't shared with contactFieldLimits.spec.ts's
    // own TEXT_MIN/TEXT_MAX: same reasoning as the Lead block's identical
    // FFR4 comment — the two files must remain independently runnable.
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
    await configPage.configureFieldLimit(CONTACT_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      CONTACT_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    // WHY 'key-not-found' is a successful no-op — same reasoning as the
    // Lead block's identical check.
    const cacheResult = await new ContactsPage(restrictedPage).clearApplicationCache(
      CONTACT_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Contact application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    // WHY fillContactForm(..., {minimal:true, onlyCustomField:'textField'})
    // rather than hand-rolling clickAddContact() + a private toggle-disable
    // + fillStandardField() (the Lead block's own literal shape above):
    // ContactsPage.disableRequiredFieldsToggle() is intentionally kept
    // `private` (unlike LeadsPage's own public equivalent) — reusing the
    // already-built minimal-fill architecture here, rather than exposing
    // that private method just for this one call site, keeps the same
    // encapsulation ContactsPage.ts already established. fillContactForm()
    // calls disableRequiredFieldsToggle() as its own first step regardless
    // of `minimal`, so this achieves the identical end state.
    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.clickAddContact();
    const lastName = faker.person.lastName();
    const contactData = generateContactData({ lastName });
    // WHY (max + 1) proves the admin's newly-configured limit specifically:
    // same reasoning as the Lead block's identical comment.
    contactData.customFields.textField = 'A'.repeat(max + 1);
    await restrictedContactsPage.fillContactForm(contactData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
    });
    await assertInlineErrorPresent(
      restrictedContactsPage,
      'FFRC4 Add Contact — restricted, over admin-set max'
    );
    logger.success('FFRC4 passed');
  });

  // WHY FFRC5-7 exist (2026-09-22, added per explicit direction after FFRC4
  // shipped): FFR4/FFRC4 alone only ever prove the admin-configures ->
  // restricted-cache-clears -> restricted-sees-it-enforced handoff for ONE
  // field type (Text) and ONE direction (reject-over-max). That handoff is
  // the real, generalizable mechanism this feature depends on for every
  // field/config type — leaving it checked from a restricted user's
  // perspective for only one of the three field types (and never checked
  // for the accept direction, or for a Regex-format config at all) was a
  // real, if not previously flagged, coverage gap, not a deliberate scope
  // boundary. FFRC5 (Number) and FFRC6 (Paragraph) each verify BOTH
  // directions — a value at the admin-set boundary is genuinely ACCEPTED
  // and persists, and a value past it is genuinely REJECTED — closing the
  // "only reject was ever checked" gap FFRC4 alone left open. FFRC7 proves
  // the identical handoff for a Regex-format config (PAN Card, chosen for
  // its simple, fully deterministic valid/invalid shape), which FFRC1-4
  // never touched a Regex config at all. THIS SHAPE IS NOW THE BASELINE for
  // every subsequent entity's RBAC block (Company, Task, Products &
  // Services, Deal) — each entity's RBAC file should carry all 7 of these
  // tests forward (the 3 original access-boundary tests unchanged, plus
  // these 4 admin-configures/restricted-verifies tests: Text/Number/
  // Paragraph limits plus one Regex format), not just the original 4.

  contactTest("@regression FFRC5 after admin sets a Number limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    contactTest.setTimeout(480000);
    // WHY these constants aren't shared with contactFieldLimits.spec.ts's
    // own NUMBER_MIN/NUMBER_MAX, and aren't the same numeric values as
    // FFRC4's own min/max: same "two files must remain independently
    // runnable" reasoning as FFRC4, plus using a DIFFERENT field's own
    // independent min/max here avoids any accidental coupling with FFRC4's
    // Text-field config running in the same serial block.
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
    await configPage.configureFieldLimit(CONTACT_NUMBER_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      CONTACT_NUMBER_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Number field'
    );

    const cacheResult = await new ContactsPage(restrictedPage).clearApplicationCache(
      CONTACT_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Contact application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();

    // WHY the accept check FIRST, then the reject check: mirrors this
    // file's own single-direction FFRC4 shape, just exercising both
    // directions in one test rather than splitting into two — the admin
    // config and restricted cache-clear above only need to happen once for
    // both checks to be meaningful.
    const acceptValue = '1'.repeat(min);
    const acceptData = generateContactData({ lastName: faker.person.lastName() });
    acceptData.customFields.number = Number(acceptValue);
    const contactId = await restrictedContactsPage.createContact(acceptData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
    });
    expect(
      contactId,
      'Expected restricted user to successfully create a Contact with a Number value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedContactsPage.searchAndOpenContact('', contactId as number);
    await restrictedContactsPage.clickDetailPageTab('Other Details');
    await restrictedContactsPage.assertCustomFieldOnDetail(
      CONTACT_FORM_FIELD_LIMIT_NAMES.number,
      acceptValue,
      'Number field'
    );

    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.clickAddContact();
    const rejectData = generateContactData({ lastName: faker.person.lastName() });
    rejectData.customFields.number = Number('1'.repeat(max + 1));
    await restrictedContactsPage.fillContactForm(rejectData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
    });
    await assertInlineErrorPresent(
      restrictedContactsPage,
      'FFRC5 Add Contact — restricted, Number over admin-set max'
    );
    logger.success('FFRC5 passed');
  });

  contactTest("@regression FFRC6 after admin sets a Paragraph limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    contactTest.setTimeout(480000);
    const min = 6;
    const max = 10;
    const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
    await configPage.configureFieldLimit(
      CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
      String(min),
      String(max)
    );
    await configPage.assertFieldConfigMatches(
      CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Paragraph field'
    );

    const cacheResult = await new ContactsPage(restrictedPage).clearApplicationCache(
      CONTACT_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Contact application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();

    const acceptValue = 'B'.repeat(min);
    const acceptData = generateContactData({ lastName: faker.person.lastName() });
    acceptData.customFields.paragraphText = acceptValue;
    const contactId = await restrictedContactsPage.createContact(acceptData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    expect(
      contactId,
      'Expected restricted user to successfully create a Contact with a Paragraph value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedContactsPage.searchAndOpenContact('', contactId as number);
    await restrictedContactsPage.clickDetailPageTab('Other Details');
    await restrictedContactsPage.assertCustomFieldOnDetail(
      CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
      acceptValue,
      'Paragraph field'
    );

    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.clickAddContact();
    const rejectData = generateContactData({ lastName: faker.person.lastName() });
    rejectData.customFields.paragraphText = 'B'.repeat(max + 1);
    await restrictedContactsPage.fillContactForm(rejectData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    await assertInlineErrorPresent(
      restrictedContactsPage,
      'FFRC6 Add Contact — restricted, Paragraph over admin-set max'
    );
    logger.success('FFRC6 passed');
  });

  contactTest("@regression FFRC7 after admin sets a Regex format (PAN Card) and restricted user's cache is cleared, restricted user's values are enforced for both a valid and an invalid value", async ({
    adminPage,
    restrictedPage,
  }) => {
    contactTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
    await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    await configPage.assertFieldConfigMatches(
      CONTACT_TEXT_FIELD_INTERNAL_NAME,
      { regexLabel: 'PAN Card' },
      'Text field'
    );

    const cacheResult = await new ContactsPage(restrictedPage).clearApplicationCache(
      CONTACT_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Contact application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedContactsPage = new ContactsPage(restrictedPage);
    await restrictedContactsPage.goToContactsList();

    // WHY no live-pattern cross-check here (unlike contactFieldLimits.spec.ts's
    // assertGeneratedValueMatchesLivePattern()): this RBAC file's own
    // established scope/rigor level (see FFRC4's identical simplicity)
    // trusts the already-proven generator directly — the full 5-option
    // live-pattern-verified sweep belongs to, and already lives in, the UI
    // spec file; this test exists to prove the RBAC handoff mechanism, not
    // to re-prove the Regex pattern itself a second time.
    const acceptValue = generateValidPanCardValue();
    const acceptData = generateContactData({ lastName: faker.person.lastName() });
    acceptData.customFields.textField = acceptValue;
    const contactId = await restrictedContactsPage.createContact(acceptData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
    });
    expect(
      contactId,
      'Expected restricted user to successfully create a Contact with a valid PAN Card value'
    ).not.toBeNull();
    await restrictedContactsPage.searchAndOpenContact('', contactId as number);
    await restrictedContactsPage.clickDetailPageTab('Other Details');
    await restrictedContactsPage.assertCustomFieldOnDetail(
      CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
      acceptValue,
      'Text field'
    );

    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.clickAddContact();
    const rejectData = generateContactData({ lastName: faker.person.lastName() });
    rejectData.customFields.textField = generateInvalidPanCardValue();
    await restrictedContactsPage.fillContactForm(rejectData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
    });
    await assertInlineErrorPresent(
      restrictedContactsPage,
      'FFRC7 Add Contact — restricted, invalid PAN Card'
    );
    logger.success('FFRC7 passed');
  });

    contactTest('@regression FFRC8 restricted user should confirm typing too few characters in the Text field is rejected when creating a contact', async ({
      adminPage,
      restrictedPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC8 Add Contact — Text under min');
      logger.success('FFRC8 passed');
    });



    contactTest('@regression FFRC9 restricted user should confirm typing exactly the maximum allowed characters in the Text field is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
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
      logger.success('FFRC9 passed');
    });



    contactTest('@regression FFRC10 restricted user should confirm typing exactly the minimum allowed characters in the Text field is accepted when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
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
      logger.success('FFRC10 passed');
    });



    contactTest('@regression FFRC11 restricted user should confirm typing too many characters in the Text field is rejected when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateContactCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC11 Edit Contact — Text over max');
      logger.success('FFRC11 passed');
    });


    contactTest('@regression FFRC12 restricted user should confirm typing too few digits in the Number field is rejected when creating a contact', async ({
      adminPage,
      restrictedPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC12 Add Contact — Number under min');
      logger.success('FFRC12 passed');
    });



    contactTest('@regression FFRC13 restricted user should confirm typing exactly the maximum allowed digits in the Number field is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
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
      logger.success('FFRC13 passed');
    });



    contactTest('@regression FFRC14 restricted user should confirm typing exactly the minimum allowed digits in the Number field is accepted when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
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
      logger.success('FFRC14 passed');
    });



    contactTest('@regression FFRC15 restricted user should confirm typing too many digits in the Number field is rejected when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC15 Edit Contact — Number over max');
      logger.success('FFRC15 passed');
    });



    contactTest('@regression FFRC16 restricted user should confirm fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      await openContactFormExpectingRejection(contactsPage, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC16 Add Contact — Number initially invalid');
      const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      await contactsPage.fillTextLikeCustomField(
        CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        validValue,
        CONTACT_FORM_FIELD_LIMIT_NAMES.number
      );
      await contactsPage.fillStandardField('lastName', lastName, 'Last Name');
      const errorStillPresent = await hasInlineFormError(
        contactsPage,
        'FFRC16 Add Contact — Number corrected to valid'
      );
      expect(
        errorStillPresent,
        'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
      ).toBe(false);
      // WHY contactsPage.saveContact() directly here, neither
      // createContactExpectingAccept() nor openContactFormExpectingRejection()'s
      // own save step: this test is deliberately exercising LIVE, IN-FORM
      // correction — the one legitimate exception to the two-path split,
      // mirroring LeadsPage's FFL22 exactly (see
      // LEAD_FEATURE_IMPLEMENTATION_CONTEXT.md §5's own documented
      // exception).
      const savedContactId = await contactsPage.saveContact();
      expect(
        savedContactId,
        'Expected the corrected Number value to save successfully'
      ).not.toBeNull();
      const contactId = savedContactId as number;
      await assertCustomFieldPersistedOnDetail(
        contactsPage,
        contactId,
        CONTACT_FORM_FIELD_LIMIT_NAMES.number,
        validValue,
        'Number field'
      );
      logger.success('FFRC16 passed');
    });


    contactTest('@regression FFRC17 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
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
      logger.success('FFRC17 passed');
    });



    contactTest('@regression FFRC18 restricted user should confirm typing too many characters in the Paragraph field is rejected when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateContactCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC18 Add Contact — Paragraph over max');
      logger.success('FFRC18 passed');
    });



    contactTest('@regression FFRC19 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
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
      logger.success('FFRC19 passed');
    });



    contactTest('@regression FFRC20 restricted user should confirm typing too many characters in the Paragraph field is rejected when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
      await openEditContactFormExpectingRejection(contactsPage, contactId, lastName, {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateContactCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC20 Edit Contact — Paragraph over max');
      logger.success('FFRC20 passed');
    });


    contactTest('@regression FFRC21 restricted user should confirm a valid PAN number is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'PAN Card'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
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
      logger.success('FFRC21 passed');
    });



    contactTest('@regression FFRC22 restricted user should confirm an invalid PAN number is rejected when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'PAN Card'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC22 Add Contact — invalid PAN Card');
      logger.success('FFRC22 passed');
    });



    contactTest('@regression FFRC23 restricted user should confirm an invalid email is rejected when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Email'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC23 Add Contact — invalid Email');
      logger.success('FFRC23 passed');
    });



    contactTest('@regression FFRC24 restricted user should confirm a valid Driver Licence value is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Driver Licence'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
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
      logger.success('FFRC24 passed');
    });



    contactTest('@regression FFRC25 restricted user should confirm an invalid Voting Card value is rejected when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Voting Card'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      await openContactFormExpectingRejection(contactsPage, faker.person.lastName(), {
        fieldName: CONTACT_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(contactsPage, 'FFRC25 Add Contact — invalid Voting Card');
      logger.success('FFRC25 passed');
    });



    contactTest('@regression FFRC26 restricted user should confirm a valid Passport value is accepted when creating a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Passport'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
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
      logger.success('FFRC26 passed');
    });



    contactTest('@regression FFRC27 restricted user should confirm a valid PAN number is accepted when editing a contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldRegex(CONTACT_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CONTACT_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'PAN Card'
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const lastName = faker.person.lastName();
      const contactId = await createBareContact(contactsPage, lastName);
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
      logger.success('FFRC27 passed');
    });



    contactTest('@regression FFRC28 restricted user should confirm after the cache is cleared, the new limit is correctly applied on a new contact', async ({
      restrictedPage,
      adminPage,
    }) => {
      contactTest.setTimeout(480000);
      // WHY these are local to this one test, not block-level constants
      // (unlike contactFieldLimits.spec.ts's own Cache-behavior block, which
      // shares them between 2 sibling tests): only ONE cache-behavior test
      // moved here (the other, FFC51/admin-only, stayed in the UI file) —
      // a shared block-level constant would be needless indirection for a
      // single caller.
      const CACHE_TEST_FRESH_MIN = 8;
      const CACHE_TEST_FRESH_MAX = 12;
      const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
      const configPage = new FormFieldsConfigPage(adminPage, CONTACT_ENTITY);
      await configPage.configureFieldLimit(
        CONTACT_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await clearContactApplicationCache(restrictedPage);
      const contactsPage = new ContactsPage(restrictedPage);
      await contactsPage.goToContactsList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
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
      logger.success('FFRC28 passed');
    });

});
