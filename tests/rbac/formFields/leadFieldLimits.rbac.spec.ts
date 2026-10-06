import { test as leadTest, expect } from '../../ui/formFields/formFieldsTestLock';
// WHY this second `test` import — mirrors companyFieldLimits.rbac.spec.ts's
// own identical `baseTest` import (2026-09-29, Fix 2 for the dated
// docs/known-issues/sharding-and-locks.md entry, "A cross-process lock only protects workers on the
// SAME filesystem"): confirmed via a complete, per-test code-level audit
// that FFR1/2/3 below are the only 3 of this file's 25 tests that never
// call configureFieldLimit()/configureFieldRegex()/
// clearAllFieldConfigurations() via adminPage.
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  LEAD_FORM_FIELD_LIMIT_NAMES,
  LEAD_LAYOUT_CACHE_KEY,
  generateLeadData,
  LeadData,
  generateLeadCustomFieldInvalidTextField,
  generateLeadCustomFieldInvalidParagraphText,
  generateValidPanCardValue as generateValidPanCardValueLd,
  generateInvalidPanCardValue as generateInvalidPanCardValueLd,
  generateInvalidEmailFormatValue as generateInvalidEmailFormatValueLd,
  generateValidDriverLicenceValue as generateValidDriverLicenceValueLd,
  generateInvalidVotingCardValue as generateInvalidVotingCardValueLd,
  generateValidPassportValue as generateValidPassportValueLd,
} from '../../../src/data/factories/leadFactory';
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
// documented in docs/known-issues/sharding-and-locks.md — colliding with
// authManager.isSessionExpiryPage()'s own recognition of that exact page
// shape. Restricted-user RBAC here is proven entirely through the LIST
// page (visible, read-only, no Add Field button, rows not clickable).

