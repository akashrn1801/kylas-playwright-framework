import { Page, Response } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { logger } from '@utils/logger';
import { config } from '@config/config';
import {
  MeetingData,
  MeetingTimeConfig,
  formatDateForCalendarLabel,
} from '@data/factories/meetingFactory';


export type SelectedMedium = 'GOOGLE_MEET' | 'OUTLOOK' | 'OFFLINE';

export class MeetingsPage extends BasePage {
  // WHY: Meetings uses higher retries/wait — calendar data loads slower
  private get retryConfig() {
    return config.meetingRetry[config.env as keyof typeof config.meetingRetry];
  }

  // ──────────────────────────────────────────────────────────
  // Locators — List page
  // ──────────────────────────────────────────────────────────

  private readonly addButton = () => this.page.getByRole('button', { name: 'Add' }).first();
  private readonly meetingsList = () => this.page.locator('ul.list-group.list-group-flush');
  private readonly meetingTitleInList = (title: string) =>
    this.page.locator('h2.meeting__title.text-truncate', { hasText: title });
  private readonly meetingDetailTitle = () => this.page.locator('h2.h2.text-break.meeting__title');
  private readonly meetingsHeading = () => this.page.locator('h1.h1', { hasText: 'Meetings' });
  private readonly meetingStatusBadge = (status: string) =>
    this.page.locator('span.meeting__status', { hasText: status });
  private readonly nameFilterInput = () => this.page.locator('input#name');
  private readonly refreshButton = () =>
    this.page.locator('button.btn-action[data-original-title="Refresh"]');

  // ──────────────────────────────────────────────────────────
  // Locators — Sort modal
  // ──────────────────────────────────────────────────────────

  private readonly sortButton = () => this.page.locator('[data-original-title="Sort"]');
  private readonly sortModal = () => this.page.locator('#sortModal');
  private readonly sortDropdownSingleVal = () =>
    this.page.locator('#sortModal').locator('[class*="singleValue"]').first();
  private readonly sortLatestFirstOption = () =>
    this.page.locator('#sortModal').locator('div[class*="option"]', { hasText: 'Latest First' });
  private readonly sortApplyButton = () =>
    this.page.locator('#sortModal').getByText('Apply', { exact: true });

  // ──────────────────────────────────────────────────────────
  // Locators — Meeting form
  // ──────────────────────────────────────────────────────────

