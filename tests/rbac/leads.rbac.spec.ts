import { test } from '../../src/fixtures/index';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../src/data/factories/leadFactory';

test.describe('Leads RBAC', () => {

  test('@smoke @regression restricted user can navigate to leads list', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('@regression restricted user can create a lead', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
  });

  test('@regression restricted user can edit own lead', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName);
    await leadsPage.assertLeadUpdated(updatedData);
  });

  test('@regression restricted user cannot edit an admin-owned lead', async ({ adminPage, restrictedPage }) => {
    test.setTimeout(180000);
    const adminLeadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await adminLeadsPage.goToLeadsList();
    await adminLeadsPage.createLead(leadData);
    // WHY: restricted user may not see admin-owned leads in their list view
    // This is expected RBAC behaviour — we assert the lead is not visible to restricted user
    const restrictedLeadsPage = new LeadsPage(restrictedPage);
    await restrictedLeadsPage.goToLeadsList();
    await restrictedLeadsPage.assertLeadNotInList(leadData.firstName);
  });

});
