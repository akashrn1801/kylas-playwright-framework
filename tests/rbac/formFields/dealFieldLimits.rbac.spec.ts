import { test as dealTest, expect } from '../../ui/formFields/dealFormFieldLock';
// WHY this second `test` import — mirrors companyFieldLimits.rbac.spec.ts's
// own identical `baseTest` import (2026-09-29, Fix 2 for the dated
// known-issues.md entry, "A cross-process lock only protects workers on the
// SAME filesystem"): confirmed via a complete, per-test code-level audit
// that FFRD1/2/3 below are the only 3 of this file's 31 tests that never
// call configureFieldLimit()/configureFieldRegex()/
// clearAllFieldConfigurations() via adminPage.
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  DEAL_FORM_FIELD_LIMIT_NAMES,
  DEAL_LAYOUT_CACHE_KEY,
  generateDealData,
  DealData,
  DealCustomFieldKey,
  generateDealCustomFieldInvalidTextField,
  generateDealCustomFieldInvalidParagraphText,
  generateValidPanCardValue as generateValidPanCardValueD,
  generateInvalidPanCardValue as generateInvalidPanCardValueD,
  generateValidEmailFormatValue as generateValidEmailFormatValueD,
  generateInvalidEmailFormatValue as generateInvalidEmailFormatValueD,
  generateValidDriverLicenceValue as generateValidDriverLicenceValueD,
  generateInvalidDriverLicenceValue as generateInvalidDriverLicenceValueD,
  generateValidVotingCardValue as generateValidVotingCardValueD,
  generateInvalidVotingCardValue as generateInvalidVotingCardValueD,
  generateValidPassportValue as generateValidPassportValueD,
  generateInvalidPassportValue as generateInvalidPassportValueD,
} from '../../../src/data/factories/dealFactory';
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