  private readonly titleInput = () => this.page.locator('[id="1_11_input_title"]');
  private readonly calendarIcon = () =>
    this.page.locator(
      '.col-6 > #from > div:nth-child(2) > .col-7 > .col-undefined > #from > div > .SingleDatePicker > div > .SingleDatePickerInput > .SingleDatePickerInput_calendarIcon'
    );
  private readonly calendarForwardButton = () =>
    this.page.getByLabel('Move forward to switch to the next month.');
  private readonly calendarDayByLabel = (label: string) =>
    this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);
  private readonly fromTimeClockIcon = () =>
    this.page.locator(
      '.col-6 > #from > div:nth-child(2) > .col-5 > .rc-time-picker > .rc-time-custom-styles'
    );
  private readonly toTimeInput = () => this.page.locator('[id="1_32_input_to_time"]');
  private readonly timezoneInput = () => this.page.locator('[id="1_41_input_timezone"]');
  private readonly statusInput = () => this.page.locator('[id="1_42_input_status"]');
  private readonly inviteesInput = () => this.page.locator('[id="1_61_input_invitees"]');
  private readonly inviteesControl = () => this.inviteesInput().locator('xpath=../../..');
  private readonly inviteesFirstOption = () =>
    this.page.locator('.is-invalid__menu-list .is-invalid__option').first();
  private readonly inviteesContainer = () =>
    this.page.locator('.is-invalid__value-container--is-multi');
  private readonly inviteeCard = (name: string) =>
    this.page.locator('.invitee__name strong', { hasText: name });
  private readonly relatedToInput = () => this.page.locator('[id="1_71_input_relatedTo"]');
  private readonly entitiesDropdown = () =>
    this.page.locator('.entity-lookup').locator('.is-invalid__control').first();
  private readonly relationOptions = () => this.page.locator('.is-invalid__option');
  private readonly mediumInputControl = () =>
    this.page
      .locator('[id="1_81_input_medium"]')
      .locator('xpath=../../..')
      .locator('[class*="single-value"]');
  private readonly mediumInputValue = () => this.page.locator('input[name="medium"]');
  private readonly locationInput = () => this.page.locator('[id="1_81_input_location"]');
  private readonly gpsButton = () => this.page.getByText('Get GPS Address');
  private readonly gpsSearchInput = () =>
    this.page.getByPlaceholder('Search for area, street name');
  private readonly addressPrediction = () => this.page.locator('.autocomplete-prediction').first();
  private readonly calendarWarning = () => this.page.locator('.calendar-suggestion');
  private readonly descriptionEditor = () =>
    this.page.locator('div.ck-editor__editable[role="textbox"]');
  private readonly addMeetingSaveButton = () => this.page.locator('button.save-button').first();
  private readonly editMeetingSaveButton = () => this.page.locator('button.save-button').first();

  // ──────────────────────────────────────────────────────────
  // Locators — Save popup (after create)
  // ──────────────────────────────────────────────────────────

  private readonly meetingIdPopup = () =>
    this.page.locator('span.link-primary').filter({ hasText: 'Meeting ID' });
  private readonly meetingIdPopupFallback = () => this.page.locator('span.link-primary').first();

  // ──────────────────────────────────────────────────────────
  // Locators — Edit modal
  // ──────────────────────────────────────────────────────────

  private readonly editModal = () => this.page.locator('#editEntityModal');
  private readonly rescheduleCalendarIcon = () =>
    this.page.locator(
      '.col-6 > #from > div:nth-child(2) > .col-7 > .col-undefined > #from > div > .SingleDatePicker > div > .SingleDatePickerInput > .SingleDatePickerInput_calendarIcon'
    );

  // ──────────────────────────────────────────────────────────
  // Locators — Ellipsis menu
  // ──────────────────────────────────────────────────────────

  private readonly ellipsisButton = () => this.page.locator('i.far.fa-ellipsis-v').first();
  private readonly dropdownMenu = () => this.page.locator('div.dropdown-menu.show');
  private readonly editOption = () =>
    this.page.locator('div.dropdown-menu.show a.dropdown-item', { hasText: 'Edit' });
  private readonly markConductedOption = () =>
    this.page.locator('div.dropdown-menu.show a.dropdown-item', { hasText: 'Mark as Conducted' });
  private readonly cancelMeetingOption = () =>
    this.page.locator('div.dropdown-menu.show a.dropdown-item', { hasText: 'Cancel meeting' });
  private readonly rescheduleMeetingOption = () =>
    this.page.getByRole('link', { name: 'Reschedule meeting' });
  private readonly confirmButton = () => this.page.locator('#confirm');

  // ──────────────────────────────────────────────────────────
  // Locators — Filter panel
  // ──────────────────────────────────────────────────────────

  private readonly filterActionButton = () => this.page.locator('#filter-action');
  private readonly filterModal = () => this.page.locator('#filterModal');
  private readonly filterClearButton = () => this.page.locator('#clearFilters');
  private readonly filterClearConfirmButton = () =>
    this.page.locator('.modal.show .btn-primary', { hasText: 'Ok' });
  private readonly filterAddInput = () => this.page.getByText('Add a filter', { exact: true });
  private readonly filterIdOption = () =>
    this.page.locator('.select__option').filter({ hasText: /^ID$/ }).first();
  private readonly filterIdRow = () => this.page.locator('#filter-item-id');
  private readonly filterIdInput = () => this.page.locator('#input_id');
  private readonly filterApplyButton = () => this.page.locator('#applyFilterBtn');

  // ──────────────────────────────────────────────────────────
  // Locators — Detail page
  // ──────────────────────────────────────────────────────────

  private readonly detailFieldValue = (label: string) =>
    this.page.locator(`#${label} span.title`).first();

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────

  private async waitForListReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForSelector('ul.list-group.list-group-flush', {
      timeout: config.timeouts.navigation,
    });
    logger.debug('Meetings list is ready');
  }

  private async captureIdFromResponse(): Promise<number | null> {
    try {
      const response = await this.page.waitForResponse(
        (res: Response) => res.url().includes('/v1/meetings') && res.request().method() === 'POST',
        { timeout: 15000 }
      );
      const body = await response.json();
      const id = body?.id ?? null;
      if (id) logger.info(`Captured meeting ID: ${id}`);
      return id;
    } catch {
      logger.warn('Could not capture meeting ID from POST response');
      return null;
    }
  }

  private async retryFindMeetingInList(title: string): Promise<boolean> {
    const { retries, wait } = this.retryConfig;
    for (let attempt = 1; attempt <= retries; attempt++) {
      logger.info(`Looking for meeting "${title}" in list — attempt ${attempt}/${retries}`);
      const found = await this.meetingTitleInList(title)
        .isVisible()
        .catch(() => false);
      if (found) {
        logger.success(`Meeting "${title}" found in list`);
        return true;
      }
      // WHY: Make sure edit modal is closed before navigating
      await this.editModal()
        .waitFor({ state: 'hidden', timeout: 5000 })
        .catch(() => {});
      await this.navigateTo(`${config.appUrl}/sales/meetings/list`);
      await this.waitForListReady();
      await this.sortByLatestFirst().catch(() => logger.warn('Sort failed — continuing'));
      await this.page.waitForTimeout(wait);
    }
    logger.warn(`Meeting "${title}" not found after ${retries} attempts`);
    return false;
  }

  private async openFilterPanel(): Promise<void> {
    logger.info('Opening filter panel');
    const alreadyOpen = await this.filterModal()
      .evaluate((el) => el.classList.contains('show'))
      .catch(() => false);
    if (alreadyOpen) {
      logger.debug('Filter panel already open');
      return;
    }
    // WHY: filter button click can be unreliable on CI — retry up to 3 times
    let filterOpened = false;
    for (let i = 0; i < 3; i++) {
      await this.filterActionButton().click({ force: true });
      try {
        await this.filterModal().waitFor({ state: 'visible', timeout: 10000 });
        filterOpened = true;
        break;
      } catch {
        logger.warn(`Filter panel did not open on attempt ${i + 1}, retrying`);
      }
    }
    if (!filterOpened) throw new Error('Filter panel did not open after 3 attempts');
    await this.page.waitForTimeout(500);
    logger.success('Filter panel opened');
  }

  private async fillDate(daysFromNow: number): Promise<void> {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    logger.info(`Selecting meeting date: ${d.toDateString()}`);
    const dayLabel = formatDateForCalendarLabel(d);

    await this.calendarIcon().click();
    await this.calendarForwardButton().waitFor({ state: 'visible', timeout: 10000 });
    logger.info('Calendar opened');

    const dayCell = this.calendarDayByLabel(dayLabel);
    let found = false;
    let attempts = 0;
    try {
      await dayCell.waitFor({ state: 'visible', timeout: 1500 });
      found = true;
    } catch {
      found = false;
    }
    while (!found && attempts < 24) {
      logger.info(`Navigating forward attempt ${attempts + 1}`);
      await this.calendarForwardButton().click();
      await this.page.waitForTimeout(400);
      try {
        await dayCell.waitFor({ state: 'visible', timeout: 1000 });
        found = true;
      } catch {
        found = false;
      }
      attempts++;
    }
    if (!found) throw new Error(`Date cell not found after ${attempts} navigations: ${dayLabel}`);
    await dayCell.click();
    logger.success(`Meeting date selected: ${d.toDateString()}`);
  }

  private async fillTimePicker(timeConfig: MeetingTimeConfig, type: 'from' | 'to'): Promise<void> {
    const hour = type === 'from' ? timeConfig.fromHour : timeConfig.toHour;
    const minute = type === 'from' ? timeConfig.fromMinute : timeConfig.toMinute;
    const amPm = type === 'from' ? timeConfig.amPmFrom : timeConfig.amPmTo;
    const hourStr = String(hour).padStart(2, '0');
    const minuteStr = String(minute).padStart(2, '0');
    logger.info(`Setting ${type} time to ${hourStr}:${minuteStr} ${amPm}`);

    if (type === 'from') {
      await this.fromTimeClockIcon().click();
    } else {
      await this.toTimeInput().click();
    }
    await this.page.waitForSelector('.rc-time-picker-panel', { timeout: 5000 });

    const columns = this.page.locator('.rc-time-picker-panel:visible .rc-time-picker-panel-select');
    await columns
      .nth(0)
      .locator('li', { hasText: new RegExp(`^${hourStr}$`) })
      .click();
    await this.page.waitForTimeout(200);
    await columns
      .nth(1)
      .locator('li', { hasText: new RegExp(`^${minuteStr}$`) })
      .click();
    await this.page.waitForTimeout(200);
    await columns.nth(2).locator('li', { hasText: amPm }).click();
    await this.page.waitForTimeout(200);

    await this.page.keyboard.press('Escape');
    await this.page
      .waitForSelector('.rc-time-picker-panel', { state: 'hidden', timeout: 3000 })
      .catch(() => {});
    logger.debug(`${type} time set`);
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToMeetingsList(): Promise<void> {
    logger.info('Navigating to meetings list');
    await this.navigateTo(`${config.appUrl}/sales/meetings/list`);
    await this.waitForListReady();
    logger.success('On meetings list page');
  }

  // ──────────────────────────────────────────────────────────
  // Sort
  // ──────────────────────────────────────────────────────────

  async sortByLatestFirst(): Promise<void> {
    logger.info('Sorting meetings by Latest First');
    await this.sortButton().click();
    await this.sortModal().waitFor({ state: 'visible', timeout: 5000 });
    await this.page.waitForTimeout(400);
    // WHY: Click the singleValue text inside the sort dropdown to open it
    await this.sortDropdownSingleVal().waitFor({ state: 'visible', timeout: 5000 });
    await this.sortDropdownSingleVal().click();
    await this.page.waitForTimeout(400);
    await this.sortLatestFirstOption().click();
    await this.page.waitForTimeout(400);
    await this.sortApplyButton().click();
    await this.page.waitForTimeout(1000);
    logger.success('Sorted by Latest First');
  }

  // ──────────────────────────────────────────────────────────
  // Meeting Form
  // ──────────────────────────────────────────────────────────

  async selectMediumWithFallback(): Promise<SelectedMedium> {
    // Randomly pick between Google Meet and Outlook first — then fall back to Offline
    const onlineMediums: Array<{ value: SelectedMedium; label: string }> =
      Math.random() > 0.5
        ? [
            { value: 'GOOGLE_MEET', label: 'Google Meet' },
            { value: 'OUTLOOK', label: 'Outlook Calendar' },
          ]
        : [
            { value: 'OUTLOOK', label: 'Outlook Calendar' },
            { value: 'GOOGLE_MEET', label: 'Google Meet' },
          ];

    for (const medium of onlineMediums) {
      logger.info(`Trying medium: ${medium.label}`);
      await this.mediumInputControl().click();
      await this.page.waitForTimeout(500);
      await this.page.getByText(medium.label, { exact: true }).last().click();
      await this.page.waitForTimeout(1000);

      const newValue = await this.mediumInputValue()
        .inputValue()
        .catch(() => '');
      logger.info(`Medium input value: ${newValue}`);

      const warningVisible = await this.calendarWarning()
        .isVisible()
        .catch(() => false);
      if (!warningVisible) {
        logger.success(`Selected medium: ${medium.label} (value: ${newValue})`);
        return medium.value;
      }
      logger.warn(`${medium.label} - no calendar connected, trying next`);
    }

    // Fall back to Offline
    logger.warn('No online calendar connected — falling back to Offline');
    await this.mediumInputControl().click();
    await this.page.waitForTimeout(500);
    await this.page.getByText('Offline', { exact: true }).last().click();
    await this.page.waitForTimeout(500);
    logger.success('Selected medium: Offline (fallback)');
    return 'OFFLINE';
  }

  async fillLocation(manualAddress: string): Promise<void> {
    logger.info('Filling location field');
    const gpsVisible = await this.gpsButton()
      .isVisible()
      .catch(() => false);
    if (gpsVisible) {
      await this.gpsButton().click();
      await this.page.waitForTimeout(1500);
      const addonDialog = await this.page
        .locator('text=purchase')
        .first()
        .isVisible()
        .catch(() => false);
      if (!addonDialog) {
        const citySearch = manualAddress.split(',')[0].trim().substring(0, 10);
        await this.gpsSearchInput().fill(citySearch);
        await this.page
          .waitForSelector('.autocomplete-prediction', { timeout: 5000 })
          .catch(() => null);
        const predictionsVisible = await this.addressPrediction()
          .isVisible()
          .catch(() => false);
        if (predictionsVisible) {
          await this.addressPrediction().click();
          logger.success('GPS address selected');
          return;
        }
      }
    }
    await this.locationInput().fill(manualAddress);
    logger.info(`Manual address entered: ${manualAddress}`);
  }

  async fillRelatedTo(_isRestrictedUser = false): Promise<void> {
    logger.info('Filling Related To - all entity types');
    const entityTypes = ['Lead', 'Contact', 'Deal', 'Company'];

    for (const entityType of entityTypes) {
      logger.info(`Selecting entity type: ${entityType}`);

      // Step 1: Click Entities dropdown and select entity type
      await this.entitiesDropdown().click();
      await this.page.waitForTimeout(400);
      await this.page.getByText(entityType, { exact: true }).click();
      await this.page.waitForTimeout(500);

      // Step 2: Click Search... to open entity search dropdown
      await this.page.getByText('Search ...').last().click();
      await this.page.waitForTimeout(400);

      // Step 3: Type into relatedTo input
      await this.relatedToInput().fill('   ');
      await this.page.waitForTimeout(1500);

      // Step 4: Wait for options to appear
      try {
        await this.relationOptions().first().waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        // Options not loaded yet — try search terms
        for (const term of ['abc', 'isa', 'rau', 'amb', 'win', 'dea', 'con', 'the', 'inc']) {
          await this.relatedToInput().fill(term);
          await this.page.waitForTimeout(1000);
          const appeared = await this.relationOptions()
            .first()
            .isVisible()
            .catch(() => false);
          if (appeared) {
            logger.info(`Found ${entityType} results with term: "${term}"`);
            break;
          }
          await this.relatedToInput().clear();
          await this.page.waitForTimeout(200);
        }
      }
      const count = await this.relationOptions()
        .count()
        .catch(() => 0);
      logger.info(`Options count for ${entityType}: ${count}`);

      // Step 5: Pick random option
      if (count > 0) {
        const randomIdx = Math.floor(Math.random() * Math.min(count, 5));
        const selectedOption = this.relationOptions().nth(randomIdx);
        const optionText = await selectedOption.textContent();
        await selectedOption.click();
        await this.page.waitForTimeout(300);
        await this.relatedToInput().press('Enter');
        logger.success(`Selected ${entityType} (${randomIdx + 1}/${count}): ${optionText?.trim()}`);
      } else {
        logger.warn(`No ${entityType} records found - skipping`);
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(600);
    }
  }

  async fillMeetingForm(
    data: MeetingData,
    createdBy = 'Admin',
    addInvitee = true,
    skipRelatedTo = false
  ): Promise<void> {
    logger.info(`Filling meeting form title: "${data.title}"`);
    await this.fill(this.titleInput(), data.title, 'Meeting title');
    await this.fillDate(3);
    await this.fillTimePicker(data.timeConfig, 'from');
    await this.fillTimePicker(data.timeConfig, 'to');

    // Timezone already defaults to GMT+05:30 — no action needed
    logger.info('Timezone left as default GMT+05:30');
    // Status already defaults to Scheduled — no action needed
    logger.info('Status left as default Scheduled');

    // Creator is auto-added — optionally add another invitee
    if (addInvitee) {
      await this.inviteesControl().click();
      await this.inviteesFirstOption().waitFor({ state: 'visible', timeout: 10000 });
      await this.page.waitForTimeout(300);
      await this.inviteesFirstOption().click();
      logger.info(`Invitee added by ${createdBy}`);
    } else {
      logger.info('Skipping invitee — no extra invitee added');
    }

    // WHY: skipRelatedTo=true for RBAC "not invited" tests — if Related To
    // contains entities owned by the restricted user, Kylas grants them access
    // to the meeting regardless of invitee status. Skip relations entirely
    // to ensure the only access path is the invitee list.
    if (!skipRelatedTo) {
      await this.fillRelatedTo(createdBy === 'Restricted');
    } else {
      logger.info('Skipping Related To — skipRelatedTo=true');
    }

    const selectedMedium = await this.selectMediumWithFallback();
    logger.info(`Medium resolved to: ${selectedMedium}`);

    await this.fillLocation(data.location);

    await this.descriptionEditor().click();
    await this.descriptionEditor().fill(`${data.description} - Created by ${createdBy}`);
    logger.info('Description filled');
  }

  async saveMeeting(): Promise<number | null> {
    logger.info('Saving meeting');
    const idPromise = this.captureIdFromResponse();
    await this.addMeetingSaveButton().click();
    await this.assertNoFormErrors('meeting create form');
    const id = await idPromise;
    await this.page.waitForTimeout(1500);

    // WHY: After save a popup appears with span.link-primary containing meeting ID
    try {
      await this.meetingIdPopup().waitFor({ state: 'visible', timeout: 5000 });
      await this.meetingIdPopup().click();
      await this.page.waitForTimeout(1000);
      logger.success('Clicked meeting popup');
    } catch {
      try {
        await this.meetingIdPopupFallback().waitFor({ state: 'visible', timeout: 3000 });
        await this.meetingIdPopupFallback().click();
        await this.page.waitForTimeout(1000);
        logger.success('Clicked meeting popup (fallback)');
      } catch {
        logger.warn('Meeting popup not found — navigating to meetings list');
        await this.navigateTo(`${config.appUrl}/sales/meetings/list`);
        await this.waitForListReady();
      }
    }
    return id;
  }

  // ──────────────────────────────────────────────────────────
  // Search & Open
  // ──────────────────────────────────────────────────────────

  async searchMeetingInList(title: string): Promise<void> {
    logger.info(`Searching for meeting by name: "${title}"`);
    const nameVisible = await this.nameFilterInput()
      .isVisible()
      .catch(() => false);
    if (nameVisible) {
      await this.nameFilterInput().fill(title);
      await this.page.waitForTimeout(1000);
    }
  }

  async openMeetingFromList(title: string): Promise<void> {
    logger.info(`Opening meeting from list: "${title}"`);
    await this.meetingTitleInList(title).waitFor({
      state: 'visible',
      timeout: config.timeouts.navigation,
    });
    await this.meetingTitleInList(title).click();
    await this.page.waitForTimeout(800);
    logger.success(`Meeting "${title}" opened`);
  }

  async searchMeetingById(meetingId: number): Promise<void> {
    // WHY: Navigate directly to ?id=<meetingId> — native app URL pattern.
    // Filter panel approach was unreliable: detail panel intercepts filter button clicks.
    logger.info(`Navigating to meeting by ID: ${meetingId}`);
    await this.navigateTo(`${config.appUrl}/sales/meetings/list?id=${meetingId}`);
    await this.waitForListReady();
    await this.meetingDetailTitle().waitFor({
      state: 'visible',
      timeout: config.timeouts.navigation,
    });
    logger.success(`Meeting ID ${meetingId} confirmed via direct URL navigation`);
  }

  // ──────────────────────────────────────────────────────────
  // Ellipsis Menu Actions
  // ──────────────────────────────────────────────────────────

  async openEllipsisMenu(): Promise<void> {
    await this.ellipsisButton().click();
    await this.dropdownMenu().waitFor({ state: 'visible', timeout: 5000 });
  }

  async clickEditFromMenu(): Promise<void> {
    await this.openEllipsisMenu();
    await this.editOption().click();
    await this.page.waitForLoadState('domcontentloaded');
    logger.success('Edit form opened');
  }

  async markAsConducted(): Promise<void> {
    logger.info('Marking meeting as Conducted via ellipsis menu');
    await this.openEllipsisMenu();
    await this.markConductedOption().click();
    await this.page.waitForTimeout(1000);
    logger.success('Meeting marked as Conducted');
  }

  async cancelMeeting(): Promise<void> {
    logger.info('Cancelling meeting via ellipsis menu');
    await this.openEllipsisMenu();
    await this.cancelMeetingOption().click();
    await this.page.waitForTimeout(500);
    // WHY: Confirm cancellation popup
    const confirmVisible = await this.confirmButton()
      .isVisible()
      .catch(() => false);
    if (confirmVisible) {
      await this.confirmButton().click();
      logger.info('Confirmed cancellation popup');
    }
    await this.page.waitForTimeout(1000);
    logger.success('Meeting cancelled');
  }

  async changeStatusViaEllipsis(): Promise<'Conducted' | 'Cancelled'> {
    const action = Math.random() > 0.5 ? 'conducted' : 'cancelled';
    if (action === 'conducted') {
      await this.markAsConducted();
      return 'Conducted';
    } else {
      await this.cancelMeeting();
      return 'Cancelled';
    }
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async fillEditForm(newTitle: string, newStatus?: string, newDescription?: string): Promise<void> {
    logger.info(`Editing meeting new title: "${newTitle}"`);
    await this.titleInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    await this.titleInput().fill('');
    await this.titleInput().fill(newTitle);
    // WHY: Status is changed via ellipsis menu (markAsConducted/cancelMeeting) — NOT in edit form
    if (newDescription) {
      await this.descriptionEditor().click();
      await this.page.keyboard.press('Control+a');
      await this.descriptionEditor().fill(newDescription);
    }
  }

  async saveEditedMeeting(): Promise<void> {
    logger.info('Saving edited meeting');
    await this.editMeetingSaveButton().click();
    // WHY: Wait for edit modal to close before proceeding
    await this.editModal()
      .waitFor({ state: 'hidden', timeout: 10000 })
      .catch(() => {});
    await this.page.waitForTimeout(1000);
    logger.success('Meeting edit saved');
  }

  async rescheduleMeeting(title: string): Promise<void> {
    logger.info(`Rescheduling meeting: "${title}"`);
    const found = await this.retryFindMeetingInList(title);
    if (!found) throw new Error(`Cannot reschedule: meeting "${title}" not found`);
    await this.openMeetingFromList(title);

    await this.openEllipsisMenu();
    await this.rescheduleMeetingOption().click();
    await this.page.waitForLoadState('domcontentloaded');
    logger.info('Reschedule form opened');

    // Select next day — 1 day after currently selected date
    await this.rescheduleCalendarIcon().click();
    await this.calendarForwardButton().waitFor({ state: 'visible', timeout: 10000 });

    const d = new Date();
    d.setDate(d.getDate() + 4);
    const dayLabel = formatDateForCalendarLabel(d);
    const dayCell = this.calendarDayByLabel(dayLabel);
    let found2 = false;
    let attempts = 0;
    try {
      await dayCell.waitFor({ state: 'visible', timeout: 1500 });
      found2 = true;
    } catch {
      found2 = false;
    }
    while (!found2 && attempts < 24) {
      await this.calendarForwardButton().click();
      await this.page.waitForTimeout(400);
      try {
        await dayCell.waitFor({ state: 'visible', timeout: 1000 });
        found2 = true;
      } catch {
        found2 = false;
      }
      attempts++;
    }
    if (!found2) throw new Error(`Date cell not found for reschedule: ${dayLabel}`);
    await dayCell.click();
    logger.success(`Reschedule date selected: ${d.toDateString()}`);

    await this.editMeetingSaveButton().click();
    // WHY: Wait for edit modal to close — prevents next action failing
    await this.editModal()
      .waitFor({ state: 'hidden', timeout: config.timeouts.navigation })
      .catch(() => {});
    await this.page.waitForTimeout(500);
    logger.success(`Meeting "${title}" rescheduled`);
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnMeetingsPage(): Promise<void> {
    await this.assertUrl(/\/sales\/meetings\/list/);
    await this.assertVisible(
      this.meetingsHeading(),
      'Meetings heading',
      config.timeouts.navigation
    );
    await this.assertVisible(this.addButton(), 'Add button');
    logger.success('Confirmed on meetings list page');
  }

  async assertMeetingInList(title: string, meetingId?: number | null): Promise<void> {
    // WHY: If ID is available use searchMeetingById — bypasses unreliable list search
    if (meetingId) {
      logger.info(`Verifying meeting via ID: ${meetingId}`);
      await this.searchMeetingById(meetingId);
      logger.success(`Meeting verified via ID: ${meetingId}`);
      return;
    }
    const alreadyVisible = await this.meetingTitleInList(title)
      .isVisible()
      .catch(() => false);
    if (alreadyVisible) {
      logger.success(`Meeting "${title}" confirmed in list`);
      return;
    }
    const currentUrl = this.page.url();
    if (currentUrl.includes('/sales/meetings/list')) {
      await this.sortByLatestFirst().catch(() => {});
      const visibleAfterSort = await this.meetingTitleInList(title)
        .isVisible()
        .catch(() => false);
      if (visibleAfterSort) {
        logger.success(`Meeting "${title}" confirmed in list after sort`);
        return;
      }
    }
    await this.navigateTo(`${config.appUrl}/sales/meetings/list`);
    await this.waitForListReady();
    await this.sortByLatestFirst().catch(() => {});
    const found = await this.retryFindMeetingInList(title);
    if (!found) throw new Error(`Meeting "${title}" was not found in the list after retries`);
    logger.success(`Meeting "${title}" confirmed in list`);
  }

  async assertMeetingDetailTitle(title: string): Promise<void> {
    await this.meetingDetailTitle().waitFor({
      state: 'visible',
      timeout: config.timeouts.navigation,
    });
    const text = await this.meetingDetailTitle().textContent();
    if (!text?.includes(title))
      throw new Error(`Detail title "${text}" does not contain "${title}"`);
    logger.success(`Meeting detail title confirmed: "${text}"`);
  }

  async assertMeetingDetailField(fieldId: string, expectedValue: string): Promise<void> {
    const field = this.detailFieldValue(fieldId);
    await field.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    const text = await field.textContent();
    if (!text?.includes(expectedValue))
      throw new Error(`Field "${fieldId}" = "${text}" does not contain "${expectedValue}"`);
    logger.success(`Field "${fieldId}" confirmed`);
  }

  async assertInviteeVisible(name: string): Promise<void> {
    await this.assertVisible(this.inviteeCard(name), `Invitee card for ${name}`);
    logger.success(`Invitee "${name}" confirmed`);
  }

  async assertMeetingNotInList(title: string, meetingId?: number | null): Promise<void> {
    if (meetingId) {
      // WHY: Navigate directly to the meeting URL as the restricted user.
      // App shows "No meetings found" p.title when restricted user has no access.
      // Wait for the list to fully load (not skeleton) before checking.
      logger.info(`Asserting meeting ID ${meetingId} not accessible to current user`);
      await this.navigateTo(`${config.appUrl}/sales/meetings/list?id=${meetingId}`);
      await this.page
        .waitForLoadState('networkidle', { timeout: config.timeouts.navigation })
        .catch(() => null);
      // WHY: Wait for skeleton loaders to disappear — skeleton uses the same
      // list container, so waitForListReady alone is not sufficient.
      // Wait for either "No meetings found" OR the meeting title to appear.
      await Promise.race([
        this.page
          .locator('p.title', { hasText: 'No meetings found' })
          .waitFor({ state: 'visible', timeout: 15000 }),
        this.meetingDetailTitle().waitFor({ state: 'visible', timeout: 15000 }),
      ]).catch(() => null);
      const blocked = await this.page
        .locator('p.title', { hasText: 'No meetings found' })
        .isVisible()
        .catch(() => false);
      if (!blocked)
        throw new Error(
          `Meeting ID ${meetingId} should NOT be accessible but detail panel is visible`
        );
      logger.success(`Meeting ID ${meetingId} correctly blocked — "No meetings found" confirmed`);
      return;
    }
    // Fallback: name-based search when ID not available
    await this.searchMeetingInList(title);
    await this.page.waitForTimeout(1500);
    const visible = await this.meetingTitleInList(title)
      .isVisible()
      .catch(() => false);
    if (visible) throw new Error(`Meeting "${title}" should NOT be visible but it is`);
    logger.success(`Meeting "${title}" correctly not visible`);
  }

  async assertEditOptionNotInMenu(): Promise<void> {
    await this.openEllipsisMenu();
    const editVisible = await this.editOption()
      .isVisible()
      .catch(() => false);
    if (editVisible) throw new Error('Edit option should NOT be visible for restricted user');
    logger.success('Edit option correctly absent');
  }

  async assertEditOptionInMenu(): Promise<void> {
    await this.openEllipsisMenu();
    await this.assertVisible(this.editOption(), 'Edit option in dropdown');
    await this.page.keyboard.press('Escape');
    logger.success('Edit option confirmed in menu');
  }

  async assertMeetingStatus(expectedStatus: string): Promise<void> {
    logger.info(`Asserting meeting status: ${expectedStatus}`);
    await this.meetingStatusBadge(expectedStatus).waitFor({
      state: 'visible',
      timeout: config.timeouts.navigation,
    });
    logger.success(`Meeting status confirmed: ${expectedStatus}`);
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createMeeting(
    data: MeetingData,
    createdBy = 'Admin',
    addInvitee = true,
    skipRelatedTo = false
  ): Promise<number | null> {
    logger.info(`Creating meeting: "${data.title}" as ${createdBy}`);
    await this.click(this.addButton(), 'Add button');
    // WHY: On GHA the form sometimes does not open on first click — retry up to 3 times
    let formOpened = false;
    for (let i = 0; i < 3; i++) {
      try {
        await this.titleInput().waitFor({ state: 'visible', timeout: 15000 });
        formOpened = true;
        break;
      } catch {
        logger.warn(`Meeting form did not open on attempt ${i + 1}, retrying Add button click`);
        await this.click(this.addButton(), 'Add button retry');
      }
    }
    if (!formOpened) throw new Error('Meeting form did not open after 3 attempts');
    await this.fillMeetingForm(data, createdBy, addInvitee, skipRelatedTo);
    const meetingId = await this.saveMeeting();
    logger.success(`Meeting "${data.title}" created`);
    return meetingId;
  }

  async updateMeeting(
    newTitle: string,
    originalTitle: string,
    newStatus?: string,
    newDescription?: string
  ): Promise<void> {
    logger.info(`Updating meeting "${originalTitle}" to "${newTitle}"`);
    const found = await this.retryFindMeetingInList(originalTitle);
    if (!found) throw new Error(`Cannot update: meeting "${originalTitle}" not found`);
    await this.openMeetingFromList(originalTitle);
    await this.clickEditFromMenu();
    await this.fillEditForm(newTitle, newStatus, newDescription);
    await this.saveEditedMeeting();
    logger.success(`Meeting updated to "${newTitle}"`);
  }
}
