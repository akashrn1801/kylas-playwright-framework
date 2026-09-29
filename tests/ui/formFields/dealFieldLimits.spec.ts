import { test, expect, withDealFormFieldLock } from './dealFormFieldLock';
import { Page } from '@playwright/test';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  DEAL_FORM_FIELD_LIMIT_NAMES,
  DEAL_LAYOUT_CACHE_KEY,
  generateDealData,
  DealData,
  DealCustomFieldKey,
  generateDealCustomFieldInvalidTextField,
  generateDealCustomFieldInvalidParagraphText,
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
} from '../../../src/data/factories/dealFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this is the Deal rollout of the Form Field Limit feature — the SAME
// reusable architecture already proven for Lead/Contact/Company/Task/
// Products & Services, not a re-derivation. Design B (this file =
// admin-only, zero restrictedPage usage; all restricted-role tests live in
// tests/rbac/formFields.rbac.spec.ts's own block) and full 5-format Regex
// coverage are both applied from the start.
//
// WHY Deal's own live-confirmed facts (this session's own diagnostic pass,
// not assumed from any prior entity):
// - The Form Fields settings page's own tab for this module is labeled
//   exactly "Deal", urlSlug "deals" (confirmed live via
//   FormFieldsConfigPage.open()+getVisibleEntityTabLabels()).
// - Deal's true save-required minimum is Name + Pipeline + Estimated Value
//   — confirmed live via direct incremental reproduction. This CORRECTS an
//   earlier, less complete claim in dealFactory.ts's own comment
//   ("Name+Estimated Value only") — Pipeline selection turned out to be a
//   genuine prerequisite: the Estimated Value input is not even
//   visible/enabled until a Pipeline is chosen. No Product row is needed —
//   Estimated Value can be filled manually once Pipeline is set.
//   DealsPage.fillDealForm()'s own `minimal` mode fills exactly these
//   three, skipping Associated Contact/Company, every Product row, Part
//   Payments, Campaign/Source, and every UTM field.
// - Minimal EDIT is a genuine correctness requirement here, not just an
//   optimization: DealsPage.fillEditForm()'s own pre-existing payment-
//   status-change block unconditionally targets the deal's FIRST part-
//   payment row, which only exists on a deal that has installments — a
//   bare minimal deal (no Part Payments, per the point above) has none, so
//   running that block would fail outright. `minimal` mode therefore skips
//   it entirely, touching only Name and custom fields.
// - Deal's detail-page "Other Details" tab is Deal's OWN dedicated locator
//   (`#nav-tab2-tab`), NOT the generic `data-targetid="Other Details"`
//   attribute convention every other entity in this feature uses —
//   DealsPage.assertDealCustomFieldOnDetail() (new, single-field variant of
//   the pre-existing assertDealCustomFieldsOnDetail()) handles this
//   correctly; BasePage.clickDetailPageTab() would NOT work here.
// - Custom-field ids use the "legacy" suffix style (already an established,
//   confirmed fact for this module — same as Lead/Contact/Company/
//   Quotation/Task), reused unchanged (the default, no suffixStyle param
//   needed anywhere in this file).
// - Deal's Name field is `[id="0_11_input_name"]`, NOT `input[name="name"]`
//   — the same trap already confirmed for Company/Task. This file never
//   calls the generic fillStandardField() for Deal's name — every mutation
//   goes through DealsPage.fillDealForm()/fillEditForm(), which already
//   handle this correctly internally.
// - Deal ids are NUMBERS (`number | null`), like every other entity except
//   Products & Services — handled accordingly throughout this file.

const DEAL_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Deal', urlSlug: 'deals' };

const D_TEXT_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.textField}`;
const D_NUMBER_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.number}`;
const D_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

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

// ─── Shared local action helpers ──────────────────────────────────────────

