import { test } from '../../../src/fixtures/index';
import { CompaniesPage } from '../../../src/modules/companies/CompaniesPage';
import { generateCompanyData } from '../../../src/data/factories/companyFactory';
import { logger } from '../../../src/utils/logger';

test.describe('Companies', () => {
  test('@smoke @regression admin should navigate to companies list page', async ({ adminPage }) => {
    const companiesPage = new CompaniesPage(adminPage);

    await companiesPage.goToCompaniesList();
    await companiesPage.assertOnCompaniesListPage();
    logger.success('CO1 passed');
  });

  test('@regression admin should create a new company with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);

    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();

    await companiesPage.goToCompaniesList();

    const companyId = await companiesPage.createCompany(companyData);

    await companiesPage.assertCompanyCreated(companyData, companyId ?? undefined);
    logger.success('CO2 passed');
  });

  test('@regression admin should update a created company', async ({ adminPage }) => {
    test.setTimeout(480000);

    const companiesPage = new CompaniesPage(adminPage);
    const companyData = generateCompanyData();

    await companiesPage.goToCompaniesList();
    await companiesPage.createCompany(companyData);

    const updatedData = generateCompanyData();

    await companiesPage.updateCompany(updatedData, companyData.name);
    await companiesPage.assertCompanyUpdated(updatedData);
    logger.success('CO3 passed');
  });
});
