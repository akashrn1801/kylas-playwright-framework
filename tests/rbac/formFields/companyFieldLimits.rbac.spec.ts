import { test as companyTest, expect } from '../../ui/formFields/companyFormFieldLock';
import { Page } from '@playwright/test';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { FormFieldsConfigPage, FormFieldsEntityConfig } from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  COMPANY_FORM_FIELD_LIMIT_NAMES,
  COMPANY_LAYOUT_CACHE_KEY,
  generateCompanyData,
  CompanyData,
  generateCompanyCustomFieldInvalidTextField,
  generateCompanyCustomFieldInvalidParagraphText,
  generateValidPanCardValue as generateValidPanCardValueCo,
  generateInvalidPanCardValue as generateInvalidPanCardValueCo,
  generateValidEmailFormatValue as generateValidEmailFormatValueCo,
  generateInvalidEmailFormatValue as generateInvalidEmailFormatValueCo,
  generateValidDriverLicenceValue as generateValidDriverLicenceValueCo,
  generateInvalidDriverLicenceValue as generateInvalidDriverLicenceValueCo,
  generateValidVotingCardValue as generateValidVotingCardValueCo,
  generateInvalidVotingCardValue as generateInvalidVotingCardValueCo,
  generateValidPassportValue as generateValidPassportValueCo,
  generateInvalidPassportValue as generateInvalidPassportValueCo,
} from '../../../src/data/factories/companyFactory';
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
  page: CompaniesPage,
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

