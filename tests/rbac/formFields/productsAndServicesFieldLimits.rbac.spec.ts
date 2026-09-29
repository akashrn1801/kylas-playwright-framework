import { test as productsTest, expect } from '../../ui/formFields/productsAndServicesFormFieldLock';
// WHY this second `test` import — mirrors companyFieldLimits.rbac.spec.ts's
// own identical `baseTest` import (2026-09-29, Fix 2 for the dated
// known-issues.md entry, "A cross-process lock only protects workers on the
// SAME filesystem"): confirmed via a complete, per-test code-level audit
// that FFRPS1/2/3 below are the only 3 of this file's 31 tests that never
// call configureFieldLimit()/configureFieldRegex()/
// clearAllFieldConfigurations() via adminPage.
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { ProductsAndServicesPage } from '../../../src/modules/productsAndServices/ProductsAndServicesPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  PRODUCTS_FORM_FIELD_LIMIT_NAMES,
  PRODUCTS_LAYOUT_CACHE_KEY,
  generateProductsAndServicesData,
  generateProductsCustomFieldData,
  ProductsCustomFieldData,
  ProductsCustomFieldKey,
  generateProductsCustomFieldInvalidTextField,
  generateProductsCustomFieldInvalidParagraphText,
  generateValidPanCardValue as generateValidPanCardValuePs,
  generateInvalidPanCardValue as generateInvalidPanCardValuePs,
  generateValidEmailFormatValue as generateValidEmailFormatValuePs,
  generateInvalidEmailFormatValue as generateInvalidEmailFormatValuePs,
  generateValidDriverLicenceValue as generateValidDriverLicenceValuePs,
  generateInvalidDriverLicenceValue as generateInvalidDriverLicenceValuePs,
  generateValidVotingCardValue as generateValidVotingCardValuePs,
  generateInvalidVotingCardValue as generateInvalidVotingCardValuePs,
  generateValidPassportValue as generateValidPassportValuePs,
  generateInvalidPassportValue as generateInvalidPassportValuePs,
} from '../../../src/data/factories/productsAndServicesFactory';
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
  page: ProductsAndServicesPage,
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
const PRODUCTS_ENTITY: FormFieldsEntityConfig = {
  tabLabel: 'Product & Service',
  urlSlug: 'products-services',
};
const PS_TEXT_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField}`;

// WHY this block is separate from, not nested inside, the main
// 'Form Field Limits — RBAC › Products & Services' describe below, using
// `baseTest` instead of `productsTest` — mirrors
// companyFieldLimits.rbac.spec.ts's own identical extraction (see that
// file's WHY comment for the full reasoning, including why `.serial` isn't
// needed here either).
baseTest.describe('Form Field Limits — RBAC › Products & Services (read-only, lock-free)', () => {
  baseTest(
    '@regression FFRPS1 restricted user can see the field settings list but nothing else on that page',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, PRODUCTS_ENTITY);
      await configPage.assertListVisibleReadOnly();
      logger.success('FFRPS1 passed');
    }
  );

  baseTest(
    '@regression FFRPS2 restricted user does not see the "Add Field" button',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, PRODUCTS_ENTITY);
      await configPage.assertAddFieldButtonAbsent();
      logger.success('FFRPS2 passed');
    }
  );

  baseTest(
    '@regression FFRPS3 restricted user cannot click into any field to open it for editing',
    async ({ restrictedPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(restrictedPage, PRODUCTS_ENTITY);
      await configPage.assertRowNotClickable(PS_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFRPS3 passed');
    }
  );
});

productsTest.describe('Form Field Limits — RBAC › Products & Services', () => {
  // WHY productsTest.describe.configure({ mode: 'serial' }) IS here (restored
  // 2026-09-29 — see .claude/known-issues.md's dated 2026-09-29 entry "A
  // cross-process lock only protects workers on the SAME filesystem"):
  // removed earlier the same day on the reasoning that the auto-applied,
  // scope:'test' productsFormFieldLock fixture's own cross-process lock already makes
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

  // WHY productsTest.describe.configure({ timeout: 480000 }) here (2026-09-29,
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
  // per-test productsTest.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  productsTest.describe.configure({ mode: 'serial' });

  productsTest.describe.configure({ timeout: 480000 });

  // WHY PRODUCTS_ENTITY/PS_TEXT_FIELD_INTERNAL_NAME are NOT re-declared here
  // (2026-09-29): both now live at file scope (see the top of this file) —
  // shared with the lock-free 'read-only' block above, not duplicated.
  const PS_NUMBER_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.number}`;
  const PS_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

  // WHY these constants/helpers are duplicated here from
  // productsAndServicesFieldLimits.spec.ts rather than imported: mirrors
  // every other entity block's own identical, already-established "these
  // two files must remain independently runnable" convention.
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

  async function clearProductsApplicationCache(targetPage: Page): Promise<void> {
    const psPage = new ProductsAndServicesPage(targetPage);
    const result = await psPage.clearApplicationCache(PRODUCTS_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Products & Services application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

  type SupportedCustomFieldKey = Extract<ProductsCustomFieldKey, 'textField' | 'paragraphText' | 'number'>;

  function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
    if (fieldName === PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
    if (fieldName === PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
    if (fieldName === PRODUCTS_FORM_FIELD_LIMIT_NAMES.number) return 'number';
    throw new Error(
      `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
    );
  }

  interface ProductFieldUnderTest {
    fieldName: string;
    value: string;
  }

  function buildProductCustomFieldsWithOverride(field: ProductFieldUnderTest): ProductsCustomFieldData {
    const cf = generateProductsCustomFieldData();
    const dataKey = customFieldNameToDataKey(field.fieldName);
    if (dataKey === 'number') {
      cf.number = Number(field.value);
    } else {
      cf[dataKey] = field.value;
    }
    return cf;
  }

  async function hasInlineFormError(psPage: ProductsAndServicesPage, context: string): Promise<boolean> {
    try {
      await psPage.assertNoFormErrors(context);
      return false;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
        return true;
      }
      throw error;
    }
  }

  // WHY this retries the WHOLE create (not just the value verification)
  // up to 3 times: a confirmed, real Kylas application bug (2026-09-23,
  // see APPLICATION_BUGS.md #6) — under genuine concurrent load, a custom
  // field's value can be silently dropped server-side during create even
  // though the create POST itself returns success. Direct raw API
  // evidence confirmed the value is GENUINELY ABSENT from the persisted
  // record (not a client-side rendering/timing issue), so no amount of
  // re-reading the SAME record can recover it — only a fresh, independent
  // create attempt has a chance of not re-hitting the same race window.
  // Mirrors this codebase's own established "bounded whole-operation
  // retry on a confirmed app-side race" mitigation pattern
  // (CallLogsPage.openLogACallForm()'s 5-attempt reload-and-retry for the
  // analogous Call Logs concurrency bug, APPLICATION_BUGS.md #1).
  async function createProductExpectingAccept(
    psPage: ProductsAndServicesPage,
    field: ProductFieldUnderTest
  ): Promise<string> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const data = generateProductsAndServicesData();
      const cf = buildProductCustomFieldsWithOverride(field);
      const result = await psPage.createProduct(data, cf, {
        minimal: true,
        onlyCustomField: customFieldNameToDataKey(field.fieldName),
        onlyCustomFieldName: field.fieldName,
      });
      expect(
        result.id,
        `Expected Product creation to succeed (field="${field.fieldName}", value="${field.value}") but createProduct() returned null id`
      ).not.toBeNull();
      const id = result.id as string;
      try {
        await assertCustomFieldPersistedOnEdit(psPage, id, field.fieldName, field.value, field.fieldName);
        return id;
      } catch (error) {
        lastError = error;
        logger.warn(
          `createProductExpectingAccept: value not persisted after create (attempt ${attempt}/${maxAttempts}, ` +
            `suspected real backend concurrency bug — APPLICATION_BUGS.md #6) — retrying with a fresh product`
        );
      }
    }
    throw lastError;
  }

  async function createBareProduct(psPage: ProductsAndServicesPage): Promise<string> {
    const result = await psPage.createProduct(generateProductsAndServicesData(), undefined, {
      minimal: true,
    });
    expect(result.id, 'Expected a bare minimal Product to be created successfully').not.toBeNull();
    return result.id as string;
  }

  // WHY this retries the WHOLE edit — same confirmed real Kylas
  // application bug and reasoning as createProductExpectingAccept()'s own
  // identical fix above (APPLICATION_BUGS.md #6).
  async function updateProductExpectingAccept(
    psPage: ProductsAndServicesPage,
    id: string,
    field: ProductFieldUnderTest
  ): Promise<void> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await psPage.openProductForEdit(id);
      const cf = buildProductCustomFieldsWithOverride(field);
      await psPage.fillEditForm({}, cf, customFieldNameToDataKey(field.fieldName), field.fieldName);
      await psPage.saveEditedProduct();
      try {
        await assertCustomFieldPersistedOnEdit(psPage, id, field.fieldName, field.value, field.fieldName);
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `updateProductExpectingAccept: value not persisted after edit (attempt ${attempt}/${maxAttempts}, ` +
            `suspected real backend concurrency bug — APPLICATION_BUGS.md #6) — retrying the edit`
        );
      }
    }
    throw lastError;
  }

  async function openProductFormExpectingRejection(
    psPage: ProductsAndServicesPage,
    field: ProductFieldUnderTest
  ): Promise<void> {
    await psPage.goToProductsAndServicesList();
    await psPage.goToCreateProductForm();
    const data = generateProductsAndServicesData();
    const cf = buildProductCustomFieldsWithOverride(field);
    await psPage.fillProductsAndServicesForm(data, cf, {
      minimal: true,
      onlyCustomField: customFieldNameToDataKey(field.fieldName),
      onlyCustomFieldName: field.fieldName,
    });
  }

  async function openEditProductFormExpectingRejection(
    psPage: ProductsAndServicesPage,
    id: string,
    field: ProductFieldUnderTest
  ): Promise<void> {
    await psPage.openProductForEdit(id);
    const cf = buildProductCustomFieldsWithOverride(field);
    await psPage.fillEditForm({}, cf, customFieldNameToDataKey(field.fieldName), field.fieldName);
  }

  async function assertCustomFieldPersistedOnEdit(
    psPage: ProductsAndServicesPage,
    id: string,
    fieldName: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    await psPage.openProductForEdit(id);
    await psPage.assertCustomFieldValueOnEditPage(fieldName, expectedValue, description, id);
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

  // WHY FFRPS1/2/3 are no longer here (2026-09-29): moved to the lock-free
  // 'Form Field Limits — RBAC › Products & Services (read-only, lock-free)'
  // describe block near the top of this file.

  productsTest("@regression FFRPS4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      PS_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    const cacheResult = await new ProductsAndServicesPage(restrictedPage).clearApplicationCache(
      PRODUCTS_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Products & Services application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedPsPage = new ProductsAndServicesPage(restrictedPage);
    await restrictedPsPage.goToProductsAndServicesList();
    await restrictedPsPage.goToCreateProductForm();
    const data = generateProductsAndServicesData();
    const cf = generateProductsCustomFieldData();
    cf.textField = 'A'.repeat(max + 1);
    await restrictedPsPage.fillProductsAndServicesForm(data, cf, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent1 = await hasInlineFormError(
      restrictedPsPage,
      'FFRPS4 Add Product — restricted, over admin-set max'
    );
    expect(errorPresent1, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRPS4 passed');
  });

  productsTest("@regression FFRPS5 after admin sets a Number limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      PS_NUMBER_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Number field'
    );

    await clearProductsApplicationCache(restrictedPage);
    const restrictedPsPage = new ProductsAndServicesPage(restrictedPage);

    const acceptValue = '1'.repeat(min);
    await createProductExpectingAccept(restrictedPsPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      value: acceptValue,
    });

    await restrictedPsPage.goToProductsAndServicesList();
    await restrictedPsPage.goToCreateProductForm();
    const rejectData = generateProductsAndServicesData();
    const rejectCf = generateProductsCustomFieldData();
    rejectCf.number = Number('1'.repeat(max + 1));
    await restrictedPsPage.fillProductsAndServicesForm(rejectData, rejectCf, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
    });
    const errorPresent2 = await hasInlineFormError(
      restrictedPsPage,
      'FFRPS5 Add Product — restricted, Number over admin-set max'
    );
    expect(errorPresent2, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRPS5 passed');
  });

  productsTest("@regression FFRPS6 after admin sets a Paragraph limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const min = 6;
    const max = 10;
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_PARAGRAPH_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      PS_PARAGRAPH_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Paragraph field'
    );

    await clearProductsApplicationCache(restrictedPage);
    const restrictedPsPage = new ProductsAndServicesPage(restrictedPage);

    const acceptValue = 'B'.repeat(min);
    await createProductExpectingAccept(restrictedPsPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: acceptValue,
    });

    await restrictedPsPage.goToProductsAndServicesList();
    await restrictedPsPage.goToCreateProductForm();
    const rejectData = generateProductsAndServicesData();
    const rejectCf = generateProductsCustomFieldData();
    rejectCf.paragraphText = 'B'.repeat(max + 1);
    await restrictedPsPage.fillProductsAndServicesForm(rejectData, rejectCf, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    const errorPresent3 = await hasInlineFormError(
      restrictedPsPage,
      'FFRPS6 Add Product — restricted, Paragraph over admin-set max'
    );
    expect(errorPresent3, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRPS6 passed');
  });

  productsTest("@regression FFRPS7 after admin sets a Regex format (PAN Card) and restricted user's cache is cleared, restricted user's values are enforced for both a valid and an invalid value", async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'PAN Card' }, 'Text field');

    await clearProductsApplicationCache(restrictedPage);
    const restrictedPsPage = new ProductsAndServicesPage(restrictedPage);

    const acceptValue = generateValidPanCardValuePs();
    await createProductExpectingAccept(restrictedPsPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
      value: acceptValue,
    });

    await restrictedPsPage.goToProductsAndServicesList();
    await restrictedPsPage.goToCreateProductForm();
    const rejectData = generateProductsAndServicesData();
    const rejectCf = generateProductsCustomFieldData();
    rejectCf.textField = generateInvalidPanCardValuePs();
    await restrictedPsPage.fillProductsAndServicesForm(rejectData, rejectCf, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent4 = await hasInlineFormError(
      restrictedPsPage,
      'FFRPS7 Add Product — restricted, invalid PAN Card'
    );
    expect(errorPresent4, 'Expected an inline validation error for the invalid PAN Card value').toBe(true);
    logger.success('FFRPS7 passed');
  });

  productsTest('@regression FFRPS8 restricted user should confirm typing too few characters in the Text field is rejected when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
      value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS8 Add Product — Text under min');
    logger.success('FFRPS8 passed');
  });

  productsTest('@regression FFRPS9 restricted user should confirm typing exactly the maximum allowed characters in the Text field is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS9 passed');
  });

  productsTest('@regression FFRPS10 restricted user should confirm typing exactly the minimum allowed characters in the Text field is accepted when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
    await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS10 passed');
  });

  productsTest('@regression FFRPS11 restricted user should confirm typing too many characters in the Text field is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
      value: generateProductsCustomFieldInvalidTextField(TEXT_MAX),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS11 Edit Product — Text over max');
    logger.success('FFRPS11 passed');
  });

  productsTest('@regression FFRPS12 restricted user should confirm typing too few digits in the Number field is rejected when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS12 Add Product — Number under min');
    logger.success('FFRPS12 passed');
  });

  productsTest('@regression FFRPS13 restricted user should confirm typing exactly the maximum allowed digits in the Number field is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRPS13 passed');
  });

  productsTest('@regression FFRPS14 restricted user should confirm typing exactly the minimum allowed digits in the Number field is accepted when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRPS14 passed');
  });

  productsTest('@regression FFRPS15 restricted user should confirm typing too many digits in the Number field is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS15 Edit Product — Number over max');
    logger.success('FFRPS15 passed');
  });

  productsTest('@regression FFRPS16 restricted user should confirm fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
    restrictedPage,
    adminPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS16 Add Product — Number initially invalid');
    const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
    await psPage.fillTextLikeCustomField(
      PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      validValue,
      PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
      'plain'
    );
    await restrictedPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const errorStillPresent = await hasInlineFormError(
      psPage,
      'FFRPS16 Add Product — Number corrected to valid'
    );
    expect(
      errorStillPresent,
      'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
    ).toBe(false);
    const savedResult = await psPage.saveProduct();
    expect(savedResult.id, 'Expected the corrected Number value to save successfully').not.toBeNull();
    const id = savedResult.id as string;
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, validValue, 'Number field');
    logger.success('FFRPS16 passed');
  });

  productsTest('@regression FFRPS17 restricted user should confirm typing too few characters in the Paragraph field is rejected when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS17 Add Product — Paragraph under min');
    logger.success('FFRPS17 passed');
  });

  productsTest('@regression FFRPS18 restricted user should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRPS18 passed');
  });

  productsTest('@regression FFRPS19 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
    await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
    logger.success('FFRPS19 passed');
  });

  productsTest('@regression FFRPS20 restricted user should confirm typing too many characters in the Paragraph field is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(PS_PARAGRAPH_FIELD_INTERNAL_NAME, String(PARAGRAPH_MIN), String(PARAGRAPH_MAX));
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, {
      fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
      value: generateProductsCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
    });
    await assertInlineErrorPresent(psPage, 'FFRPS20 Edit Product — Paragraph over max');
    logger.success('FFRPS20 passed');
  });

  productsTest('@regression FFRPS21 restricted user should confirm a valid PAN Card value is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateValidPanCardValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS21 passed');
  });

  productsTest('@regression FFRPS22 restricted user should confirm an invalid PAN Card value is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    const value = generateInvalidPanCardValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(psPage, 'FFRPS22 Edit Product — invalid PAN Card');
    logger.success('FFRPS22 passed');
  });

  productsTest('@regression FFRPS23 restricted user should confirm an invalid Email value is rejected when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateInvalidEmailFormatValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(psPage, 'FFRPS23 Add Product — invalid Email');
    logger.success('FFRPS23 passed');
  });

  productsTest('@regression FFRPS24 restricted user should confirm a valid Email value is accepted when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
    const value = generateValidEmailFormatValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS24 passed');
  });

  productsTest('@regression FFRPS25 restricted user should confirm a valid Driver Licence value is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateValidDriverLicenceValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS25 passed');
  });

  productsTest('@regression FFRPS26 restricted user should confirm an invalid Driver Licence value is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
    const value = generateInvalidDriverLicenceValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(psPage, 'FFRPS26 Edit Product — invalid Driver Licence');
    logger.success('FFRPS26 passed');
  });

  productsTest('@regression FFRPS27 restricted user should confirm an invalid Voting Card value is rejected when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateInvalidVotingCardValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    await openProductFormExpectingRejection(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(psPage, 'FFRPS27 Add Product — invalid Voting Card');
    logger.success('FFRPS27 passed');
  });

  productsTest('@regression FFRPS28 restricted user should confirm a valid Voting Card value is accepted when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
    const value = generateValidVotingCardValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS28 passed');
  });

  productsTest('@regression FFRPS29 restricted user should confirm a valid Passport value is accepted when creating a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateValidPassportValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
    logger.success('FFRPS29 passed');
  });

  productsTest('@regression FFRPS30 restricted user should confirm an invalid Passport value is rejected when editing a product', async ({
    adminPage,
    restrictedPage,
  }) => {
    productsTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Passport');
    const value = generateInvalidPassportValuePs();
    await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const id = await createBareProduct(psPage);
    await openEditProductFormExpectingRejection(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
    await assertInlineErrorPresent(psPage, 'FFRPS30 Edit Product — invalid Passport');
    logger.success('FFRPS30 passed');
  });

  productsTest("@regression FFRPS31 restricted user should confirm after the cache is cleared, the new limit is correctly applied on a new product", async ({
    restrictedPage,
    adminPage,
  }) => {
    productsTest.setTimeout(480000);
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
    const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
    await configPage.configureFieldLimit(
      PS_NUMBER_FIELD_INTERNAL_NAME,
      String(CACHE_TEST_FRESH_MIN),
      String(CACHE_TEST_FRESH_MAX)
    );
    await clearProductsApplicationCache(restrictedPage);
    const psPage = new ProductsAndServicesPage(restrictedPage);
    const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
    const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value });
    await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
    logger.success('FFRPS31 passed');
  });
});
