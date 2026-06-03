import { test } from '../../../src/fixtures/index';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData, LEAD_PIPELINE_STAGES } from '../../../src/data/factories/leadFactory';
import { faker } from '@faker-js/faker';
import { config } from '../../../config/config';

test.describe('Leads', () => {

  test('@smoke @regression admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
  });

  test('@regression admin should create a new lead with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
  });

  test('@regression admin should update a created lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const updatedData = generateLeadData();
    await leadsPage.updateLead(updatedData, leadData.firstName);
    await leadsPage.assertLeadUpdated(updatedData);
  });



  // ──────────────────────────────────────────────────────────
  // Pipeline Stage verification
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a lead with pipeline stage and verify on details', async ({ adminPage }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData({ pipelineStage: 'Open' });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);

    // Navigate to lead details
    await adminPage.goto(
      `${config.appUrl}/sales/leads/details/${leadId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await adminPage.waitForURL(/leads\/details\//, { timeout: 20000 });

    // WHY: Verify pipeline stage is shown correctly on details page
    await leadsPage.assertPipelineStageOnDetails('Open');
  });

  test('@regression admin should change pipeline stage while updating a lead', async ({ adminPage }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData({ pipelineStage: 'Open' });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);

    // Open lead for editing
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);

    // WHY: Pick a random non-closed stage for update
    const newStage = faker.helpers.arrayElement([
      'Prospect/Contacted',
      'Requirements Gathered',
      'Demo/Meeting Conducted',
    ]);
    const updatedData = generateLeadData({ pipelineStage: newStage as typeof leadData.pipelineStage });

    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updatedData);
    await leadsPage.changePipelineStageInEdit(newStage);
    await leadsPage.saveEditedLead();

    // Verify stage updated on details page
    await adminPage.goto(
      `${config.appUrl}/sales/leads/details/${leadId}`,
      { waitUntil: 'domcontentloaded' },
    );
    await adminPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await leadsPage.assertPipelineStageOnDetails(newStage);
  });
});