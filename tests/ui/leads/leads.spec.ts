import { test } from '../../../src/fixtures/index';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../../src/data/factories/leadFactory';

test.describe('Leads', () => {

  test('@smoke @regression admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.navigateToLeads();
    await leadsPage.assertLeadsPageVisible();
  });

  test('@regression admin should create a new lead with all fields', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.navigateToLeads();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
  });

  test('@regression admin should update a created lead', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.navigateToLeads();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData);
    await leadsPage.assertLeadUpdated(updatedData);
  });

});
