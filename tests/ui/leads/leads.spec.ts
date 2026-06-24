import { test, expect } from '../../../src/fixtures/index';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { generateLeadData } from '../../../src/data/factories/leadFactory';
import { faker } from '@faker-js/faker';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

test.describe('Leads', () => {
  test('@smoke @regression admin should navigate to leads list page', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L1 passed');
  });

  test('@regression admin should create a new lead with all fields', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    await leadsPage.assertLeadCreated(leadData);
    logger.success('L2 passed');
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
    logger.success('L3 passed');
  });

  // ──────────────────────────────────────────────────────────
  // Pipeline Stage verification
  // ──────────────────────────────────────────────────────────

  test('@regression admin should create a lead with pipeline stage and verify on details', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData({ pipelineStage: 'Open' });

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);

    // Navigate to lead details
    await adminPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, {
      waitUntil: 'domcontentloaded',
    });
    await adminPage.waitForURL(/leads\/details\//, { timeout: 20000 });

    // WHY: Verify pipeline stage is shown correctly on details page
    await leadsPage.assertPipelineStageOnDetails('Open');
    logger.success('L4 passed');
  });

  test('@regression admin should change pipeline stage while updating a lead', async ({
    adminPage,
  }) => {
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
    const updatedData = generateLeadData({
      pipelineStage: newStage as typeof leadData.pipelineStage,
    });

    await leadsPage.clickEditIcon();
    await leadsPage.fillEditForm(updatedData);
    await leadsPage.changePipelineStageInEdit(newStage);
    await leadsPage.saveEditedLead();

    // Verify stage updated on details page
    await adminPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, {
      waitUntil: 'domcontentloaded',
    });
    await adminPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    await leadsPage.assertPipelineStageOnDetails(newStage);
    logger.success('L5 passed');
  });

  // ── L6 ────────────────────────────────────────────────────

  test('@regression admin should search lead by name and verify in list', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.goToLeadsList();
    await leadsPage.assertLeadExistsInList(leadData.firstName);
    logger.success('L6 passed');
  });

  // ── L7 ────────────────────────────────────────────────────

  test('@regression admin should verify all detail fields after creating a lead', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await adminPage.goto(`${config.appUrl}/sales/leads/details/${leadId}`, { waitUntil: 'domcontentloaded' });
    await adminPage.waitForURL(/leads\/details\//, { timeout: 20000 });
    // WHY: Verify Communication tab fields
    await leadsPage.assertDetailTabContent('nav-tab0-tab', [leadData.email]);
    // WHY: Verify Location tab fields
    await leadsPage.assertDetailTabContent('nav-tab1-tab', [leadData.city, leadData.state]);
    // WHY: Verify Social tab fields
    await leadsPage.assertDetailTabContent('nav-tab2-tab', [leadData.facebook, leadData.twitter]);
    // WHY: Verify Professional tab fields
    await leadsPage.assertDetailTabContent('nav-tab3-tab', [leadData.companyName, leadData.department, leadData.designation]);
    logger.success('L7 passed');
  });

  // ── L8 ────────────────────────────────────────────────────

  test('@regression admin should delete a lead and verify it is removed from list', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    // WHY: Use ADM prefix to guarantee uniqueness — only this test creates this lead
    const { generateAdminLeadData } = await import('../../../src/data/factories/leadFactory');
    const leadData = generateAdminLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.deleteLead();
    await leadsPage.assertLeadNotInList(leadData.firstName);
    logger.success('L8 passed');
  });

  // ── L9 ────────────────────────────────────────────────────

  test('@regression admin should clone a lead and verify new lead has Copy in lastName', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.cloneLead();
    await leadsPage.assertClonedLeadLastName(leadData.lastName);
    logger.success('L9 passed');
  });

  // ── L10 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Won via Close Lead dropdown and verify stage', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Won');
    await leadsPage.assertLeadStageOnDetail('Won');
    logger.success('L10 passed');
  });

  // ── L11 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Lost via Close Lead dropdown select reason and verify stage', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Closed Lost');
    await leadsPage.assertLeadStageOnDetail('Closed Lost');
    logger.success('L11 passed');
  });

  // ── L12 ───────────────────────────────────────────────────

  test('@regression admin should mark lead as Closed Unqualified via Close Lead dropdown select reason and verify stage', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    await leadsPage.markLeadAsStage('Closed Unqualified');
    await leadsPage.assertLeadStageOnDetail('Closed Unqualified');
    logger.success('L12 passed');
  });

  // ── L13 ───────────────────────────────────────────────────

  test('@regression admin should convert lead to Deal Contact and Company and verify Lead Converted badge', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const dealName = `Deal-${Date.now()}`;
    await leadsPage.convertLeadToAll(dealName);
    await leadsPage.assertLeadConvertedBadge();
    logger.success('L13 passed');
  });

  // ── L14 ───────────────────────────────────────────────────

  test('@regression admin should reassign lead to restricted user and verify owner changed', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(leadData);
    expect(leadId).not.toBeNull();
    await leadsPage.searchAndOpenLead(leadData.firstName, leadId ?? undefined);
    const restrictedUserName = await leadsPage.getLoggedInUserName('restricted');
    await leadsPage.reassignLead(restrictedUserName);
    await leadsPage.assertOwnerOnDetail(restrictedUserName);
    logger.success('L14 passed');
  });

  // ── L15 ───────────────────────────────────────────────────

  test('@regression admin should get validation error when saving lead without lastName', async ({ adminPage }) => {
    test.setTimeout(480000);
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    // WHY: Only fill firstName — leave lastName empty to trigger validation
    await leadsPage.fillLeadForm({ ...generateLeadData(), lastName: '' });
    // WHY: saveLead() clicks save button and checks for form errors
    await adminPage.locator('button[type="submit"].save-button').click();
    await leadsPage.assertValidationError('required');
    logger.success('L15 passed');
  });

  // ── L16 ───────────────────────────────────────────────────

  test('@prodSafe admin should navigate to leads list page on production', async ({ adminPage }) => {
    const leadsPage = new LeadsPage(adminPage);
    await leadsPage.goToLeadsList();
    await leadsPage.assertOnLeadsListPage();
    logger.success('L16 passed');
  });
});
