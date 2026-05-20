import { test, expect } from '../../../src/fixtures/index';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../../src/data/factories/leadFactory';

test.describe('Leads Module', () => {

  test('Admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('Admin should create a new lead with all fields', async ({ adminPage }) => {
    test.setTimeout(90000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();
    await leadsPage.assertLeadExistsInList(leadData.firstName, leadData.lastName);
  });

  test('Admin should update a created lead', async ({ adminPage }) => {
    test.setTimeout(90000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    const updatedData = generateLeadData();

    // Step 1 — create lead
    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();

    // Step 2 — open lead detail
    await leadsPage.searchAndOpenLead(leadData.firstName);
    await leadsPage.assertOnLeadDetailPage();

    // Step 3 — edit and save
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updatedData);
    await leadsPage.saveEditedLead();

    // Step 4 — assert updated name in list
    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(updatedData.firstName, updatedData.lastName);
  });

});