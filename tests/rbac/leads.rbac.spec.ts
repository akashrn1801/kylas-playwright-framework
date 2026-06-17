import { test } from '../../src/fixtures/index';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData, generateAdminLeadData } from '../../src/data/factories/leadFactory';
import { logger } from '../../src/utils/logger';

test.describe('Leads RBAC', () => {
  test('@smoke @regression restricted user can navigate to leads list', async ({
    restrictedPage,
  }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L6 passed');
  });

  test('@regression restricted user can create a lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
    logger.success('L7 passed');
  });

  test('@regression restricted user can edit own lead', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName);
    await leadsPage.assertLeadUpdated(updatedData);
    logger.success('L8 passed');
  });

  test('@regression restricted user cannot edit an admin-owned lead', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);
    // WHY: generateAdminLeadData uses timestamp prefix (ADM12345678)
    // guarantees this lead name has never existed before — no collision with old test data
    const adminLeadsPage = new LeadsPage(adminPage);
    const leadData = generateAdminLeadData();
    await adminLeadsPage.goToLeadsList();
    await adminLeadsPage.createLead(leadData);
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await restrictedLeadsPage.goToLeadsList();
    await restrictedLeadsPage.assertLeadNotInList(leadData.firstName);
    logger.success('L9 passed');
  });
});