// WHY this checks an inline error, not a toast: live reproduction confirmed
// Text field min/max is validated CLIENT-SIDE, inline, on blur — the exact
// same mechanism as Number/Regex. Network-request logging confirmed Save
// fires ZERO requests while this inline error is present, so a toast-based
// check can never observe anything here. Deliberately duplicated per
// entity file rather than imported from a shared location — matches this
// feature's own established "each file stays independently runnable"
// convention.
async function assertInlineErrorPresent(
  page: DealsPage,
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

// WHY these two constants live at file (not describe-block) scope
// (2026-09-29): both the lock-free block below AND the main, lock-wrapped
// block need them — mirrors companyFieldLimits.rbac.spec.ts's identical
// hoist.
const DEAL_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Deal', urlSlug: 'deals' };
const D_TEXT_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.textField}`;

// WHY this block is separate from, not nested inside, the main
// 'Form Field Limits — RBAC › Deal' describe below, using `baseTest`
// instead of `dealTest` — mirrors companyFieldLimits.rbac.spec.ts's own
// identical extraction (see that file's WHY comment for the full
// reasoning, including why `.serial` isn't needed here either).
baseTest.describe('Form Field Limits — RBAC › Deal (read-only, lock-free)', () => {
  baseTest(
    '@regression FFRD1 restricted user can see the field settings list but nothing else on that page',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, DEAL_ENTITY);
      await configPage.assertListVisibleReadOnly();
      logger.success('FFRD1 passed');
    }
  );

  baseTest(
    '@regression FFRD2 restricted user does not see the "Add Field" button',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, DEAL_ENTITY);
      await configPage.assertAddFieldButtonAbsent();
      logger.success('FFRD2 passed');
    }
  );

  baseTest(
    '@regression FFRD3 restricted user cannot click into any field to open it for editing',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, DEAL_ENTITY);
      await configPage.assertRowNotClickable(D_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFRD3 passed');
    }
  );
});

dealTest.describe('Form Field Limits — RBAC › Deal', () => {
  // NOTE (2026-10-05): serial mode now lives on each per-category sub-block below, not this outer describe — the
  // reasoning that follows still applies to each sub-block.
  // WHY dealTest.describe.configure({ mode: 'serial' }) IS here (restored
  // 2026-09-29 — see .claude/known-issues.md's dated 2026-09-29 entry "A
  // cross-process lock only protects workers on the SAME filesystem"):
  // removed earlier the same day on the reasoning that the auto-applied,
  // scope:'test' dealFormFieldLock fixture's own cross-process lock already makes
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

  // WHY dealTest.describe.configure({ timeout: 480000 }) here (2026-09-29,
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
  // per-test dealTest.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  dealTest.describe.configure({ timeout: 480000 });

  // WHY DEAL_ENTITY/D_TEXT_FIELD_INTERNAL_NAME are NOT re-declared here
  // (2026-09-29): both now live at file scope (see the top of this file) —
  // shared with the lock-free 'read-only' block above, not duplicated.
  const D_NUMBER_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.number}`;
  const D_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

  // WHY these constants/helpers are duplicated here from
  // dealFieldLimits.spec.ts rather than imported: mirrors every other
  // entity block's own identical, already-established "these two files
  // must remain independently runnable" convention.
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

  function uniqueDealName(): string {
    return `[QA-Auto] ${faker.commerce.productName()} Deal ${Date.now()}`;
  }

  async function clearDealApplicationCache(targetPage: Page): Promise<void> {
    const dealsPage = new DealsPage(targetPage);
    const result = await dealsPage.clearApplicationCache(DEAL_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Deal application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

  type SupportedCustomFieldKey = Extract<DealCustomFieldKey, 'textField' | 'paragraphText' | 'number'>;

  function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
    if (fieldName === DEAL_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
    if (fieldName === DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
    if (fieldName === DEAL_FORM_FIELD_LIMIT_NAMES.number) return 'number';
    throw new Error(
      `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
    );
  }

  interface DealFieldUnderTest {
    fieldName: string;
    value: string;
  }

  function buildDealDataWithFieldOverride(name: string, field: DealFieldUnderTest): DealData {
    const dealData = generateDealData({ name, skipAssociatedEntities: true });
    const dataKey = customFieldNameToDataKey(field.fieldName);
    if (dataKey === 'number') {
      dealData.customFields.number = Number(field.value);
    } else {
      dealData.customFields[dataKey] = field.value;
    }
    return dealData;
  }

  async function hasInlineFormError(dealsPage: DealsPage, context: string): Promise<boolean> {
    try {
      await dealsPage.assertNoFormErrors(context);
      return false;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
        return true;
      }
      throw error;
    }
  }

  async function createDealExpectingAccept(
    dealsPage: DealsPage,
    name: string,
    field: DealFieldUnderTest
  ): Promise<number> {
    const dealData = buildDealDataWithFieldOverride(name, field);
    const dealId = await dealsPage.createDeal(dealData, {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    expect(
      dealId,
      `Expected Deal creation to succeed (field="${field.fieldName}", value="${field.value}") but createDeal() returned null`
    ).not.toBeNull();
    return dealId as number;
  }

  async function createBareDeal(dealsPage: DealsPage, name: string): Promise<number> {
    const dealId = await dealsPage.createDeal(generateDealData({ name, skipAssociatedEntities: true }), {
      minimal: true,
    });
    expect(dealId, `Expected a bare minimal Deal ("${name}") to be created successfully`).not.toBeNull();
    return dealId as number;
  }

  async function updateDealExpectingAccept(
    dealsPage: DealsPage,
    dealId: number,
    name: string,
    field: DealFieldUnderTest
  ): Promise<void> {
    await dealsPage.searchAndOpenDeal('', dealId);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(buildDealDataWithFieldOverride(name, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
    await dealsPage.saveEditedDeal();
  }

  async function openDealFormExpectingRejection(
    dealsPage: DealsPage,
    name: string,
    field: DealFieldUnderTest
  ): Promise<void> {
    await dealsPage.clickAddDeal();
    await dealsPage.fillDealForm(buildDealDataWithFieldOverride(name, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function openEditDealFormExpectingRejection(
    dealsPage: DealsPage,
    dealId: number,
    name: string,
    field: DealFieldUnderTest
  ): Promise<void> {
    await dealsPage.searchAndOpenDeal('', dealId);
    await dealsPage.clickEditIcon();
    await dealsPage.fillEditForm(buildDealDataWithFieldOverride(name, field), {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function assertCustomFieldPersistedOnDetail(
    dealsPage: DealsPage,
    dealId: number,
    fieldName: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    await dealsPage.searchAndOpenDeal('', dealId);
    await dealsPage.assertDealCustomFieldOnDetail(fieldName, expectedValue, description);
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

  // WHY FFRD1/2/3 are no longer here (2026-09-29): moved to the lock-free
  // 'Form Field Limits — RBAC › Deal (read-only, lock-free)' describe
  // block near the top of this file.

  // WHY split into smaller per-category serial sub-blocks below (2026-10-05) — mirrors dealFieldLimits.spec.ts's own
  // structure and Company's RBAC restructuring (see companyFieldLimits.rbac.spec.ts's WHY comment: cross-shard safety
  // unaffected, blast radius reduced). Constants/helpers above stay at this shared scope so every sub-block can see them.

  dealTest.describe('Admin-configures / restricted-verifies boundary tests', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest("@regression FFRD4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      D_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    const cacheResult = await new DealsPage(restrictedPage).clearApplicationCache(DEAL_LAYOUT_CACHE_KEY);
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Deal application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.clickAddDeal();
    const name = uniqueDealName();
    const dealData = generateDealData({ name, skipAssociatedEntities: true });
    dealData.customFields.textField = 'A'.repeat(max + 1);
    await restrictedDealsPage.fillDealForm(dealData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent1 = await hasInlineFormError(
      restrictedDealsPage,
      'FFRD4 Add Deal — restricted, over admin-set max'
    );
    expect(errorPresent1, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRD4 passed');
  });

  dealTest("@regression FFRD5 after admin sets a Number limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      D_NUMBER_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Number field'
    );

    await clearDealApplicationCache(restrictedPage);
    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();

    const acceptValue = '1'.repeat(min);
    const acceptData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    acceptData.customFields.number = Number(acceptValue);
    const dealId = await restrictedDealsPage.createDeal(acceptData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
    });
    expect(
      dealId,
      'Expected restricted user to successfully create a Deal with a Number value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedDealsPage.searchAndOpenDeal('', dealId as number);
    await restrictedDealsPage.assertDealCustomFieldOnDetail(
      DEAL_FORM_FIELD_LIMIT_NAMES.number,
      acceptValue,
      'Number field'
    );

    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.clickAddDeal();
    const rejectData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    rejectData.customFields.number = Number('1'.repeat(max + 1));
    await restrictedDealsPage.fillDealForm(rejectData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
    });
    const errorPresent2 = await hasInlineFormError(
      restrictedDealsPage,
      'FFRD5 Add Deal — restricted, Number over admin-set max'
    );
    expect(errorPresent2, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRD5 passed');
  });

  dealTest("@regression FFRD6 after admin sets a Paragraph limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const min = 6;
    const max = 10;
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_PARAGRAPH_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      D_PARAGRAPH_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Paragraph field'
    );

    await clearDealApplicationCache(restrictedPage);
    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();

    const acceptValue = 'B'.repeat(min);
    const acceptData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    acceptData.customFields.paragraphText = acceptValue;
    const dealId = await restrictedDealsPage.createDeal(acceptData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    expect(
      dealId,
      'Expected restricted user to successfully create a Deal with a Paragraph value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedDealsPage.searchAndOpenDeal('', dealId as number);
    await restrictedDealsPage.assertDealCustomFieldOnDetail(
      DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
      acceptValue,
      'Paragraph field'
    );

    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.clickAddDeal();
    const rejectData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    rejectData.customFields.paragraphText = 'B'.repeat(max + 1);
    await restrictedDealsPage.fillDealForm(rejectData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    const errorPresent3 = await hasInlineFormError(
      restrictedDealsPage,
      'FFRD6 Add Deal — restricted, Paragraph over admin-set max'
    );
    expect(errorPresent3, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRD6 passed');
  });

  dealTest("@regression FFRD7 after admin sets a Regex format (PAN Card) and restricted user's cache is cleared, restricted user's values are enforced for both a valid and an invalid value", async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'PAN Card' }, 'Text field');

    await clearDealApplicationCache(restrictedPage);
    const restrictedDealsPage = new DealsPage(restrictedPage);
    await restrictedDealsPage.goToDealsList();

    const acceptValue = generateValidPanCardValueD();
    const acceptData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    acceptData.customFields.textField = acceptValue;
    const dealId = await restrictedDealsPage.createDeal(acceptData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
    });
    expect(
      dealId,
      'Expected restricted user to successfully create a Deal with a valid PAN Card value'
    ).not.toBeNull();
    await restrictedDealsPage.searchAndOpenDeal('', dealId as number);
    await restrictedDealsPage.assertDealCustomFieldOnDetail(
      DEAL_FORM_FIELD_LIMIT_NAMES.textField,
      acceptValue,
      'Text field'
    );

    await restrictedDealsPage.goToDealsList();
    await restrictedDealsPage.clickAddDeal();
    const rejectData = generateDealData({ name: uniqueDealName(), skipAssociatedEntities: true });
    rejectData.customFields.textField = generateInvalidPanCardValueD();
    await restrictedDealsPage.fillDealForm(rejectData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent4 = await hasInlineFormError(
      restrictedDealsPage,
      'FFRD7 Add Deal — restricted, invalid PAN Card'
    );
    expect(errorPresent4, 'Expected an inline validation error for the invalid PAN Card value').toBe(true);
    logger.success('FFRD7 passed');
  });

  });

  dealTest.describe('Text field tests', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest('@regression FFRD8 restricted user should confirm typing too few characters in the Text field is rejected when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
      value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD8 Add Deal — Text under min');
    logger.success('FFRD8 passed');
  });

  dealTest('@regression FFRD9 restricted user should confirm typing exactly the maximum allowed characters in the Text field is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD9 passed');
  });

  dealTest('@regression FFRD10 restricted user should confirm typing exactly the minimum allowed characters in the Text field is accepted when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
    await updateDealExpectingAccept(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD10 passed');
  });

  dealTest('@regression FFRD11 restricted user should confirm typing too many characters in the Text field is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
      value: generateDealCustomFieldInvalidTextField(TEXT_MAX),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD11 Edit Deal — Text over max');
    logger.success('FFRD11 passed');
  });

  });

  dealTest.describe('Number field tests', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest('@regression FFRD12 restricted user should confirm typing too few digits in the Number field is rejected when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD12 Add Deal — Number under min');
    logger.success('FFRD12 passed');
  });

  dealTest('@regression FFRD13 restricted user should confirm typing exactly the maximum allowed digits in the Number field is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRD13 passed');
  });

  dealTest('@regression FFRD14 restricted user should confirm typing exactly the minimum allowed digits in the Number field is accepted when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await updateDealExpectingAccept(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRD14 passed');
  });

  dealTest('@regression FFRD15 restricted user should confirm typing too many digits in the Number field is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD15 Edit Deal — Number over max');
    logger.success('FFRD15 passed');
  });

  dealTest('@regression FFRD16 restricted user should confirm fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
    restrictedPage,
    adminPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    await openDealFormExpectingRejection(dealsPage, name, {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD16 Add Deal — Number initially invalid');
    const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await dealsPage.fillTextLikeCustomField(
      DEAL_FORM_FIELD_LIMIT_NAMES.number,
      validValue,
      DEAL_FORM_FIELD_LIMIT_NAMES.number
    );
    await restrictedPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const errorStillPresent = await hasInlineFormError(dealsPage, 'FFRD16 Add Deal — Number corrected to valid');
    expect(
      errorStillPresent,
      'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
    ).toBe(false);
    const savedDealId = await dealsPage.saveDeal();
    expect(savedDealId, 'Expected the corrected Number value to save successfully').not.toBeNull();
    const dealId = savedDealId as number;
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, validValue, 'Number field');
    logger.success('FFRD16 passed');
  });

  });

  dealTest.describe('Paragraph field tests', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest('@regression FFRD17 restricted user should confirm typing too few characters in the Paragraph field is rejected when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD17 Add Deal — Paragraph under min');
    logger.success('FFRD17 passed');
  });

  dealTest('@regression FFRD18 restricted user should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRD18 passed');
  });

  dealTest('@regression FFRD19 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
    await updateDealExpectingAccept(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRD19 passed');
  });

  dealTest('@regression FFRD20 restricted user should confirm typing too many characters in the Paragraph field is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(D_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
      fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: generateDealCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
    });
    await assertInlineErrorPresent(dealsPage, 'FFRD20 Edit Deal — Paragraph over max');
    logger.success('FFRD20 passed');
  });

  });

  dealTest.describe('Text field format rules (Regex) tests', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest('@regression FFRD21 restricted user should confirm a valid PAN Card value is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateValidPanCardValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD21 passed');
  });

  dealTest('@regression FFRD22 restricted user should confirm an invalid PAN Card value is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateInvalidPanCardValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(dealsPage, 'FFRD22 Edit Deal — invalid PAN Card');
    logger.success('FFRD22 passed');
  });

  dealTest('@regression FFRD23 restricted user should confirm an invalid Email value is rejected when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateInvalidEmailFormatValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await openDealFormExpectingRejection(dealsPage, uniqueDealName(), { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(dealsPage, 'FFRD23 Add Deal — invalid Email');
    logger.success('FFRD23 passed');
  });

  dealTest('@regression FFRD24 restricted user should confirm a valid Email value is accepted when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateValidEmailFormatValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await updateDealExpectingAccept(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD24 passed');
  });

  dealTest('@regression FFRD25 restricted user should confirm a valid Driver Licence value is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateValidDriverLicenceValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD25 passed');
  });

  dealTest('@regression FFRD26 restricted user should confirm an invalid Driver Licence value is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateInvalidDriverLicenceValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(dealsPage, 'FFRD26 Edit Deal — invalid Driver Licence');
    logger.success('FFRD26 passed');
  });

  dealTest('@regression FFRD27 restricted user should confirm an invalid Voting Card value is rejected when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateInvalidVotingCardValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    await openDealFormExpectingRejection(dealsPage, uniqueDealName(), { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(dealsPage, 'FFRD27 Add Deal — invalid Voting Card');
    logger.success('FFRD27 passed');
  });

  dealTest('@regression FFRD28 restricted user should confirm a valid Voting Card value is accepted when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateValidVotingCardValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await updateDealExpectingAccept(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD28 passed');
  });

  dealTest('@regression FFRD29 restricted user should confirm a valid Passport value is accepted when creating a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateValidPassportValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRD29 passed');
  });

  dealTest('@regression FFRD30 restricted user should confirm an invalid Passport value is rejected when editing a deal', async ({
    adminPage,
    restrictedPage,
  }) => {
    dealTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateInvalidPassportValueD();
    await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const name = uniqueDealName();
    const dealId = await createBareDeal(dealsPage, name);
    await openEditDealFormExpectingRejection(dealsPage, dealId, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(dealsPage, 'FFRD30 Edit Deal — invalid Passport');
    logger.success('FFRD30 passed');
  });

  });

  dealTest.describe('Cache behavior', () => {
    dealTest.describe.configure({ mode: 'serial' });

  dealTest("@regression FFRD31 restricted user should confirm after the cache is cleared, the new limit is correctly applied on a new deal", async ({
    restrictedPage,
    adminPage,
  }) => {
    dealTest.setTimeout(480000);
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
    const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
    await configPage.configureFieldLimit(
      D_NUMBER_FIELD_INTERNAL_NAME,
      String(CACHE_TEST_FRESH_MIN),
      String(CACHE_TEST_FRESH_MAX)
    );
    await clearDealApplicationCache(restrictedPage);
    const dealsPage = new DealsPage(restrictedPage);
    await dealsPage.goToDealsList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
    const name = uniqueDealName();
    const dealId = await createDealExpectingAccept(dealsPage, name, { fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRD31 passed');
  });
  });
});
