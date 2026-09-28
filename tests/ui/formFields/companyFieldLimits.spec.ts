import { test, expect, withCompanyFormFieldLock } from './companyFormFieldLock';
import { Page } from '@playwright/test';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  COMPANY_FORM_FIELD_LIMIT_NAMES,
  COMPANY_LAYOUT_CACHE_KEY,
  generateCompanyData,
  CompanyData,
  generateCompanyCustomFieldInvalidTextField,
  generateCompanyCustomFieldInvalidParagraphText,
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
} from '../../../src/data/factories/companyFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this is the Company rollout of the Form Field Limit feature — the
// SAME reusable architecture already proven for Lead and Contact (see
// LEAD_FEATURE_RETROSPECTIVE.md/LEAD_FEATURE_IMPLEMENTATION_CONTEXT.md),
// not a re-derivation. Two structural decisions changed for Company,
// deliberately, per explicit direction after Contact shipped:
//
// 1. UI/RBAC split (Design B): this file holds ONLY admin-role and
//    config-only tests — ZERO `restrictedPage` usage anywhere. Every
//    single-restricted-role test (accept/reject boundaries, Regex
//    validation) lives in tests/rbac/formFields.rbac.spec.ts's own
//    `Company` block instead, alongside the 3 access-boundary tests and
//    the 4 admin-configures/restricted-verifies dual-fixture tests. This
//    matches this codebase's own real, pre-existing convention (confirmed
//    live via leads.spec.ts/leads.rbac.spec.ts and 4 other module pairs —
//    the UI file is admin-only in every one of them). Built this way from
//    the start for Company — not built the old Lead/Contact-style mixed
//    way and then moved, per explicit direction.
//
// 2. FULL Regex coverage: all 5 real format options (PAN Card, Email,
//    Driver Licence, Voting Card, Passport) get the SAME full coverage
//    PAN Card alone got in Contact — valid+invalid on BOTH create and
//    edit, not just create. This is now the baseline for every entity
//    after Company too. Email's own "valid value accepted" test (omitted
//    for both Lead and Contact out of caution after a load-dependent
//    create-POST timeout was traced to a random-domain email value) is
//    included here using the already-hardened generator (a fixed, real
//    `example.com` domain, never a random one) — watched closely during
//    this entity's own verification run for any recurrence of that
//    symptom before trusting it as safe going forward.
//
// WHY Company's own live-confirmed facts (this session's own diagnostic
// pass, not assumed from Lead/Contact): Company's CREATE and EDIT forms
// are BOTH `#editEntityModal` (confirmed live — `isModal = true`
// immediately after clickAddCompany()), unlike Contact's standalone-page
// create form — matching Lead's own shared-modal-template architecture
// instead. Company's Name field is `[id="0_11_input_name"]`, NOT
// `input[name="name"]` — BasePage's generic fillStandardField() hangs
// indefinitely against it (confirmed live via a real 120s timeout
// reproduction); CompaniesPage.fillCompanyName() is the correct,
// dedicated alternative, never the generic helper. Only `name` is
// required to save (no Pipeline-equivalent dependency, no toggle needed
// for the minimum path). Company's detail-page "Other Details" tab DOES
// carry the same `data-targetid="Other Details"` attribute Lead's/
// Contact's does — BasePage.clickDetailPageTab() works unchanged.

const COMPANY_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Company', urlSlug: 'companies' };
const OTHER_DETAILS_TAB = 'Other Details';

const CO_TEXT_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.textField}`;
const CO_NUMBER_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.number}`;
const CO_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

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

// WHY a dedicated name generator, not a bare faker.company.name() call at
// every site: mirrors leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's
// own faker.person.lastName()-per-call-site convention, adapted for
// Company's own identifying field (`name`, not firstName/lastName).
function uniqueCompanyName(): string {
  return `${faker.company.name()} ${Date.now()}`;
}

