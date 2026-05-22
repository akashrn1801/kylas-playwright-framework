import { test, expect } from '../../../src/fixtures/index';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../../src/data/factories/leadFactory';

test.describe('Leads module — admin', () => {

  test('admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('admin should create a new lead with all fields', async ({ adminPage }) => {
    test.setTimeout(90000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();
    await leadsPage.assertLeadExistsInList(leadData.firstName);
  });

  test('admin should update a created lead', async ({ adminPage }) => {
    test.setTimeout(120000);
    const leadsPage = new LeadsPage(adminPage);
    const original = generateLeadData();
    const updated  = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(original);
    await leadsPage.saveLead();

    await leadsPage.searchAndOpenLead(original.firstName);
    await leadsPage.assertOnLeadDetailPage();
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updated);
    await leadsPage.saveEditedLead();

    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(updated.firstName);
  });

});
