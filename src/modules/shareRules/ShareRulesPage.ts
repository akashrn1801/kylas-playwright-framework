import { Page, Locator, Response, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { SHARE_ENTITIES, ShareEntityType, SharePermission, SharePermissionSet } from '../../core/sharePermissions';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

// WHY this module exists (2026-10-30, Leads coverage work): every "Share" on a record creates a
// share rule, and the rules of ALL entities are managed on ONE setup page — Setup → Data Management
// → Share Data (/setup/data-management/sharing/entities/list). Confirmed live: the list can be
// filtered to a record's rule, a rule opens on /…/edit/<ruleId> with one switch per permission,
// Save changes it and Delete removes it. This page object is therefore entity-agnostic: the entity
// comes in as a parameter (SHARE_ENTITIES in src/core/sharePermissions.ts) and nothing here names a
// lead. Only the Lead entity has been exercised live — see SHARE_ENTITIES for how to add another.

export class ShareRulesPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // Locators
  // ──────────────────────────────────────────────────────────

  private readonly filterButton = (): Locator => this.page.locator('#filter-action');

  private readonly filterPanel = (): Locator => this.page.locator('#filterModal');

  // WHY an id SUFFIX: the full id is `undefined_undefinedundefined_input_entityId` — the field's own
  // internal name is the stable part, nothing in it is a layout position
  private readonly filterEntityLookupInput = (): Locator =>
    this.filterPanel().locator('[id$="_input_entityId"]');

  private readonly listRows = (): Locator =>
    this.page.locator('.rt-tr[role="row"]:has(input[id^="check_"]:not(#check_all))');

  private readonly totalRecords = (): Locator => this.page.locator('#totalRecords').first();

  // `.custom-control` (the visible box), not the label: the label has no size of its own
  private readonly permissionSwitch = (permission: SharePermission): Locator =>
    this.page.locator(`.custom-control:has(#inp_${permission})`);

  private readonly permissionInput = (permission: SharePermission): Locator =>
    this.page.locator(`#inp_${permission}`);

  private readonly saveButton = (): Locator => this.page.getByRole('button', { name: 'Save', exact: true });

  // The rule page's own header (verified live): the only Delete button on the page
  private readonly deleteButton = (): Locator =>
    this.page.locator('.share-rule-header-section button.btn-danger').filter({ hasText: /^\s*Delete\s*$/ });

  // The confirmation dialog is aria-hidden while shown, so role queries cannot see it
  private readonly confirmDialog = (): Locator => this.page.locator('#confirmModal.show');

  private readonly deleteConfirmButton = (): Locator =>
    this.confirmDialog().locator('button').filter({ hasText: /^\s*Delete\s*$/ });

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToShareRulesList(): Promise<void> {
    logger.info('Navigating to the Share Data rules list');
    await this.navigateTo(`${config.appUrl}/setup/data-management/sharing/entities/list`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.totalRecords()).toBeVisible({ timeout: config.timeouts.navigation })
    );
    logger.success('On the Share Data rules list');
  }

  // ──────────────────────────────────────────────────────────
  // Find a rule
  // ──────────────────────────────────────────────────────────

  // Filter the list to the rules of ONE record: Entity → type the record's name → pick it → Apply.
  // WHY retried: the record lookup reads the search index, which trails a brand-new record briefly
  // (documented lookup-indexing lag, KNOWN_ISSUES_ACTIVE.md); bounded by the navigation timeout.
  async filterByRecord(entityType: ShareEntityType, recordName: string): Promise<void> {
    const { label } = SHARE_ENTITIES[entityType];
    logger.info(`Filtering share rules by ${label}: ${recordName}`);
    await this.click(this.filterButton(), 'filter button');
    await this.withSessionExpiryRecovery(() =>
      expect(this.filterPanel()).toBeVisible({ timeout: config.timeouts.expect })
    );
    await this.click(this.filterPanel().locator('.select__control').first(), 'filter field select');
    const entityOption = this.page.locator('.select__option').filter({ hasText: /^\s*Entity\s*$/ }).first();
    await entityOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.click(entityOption, 'Entity filter option');

    // Choosing "Entity" adds an "Entity Type" filter next to it. Only its default value has been
    // exercised live (Lead); another entity needs its own check of how that value is changed.
    const typeValue = this.filterPanel().locator('.select__single-value').filter({ hasText: label });
    if ((await typeValue.count()) === 0) {
      throw new Error(
        `filterByRecord: the Entity Type filter does not show "${label}" by default — selecting another ` +
          'entity type on this page has not been verified live yet'
      );
    }

    // The lookup's open menu is rendered outside the filter panel (verified live), so it is found as the one
    // open react-select menu, not by a bare class substring that also matches Bootstrap `dropdown-menu` blocks
    const recordOption = this.page
      .locator('div[class$="-menu"]:not(.dropdown-menu) div[class$="-option"]')
      .filter({ hasText: recordName })
      .first();
    await expect
      .poll(
        async () => {
          await this.filterEntityLookupInput().fill('', { timeout: config.timeouts.expect });
          await this.filterEntityLookupInput().fill(recordName, { timeout: config.timeouts.expect });
          return recordOption
            .waitFor({ state: 'visible', timeout: config.timeouts.expect })
            .then(() => true)
            .catch(() => false);
        },
        { timeout: config.timeouts.navigation, intervals: [1000, 2000], message: `${label} "${recordName}" in the lookup` }
      )
      .toBe(true);
    await this.click(recordOption, 'record option');
    await this.click(this.filterPanel().getByText('Apply', { exact: true }), 'Apply filter');
    await this.withSessionExpiryRecovery(() =>
      expect(this.filterPanel()).toBeHidden({ timeout: config.timeouts.expect })
    );
    logger.success(`Share rules filtered by ${label}: ${recordName}`);
  }

  async getListedRuleCount(): Promise<number> {
    const text = (await this.totalRecords().innerText()).replace(/,/g, '');
    const match = text.match(/(\d+)\s+items?/);
    if (!match) throw new Error(`getListedRuleCount: unexpected total text "${text}"`);
    return Number(match[1]);
  }

  async assertSingleRuleListedFor(entityType: ShareEntityType, recordName: string): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.listRows(), 'Rows listed for the filtered record').toHaveCount(1, {
        timeout: config.timeouts.navigation,
      })
    );
    expect(await this.getListedRuleCount(), 'Rules listed for the filtered record').toBe(1);
    // The list shows the entity and the record as "Lead (record name)", with the name re-capitalised
    await expect(this.listRows().first()).toContainText(
      new RegExp(`${this.escapeRegExp(SHARE_ENTITIES[entityType].label)}\\s*\\(.*${this.escapeRegExp(recordName)}`, 'i')
    );
  }

  // Opens the listed rule and returns its id (from the address of the edit page)
  async openListedRule(): Promise<number> {
    // the cell that names the record ("Lead (name)"), not a column position
    await this.click(
      this.listRows().first().locator('.rt-td').filter({ hasText: /\(.+\)/ }).first(),
      'listed share rule'
    );
    await this.withSessionExpiryRecovery(() =>
      expect(this.page).toHaveURL(/\/sharing\/entities\/edit\/\d+/, { timeout: config.timeouts.navigation })
    );
    const match = this.page.url().match(/\/edit\/(\d+)/);
    if (!match) throw new Error(`openListedRule: no rule id in ${this.page.url()}`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.permissionInput('read')).toBeVisible({ timeout: config.timeouts.navigation })
    );
    return Number(match[1]);
  }

  // ──────────────────────────────────────────────────────────
  // Edit / delete a rule
  // ──────────────────────────────────────────────────────────

  // WHY partial: `delete` is part of a share but has no switch on the rule page
  async getPermissionStates(): Promise<Partial<SharePermissionSet>> {
    const states: Partial<SharePermissionSet> = {};
    for (const permission of ['read', 'update', 'note', 'task', 'meeting', 'call', 'email', 'sms', 'document'] as SharePermission[]) {
      states[permission] = await this.permissionInput(permission).isChecked();
    }
    return states;
  }

  async assertPermissionSwitchLocked(permission: SharePermission): Promise<void> {
    await expect(this.permissionInput(permission), `${permission} switch is locked`).toBeDisabled({
      timeout: config.timeouts.expect,
    });
  }

  async setPermission(permission: SharePermission, enabled: boolean): Promise<void> {
    logger.info(`Setting share permission ${permission} to ${enabled ? 'on' : 'off'}`);
    if ((await this.permissionInput(permission).isChecked()) !== enabled) {
      await this.click(this.permissionSwitch(permission), `${permission} switch`);
    }
    await expect(this.permissionInput(permission)).toBeChecked({ checked: enabled, timeout: config.timeouts.expect });
  }

  async saveRule(): Promise<void> {
    logger.info('Saving the share rule');
    const saveResponsePromise: Promise<Response> = this.armResponseWaitWithRecovery(
      (res) => /\/v1\/[a-z-]+\/\d+\/share\/\d+$/.test(res.url()) && res.request().method() === 'PUT',
      'share rule save response',
      config.timeouts.navigation
    );
    await this.click(this.saveButton(), 'save');
    const response = await saveResponsePromise;
    expect(response.status(), 'Saving the share rule should succeed').toBe(200);
    await this.withSessionExpiryRecovery(() =>
      expect(this.page).toHaveURL(/\/sharing\/entities\/list/, { timeout: config.timeouts.navigation })
    );
    logger.success('Share rule saved');
  }

  async deleteRule(): Promise<void> {
    logger.info('Deleting the share rule');
    await this.click(this.deleteButton(), 'delete');
    await this.withSessionExpiryRecovery(() =>
      expect(this.confirmDialog()).toContainText('Are you sure you want to delete this share rule?', {
        timeout: config.timeouts.expect,
      })
    );
    const deleteResponsePromise: Promise<Response> = this.armResponseWaitWithRecovery(
      (res) => /\/v1\/share-rules\/\d+\/delete$/.test(res.url()) && res.request().method() === 'DELETE',
      'share rule delete response',
      config.timeouts.navigation
    );
    await this.click(this.deleteConfirmButton(), 'confirm delete');
    const response = await deleteResponsePromise;
    expect(response.status(), 'Deleting the share rule should succeed').toBe(200);
    await this.withSessionExpiryRecovery(() =>
      expect(this.page).toHaveURL(/\/sharing\/entities\/list/, { timeout: config.timeouts.navigation })
    );
    logger.success('Share rule deleted');
  }
}