async function clearDealApplicationCache(targetPage: Page): Promise<void> {
  const dealsPage = new DealsPage(targetPage);
  const result = await dealsPage.clearApplicationCache(DEAL_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Deal application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Deal create/update flow for this feature — architecture note
// ============================================================================
// WHY exactly two Deal-mutation paths exist below: mirrors
// leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's/
// companyFieldLimits.spec.ts's/taskFieldLimits.spec.ts's own identical
// split exactly — see LEAD_FEATURE_RETROSPECTIVE.md §1 for the full
// evidence chain this reuses unchanged.
// ============================================================================

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

async function assertInlineErrorPresent(dealsPage: DealsPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(dealsPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

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

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

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

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
  await configPage.clearFieldConfiguration(D_TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(D_NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(D_PARAGRAPH_FIELD_INTERNAL_NAME);
}

test.describe('Deal Field Limits', () => {
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
      await withDealFormFieldLock(() => clearAllFieldConfigurations(page));
      logger.success('afterAll safety-net cleanup completed');
    } catch (error) {
      logger.warn(`afterAll safety-net cleanup failed (non-fatal): ${String(error)}`);
    } finally {
      await context.close();
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────

  test.describe('Navigation', () => {
    test('@smoke @prodSafe FFD1 admin should open the Deal field settings page and see the entity tabs', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(tabs, 'Expected the "Deal" tab to be present among the live tab labels').toContain('Deal');
      logger.success('FFD1 passed');
    });

    test('@smoke @prodSafe FFD2 admin should search the field list by internal name and see it filter correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.open();
      await configPage.searchField(D_TEXT_FIELD_INTERNAL_NAME);
      await configPage.openFieldForEdit(D_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFD2 passed');
    });

    test("@smoke @prodSafe FFD3 admin should open an individual custom field's edit page from the list", async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(D_TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFD3 passed');
    });
  }); // end describe('Navigation')

  // ─── Text field character-length limits ─────────────────────────────

  test.describe('Text field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFD4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await configPage.assertFieldConfigMatches(
        D_TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFD4 passed');
    });

    test('@regression FFD5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD5 passed');
    });

    test('@regression FFD6 admin should confirm typing too many characters in the Text field is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateDealCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD6 Add Deal — Text over max');
      logger.success('FFD6 passed');
    });

    test('@regression FFD7 admin should confirm typing too few characters in the Text field is rejected when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD7 Edit Deal — Text under min');
      logger.success('FFD7 passed');
    });

    test('@regression FFD8 admin should confirm typing exactly the maximum allowed characters in the Text field is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_TEXT_FIELD_INTERNAL_NAME, String(TEXT_MIN), String(TEXT_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD8 passed');
    });
  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ────────────────────────

  test.describe('Number field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFD9 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await configPage.assertFieldConfigMatches(
        D_NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFD9 passed');
    });

    test('@regression FFD10 admin should confirm typing exactly the minimum allowed digits in the Number field is accepted when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
      logger.success('FFD10 passed');
    });

    test('@regression FFD11 admin should confirm typing too many digits in the Number field is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD11 Add Deal — Number over max');
      logger.success('FFD11 passed');
    });

    test('@regression FFD12 admin should confirm typing too few digits in the Number field is rejected when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD12 Edit Deal — Number under min');
      logger.success('FFD12 passed');
    });

    test('@regression FFD13 admin should confirm typing exactly the maximum allowed digits in the Number field is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(D_NUMBER_FIELD_INTERNAL_NAME, String(NUMBER_MIN), String(NUMBER_MAX));
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.number, value, 'Number field');
      logger.success('FFD13 passed');
    });
  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────

  test.describe('Paragraph field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFD14 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFD14 passed');
    });

    test('@regression FFD15 admin should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
      logger.success('FFD15 passed');
    });

    test('@regression FFD16 admin should confirm typing too many characters in the Paragraph field is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateDealCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD16 Add Deal — Paragraph over max');
      logger.success('FFD16 passed');
    });

    test('@regression FFD17 admin should confirm typing too few characters in the Paragraph field is rejected when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(dealsPage, 'FFD17 Edit Deal — Paragraph under min');
      logger.success('FFD17 passed');
    });

    test('@regression FFD18 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.paragraphText, value, 'Paragraph field');
      logger.success('FFD18 passed');
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

    test('@regression FFD19 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'PAN Card' }, 'Text field');
      logger.success('FFD19 passed');
    });

    test('@regression FFD20 admin should confirm an invalid PAN Card value is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'PAN Card');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(dealsPage, 'FFD20 Add Deal — invalid PAN Card');
      logger.success('FFD20 passed');
    });

    test('@regression FFD21 admin should confirm a valid PAN Card value is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'PAN Card');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD21 passed');
    });

    test('@regression FFD22 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Email' }, 'Text field');
      logger.success('FFD22 passed');
    });

    test('@regression FFD23 admin should confirm a valid Email value is accepted when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD23 passed');
    });

    test('@regression FFD24 admin should confirm an invalid Email value is rejected when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(dealsPage, 'FFD24 Edit Deal — invalid Email');
      logger.success('FFD24 passed');
    });

    test('@regression FFD25 admin sets the Text field format to Driver Licence and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Driver Licence' }, 'Text field');
      logger.success('FFD25 passed');
    });

    test('@regression FFD26 admin should confirm an invalid Driver Licence value is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(dealsPage, 'FFD26 Add Deal — invalid Driver Licence');
      logger.success('FFD26 passed');
    });

    test('@regression FFD27 admin should confirm a valid Driver Licence value is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD27 passed');
    });

    test('@regression FFD28 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Voting Card' }, 'Text field');
      logger.success('FFD28 passed');
    });

    test('@regression FFD29 admin should confirm a valid Voting Card value is accepted when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD29 passed');
    });

    test('@regression FFD30 admin should confirm an invalid Voting Card value is rejected when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await openEditDealFormExpectingRejection(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(dealsPage, 'FFD30 Edit Deal — invalid Voting Card');
      logger.success('FFD30 passed');
    });

    test('@regression FFD31 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(D_TEXT_FIELD_INTERNAL_NAME, { regexLabel: 'Passport' }, 'Text field');
      logger.success('FFD31 passed');
    });

    test('@regression FFD32 admin should confirm an invalid Passport value is rejected when creating a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(dealsPage, 'FFD32 Add Deal — invalid Passport');
      logger.success('FFD32 passed');
    });

    test('@regression FFD33 admin should confirm a valid Passport value is accepted when editing a deal', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, D_TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const name = uniqueDealName();
      const dealId = await createBareDeal(dealsPage, name);
      await updateDealExpectingAccept(dealsPage, dealId, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD33 passed');
    });

    test('@regression FFD34 admin should confirm choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.openFieldForEdit(D_TEXT_FIELD_INTERNAL_NAME);
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        D_TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFD34 passed');
    });

    test('@regression FFD35 admin should confirm choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        D_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFD35 passed');
    });

    test('@regression FFD36 admin should confirm switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(D_TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(D_TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        D_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false, min: lockedSnapshot.min, max: lockedSnapshot.max },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFD36 passed');
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

    test('@regression FFD37 admin should confirm a new limit is not applied on the deal form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.configureFieldLimit(
        D_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await dealsPage.assertNoFormErrors('FFD37 seed Add Deal');
      await configPage.configureFieldLimit(
        D_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await dealsPage.goToDealsList();
      await openDealFormExpectingRejection(dealsPage, uniqueDealName(), {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        dealsPage,
        'FFD37 Add Deal — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFD37 passed');
    });
  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────

  test.describe('Cleanup', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFD38 admin should confirm after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, DEAL_ENTITY);
      await configPage.assertFieldConfigMatches(
        D_TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        D_NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        D_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFD38 passed');
    });

    test('@regression FFD39 admin should confirm after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      await clearDealApplicationCache(adminPage);
      const dealsPage = new DealsPage(adminPage);
      await dealsPage.goToDealsList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const name = uniqueDealName();
      const dealId = await createDealExpectingAccept(dealsPage, name, {
        fieldName: DEAL_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(dealsPage, dealId, DEAL_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFD39 passed');
    });
  }); // end describe('Cleanup')
});
