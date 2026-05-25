import { test, expect } from '../../src/fixtures/index';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../src/data/factories/leadFactory';

test.describe('Leads RBAC', () => {

  test('restricted user can navigate to leads list', async ({ restrictedPage }) => {
    const leadsPage = new LeadsPage(restrictedPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('restricted user can create a lead', async ({ restrictedPage }) => {
    test.setTimeout(90000);
    const leadsPage = new LeadsPage(restrictedPage);
    const leadData = generateLeadData();

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.fillLeadForm(leadData);
    await leadsPage.saveLead();
    await leadsPage.assertLeadExistsInList(leadData.firstName);
  });

  test('restricted user can edit own lead', async ({ restrictedPage }) => {
    test.setTimeout(120000);
    const leadsPage = new LeadsPage(restrictedPage);
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

  test('restricted user cannot edit an admin-owned lead', async ({ adminPage, restrictedPage }) => {
    test.setTimeout(120000);

    // Step 1 — admin creates a lead and captures its URL
    const adminLeadsPage = new LeadsPage(adminPage);
    const adminLead = generateLeadData();

    await adminLeadsPage.goToLeadsList();
    await adminLeadsPage.clickAddLead();
    await adminLeadsPage.fillLeadForm(adminLead);
    await adminLeadsPage.saveLead();
    await adminLeadsPage.searchAndOpenLead(adminLead.firstName);

    const adminLeadUrl = adminPage.url();

    // Step 2 — restricted user navigates directly to that lead's URL
    await restrictedPage.goto(adminLeadUrl, { waitUntil: 'domcontentloaded' });
    await restrictedPage.waitForLoadState('domcontentloaded');

    // WHY: a proper RBAC assertion must be deterministic — either:
    // (a) user was redirected away (no access), OR
    // (b) user can see the page but the edit button must be absent
    // The old code passed even when the user COULD access the page.
    const finalUrl = restrictedPage.url();
    const wasRedirected = finalUrl !== adminLeadUrl;

    if (wasRedirected) {
      // Access denied — redirected away. Test passes.
      expect(wasRedirected).toBe(true);
    } else {
      // User can see the page — edit button must NOT be present
      // WHY: toBeHidden() is a hard assertion, not isVisible() which can silently pass
      const editBtn = restrictedPage.locator('#edit-action-btn');
      await expect(editBtn).toBeHidden({ timeout: 5000 });
    }
  });

});
