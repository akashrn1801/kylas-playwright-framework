import { Page, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { LeadData } from '../../data/factories/leadFactory';
import { logger } from '../../utils/logger';

export class LeadsPage extends BasePage {

  // ─── Navigation Locators ──────────────────────────────────
  private readonly leadsNavIcon = () =>
    this.page.locator('.left-navbar__side-nav__item[data-original-title="Leads"]');

  // ─── List Page Locators ───────────────────────────────────
  private readonly addButton = () =>
    this.page.locator('button.btn.btn-primary.mr-2').filter({ hasText: 'Add' });
  private readonly searchInput = () =>
    this.page.locator('#fulltext-search');

  // ─── Form Locators ────────────────────────────────────────
  private readonly showRequiredToggle = () =>
    this.page.locator('label').filter({ hasText: 'Show Required & Important Fields' });
  private readonly firstNameInput = () =>
    this.page.locator('input[name="firstName"]');
  private readonly lastNameInput = () =>
    this.page.locator('input[name="lastName"]');
  private readonly addEmailButton = () =>
    this.page.locator('span').filter({ hasText: 'Add Email' }).first();
  private readonly emailInput = () =>
    this.page.locator('input[name="emails[0].value"]');
  private readonly addPhoneButton = () =>
    this.page.locator('span').filter({ hasText: 'Add Phone' }).first();
  private readonly phoneInput = () =>
    this.page.locator('input[id*="input_phone_0"]');
  private readonly addressInput = () =>
    this.page.locator('input[name="address"]');
  private readonly cityInput = () =>
    this.page.locator('input[name="city"]');
  private readonly stateInput = () =>
    this.page.locator('input[name="state"]');
  private readonly zipcodeInput = () =>
    this.page.locator('input[name="zipcode"]');
  private readonly facebookInput = () =>
    this.page.locator('input[name="facebook"]');
  private readonly twitterInput = () =>
    this.page.locator('input[name="twitter"]');
  private readonly linkedInInput = () =>
    this.page.locator('input[name="linkedIn"]');
  private readonly companyNameInput = () =>
    this.page.locator('input[name="companyName"]');
  private readonly departmentInput = () =>
    this.page.locator('input[name="department"]');
  private readonly designationInput = () =>
    this.page.locator('input[name="designation"]');
  private readonly companyAddressInput = () =>
    this.page.locator('input[name="companyAddress"]');
  private readonly companyCityInput = () =>
    this.page.locator('input[name="companyCity"]');
  private readonly companyStateInput = () =>
    this.page.locator('input[name="companyState"]');
  private readonly companyZipcodeInput = () =>
    this.page.locator('input[name="companyZipcode"]');
  private readonly saveButton = () =>
    this.page.locator('button[type="submit"].save-button');

  // ─── Detail Page Locators ─────────────────────────────────
private readonly editIconButton = () =>
    this.page.locator('#edit-action-btn');

  // ─── Edit Form Locators ───────────────────────────────────
  private readonly editFirstNameInput = () =>
    this.page.locator('input[name="firstName"]');
  private readonly editLastNameInput = () =>
    this.page.locator('input[name="lastName"]');
  private readonly editEmailInput = () =>
    this.page.locator('[name*="emails"][name*="value"]').first();
  private readonly editPhoneInput = () =>
    this.page.locator('[name*="phoneNumbers"]').first();
  private readonly editSaveButton = () =>
    this.page.locator('button[type="submit"].save-button');

  constructor(page: Page) {
    super(page);
  }

  // ─── Navigation Actions ───────────────────────────────────

  async goToLeadsList(): Promise<void> {
    logger.info('Navigating to Leads list');
    // Close any open modal first
    await this.closeModalIfOpen();
    await this.click(this.leadsNavIcon(), 'leads nav icon');
    await this.waitForUrl(/leads\/list/);
    logger.success('On Leads list page');
  }

  private async closeModalIfOpen(): Promise<void> {
    try {
      const modal = this.page.locator('#editEntityModal.show');
      const isVisible = await modal.isVisible({ timeout: 1000 });
      if (isVisible) {
        logger.info('Closing open modal before navigation');
        const cancelBtn = this.page.locator('button[data-dismiss="modal"]').first();
        await cancelBtn.click();
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
      }
    } catch {
      // No modal open
    }
  }

  async clickAddLead(): Promise<void> {
    logger.info('Clicking Add Lead button');
    await this.click(this.addButton(), 'add lead button');
    await this.page.waitForTimeout(1000);
  }

  // ─── Form Helper Actions ──────────────────────────────────

  private async disableRequiredFieldsToggle(): Promise<void> {
    try {
      const toggle = this.showRequiredToggle();
      const isVisible = await toggle.isVisible({ timeout: 3000 });
      if (isVisible) {
        logger.info('Disabling Show Required & Important Fields toggle');
        await toggle.click();
        await this.page.waitForTimeout(800);
      }
    } catch {
      // Toggle not present
    }
  }

  // ─── Fill Form ────────────────────────────────────────────

  async fillLeadForm(data: LeadData): Promise<void> {
    logger.info('Filling lead creation form');

    await this.disableRequiredFieldsToggle();

    // Basic info
    await this.fill(this.firstNameInput(), data.firstName, 'first name');
    await this.fill(this.lastNameInput(), data.lastName, 'last name');

    // Email
    await this.click(this.addEmailButton(), 'add email button');
    await this.page.waitForTimeout(300);
    await this.fill(this.emailInput(), data.email, 'email');

    // Phone
    await this.click(this.addPhoneButton(), 'add phone button');
    await this.page.waitForTimeout(500);
    await this.fill(this.phoneInput(), data.phone, 'phone');

    // Address
    await this.fill(this.addressInput(), data.address, 'address');
    await this.fill(this.cityInput(), data.city, 'city');
    await this.fill(this.stateInput(), data.state, 'state');
    await this.fill(this.zipcodeInput(), data.zipcode, 'zipcode');

    // Social
    await this.fill(this.facebookInput(), data.facebook, 'facebook');
    await this.fill(this.twitterInput(), data.twitter, 'twitter');
    await this.fill(this.linkedInInput(), data.linkedIn, 'linkedin');

    // Company info
    await this.fill(this.companyNameInput(), data.companyName, 'company name');
    await this.fill(this.departmentInput(), data.department, 'department');
    await this.fill(this.designationInput(), data.designation, 'designation');
    await this.fill(this.companyAddressInput(), data.companyAddress, 'company address');
    await this.fill(this.companyCityInput(), data.companyCity, 'company city');
    await this.fill(this.companyStateInput(), data.companyState, 'company state');
    await this.fill(this.companyZipcodeInput(), data.companyZipcode, 'company zipcode');

    logger.success('Lead form filled successfully');
  }

 async saveLead(): Promise<void> {
    logger.info('Saving lead');
    await this.click(this.saveButton(), 'save button');
    await this.page.waitForTimeout(2000);
    // Explicitly navigate back to leads list
    await this.navigateTo('https://app.kylas.io/sales/leads/list');
    await this.waitForUrl(/leads\/list/);
    logger.success('Lead saved successfully');
  }

  // ─── Search & Open ────────────────────────────────────────
async searchAndOpenLead(firstName: string): Promise<void> {
  logger.info(`Searching for lead: ${firstName}`);
  await this.navigateTo('https://app.kylas.io/sales/leads/list');
  await this.waitForUrl(/leads\/list/);
  await this.page.waitForTimeout(2000);

  await this.fill(this.searchInput(), firstName, 'search input');
  await this.click(this.page.locator('#Ic_Search'), 'search icon');
  await this.page.waitForTimeout(3000); // 👈 fixed wait

  const nameCell = this.page.locator('.rt-tr-group .clip-text')
    .filter({ hasText: firstName })
    .first();
  await nameCell.waitFor({ state: 'visible', timeout: 20000 });
  await nameCell.click();
  await this.page.waitForURL(/sales\/leads\/details\//, { timeout: 15000 });
  logger.success(`Opened lead: ${firstName}`);
}
  // ─── List Assertion ───────────────────────────────────────

async assertLeadExistsInList(firstName: string, lastName: string): Promise<void> {
  logger.info(`Asserting lead in list: ${firstName} ${lastName}`);
  await this.waitForUrl(/leads\/list/);
  await this.page.waitForLoadState('networkidle');
  
  await this.fill(this.searchInput(), firstName, 'search input');
  await this.click(this.page.locator('#Ic_Search'), 'search icon'); // 👈 click icon not Enter
  await this.page.waitForLoadState('networkidle');
  await this.page.waitForTimeout(2000);

  const nameCell = this.page.locator('.rt-tr-group .clip-text')
    .filter({ hasText: new RegExp(`^${firstName}$`) })
    .first();
  await expect(nameCell).toBeVisible({ timeout: 20000 });
  logger.success(`Lead found in list: ${firstName} ${lastName}`);
}
  // ─── Edit Lead ────────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Clicking edit icon');
    await this.click(this.editIconButton(), 'edit icon');
    await this.page.waitForTimeout(1000);
    logger.success('Edit form opened');
  }

  async fillEditForm(data: LeadData): Promise<void> {
    logger.info('Filling edit form');
    await this.fill(this.editFirstNameInput(), data.firstName, 'first name');
    await this.fill(this.editLastNameInput(), data.lastName, 'last name');
    logger.success('Edit form filled');
  }

  async saveEditedLead(): Promise<void> {
    logger.info('Saving edited lead');
    await this.click(this.editSaveButton(), 'save button');
    await this.page.waitForTimeout(2000);
    logger.success('Lead updated successfully');
  }

  // ─── Assertions ───────────────────────────────────────────

  async assertOnLeadsListPage(): Promise<void> {
    await this.assertUrl(/leads\/list/);
  }

  async assertOnLeadDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/leads\/details\//);
  }
}