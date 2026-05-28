import { test } from '../../src/fixtures/index';
import { CompaniesPage } from '../../src/modules/companies/CompaniesPage';
import {
  generateCompanyData,
  generateAdminCompanyData,
} from '../../src/data/factories/companyFactory';

test.describe('Companies RBAC', () => {
  test(
    '@smoke @regression restricted user can navigate to companies list',
    async ({ restrictedPage }) => {
      const companiesPage = new CompaniesPage(restrictedPage);

      await companiesPage.goToCompaniesList();
      await companiesPage.assertOnCompaniesListPage();
    }
  );

  test(
    '@regression restricted user can create a company',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);

      const companiesPage = new CompaniesPage(restrictedPage);
      const companyData = generateCompanyData();

      await companiesPage.goToCompaniesList();

      const companyId = await companiesPage.createCompany(companyData);

      await companiesPage.assertCompanyCreated(
        companyData,
        companyId ?? undefined
      );
    }
  );

  test(
    '@regression restricted user can edit own company',
    async ({ restrictedPage }) => {
      test.setTimeout(480000);

      const companiesPage = new CompaniesPage(restrictedPage);
      const companyData = generateCompanyData();

      await companiesPage.goToCompaniesList();
      await companiesPage.createCompany(companyData);

      const updatedData = generateCompanyData();

      await companiesPage.updateCompany(updatedData, companyData.name);
      await companiesPage.assertCompanyUpdated(updatedData);
    }
  );

  test(
    '@regression restricted user cannot see an admin-owned company',
    async ({ adminPage, restrictedPage }) => {
      test.setTimeout(480000);

      // WHY: generateAdminCompanyData uses timestamp prefix (ADM12345678 Corp)
      // guarantees this company name has never existed before — no collision with old test data
      const adminCompaniesPage = new CompaniesPage(adminPage);
      const companyData = generateAdminCompanyData();

      await adminCompaniesPage.goToCompaniesList();
      await adminCompaniesPage.createCompany(companyData);

      const restrictedCompaniesPage = new CompaniesPage(restrictedPage);

      await restrictedCompaniesPage.goToCompaniesList();
      await restrictedCompaniesPage.assertCompanyNotInList(companyData.name);
    }
  );
});