// ─── Shared local action helpers ──────────────────────────────────────────

async function clearCompanyApplicationCache(targetPage: Page): Promise<void> {
  const companiesPage = new CompaniesPage(targetPage);
  const result = await companiesPage.clearApplicationCache(COMPANY_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Company application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Company create/update flow for this feature — architecture note
// ============================================================================
// WHY exactly two Company-mutation paths exist below: mirrors leadFieldLimits.spec.ts's/
// contactFieldLimits.spec.ts's own identical split exactly — see LEAD_FEATURE_RETROSPECTIVE.md
// §1 for the full evidence chain this reuses unchanged.
// ============================================================================

type SupportedCustomFieldKey = 'textField' | 'paragraphText' | 'number';

function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
  if (fieldName === COMPANY_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
  if (fieldName === COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
  if (fieldName === COMPANY_FORM_FIELD_LIMIT_NAMES.number) return 'number';
  throw new Error(
    `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
  );
}

interface CompanyFieldUnderTest {
  fieldName: string;
  value: string;
}

function buildCompanyDataWithFieldOverride(name: string, field: CompanyFieldUnderTest): CompanyData {
  const companyData = generateCompanyData({ name });
  const dataKey = customFieldNameToDataKey(field.fieldName);
  if (dataKey === 'number') {
    companyData.customFields.number = Number(field.value);
  } else {
    companyData.customFields[dataKey] = field.value;
  }
  return companyData;
}

async function hasInlineFormError(companiesPage: CompaniesPage, context: string): Promise<boolean> {
  try {
    await companiesPage.assertNoFormErrors(context);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
      return true;
    }
    throw error;
  }
}

async function assertInlineErrorPresent(companiesPage: CompaniesPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(companiesPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

async function createCompanyExpectingAccept(
  companiesPage: CompaniesPage,
  name: string,
  field: CompanyFieldUnderTest
): Promise<number> {
  const companyData = buildCompanyDataWithFieldOverride(name, field);
  const companyId = await companiesPage.createCompany(companyData, {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  expect(
    companyId,
    `Expected Company creation to succeed (field="${field.fieldName}", value="${field.value}") but createCompany() returned null`
  ).not.toBeNull();
  return companyId as number;
}

async function createBareCompany(companiesPage: CompaniesPage, name: string): Promise<number> {
  const companyId = await companiesPage.createCompany(generateCompanyData({ name }), {
    minimal: true,
  });
  expect(
    companyId,
    `Expected a bare minimal Company ("${name}") to be created successfully`
  ).not.toBeNull();
  return companyId as number;
}

async function updateCompanyExpectingAccept(
  companiesPage: CompaniesPage,
  companyId: number,
  name: string,
  field: CompanyFieldUnderTest
): Promise<void> {
  await companiesPage.searchAndOpenCompany('', companyId);
  await companiesPage.clickEditIcon();
  await companiesPage.fillEditForm(buildCompanyDataWithFieldOverride(name, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  await companiesPage.saveEditedCompany();
}

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

async function openCompanyFormExpectingRejection(
  companiesPage: CompaniesPage,
  name: string,
  field: CompanyFieldUnderTest
): Promise<void> {
  await companiesPage.clickAddCompany();
  await companiesPage.fillCompanyForm(buildCompanyDataWithFieldOverride(name, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

async function openEditCompanyFormExpectingRejection(
  companiesPage: CompaniesPage,
  companyId: number,
  name: string,
  field: CompanyFieldUnderTest
): Promise<void> {
  await companiesPage.searchAndOpenCompany('', companyId);
  await companiesPage.clickEditIcon();
  await companiesPage.fillEditForm(buildCompanyDataWithFieldOverride(name, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

async function assertCustomFieldPersistedOnDetail(
  companiesPage: CompaniesPage,
  companyId: number,
  fieldName: string,
  expectedValue: string,
  description: string
): Promise<void> {
  await companiesPage.searchAndOpenCompany('', companyId);
  await companiesPage.clickDetailPageTab(OTHER_DETAILS_TAB);
  await companiesPage.assertCustomFieldOnDetail(fieldName, expectedValue, description);
}

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
  await configPage.clearFieldConfiguration(CO_TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(CO_NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(CO_PARAGRAPH_FIELD_INTERNAL_NAME);
}

test.describe('Company Field Limits', () => {
  test.afterAll(async ({ browser }) => {
    const adminStorageStatePath = path.join(
      __dirname,
      '../../../src/auth/storageStates',
      config.env,
      'admin.json'
    );
    const context = await browser.newContext({ storageState: adminStorageStatePath });
    const page = await context.newPage();
    try {
      await withCompanyFormFieldLock(() => clearAllFieldConfigurations(page));
      logger.success('afterAll safety-net cleanup completed');
    } catch (error) {
      logger.warn(`afterAll safety-net cleanup failed (non-fatal): ${String(error)}`);
    } finally {
      await context.close();
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────

  test.describe('Navigation', () => {
    test('@smoke @prodSafe FFCO1 admin should open the Company field settings page and see the entity tabs', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(tabs, 'Expected the "Company" tab to be present among the live tab labels').toContain(
        'Company'
      );
      logger.success('FFCO1 passed');
    });

    test('@smoke @prodSafe FFCO2 admin should search the field list by internal name and see it filter correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.open();
      await configPage.searchField(CO_TEXT_FIELD_INTERNAL_NAME);
      await configPage.openFieldForEdit(CO_TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFCO2 passed');
    });

    test("@smoke @prodSafe FFCO3 admin should open an individual custom field's edit page from the list", async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(CO_TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFCO3 passed');
    });
  }); // end describe('Navigation')

  // ─── Text field character-length limits ─────────────────────────────

  test.describe('Text field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFCO4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFCO4 passed');
    });

    test('@regression FFCO5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO5 passed');
    });

    test('@regression FFCO6 admin should confirm typing too many characters in the Text field is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateCompanyCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO6 Add Company — Text over max');
      logger.success('FFCO6 passed');
    });

    test('@regression FFCO7 admin should confirm typing too few characters in the Text field is rejected when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO7 Edit Company — Text under min');
      logger.success('FFCO7 passed');
    });

    test('@regression FFCO8 admin should confirm typing exactly the maximum allowed characters in the Text field is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO8 passed');
    });
  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ────────────────────────

  test.describe('Number field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFCO9 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await configPage.assertFieldConfigMatches(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFCO9 passed');
    });

    test('@regression FFCO10 admin should confirm typing exactly the minimum allowed digits in the Number field is accepted when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFCO10 passed');
    });

    test('@regression FFCO11 admin should confirm typing too many digits in the Number field is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO11 Add Company — Number over max');
      logger.success('FFCO11 passed');
    });

    test('@regression FFCO12 admin should confirm typing too few digits in the Number field is rejected when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO12 Edit Company — Number under min');
      logger.success('FFCO12 passed');
    });

    test('@regression FFCO13 admin should confirm typing exactly the maximum allowed digits in the Number field is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFCO13 passed');
    });
  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────

  test.describe('Paragraph field limits', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFCO14 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFCO14 passed');
    });

    test('@regression FFCO15 admin should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFCO15 passed');
    });

    test('@regression FFCO16 admin should confirm typing too many characters in the Paragraph field is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateCompanyCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO16 Add Company — Paragraph over max');
      logger.success('FFCO16 passed');
    });

    test('@regression FFCO17 admin should confirm typing too few characters in the Paragraph field is rejected when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO17 Edit Company — Paragraph under min');
      logger.success('FFCO17 passed');
    });

    test('@regression FFCO18 admin should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFCO18 passed');
    });
  }); // end describe('Paragraph field limits')

  // ─── Format rules (Regex) — Text field ────────────────────────────────

  test.describe('Text field format rules (Regex)', () => {
    test.describe.configure({ mode: 'serial' });

    // WHY cross-checking the generated value against the pattern read LIVE
    // off the config page, not just trusting the generator: mirrors
    // leadFieldLimits.spec.ts's/contactFieldLimits.spec.ts's identical
    // function exactly.
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

    test('@regression FFCO19 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'PAN Card' },
        'Text field'
      );
      logger.success('FFCO19 passed');
    });

    test('@regression FFCO20 admin should confirm an invalid PAN Card value is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'PAN Card'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO20 Add Company — invalid PAN Card');
      logger.success('FFCO20 passed');
    });

    test('@regression FFCO21 admin should confirm a valid PAN Card value is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'PAN Card'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO21 passed');
    });

    test('@regression FFCO22 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Email' },
        'Text field'
      );
      logger.success('FFCO22 passed');
    });

    test('@regression FFCO23 admin should confirm a valid Email value is accepted when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Email'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO23 passed');
    });

    test('@regression FFCO24 admin should confirm an invalid Email value is rejected when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Email'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO24 Edit Company — invalid Email');
      logger.success('FFCO24 passed');
    });

    test('@regression FFCO25 admin sets the Text field format to Driver Licence and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Driver Licence' },
        'Text field'
      );
      logger.success('FFCO25 passed');
    });

    test('@regression FFCO26 admin should confirm an invalid Driver Licence value is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Driver Licence'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO26 Add Company — invalid Driver Licence');
      logger.success('FFCO26 passed');
    });

    test('@regression FFCO27 admin should confirm a valid Driver Licence value is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Driver Licence'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO27 passed');
    });

    test('@regression FFCO28 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Voting Card' },
        'Text field'
      );
      logger.success('FFCO28 passed');
    });

    test('@regression FFCO29 admin should confirm a valid Voting Card value is accepted when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Voting Card'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO29 passed');
    });

    test('@regression FFCO30 admin should confirm an invalid Voting Card value is rejected when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Voting Card'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO30 Edit Company — invalid Voting Card');
      logger.success('FFCO30 passed');
    });

    test('@regression FFCO31 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Passport' },
        'Text field'
      );
      logger.success('FFCO31 passed');
    });

    test('@regression FFCO32 admin should confirm an invalid Passport value is rejected when creating a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Passport'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFCO32 Add Company — invalid Passport');
      logger.success('FFCO32 passed');
    });

    test('@regression FFCO33 admin should confirm a valid Passport value is accepted when editing a company', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Passport'
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await updateCompanyExpectingAccept(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO33 passed');
    });

    test('@regression FFCO34 admin should confirm choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.openFieldForEdit(CO_TEXT_FIELD_INTERNAL_NAME);
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFCO34 passed');
    });

    test('@regression FFCO35 admin should confirm choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFCO35 passed');
    });

    test('@regression FFCO36 admin should confirm switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(CO_TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        {
          minDisabled: false,
          maxDisabled: false,
          min: lockedSnapshot.min,
          max: lockedSnapshot.max,
        },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFCO36 passed');
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

    test('@regression FFCO37 admin should confirm a new limit is not applied on the company form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await companiesPage.assertNoFormErrors('FFCO37 seed Add Company');
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        companiesPage,
        'FFCO37 Add Company — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFCO37 passed');
    });
  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────

  test.describe('Cleanup', () => {
    test.describe.configure({ mode: 'serial' });

    test('@regression FFCO38 admin should confirm after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.assertFieldConfigMatches(
        CO_TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFCO38 passed');
    });

    test('@regression FFCO39 admin should confirm after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      await clearCompanyApplicationCache(adminPage);
      const companiesPage = new CompaniesPage(adminPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const name = uniqueCompanyName();
      const companyId = await createCompanyExpectingAccept(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFCO39 passed');
    });

  }); // end describe('Cleanup')
});
