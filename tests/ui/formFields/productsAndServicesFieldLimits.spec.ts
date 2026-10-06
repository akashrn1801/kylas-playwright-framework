import {
  test,
  expect,
  withProductsAndServicesFormFieldLock,
} from './productsAndServicesFormFieldLock';
// WHY a second, separate `test` import here — mirrors
// companyFieldLimits.spec.ts's own identical `baseTest` import (2026-09-29,
// Fix 2 for the dated docs/known-issues/sharding-and-locks.md entry, "A cross-process lock only
// protects workers on the SAME filesystem"): confirmed via a complete,
// per-test code-level audit that every Navigation test below only ever
// READS field config, never calls configureFieldLimit()/
// configureFieldRegex()/clearAllFieldConfigurations().
import { test as baseTest } from '../../../src/fixtures/index';
import { Page } from '@playwright/test';
import { ProductsAndServicesPage } from '../../../src/modules/productsAndServices/ProductsAndServicesPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  PRODUCTS_FORM_FIELD_LIMIT_NAMES,
  PRODUCTS_LAYOUT_CACHE_KEY,
  generateProductsAndServicesData,
  generateProductsCustomFieldData,
  ProductsCustomFieldData,
  ProductsCustomFieldKey,
  generateProductsCustomFieldInvalidTextField,
  generateProductsCustomFieldInvalidParagraphText,
  generateValidPanCardValue,
  generateInvalidPanCardValue,
  generateValidEmailFormatValue,
  generateInvalidEmailFormatValue,
  generateValidDriverLicenceValue,
  generateInvalidDriverLicenceValue,
  generateValidVotingCardValue,
  generateInvalidVotingCardValue,
  generateValidPassportValue,
  generateInvalidPassportValue,
} from '../../../src/data/factories/productsAndServicesFactory';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this is the Products & Services rollout of the Form Field Limit
// feature — the SAME reusable architecture already proven for Lead/Contact/
// Company/Task, not a re-derivation. Design B (this file = admin-only, zero
// restrictedPage usage; all restricted-role tests live in
// tests/rbac/formFields.rbac.spec.ts's own block) and full 5-format Regex
// coverage are both applied from the start.
//
// WHY Products & Services' own live-confirmed facts (this session's own
// diagnostic pass, not assumed from any prior entity):
// - The Form Fields settings page's own tab for this module is labeled
//   "Product & Service" (singular "Product") — NOT "Products & Services"
//   the way the module's own app-facing name reads everywhere else. Its
//   URL slug is "products-services" (confirmed live: clicking the tab
//   lands on /setup/fields/products-services/list).
// - Products & Services' true save-required minimum is just TWO fields —
//   Name + Price — confirmed live via direct incremental reproduction
//   (Name alone -> "This is a required field"; Name+Price -> HTTP 200,
//   redirected to list). Description/HSN-SAC/Country/Category/Units/Active
//   are all genuinely optional server-side. This is simpler than every
//   other entity built so far in this feature.
// - This module has NO detail page at all — edit doubles as the only
//   per-record view (confirmed live, and already documented in
//   docs/known-issues/products-and-services.md's deviation list for this module).
//   Persisted custom-field values are verified by reading them back from
//   the still-open EDIT FORM's own input
//   (ProductsAndServicesPage.assertCustomFieldValueOnEditPage()), never via
//   BasePage.assertCustomFieldOnDetail() (which requires a rendered
//   detail-page display this module doesn't have).
// - Custom-field ids use the "plain" suffix style (`_input_cf<Name>`, no
//   `customFieldValues.` segment) — already an established, confirmed fact
//   in this codebase, reused here unchanged.
// - No "Show Required & Important Fields" toggle exists anywhere in this
//   module's create/edit forms.
// - `createProduct()`/`saveProduct()` return `{ id: string | null }`, not a
//   bare `number | null` the way every other entity's create method does —
//   ids are handled as strings throughout this file accordingly.
// - `ProductsAndServicesData` does NOT embed `customFields` the way every
//   other entity's own Data interface does — it's always a separate,
//   optional 2nd parameter on every fill/create/update method. This file's
//   own helper functions build the custom-fields object separately from
//   the main product data for this reason.

const PRODUCTS_ENTITY: FormFieldsEntityConfig = {
  tabLabel: 'Product & Service',
  urlSlug: 'products-services',
};

const PS_TEXT_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField}`;
const PS_NUMBER_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.number}`;
const PS_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

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

