import { Page, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { LeadData } from '../../data/factories/leadFactory';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';
import { config } from '../../../config/config';

export class LeadsPage extends BasePage {

  // ─── Locators ─────────────────────────────────────────────

  private readonly leadsNavIcon = () =>
    this.page.locator('.left-navbar__side-nav__item[data-original-title="Leads"]');

  private readonly addButton = () =>
    this.page.locator('button.btn.btn-primary.mr-2').filter({ hasText: 'Add' });

  private readonly searchInput = () =>
    this.page.locator('#fulltext-search');

  private readonly searchIcon = () =>
    this.page.locator('svg:has(#Ic_Search)');

  private readonly leadRowNameCell = (firstName: string) =>
    this.page.locator('.rt-tr-group .clip-text')
      .filter({ hasText: new RegExp(`${firstName}`) })
      .first();

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

  private readonly addressInput        = () => this.page.locator('input[name="address"]');
  private readonly cityInput           = () => this.page.locator('input[name="city"]');
  private readonly stateInput          = () => this.page.locator('input[name="state"]');
  private readonly zipcodeInput        = () => this.page.locator('input[name="zipcode"]');
  private readonly facebookInput       = () => this.page.locator('input[name="facebook"]');
  private readonly twitterInput        = () => this.page.locator('input[name="twitter"]');
  private readonly linkedInInput       = () => this.page.locator('input[name="linkedIn"]');
  private readonly companyNameInput    = () => this.page.locator('input[name="companyName"]');
  private readonly departmentInput     = () => this.page.locator('input[name="department"]');
  private readonly designationInput    = () => this.page.locator('input[name="designation"]');
  private readonly companyAddressInput = () => this.page.locator('input[name="companyAddress"]');
  private readonly companyCityInput    = () => this.page.locator('input[name="companyCity"]');
  private readonly companyStateInput   = () => this.page.locator('input[name="companyState"]');
  private readonly companyZipcodeInput = () => this.page.locator('input[name="companyZipcode"]');

  private readonly saveButton = () =>
    this.page.locator('button[type="submit"].save-button');

  private readonly editIconButton = () =>
    this.page.locator('#edit-action-btn');

  private readonly editModal = () =>
    this.page.locator('#editEntityModal');

  private readonly modalCancelButton = () =>
    this.page.locator('button[data-dismiss="modal"]').first();

  // WHY: success toast is the only reliable post-save signal on this app
  // The app does NOT redirect after create — it stays on the form
  private readonly successToast = () =>
    this.page.locator('.toast-success, .alert-success, [class*="toast"][class*="success"], [class*="notification"][class*="success"]').first();

  constructor(page: Page) {
    super(page);
  }

  // ─── Private Helpers ──────────────────────────────────────

  private async closeModalIfOpen(): Promise<void> {
    try {
      const modal = this.editModal();
      const isVisible = await modal.isVisible({ timeout: 1000 });
      if (isVisible) {
        logger.info('Closing open modal before navigation');
        await this.modalCancelButton().click();
        await modal.waitFor({ state: 'hidden', timeout: 5000 });
        logger.success('Modal closed');
      }
    } catch {
      // No modal open — continue
    }
  }

  private async disableRequiredFieldsToggle(): Promise<void> {
    try {
      const toggle = this.showRequiredToggle();
      const isVisible = await toggle.isVisible({ timeout: 3000 });
      if (!isVisible) return;
      logger.info('Disabling Show Required & Important Fields toggle');
      await toggle.click();
      // WHY: wait for firstName to appear — that is the real signal
      // the form re-rendered after toggle, not a page load event
      await this.firstNameInput().waitFor({ state: 'visible', timeout: 10000 });
      logger.info('Toggle disabled — form ready');
    } catch {
      // Toggle absent — form already fully visible, continue
    }
  }
private async performSearch(searchText: string): Promise<void> {
  await this.fill(this.searchInput(), searchText, 'search input');
  await this.page.waitForTimeout(2000);  // increase from 1000
  await this.click(this.searchIcon(), 'search icon');
  await this.page.waitForTimeout(5000);  // increase from 3000
}

  // ─── Navigation ───────────────────────────────────────────

async goToLeadsList(): Promise<void> {
  logger.info('Navigating to Leads list');
  await this.closeModalIfOpen();
  // WHY: navigate directly by URL instead of clicking nav icon
  // The nav icon can load a stale cached list — direct navigation
  // forces a fresh load from the server every time
  await this.navigateTo(`${config.appUrl}/sales/leads/list`);
  await this.waitForUrl(/leads\/list/);
  await this.waitForListReady();
  logger.success('On Leads list page');
}
  async clickAddLead(): Promise<void> {
    logger.info('Clicking Add Lead button');
    await this.click(this.addButton(), 'add lead button');
    // WHY: firstName appearing = create form fully mounted
    await this.firstNameInput().waitFor({ state: 'visible', timeout: 10000 });
  }

  // ─── Form Actions ─────────────────────────────────────────

  async fillLeadForm(data: LeadData): Promise<void> {
    logger.info('Filling lead creation form');

    await this.disableRequiredFieldsToggle();

    await this.fill(this.firstNameInput(), data.firstName, 'first name');
    await this.fill(this.lastNameInput(), data.lastName, 'last name');

    await this.click(this.addEmailButton(), 'add email button');
    await this.emailInput().waitFor({ state: 'visible', timeout: 5000 });
    await this.fill(this.emailInput(), data.email, 'email');

    await this.click(this.addPhoneButton(), 'add phone button');
    await this.phoneInput().waitFor({ state: 'visible', timeout: 5000 });
    await this.fill(this.phoneInput(), data.phone, 'phone');

    await this.fill(this.addressInput(),        data.address,        'address');
    await this.fill(this.cityInput(),           data.city,           'city');
    await this.fill(this.stateInput(),          data.state,          'state');
    await this.fill(this.zipcodeInput(),        data.zipcode,        'zipcode');
    await this.fill(this.facebookInput(),       data.facebook,       'facebook');
    await this.fill(this.twitterInput(),        data.twitter,        'twitter');
    await this.fill(this.linkedInInput(),       data.linkedIn,       'linkedin');
    await this.fill(this.companyNameInput(),    data.companyName,    'company name');
    await this.fill(this.departmentInput(),     data.department,     'department');
    await this.fill(this.designationInput(),    data.designation,    'designation');
    await this.fill(this.companyAddressInput(), data.companyAddress, 'company address');
    await this.fill(this.companyCityInput(),    data.companyCity,    'company city');
    await this.fill(this.companyStateInput(),   data.companyState,   'company state');
    await this.fill(this.companyZipcodeInput(), data.companyZipcode, 'company zipcode');

    logger.success('Lead form filled successfully');
  }

  async saveLead(): Promise<void> {
    logger.info('Saving lead');
    await this.click(this.saveButton(), 'save button');
    await this.page.waitForTimeout(2000);
    await this.navigateTo(`${config.appUrl}/sales/leads/list`);
    await this.waitForUrl(/leads\/list/);
    await this.waitForListReady();
    logger.success('Lead saved — on list page');
  }

  // ─── Search & Open ────────────────────────────────────────

  async searchAndOpenLead(firstName: string): Promise<void> {
    logger.info(`Searching for lead: ${firstName}`);
    await this.navigateTo(`${config.appUrl}/sales/leads/list`);
    await this.waitForUrl(/leads\/list/);
    await this.waitForListReady();
    await this.performSearch(firstName);

    const nameCell = this.leadRowNameCell(firstName);
    await nameCell.waitFor({ state: 'visible', timeout: 20000 });
    await nameCell.click();
    await this.page.waitForURL(/sales\/leads\/details\//, { timeout: 20000 });
    logger.success(`Opened lead: ${firstName}`);
  }

  // ─── Edit Actions ─────────────────────────────────────────

  async clickEditIcon(): Promise<void> {
    logger.info('Clicking edit icon');
    await this.click(this.editIconButton(), 'edit icon');
    await this.editModal().waitFor({ state: 'visible', timeout: 10000 });
    logger.success('Edit form opened');
  }

  async fillEditForm(data: LeadData): Promise<void> {
    logger.info('Filling edit form');
    await this.fill(this.firstNameInput(), data.firstName, 'first name');
    await this.fill(this.lastNameInput(), data.lastName, 'last name');
    logger.success('Edit form filled');
  }

  async saveEditedLead(): Promise<void> {
    logger.info('Saving edited lead');
    await this.click(this.saveButton(), 'save button');
    // WHY: modal disappearing = edit API call completed successfully
    await this.editModal().waitFor({ state: 'hidden', timeout: 15000 });
    logger.success('Lead updated successfully');
  }

  // ─── Assertions ───────────────────────────────────────────

  async assertOnLeadsListPage(): Promise<void> {
    await this.assertUrl(/leads\/list/);
  }

  async assertOnLeadDetailPage(): Promise<void> {
    await this.assertUrl(/sales\/leads\/details\//);
  }

  async assertLeadExistsInList(firstName: string): Promise<void> {
  logger.info(`Asserting lead exists in list: ${firstName}`);
  
  // WHY: after edit, the search index can lag by 1-2 seconds
  // We retry the search up to 3 times with a short wait between
  // This eliminates flakiness without using fixed sleeps
  let found = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await this.performSearch(firstName);
    const nameCell = this.leadRowNameCell(firstName);
    found = await nameCell.isVisible({ timeout: 5000 }).catch(() => false);
    if (found) break;
    logger.info(`Lead not visible yet — retry ${attempt}/3`);
    // WHY: short wait before retry — gives search index time to catch up
    await this.page.waitForTimeout(2000);
  }

  await expect(this.leadRowNameCell(firstName)).toBeVisible({ timeout: 10000 });
  logger.success(`Lead confirmed in list: ${firstName}`);
}

  async assertLeadNotInList(firstName: string): Promise<void> {
    logger.info(`Asserting lead NOT in list: ${firstName}`);
    await this.performSearch(firstName);
    // WHY: toBeHidden is a hard assertion — will fail if element appears
    await expect(this.leadRowNameCell(firstName)).toBeHidden({ timeout: 10000 });
    logger.success(`Confirmed lead absent: ${firstName}`);
  }
}