const LEAD_TEXT_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.textField}`;

// WHY this checks an inline error, not a toast: live reproduction confirmed
// Text field min/max is validated CLIENT-SIDE, inline, on blur — the exact
// same mechanism as Number/Regex. Network-request logging confirmed Save
// fires ZERO requests while this inline error is present, so a toast-based
// check can never observe anything here. Deliberately duplicated per
// entity file rather than imported from a shared location — matches this
// feature's own established "each file stays independently runnable"
// convention.
async function assertInlineErrorPresent(
  page: LeadsPage,
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
const LEAD_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Lead', urlSlug: 'leads' };

// WHY this block is separate from, not nested inside, the main
// 'Form Field Limits — RBAC › Lead' describe below, using `baseTest`
// instead of `leadTest` — mirrors companyFieldLimits.rbac.spec.ts's own
// identical extraction (see that file's WHY comment for the full
// reasoning, including why `.serial` isn't needed here either).
baseTest.describe('Form Field Limits — RBAC › Lead (read-only, lock-free)', () => {
  baseTest(
    '@regression FFR1 restricted user can see the field settings list but nothing else on that page',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, LEAD_ENTITY);
      await configPage.assertListVisibleReadOnly();
      logger.success('FFR1 passed');
    }
  );

  baseTest(
    '@regression FFR2 restricted user does not see the "Add Field" button',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, LEAD_ENTITY);
      await configPage.assertAddFieldButtonAbsent();
      logger.success('FFR2 passed');
    }
  );

  baseTest(
    '@regression FFR3 restricted user cannot click into any field to open it for editing',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, LEAD_ENTITY);
      await configPage.assertRowNotClickable(LEAD_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFR3 passed');
    }
  );
});

leadTest.describe('Form Field Limits — RBAC › Lead', () => {
  // NOTE (2026-10-05): serial mode now lives on each per-category sub-block below, not this outer describe — the
  // reasoning that follows still applies to each sub-block.
  // WHY leadTest.describe.configure({ mode: 'serial' }) IS here (restored
  // 2026-09-29 — see docs/known-issues/sharding-and-locks.md's dated 2026-09-29 entry "A
  // cross-process lock only protects workers on the SAME filesystem"):
  // removed earlier the same day on the reasoning that the auto-applied,
  // scope:'test' leadFormFieldLock fixture's own cross-process lock already makes
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

  // WHY leadTest.describe.configure({ timeout: 480000 }) here (2026-09-29,
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
  // per-test leadTest.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  leadTest.describe.configure({ timeout: 480000 });

  // WHY LEAD_ENTITY is NOT re-declared here (2026-09-29): it now lives at
  // file scope (see the top of this file) — shared with the lock-free
  // 'read-only' block above, not duplicated.

  // WHY these constants/helpers are duplicated here from
  // leadFieldLimits.spec.ts rather than imported: mirrors every other
  // entity block's own identical, already-established "these two files
  // must remain independently runnable" convention. Added 2026-09-23 as
  // part of the Design B retrofit (moving Lead's own restricted-role tests
  // out of leadFieldLimits.spec.ts into this block, matching the pattern
  // already applied to Contact/Company/Task/Products & Services/Deal).
  const TEXT_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.textField}`;
  const NUMBER_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.number}`;
  const PARAGRAPH_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText}`;
  const OTHER_DETAILS_TAB = 'Other Details';

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

  async function clearLeadApplicationCache(targetPage: Page): Promise<void> {
    const leadsPage = new LeadsPage(targetPage);
    const result = await leadsPage.clearApplicationCache(LEAD_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Lead application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

  type SupportedCustomFieldKey = 'textField' | 'paragraphText' | 'number';

  function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
    if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
    if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
    if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.number) return 'number';
    throw new Error(
      `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
    );
  }

  interface LeadFieldUnderTest {
    fieldName: string;
    value: string;
  }

  function buildLeadDataWithFieldOverride(lastName: string, field: LeadFieldUnderTest): LeadData {
    const leadData = generateLeadData({ lastName });
    const dataKey = customFieldNameToDataKey(field.fieldName);
    if (dataKey === 'number') {
      leadData.customFields.number = Number(field.value);
    } else {
      leadData.customFields[dataKey] = field.value;
    }
    return leadData;
  }

  async function hasInlineFormError(leadsPage: LeadsPage, context: string): Promise<boolean> {
    try {
      await leadsPage.assertNoFormErrors(context);
      return false;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
        return true;
      }
      throw error;
    }
  }

  async function createLeadExpectingAccept(
    leadsPage: LeadsPage,
    lastName: string,
    field: LeadFieldUnderTest
  ): Promise<number> {
    const leadData = buildLeadDataWithFieldOverride(lastName, field);
    const leadId = await leadsPage.createLead(leadData, {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    expect(
      leadId,
      `Expected Lead creation to succeed (field="${field.fieldName}", value="${field.value}") but createLead() returned null`
    ).not.toBeNull();
    return leadId as number;
  }

  async function createBareLead(leadsPage: LeadsPage, lastName: string): Promise<number> {
    const leadId = await leadsPage.createLead(generateLeadData({ lastName }), { minimal: true });
    expect(
      leadId,
      `Expected a bare minimal Lead ("${lastName}") to be created successfully`
    ).not.toBeNull();
    return leadId as number;
  }

  async function updateLeadExpectingAccept(
    leadsPage: LeadsPage,
    leadId: number,
    lastName: string,
    field: LeadFieldUnderTest
  ): Promise<void> {
    await leadsPage.searchAndOpenLead('', leadId);
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(buildLeadDataWithFieldOverride(lastName, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    await leadsPage.saveEditedLead();
  }

  async function openLeadFormExpectingRejection(
    leadsPage: LeadsPage,
    lastName: string,
    field: LeadFieldUnderTest
  ): Promise<void> {
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(buildLeadDataWithFieldOverride(lastName, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function openEditLeadFormExpectingRejection(
    leadsPage: LeadsPage,
    leadId: number,
    lastName: string,
    field: LeadFieldUnderTest
  ): Promise<void> {
    await leadsPage.searchAndOpenLead('', leadId);
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(buildLeadDataWithFieldOverride(lastName, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function assertCustomFieldPersistedOnDetail(
    leadsPage: LeadsPage,
    leadId: number,
    fieldName: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    await leadsPage.searchAndOpenLead('', leadId);
    await leadsPage.clickDetailPageTab(OTHER_DETAILS_TAB);
    await leadsPage.assertCustomFieldOnDetail(fieldName, expectedValue, description);
  }

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


  // WHY FFR1/2/3 are no longer here (2026-09-29): moved to the lock-free
  // 'Form Field Limits — RBAC › Lead (read-only, lock-free)' describe
  // block near the top of this file.

  // WHY split into smaller per-category serial sub-blocks below (2026-09-30)
  // — mirrors leadFieldLimits.spec.ts's own structure and the other 5
  // entities' RBAC restructuring (see companyFieldLimits.rbac.spec.ts's own
  // WHY comment for the full reasoning: cross-shard safety unaffected,
  // blast radius dramatically reduced). Lead genuinely has only ONE
  // dual-fixture admin-configures/restricted-verifies test (FFR4, unlike
  // the other 5 entities' 4) — Lead was built before the per-field-type
  // dual-fixture pattern was established and deliberately never
  // retrofitted with the other 3 (Number/Paragraph/Regex) — a real,
  // pre-existing content difference, not a mistake introduced here. All
  // constants/helpers above stay at this shared scope so every sub-block
  // below can see them.
  leadTest.describe('Admin-configures / restricted-verifies boundary tests', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest("@regression FFR4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    leadTest.setTimeout(480000);
    // WHY these two constants aren't shared with leadFieldLimits.spec.ts's
    // own TEXT_MIN/TEXT_MAX: this test file and the UI spec file are
    // separate Playwright projects/files that can be selected and run
    // independently (per detect-tests.sh's own path-based selection) —
    // sharing a module-level constant across files would create an
    // invisible coupling between two files that must otherwise remain
    // independently runnable.
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(LEAD_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      LEAD_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    // WHY 'key-not-found' is treated as a successful no-op, not a failure:
    // a restricted user's fresh browser context has never opened the Lead
    // create/edit form before this point in the test, so there is nothing
    // cached for "leads" yet — no key to delete, and "nothing cached"
    // already IS the desired end state clearing the cache is meant to
    // produce. Every OTHER failure reason ('db-not-found', 'store-not-found',
    // 'exception') still fails loudly — see leadFieldLimits.spec.ts's
    // clearLeadApplicationCache() for the identical, more fully-argued
    // reasoning.
    const cacheResult = await new LeadsPage(restrictedPage).clearApplicationCache(LEAD_LAYOUT_CACHE_KEY);
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Lead application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await restrictedLeadsPage.goToLeadsList();
    await restrictedLeadsPage.clickAddLead();
    await restrictedLeadsPage.disableRequiredFieldsToggle();
    const lastName = faker.person.lastName();
    await restrictedLeadsPage.fillStandardField('lastName', lastName, 'Last Name');
    // WHY (max + 1) proves the admin's newly-configured limit specifically
    // (not just "some" limit): this value is 1 character over the max
    // the admin JUST set — if the restricted user's own fresh cache read
    // reflects that same configuration, this value must be rejected.
    await restrictedLeadsPage.fillTextLikeCustomField(
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      'A'.repeat(max + 1),
      LEAD_FORM_FIELD_LIMIT_NAMES.textField
    );
    await restrictedLeadsPage.fillStandardField('lastName', lastName, 'Last Name');
    await assertInlineErrorPresent(restrictedLeadsPage, 'FFR4 Add Lead — restricted, over admin-set max');
    logger.success('FFR4 passed');
  });
  });

  leadTest.describe('Text field tests', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest('@regression FFR5 typing too few characters in the Text field is rejected when creating a lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      TEXT_FIELD_INTERNAL_NAME,
      String(TEXT_MIN),
      String(TEXT_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR5 Add Lead — Text under min');
    logger.success('FFR5 passed');
  });

  leadTest('@regression FFR6 typing exactly the maximum allowed characters in the Text field is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      TEXT_FIELD_INTERNAL_NAME,
      String(TEXT_MIN),
      String(TEXT_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR6 passed');
  });

  leadTest('@regression FFR7 typing exactly the minimum allowed characters in the Text field is accepted when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      TEXT_FIELD_INTERNAL_NAME,
      String(TEXT_MIN),
      String(TEXT_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
    await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR7 passed');
  });

  leadTest('@regression FFR8 typing too many characters in the Text field is rejected when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      TEXT_FIELD_INTERNAL_NAME,
      String(TEXT_MIN),
      String(TEXT_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value: generateLeadCustomFieldInvalidTextField(TEXT_MAX),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR8 Edit Lead — Text over max');
    logger.success('FFR8 passed');
  });
  });

  leadTest.describe('Number field tests', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest('@regression FFR9 typing too few digits in the Number field is rejected when creating a lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(NUMBER_MIN),
      String(NUMBER_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR9 Add Lead — Number under min');
    logger.success('FFR9 passed');
  });

  leadTest('@regression FFR10 typing exactly the maximum allowed digits in the Number field is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(NUMBER_MIN),
      String(NUMBER_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
      'Number field'
    );
    logger.success('FFR10 passed');
  });

  leadTest('@regression FFR11 typing exactly the minimum allowed digits in the Number field is accepted when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(NUMBER_MIN),
      String(NUMBER_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
      'Number field'
    );
    logger.success('FFR11 passed');
  });

  leadTest('@regression FFR12 typing too many digits in the Number field is rejected when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(NUMBER_MIN),
      String(NUMBER_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR12 Edit Lead — Number over max');
    logger.success('FFR12 passed');
  });

  leadTest('@regression FFR13 fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(NUMBER_MIN),
      String(NUMBER_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    await openLeadFormExpectingRejection(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR13 Add Lead — Number initially invalid');
    const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await leadsPage.fillTextLikeCustomField(
      LEAD_FORM_FIELD_LIMIT_NAMES.number,
      validValue,
      LEAD_FORM_FIELD_LIMIT_NAMES.number
    );
    await leadsPage.fillStandardField('lastName', lastName, 'Last Name');
    const errorStillPresent = await hasInlineFormError(
      leadsPage,
      'FFR13 Add Lead — Number corrected to valid'
    );
    expect(
      errorStillPresent,
      'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
    ).toBe(false);
    // WHY leadsPage.saveLead() directly here, neither
    // createLeadExpectingAccept() nor openLeadFormExpectingRejection()'s own
    // save step: this test is deliberately exercising LIVE, IN-FORM
    // correction (invalid value -> error shown -> corrected in place ->
    // error clears), not a plain create. createLeadExpectingAccept() would
    // re-open a brand-new modal on any retry, discarding exactly the
    // corrected-in-place state this test exists to verify — the one
    // legitimate exception to the two-path split, and it stays a single
    // direct call to the same underlying, already-proven LeadsPage.saveLead()
    // primitive both paths are themselves built on, never a third
    // reimplementation.
    const savedLeadId = await leadsPage.saveLead();
    expect(
      savedLeadId,
      'Expected the corrected Number value to save successfully'
    ).not.toBeNull();
    const leadId = savedLeadId as number;
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.number,
      validValue,
      'Number field'
    );
    logger.success('FFR13 passed');
  });
  });

  leadTest.describe('Paragraph field tests', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest('@regression FFR14 typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      PARAGRAPH_FIELD_INTERNAL_NAME,
      String(PARAGRAPH_MIN),
      String(PARAGRAPH_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
      'Paragraph field'
    );
    logger.success('FFR14 passed');
  });

  leadTest('@regression FFR15 typing too many characters in the Paragraph field is rejected when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      PARAGRAPH_FIELD_INTERNAL_NAME,
      String(PARAGRAPH_MIN),
      String(PARAGRAPH_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: generateLeadCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR15 Add Lead — Paragraph over max');
    logger.success('FFR15 passed');
  });

  leadTest('@regression FFR16 typing too few characters in the Paragraph field is rejected when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      PARAGRAPH_FIELD_INTERNAL_NAME,
      String(PARAGRAPH_MIN),
      String(PARAGRAPH_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
    });
    await assertInlineErrorPresent(leadsPage, 'FFR16 Edit Lead — Paragraph under min');
    logger.success('FFR16 passed');
  });

  leadTest('@regression FFR17 typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      PARAGRAPH_FIELD_INTERNAL_NAME,
      String(PARAGRAPH_MIN),
      String(PARAGRAPH_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
    await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value,
      'Paragraph field'
    );
    logger.success('FFR17 passed');
  });
  });

  leadTest.describe('Text field format rules (Regex) tests', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest('@regression FFR18 a valid PAN number is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateValidPanCardValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      true,
      'PAN Card'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR18 passed');
  });

  leadTest('@regression FFR19 an invalid PAN number is rejected when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateInvalidPanCardValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      false,
      'PAN Card'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(leadsPage, 'FFR19 Add Lead — invalid PAN Card');
    logger.success('FFR19 passed');
  });

  leadTest('@regression FFR20 an invalid email is rejected when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateInvalidEmailFormatValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      false,
      'Email'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(leadsPage, 'FFR20 Add Lead — invalid Email');
    logger.success('FFR20 passed');
  });

  leadTest('@regression FFR21 a valid Driving Licence value is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateValidDriverLicenceValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      true,
      'Driver Licence'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR21 passed');
  });

  leadTest('@regression FFR22 an invalid Voting Card value is rejected when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateInvalidVotingCardValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      false,
      'Voting Card'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertInlineErrorPresent(leadsPage, 'FFR22 Add Lead — invalid Voting Card');
    logger.success('FFR22 passed');
  });

  leadTest('@regression FFR23 a valid Passport value is accepted when creating a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateValidPassportValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      true,
      'Passport'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR23 passed');
  });

  leadTest('@regression FFR24 a valid PAN number is accepted when editing a lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateValidPanCardValueLd();
    await assertGeneratedValueMatchesLivePattern(
      configPage,
      TEXT_FIELD_INTERNAL_NAME,
      value,
      true,
      'PAN Card'
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const lastName = faker.person.lastName();
    const leadId = await createBareLead(leadsPage, lastName);
    await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.textField,
      value,
      'Text field'
    );
    logger.success('FFR24 passed');
  });
  });

  leadTest.describe('Cache behavior', () => {
    leadTest.describe.configure({ mode: 'serial' });

  leadTest('@regression FFR25 after the cache is cleared, the new limit is correctly applied on a new lead', async ({
    restrictedPage,
    adminPage,
  }) => {
    leadTest.setTimeout(480000);
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
    const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
    await configPage.configureFieldLimit(
      NUMBER_FIELD_INTERNAL_NAME,
      String(CACHE_TEST_FRESH_MIN),
      String(CACHE_TEST_FRESH_MAX)
    );
    await clearLeadApplicationCache(restrictedPage);
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
    const lastName = faker.person.lastName();
    const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
      fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
    });
    await assertCustomFieldPersistedOnDetail(
      leadsPage,
      leadId,
      LEAD_FORM_FIELD_LIMIT_NAMES.number,
      value,
      'Number field'
    );
    logger.success('FFR25 passed');
  });
  });
});
