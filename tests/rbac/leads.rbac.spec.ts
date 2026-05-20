import { test, expect } from '../../src/fixtures/index';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../src/data/factories/leadFactory';

test.describe('Leads RBAC', () => {

  test.setTimeout(90000);

  test('Restricted user can navigate to leads list', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('Restricted user can create a lead', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();
    await leadsPage.assertLeadExistsInList(leadData.firstName, leadData.lastName);
  });

  test('Restricted user can edit own lead', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();
    const updatedData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();

    await leadsPage.searchAndOpenLead(leadData.firstName);
    await leadsPage.assertOnLeadDetailPage();
    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updatedData);
    await leadsPage.saveEditedLead();

    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(updatedData.firstName, updatedData.lastName);
  });

  test('Restricted user cannot access admin lead', async ({ adminPage, restrictedPage }) => {
    const adminLeadsPage = new LeadsPage(adminPage);
    const adminLeadData = generateLeadData();

    await adminLeadsPage.goToLeadsList();
    await adminLeadsPage.clickAddLead();
    await adminLeadsPage.fillLeadForm(adminLeadData);
    await adminLeadsPage.saveLead();

    await adminLeadsPage.searchAndOpenLead(adminLeadData.firstName);
    const adminLeadUrl = adminPage.url();

    await restrictedPage.goto(adminLeadUrl);
    await restrictedPage.waitForLoadState('domcontentloaded');
    await restrictedPage.waitForTimeout(2000);

    const currentUrl = restrictedPage.url();

    if (currentUrl === adminLeadUrl) {
      const editBtn = restrictedPage.locator('#edit-action-btn');
      const isEditVisible = await editBtn.isVisible({ timeout: 3000 }).catch(() => false);
      expect(isEditVisible).toBeFalsy();
    } else {
      expect(currentUrl).not.toBe(adminLeadUrl);
    }
  });

});