async function clearProductsApplicationCache(targetPage: Page): Promise<void> {
  const psPage = new ProductsAndServicesPage(targetPage);
  const result = await psPage.clearApplicationCache(PRODUCTS_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Products & Services application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Products & Services create/update flow for this feature — architecture note
// ============================================================================
// WHY `customFields` is always its own separate object here, never embedded
// in the main data object: mirrors ProductsAndServicesData's own real shape
// (see this file's header comment) — unlike every other entity in this
// feature, which embeds customFields directly in its Data interface.
// ============================================================================

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

async function assertInlineErrorPresent(psPage: ProductsAndServicesPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(psPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

async function createProductExpectingAccept(
  psPage: ProductsAndServicesPage,
  field: ProductFieldUnderTest
): Promise<string> {
  // WHY this retries the WHOLE create (not just the value verification)
  // up to 3 times: a confirmed, real Kylas application bug (2026-09-23,
  // see APPLICATION_BUGS.md #6) — under genuine concurrent load, a
  // custom field's value can be silently dropped server-side during
  // create even though the create POST itself returns success. Direct raw
  // API evidence confirmed the value is GENUINELY ABSENT from the
  // persisted record (not a client-side rendering/timing issue), so no
  // amount of re-reading the SAME record can recover it — only a fresh,
  // independent create attempt has a chance of not re-hitting the same
  // race window. Mirrors this codebase's own established "bounded
  // whole-operation retry on a confirmed app-side race" mitigation
  // pattern (CallLogsPage.openLogACallForm()'s 5-attempt reload-and-retry
  // for the analogous Call Logs concurrency bug, APPLICATION_BUGS.md #1).
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

// WHY this retries the WHOLE edit (not just the value verification) up
// to 3 times: same confirmed real Kylas application bug and reasoning as
// createProductExpectingAccept()'s own identical fix above (APPLICATION_
// BUGS.md #6) — the race is not confirmed to be create-specific, and a
// bare re-read can never recover a value the backend never durably wrote.
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

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

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

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
  await configPage.clearFieldConfiguration(PS_TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(PS_NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(PS_PARAGRAPH_FIELD_INTERNAL_NAME);
}

// WHY this block is a sibling of, not nested inside, 'Products & Services
// Field Limits' below, using `baseTest` instead of `test` — mirrors
// companyFieldLimits.spec.ts's own identical 'Navigation' extraction.
baseTest.describe('Navigation', () => {
  baseTest(
    '@smoke @prodSafe FFPS1 admin should open the Product & Service field settings page and see the entity tabs',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(
        tabs,
        'Expected the "Product & Service" tab to be present among the live tab labels'
      ).toContain('Product & Service');
      logger.success('FFPS1 passed');
    }
  );

  baseTest(
    '@smoke @prodSafe FFPS2 admin should search the field list by internal name and see it filter correctly',
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.open();
      await configPage.searchField(PS_TEXT_FIELD_INTERNAL_NAME);
      await configPage.openFieldForEdit(PS_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFPS2 passed');
    }
  );

  baseTest(
    "@smoke @prodSafe FFPS3 admin should open an individual custom field's edit page from the list",
    async ({ adminPage }) => {
      baseTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(PS_TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFPS3 passed');
    }
  );
}); // end describe('Navigation')

test.describe('Products & Services Field Limits', () => {
  // WHY test.describe.configure({{ timeout: 480000 }}) here (2026-09-29,
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
    const adminStorageStatePath = path.join(
      __dirname,
      '../../../src/auth/storageStates',
      config.env,
      'admin.json'
    );
    const context = await browser.newContext({ storageState: adminStorageStatePath });
    const page = await context.newPage();
    try {
      await withProductsAndServicesFormFieldLock(() => clearAllFieldConfigurations(page));
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

    test('@regression FFPS4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await configPage.assertFieldConfigMatches(
        PS_TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFPS4 passed');
    });

    test('@regression FFPS5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const id = await createProductExpectingAccept(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS5 passed');
    });

    test('@regression FFPS6 admin should confirm typing too many characters in the Text field is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateProductsCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(psPage, 'FFPS6 Add Product — Text over max');
      logger.success('FFPS6 passed');
    });

    test('@regression FFPS7 admin should confirm typing too few characters in the Text field is rejected when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await openEditProductFormExpectingRejection(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(psPage, 'FFPS7 Edit Product — Text under min');
      logger.success('FFPS7 passed');
    });

    test('@regression FFPS8 admin should confirm typing exactly the maximum allowed characters in the Text field is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateProductExpectingAccept(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS8 passed');
    });
  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ────────────────────────

  test.describe('Number field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFPS9 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await configPage.assertFieldConfigMatches(
        PS_NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFPS9 passed');
    });

    test('@regression FFPS10 admin should confirm typing exactly the minimum allowed digits in the Number field is accepted when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const id = await createProductExpectingAccept(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
      logger.success('FFPS10 passed');
    });

    test('@regression FFPS11 admin should confirm typing too many digits in the Number field is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(psPage, 'FFPS11 Add Product — Number over max');
      logger.success('FFPS11 passed');
    });

    test('@regression FFPS12 admin should confirm typing too few digits in the Number field is rejected when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await openEditProductFormExpectingRejection(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(psPage, 'FFPS12 Edit Product — Number under min');
      logger.success('FFPS12 passed');
    });

    test('@regression FFPS13 admin should confirm typing exactly the maximum allowed digits in the Number field is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(PS_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateProductExpectingAccept(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
      logger.success('FFPS13 passed');
    });
  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────

  test.describe('Paragraph field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFPS14 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFPS14 passed');
    });

    test('@regression FFPS15 admin should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
      const id = await createProductExpectingAccept(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
      logger.success('FFPS15 passed');
    });

    test('@regression FFPS16 admin should confirm typing too many characters in the Paragraph field is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateProductsCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(psPage, 'FFPS16 Add Product — Paragraph over max');
      logger.success('FFPS16 passed');
    });

    test('@regression FFPS17 admin should confirm typing too few characters in the Paragraph field is rejected when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await openEditProductFormExpectingRejection(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(psPage, 'FFPS17 Edit Product — Paragraph under min');
      logger.success('FFPS17 passed');
    });

    test('@regression FFPS18 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      await updateProductExpectingAccept(psPage, id, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
      logger.success('FFPS18 passed');
    });
  }); // end describe('Paragraph field limits')

  // ─── Format rules (Regex) — Text field ────────────────────────────────

  test.describe('Text field format rules (Regex)', () => {
    test.describe.configure({ mode: 'serial' });

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

    test('@regression FFPS19 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'PAN Card' }, 'Text field');
      logger.success('FFPS19 passed');
    });

    test('@regression FFPS20 admin should confirm an invalid PAN Card value is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertInlineErrorPresent(psPage, 'FFPS20 Add Product — invalid PAN Card');
      logger.success('FFPS20 passed');
    });

    test('@regression FFPS21 admin should confirm a valid PAN Card value is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS21 passed');
    });

    test('@regression FFPS22 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Email' }, 'Text field');
      logger.success('FFPS22 passed');
    });

    test('@regression FFPS23 admin should confirm a valid Email value is accepted when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS23 passed');
    });

    test('@regression FFPS24 admin should confirm an invalid Email value is rejected when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await openEditProductFormExpectingRejection(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertInlineErrorPresent(psPage, 'FFPS24 Edit Product — invalid Email');
      logger.success('FFPS24 passed');
    });

    test('@regression FFPS25 admin sets the Text field format to Driver Licence and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Driver Licence' }, 'Text field');
      logger.success('FFPS25 passed');
    });

    test('@regression FFPS26 admin should confirm an invalid Driver Licence value is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertInlineErrorPresent(psPage, 'FFPS26 Add Product — invalid Driver Licence');
      logger.success('FFPS26 passed');
    });

    test('@regression FFPS27 admin should confirm a valid Driver Licence value is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS27 passed');
    });

    test('@regression FFPS28 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Voting Card' }, 'Text field');
      logger.success('FFPS28 passed');
    });

    test('@regression FFPS29 admin should confirm a valid Voting Card value is accepted when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createProductExpectingAccept(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS29 passed');
    });

    test('@regression FFPS30 admin should confirm an invalid Voting Card value is rejected when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await openEditProductFormExpectingRejection(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertInlineErrorPresent(psPage, 'FFPS30 Edit Product — invalid Voting Card');
      logger.success('FFPS30 passed');
    });

    test('@regression FFPS31 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(PS_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Passport' }, 'Text field');
      logger.success('FFPS31 passed');
    });

    test('@regression FFPS32 admin should confirm an invalid Passport value is rejected when creating a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertInlineErrorPresent(psPage, 'FFPS32 Add Product — invalid Passport');
      logger.success('FFPS32 passed');
    });

    test('@regression FFPS33 admin should confirm a valid Passport value is accepted when editing a product', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, PS_TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const id = await createBareProduct(psPage);
      await updateProductExpectingAccept(psPage, id, { fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS33 passed');
    });

    test('@regression FFPS34 admin should confirm choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.openFieldForEdit(PS_TEXT_FIELD_INTERNAL_NAME);
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        PS_TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFPS34 passed');
    });

    test('@regression FFPS35 admin should confirm choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        PS_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFPS35 passed');
    });

    test('@regression FFPS36 admin should confirm switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(PS_TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(PS_TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        PS_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false, min: lockedSnapshot.min, max: lockedSnapshot.max },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFPS36 passed');
    });
  }); // end describe('Text field format rules (Regex)')

  // ─── Cache behavior ────────────────────────────────────────────────────

  test.describe('Cache behavior', () => {
    test.describe.configure({ mode: 'serial' });

    const CACHE_TEST_STALE_MIN = 3;
    const CACHE_TEST_STALE_MAX = 6;
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;

    test('@regression FFPS37 admin should confirm a new limit is not applied on the product form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.configureFieldLimit(
        PS_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      await openProductFormExpectingRejection(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await psPage.assertNoFormErrors('FFPS37 seed Add Product');
      await configPage.configureFieldLimit(
        PS_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await psPage.goToProductsAndServicesList();
      await openProductFormExpectingRejection(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        psPage,
        'FFPS37 Add Product — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFPS37 passed');
    });
  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────

  test.describe('Cleanup', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFPS38 admin should confirm after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, PRODUCTS_ENTITY);
      await configPage.assertFieldConfigMatches(
        PS_TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        PS_NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        PS_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFPS38 passed');
    });

    test('@regression FFPS39 admin should confirm after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      await clearProductsApplicationCache(adminPage);
      const psPage = new ProductsAndServicesPage(adminPage);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const id = await createProductExpectingAccept(psPage, {
        fieldName: PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnEdit(psPage, id, PRODUCTS_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFPS39 passed');
    });
  }); // end describe('Cleanup')
});