companyTest.describe('Form Field Limits — RBAC › Company', () => {
  // WHY no test.describe.configure({ mode: 'serial' }) here (2026-09-29,
  // removed — see FormFieldsConfigPage.ts/formFieldLockFactory.ts's own
  // header comment for the full reasoning): the auto-applied, scope:'test'
  // companyFormFieldLock fixture already acquires this entity's real
  // cross-process lock for every test's ENTIRE duration and releases it at
  // the end — two tests from this file can never actually run concurrently
  // regardless of describe/serial grouping, so .serial mode was providing
  // zero additional correctness here, only an unwanted side effect: one
  // test's failure was skip-cascading every remaining test in this block
  // instead of each getting its own real, independent attempt. Every test
  // below already independently (re-)configures its own field state before
  // asserting on it (never relies on a predecessor's leftover config), so
  // removing the artificial ordering constraint is safe.

  // WHY companyTest.describe.configure({ timeout: 480000 }) here (2026-09-29,
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
  // per-test companyTest.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  companyTest.describe.configure({ timeout: 480000 });

  const COMPANY_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Company', urlSlug: 'companies' };
  const OTHER_DETAILS_TAB = 'Other Details';

  const CO_TEXT_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.textField}`;
  const CO_NUMBER_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.number}`;
  const CO_PARAGRAPH_FIELD_INTERNAL_NAME = `cf${COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

  // WHY these constants/helpers are duplicated here from
  // companyFieldLimits.spec.ts rather than imported: mirrors the Contact
  // block's own identical, already-established "these two files must
  // remain independently runnable" convention (see FFR4/FFRC4's own WHY
  // comment) — applied here for a THIRD entity, unchanged in reasoning.
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

  function uniqueCompanyName(): string {
    return `${faker.company.name()} ${Date.now()}`;
  }

  async function clearCompanyApplicationCache(targetPage: Page): Promise<void> {
    const companiesPage = new CompaniesPage(targetPage);
    const result = await companiesPage.clearApplicationCache(COMPANY_LAYOUT_CACHE_KEY);
    if (result.ok || result.reason === 'key-not-found') return;
    expect(
      result.ok,
      `Expected the Company application cache to clear successfully, got: ${JSON.stringify(result)}`
    ).toBe(true);
  }

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

  // WHY cross-checking the generated value against the pattern read LIVE
  // off the config page: mirrors the UI file's/Contact block's identical
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

  companyTest('@regression FFRCO1 restricted user can see the field settings list but nothing else on that page', async ({
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, COMPANY_ENTITY);
    await configPage.assertListVisibleReadOnly();
    logger.success('FFRCO1 passed');
  });

  companyTest('@regression FFRCO2 restricted user does not see the "Add Field" button', async ({
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, COMPANY_ENTITY);
    await configPage.assertAddFieldButtonAbsent();
    logger.success('FFRCO2 passed');
  });

  companyTest('@regression FFRCO3 restricted user cannot click into any field to open it for editing', async ({
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(restrictedPage, COMPANY_ENTITY);
    await configPage.assertRowNotClickable(CO_TEXT_FIELD_INTERNAL_NAME);
    logger.success('FFRCO3 passed');
  });

  companyTest("@regression FFRCO4 after admin sets a limit and restricted user's cache is cleared, restricted user sees the same limit applied", async ({
    adminPage,
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
    await configPage.configureFieldLimit(CO_TEXT_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      CO_TEXT_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Text field'
    );

    const cacheResult = await new CompaniesPage(restrictedPage).clearApplicationCache(
      COMPANY_LAYOUT_CACHE_KEY
    );
    if (!cacheResult.ok && cacheResult.reason !== 'key-not-found') {
      expect(
        cacheResult.ok,
        `Expected the restricted user's Company application cache to clear successfully, got: ${JSON.stringify(cacheResult)}`
      ).toBe(true);
    }

    const restrictedCompaniesPage = new CompaniesPage(restrictedPage);
    await restrictedCompaniesPage.goToCompaniesList();
    await restrictedCompaniesPage.clickAddCompany();
    const name = uniqueCompanyName();
    const companyData = generateCompanyData({ name });
    companyData.customFields.textField = 'A'.repeat(max + 1);
    await restrictedCompaniesPage.fillCompanyForm(companyData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent1 = await hasInlineFormError(
      restrictedCompaniesPage,
      'FFRCO4 Add Company — restricted, over admin-set max'
    );
    expect(errorPresent1, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRCO4 passed');
  });

  companyTest("@regression FFRCO5 after admin sets a Number limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const min = 4;
    const max = 7;
    const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
    await configPage.configureFieldLimit(CO_NUMBER_FIELD_INTERNAL_NAME, String(min), String(max));
    await configPage.assertFieldConfigMatches(
      CO_NUMBER_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Number field'
    );

    await clearCompanyApplicationCache(restrictedPage);
    const restrictedCompaniesPage = new CompaniesPage(restrictedPage);
    await restrictedCompaniesPage.goToCompaniesList();

    const acceptValue = '1'.repeat(min);
    const acceptData = generateCompanyData({ name: uniqueCompanyName() });
    acceptData.customFields.number = Number(acceptValue);
    const companyId = await restrictedCompaniesPage.createCompany(acceptData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
    });
    expect(
      companyId,
      'Expected restricted user to successfully create a Company with a Number value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedCompaniesPage.searchAndOpenCompany('', companyId as number);
    await restrictedCompaniesPage.clickDetailPageTab('Other Details');
    await restrictedCompaniesPage.assertCustomFieldOnDetail(
      COMPANY_FORM_FIELD_LIMIT_NAMES.number,
      acceptValue,
      'Number field'
    );

    await restrictedCompaniesPage.goToCompaniesList();
    await restrictedCompaniesPage.clickAddCompany();
    const rejectData = generateCompanyData({ name: uniqueCompanyName() });
    rejectData.customFields.number = Number('1'.repeat(max + 1));
    await restrictedCompaniesPage.fillCompanyForm(rejectData, {
      minimal: true,
      onlyCustomField: 'number',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
    });
    const errorPresent2 = await hasInlineFormError(
      restrictedCompaniesPage,
      'FFRCO5 Add Company — restricted, Number over admin-set max'
    );
    expect(errorPresent2, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRCO5 passed');
  });

  companyTest("@regression FFRCO6 after admin sets a Paragraph limit and restricted user's cache is cleared, restricted user's values are enforced at both boundaries", async ({
    adminPage,
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const min = 6;
    const max = 10;
    const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
    await configPage.configureFieldLimit(
      CO_PARAGRAPH_FIELD_INTERNAL_NAME,
      String(min),
      String(max)
    );
    await configPage.assertFieldConfigMatches(
      CO_PARAGRAPH_FIELD_INTERNAL_NAME,
      { min: String(min), max: String(max) },
      'Paragraph field'
    );

    await clearCompanyApplicationCache(restrictedPage);
    const restrictedCompaniesPage = new CompaniesPage(restrictedPage);
    await restrictedCompaniesPage.goToCompaniesList();

    const acceptValue = 'B'.repeat(min);
    const acceptData = generateCompanyData({ name: uniqueCompanyName() });
    acceptData.customFields.paragraphText = acceptValue;
    const companyId = await restrictedCompaniesPage.createCompany(acceptData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    expect(
      companyId,
      'Expected restricted user to successfully create a Company with a Paragraph value at the admin-set minimum'
    ).not.toBeNull();
    await restrictedCompaniesPage.searchAndOpenCompany('', companyId as number);
    await restrictedCompaniesPage.clickDetailPageTab('Other Details');
    await restrictedCompaniesPage.assertCustomFieldOnDetail(
      COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
      acceptValue,
      'Paragraph field'
    );

    await restrictedCompaniesPage.goToCompaniesList();
    await restrictedCompaniesPage.clickAddCompany();
    const rejectData = generateCompanyData({ name: uniqueCompanyName() });
    rejectData.customFields.paragraphText = 'B'.repeat(max + 1);
    await restrictedCompaniesPage.fillCompanyForm(rejectData, {
      minimal: true,
      onlyCustomField: 'paragraphText',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
    });
    const errorPresent3 = await hasInlineFormError(
      restrictedCompaniesPage,
      'FFRCO6 Add Company — restricted, Paragraph over admin-set max'
    );
    expect(errorPresent3, 'Expected an inline validation error over the admin-set max').toBe(true);
    logger.success('FFRCO6 passed');
  });

  companyTest("@regression FFRCO7 after admin sets a Regex format (PAN Card) and restricted user's cache is cleared, restricted user's values are enforced for both a valid and an invalid value", async ({
    adminPage,
    restrictedPage,
  }) => {
    companyTest.setTimeout(480000);
    const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
    await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
    await configPage.assertFieldConfigMatches(
      CO_TEXT_FIELD_INTERNAL_NAME,
      { regexLabel: 'PAN Card' },
      'Text field'
    );

    await clearCompanyApplicationCache(restrictedPage);
    const restrictedCompaniesPage = new CompaniesPage(restrictedPage);
    await restrictedCompaniesPage.goToCompaniesList();

    const acceptValue = generateValidPanCardValueCo();
    const acceptData = generateCompanyData({ name: uniqueCompanyName() });
    acceptData.customFields.textField = acceptValue;
    const companyId = await restrictedCompaniesPage.createCompany(acceptData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
    });
    expect(
      companyId,
      'Expected restricted user to successfully create a Company with a valid PAN Card value'
    ).not.toBeNull();
    await restrictedCompaniesPage.searchAndOpenCompany('', companyId as number);
    await restrictedCompaniesPage.clickDetailPageTab('Other Details');
    await restrictedCompaniesPage.assertCustomFieldOnDetail(
      COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
      acceptValue,
      'Text field'
    );

    await restrictedCompaniesPage.goToCompaniesList();
    await restrictedCompaniesPage.clickAddCompany();
    const rejectData = generateCompanyData({ name: uniqueCompanyName() });
    rejectData.customFields.textField = generateInvalidPanCardValueCo();
    await restrictedCompaniesPage.fillCompanyForm(rejectData, {
      minimal: true,
      onlyCustomField: 'textField',
      onlyCustomFieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
    });
    const errorPresent4 = await hasInlineFormError(
      restrictedCompaniesPage,
      'FFRCO7 Add Company — restricted, invalid PAN Card'
    );
    expect(errorPresent4, 'Expected an inline validation error for the invalid PAN Card value').toBe(true);
    logger.success('FFRCO7 passed');
  });

    companyTest('@regression FFRCO8 restricted user should confirm typing too few characters in the Text field is rejected when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO8 Add Company — Text under min');
      logger.success('FFRCO8 passed');
    });

    companyTest('@regression FFRCO9 restricted user should confirm typing exactly the maximum allowed characters in the Text field is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
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
      logger.success('FFRCO9 passed');
    });

    companyTest('@regression FFRCO10 restricted user should confirm typing exactly the minimum allowed characters in the Text field is accepted when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
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
      logger.success('FFRCO10 passed');
    });

    companyTest('@regression FFRCO11 restricted user should confirm typing too many characters in the Text field is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateCompanyCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO11 Edit Company — Text over max');
      logger.success('FFRCO11 passed');
    });

    companyTest('@regression FFRCO12 restricted user should confirm typing too few digits in the Number field is rejected when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO12 Add Company — Number under min');
      logger.success('FFRCO12 passed');
    });

    companyTest('@regression FFRCO13 restricted user should confirm typing exactly the maximum allowed digits in the Number field is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
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
      logger.success('FFRCO13 passed');
    });

    companyTest('@regression FFRCO14 restricted user should confirm typing exactly the minimum allowed digits in the Number field is accepted when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
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
      logger.success('FFRCO14 passed');
    });

    companyTest('@regression FFRCO15 restricted user should confirm typing too many digits in the Number field is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO15 Edit Company — Number over max');
      logger.success('FFRCO15 passed');
    });

    companyTest('@regression FFRCO16 restricted user should confirm fixing an invalid Number value to a valid one clears the error and saves correctly', async ({
      restrictedPage,
      adminPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      await openCompanyFormExpectingRejection(companiesPage, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO16 Add Company — Number initially invalid');
      const validValue = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      await companiesPage.fillTextLikeCustomField(
        COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        validValue,
        COMPANY_FORM_FIELD_LIMIT_NAMES.number
      );
      await companiesPage.fillCompanyName(name);
      const errorStillPresent = await hasInlineFormError(
        companiesPage,
        'FFRCO16 Add Company — Number corrected to valid'
      );
      expect(
        errorStillPresent,
        'Expected the inline error to clear once the Number value was corrected to a genuinely valid digit-count'
      ).toBe(false);
      const savedCompanyId = await companiesPage.saveCompany();
      expect(
        savedCompanyId,
        'Expected the corrected Number value to save successfully'
      ).not.toBeNull();
      const companyId = savedCompanyId as number;
      await assertCustomFieldPersistedOnDetail(
        companiesPage,
        companyId,
        COMPANY_FORM_FIELD_LIMIT_NAMES.number,
        validValue,
        'Number field'
      );
      logger.success('FFRCO16 passed');
    });

    companyTest('@regression FFRCO17 restricted user should confirm typing too few characters in the Paragraph field is rejected when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO17 Add Company — Paragraph under min');
      logger.success('FFRCO17 passed');
    });

    companyTest('@regression FFRCO18 restricted user should confirm typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
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
      logger.success('FFRCO18 passed');
    });

    companyTest('@regression FFRCO19 restricted user should confirm typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
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
      logger.success('FFRCO19 passed');
    });

    companyTest('@regression FFRCO20 restricted user should confirm typing too many characters in the Paragraph field is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldLimit(
        CO_PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateCompanyCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO20 Edit Company — Paragraph over max');
      logger.success('FFRCO20 passed');
    });

    companyTest('@regression FFRCO21 restricted user should confirm a valid PAN Card value is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateValidPanCardValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'PAN Card'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
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
      logger.success('FFRCO21 passed');
    });

    companyTest('@regression FFRCO22 restricted user should confirm an invalid PAN Card value is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'PAN Card'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO22 Edit Company — invalid PAN Card');
      logger.success('FFRCO22 passed');
    });

    companyTest('@regression FFRCO23 restricted user should confirm an invalid Email value is rejected when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Email'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO23 Add Company — invalid Email');
      logger.success('FFRCO23 passed');
    });

    companyTest('@regression FFRCO24 restricted user should confirm a valid Email value is accepted when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Email'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
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
      logger.success('FFRCO24 passed');
    });

    companyTest('@regression FFRCO25 restricted user should confirm a valid Driver Licence value is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Driver Licence'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
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
      logger.success('FFRCO25 passed');
    });

    companyTest('@regression FFRCO26 restricted user should confirm an invalid Driver Licence value is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Driver Licence'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO26 Edit Company — invalid Driver Licence');
      logger.success('FFRCO26 passed');
    });

    companyTest('@regression FFRCO27 restricted user should confirm an invalid Voting Card value is rejected when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Voting Card'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      await openCompanyFormExpectingRejection(companiesPage, uniqueCompanyName(), {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO27 Add Company — invalid Voting Card');
      logger.success('FFRCO27 passed');
    });

    companyTest('@regression FFRCO28 restricted user should confirm a valid Voting Card value is accepted when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Voting Card'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
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
      logger.success('FFRCO28 passed');
    });

    companyTest('@regression FFRCO29 restricted user should confirm a valid Passport value is accepted when creating a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Passport'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
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
      logger.success('FFRCO29 passed');
    });

    companyTest('@regression FFRCO30 restricted user should confirm an invalid Passport value is rejected when editing a company', async ({
      adminPage,
      restrictedPage,
    }) => {
      companyTest.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
      await configPage.configureFieldRegex(CO_TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValueCo();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        CO_TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Passport'
      );
      await clearCompanyApplicationCache(restrictedPage);
      const companiesPage = new CompaniesPage(restrictedPage);
      await companiesPage.goToCompaniesList();
      const name = uniqueCompanyName();
      const companyId = await createBareCompany(companiesPage, name);
      await openEditCompanyFormExpectingRejection(companiesPage, companyId, name, {
        fieldName: COMPANY_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(companiesPage, 'FFRCO30 Edit Company — invalid Passport');
      logger.success('FFRCO30 passed');
    });


  companyTest("@regression FFRCO31 restricted user should confirm after the cache is cleared, the new limit is correctly applied on a new company", async ({
    restrictedPage,
    adminPage,
  }) => {
    companyTest.setTimeout(480000);
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;
    const configPage = new FormFieldsConfigPage(adminPage, COMPANY_ENTITY);
    await configPage.configureFieldLimit(
      CO_NUMBER_FIELD_INTERNAL_NAME,
      String(CACHE_TEST_FRESH_MIN),
      String(CACHE_TEST_FRESH_MAX)
    );
    await clearCompanyApplicationCache(restrictedPage);
    const companiesPage = new CompaniesPage(restrictedPage);
    await companiesPage.goToCompaniesList();
    const value = repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS);
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
    logger.success('FFRCO31 passed');
  });
});
