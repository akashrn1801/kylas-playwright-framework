import { Page, Response, expect } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { logger } from '@utils/logger';
import { config } from '@config/config';
import {
  CallLogData,
  formatDateForCalendarLabel,
} from '@data/factories/callLogFactory';

// ─────────────────────────────────────────────────────────────────────────────
// CallLogsPage
// Architecture: Split-view (list left, detail right) — same as Tasks/Meetings
// URL pattern:  /sales/calls/list
//               /sales/calls/list?id=<callLogId>
// ─────────────────────────────────────────────────────────────────────────────

export class CallLogsPage extends BasePage {

  // ──────────────────────────────────────────────────────────
  // Retry Config
  // ──────────────────────────────────────────────────────────

  // WHY: Centralised in config.searchRetry — single place to tune retry behaviour
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // Locators — List page
  // ──────────────────────────────────────────────────────────

  private readonly logACallButton = () =>
    this.page.locator('button.btn.btn-primary', { hasText: 'Log a call' });

  private readonly callLogList = () =>
    this.page.locator('ul.list-group.list-group-flush');

  private readonly callLogListItem = () =>
    this.page.locator('li.list-group-item');

  private readonly callLogListItemById = (id: number) =>
    this.page.locator(`li.list-group-item input#check_${id}`).locator('xpath=ancestor::li');

  private readonly searchInput = () =>
    this.page.locator('#fulltext-search');

  // ──────────────────────────────────────────────────────────
  // Locators — Create / Edit form
  // ──────────────────────────────────────────────────────────

  // Entity type React Select
  private readonly entityTypeInput = () =>
    this.page.locator('[id="1_11_input_entityType"]');

  private readonly entityTypeControl = () =>
    // WHY: entity type React Select — click the is-invalid__control ancestor to open dropdown
    this.page.locator('[id="1_11_input_entityType"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Associated entity search (Lead/Contact/Deal)
  private readonly associatedEntityInput = () =>
    // WHY: Before entity type selected, ID is 1_12_input_relatedEntityIdName.
    // After entity type selected, ID changes to 'associatedEntity'.
    // Use the is-invalid__control ancestor which is stable throughout.
    this.page.locator('#callLogModal').locator('[id="1_12_input_relatedEntityIdName"], [id="associatedEntity"]').first();

  // WHY: Deal flow — Associated Contact has different input id
  private readonly associatedContactForDealInput = () =>
    this.page.locator('[id="associatedEntity"]');

  // Recording file input and display
  private readonly recordingFileInput = () =>
    this.page.locator('[id="1_51_input_callRecording"]');
  private readonly recordingFileDisplay = () =>
    this.page.locator('#recordingFile');
  private readonly recordingCard = () =>
    this.page.locator('.recording-card .card-header div').first();
  // Phone number React Select (Lead/Contact flow)
  private readonly phoneNumberInput = () =>
    // WHY: Phone number is a plain text input in the modal
    this.page.locator('[id="1_21_input_callLogPhoneNumber"]');

  private readonly phoneNumberControl = () =>
    // WHY: Phone is plain input — use parent search-autocomplete div
    this.page.locator('.search-autocomplete').locator('[id="1_21_input_callLogPhoneNumber"]').locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // WHY: Deal flow — phone field is disabled (auto-populated from contact)
  private readonly phoneNumberDisabled = () =>
    this.page.locator('[id="1_21_input_callLogPhoneNumber"]');

  // Type React Select
  private readonly callTypeInput = () =>
    this.page.locator('[id="1_31_input_callType"]');

  private readonly callTypeControl = () =>
    this.callTypeInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Outcome React Select
  private readonly outcomeInput = () =>
    this.page.locator('[id="1_32_input_outcome"]');

  private readonly outcomeControl = () =>
    this.outcomeInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Duration container — used to check enabled/disabled state
  private readonly durationContainer = () =>
    this.page.locator('.is-invalid__control').filter({
      has: this.page.locator('input[placeholder="Select Duration In"]'),
    }).first();

  // Date picker
  private readonly dateInput = () =>
    this.page.locator('[id="undefined__input_callLogDate"]');

  private readonly calendarIcon = () =>
    // WHY: Scope to modal — page has 2 calendar icons (modal + list page filter)
    this.page.locator('#callLogModal').locator('button.SingleDatePickerInput_calendarIcon').first();

  private readonly calendarForwardButton = () =>
    this.page.getByLabel('Move forward to switch to the next month.');

  private readonly calendarDayByLabel = (label: string) =>
    this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);

  // Time picker
  private readonly timePickerIcon = () =>
    this.page.locator('span.rc-time-picker-icon');

  // Disposition React Select
  private readonly dispositionInput = () =>
    this.page.locator('[id="1_52_input_callDisposition"]');

  private readonly dispositionControl = () =>
    this.dispositionInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Overall Sentiment React Select
  private readonly sentimentInput = () =>
    this.page.locator('[id="2_21_input_overallSentiment"]');

  private readonly sentimentControl = () =>
    this.sentimentInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Customer Emotion Multi-select
  private readonly customerEmotionInput = () =>
    this.page.locator('[id="2_22_input_customerEmotion"]');

  private readonly customerEmotionControl = () =>
    this.customerEmotionInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');

  // Call Summary textarea
  private readonly callSummaryTextarea = () =>
    this.page.locator('[id="2_11_input_callSummary"]');

  // Notes textarea (inside create form)
  private readonly notesTextarea = () =>
    this.page.locator('textarea.notes-textarea');

  private readonly notesAddButton = () =>
    // WHY: Observer confirms class is 'btn mr2 btn-primary d-block my-2'
    this.page.locator('#callLogModal .btn.mr2.btn-primary.d-block.my-2');

  // Save button
  private readonly saveButton = () =>
    this.page.locator('button#submit[type="submit"]');

  // ──────────────────────────────────────────────────────────
  // Locators — Toaster
  // ──────────────────────────────────────────────────────────

  private readonly successToaster = () =>
    this.page.locator('div.toastr.animated.rrt-success');

  private readonly toasterCallLogIdLink = () =>
    this.page.locator('div.toastr.animated.rrt-success .rrt-middle-container .link-primary');

  // ──────────────────────────────────────────────────────────
  // Locators — Detail panel
  // ──────────────────────────────────────────────────────────

  // WHY: Entity heading on detail — shows lead/contact/deal name as clickable link
  private readonly detailEntityHeading = () =>
    this.page.locator('h2.h2.mb-0.text-break.call-log-entity');

  private readonly detailEntityLink = () =>
    this.detailEntityHeading().locator('a.link-primary');

  // WHY: Edit button on detail panel header uses data-original-title="Edit"
  private readonly detailEditButton = () =>
    this.page.locator('button[data-original-title="Edit"]');

  // WHY: Owner field on detail panel
  private readonly ownerField = () =>
    this.page.locator('#owner');

  // Outcome label on detail
  private readonly detailOutcomeLabel = () =>
    this.page.locator('#outcomeLabel').first();

  // ──────────────────────────────────────────────────────────
  // Locators — Notes on detail panel (CKEditor)
  // ──────────────────────────────────────────────────────────

  private readonly detailNotesEditor = () =>
    this.page.getByRole('textbox', { name: /Rich Text Editor, main/i });

  private readonly detailNotesAddButton = () =>
    this.page.getByRole('button', { name: 'Add' });

  private readonly viewCallNotesButton = () =>
    this.page.getByText('View Call Notes', { exact: true });

  private readonly noteIframes = () =>
    this.page.locator('.note-text-container iframe');

  // ──────────────────────────────────────────────────────────
  // Locators — Entity productivity section (cross-module)
  // ──────────────────────────────────────────────────────────

  private readonly callLogsProductivityButton = () =>
    this.page.locator("button[data-original-title='Call Logs'] svg");

  private readonly productivityCallLogList = () =>
    this.page.locator('ul.list-unstyled.mb-0.card-list.list-bordered');

  private readonly productivityCallLogItem = () =>
    this.productivityCallLogList().locator('li.media');

  private readonly productivityOutcomeLabel = () =>
    this.page.locator('#outcomeLabel').first();

  private readonly productivityLoggedBy = () =>
    this.page.locator('.call-body', { hasText: 'Logged By:' }).first();

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Private Helpers
  // ──────────────────────────────────────────────────────────

  // WHY: This form is highly reactive — every field changes the DOM.
  // Use JS mousedown on value-container to open ANY React Select in this form.
  // Works regardless of DOM re-renders because we anchor on stable input IDs.
  private async openDropdownById(inputId: string): Promise<void> {
    // WHY: Modal has aria-hidden="true" which blocks Playwright clicks
    // Remove aria-hidden before interaction using page.evaluate (runs in browser)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    await this.page.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    await this.page.evaluate(([id]: [string]) => {
      /* eslint-disable */
      const modal = (document as any).querySelector('#callLogModal');
      const input = modal?.querySelector(`[id="${id}"]`);
      if (!input) return;
      let el = input.parentElement;
      while (el) {
        if ((el as any).className?.includes('is-invalid__value-container')) {
          (el as any).dispatchEvent(new (window as any).MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          return;
        }
        el = (el as any).parentElement;
      }
      /* eslint-enable */
    }, [inputId] as [string]);
    await this.page.waitForTimeout(400);
  }

  private async selectFromDropdown(inputId: string, optionText: string): Promise<void> {
    logger.info(`Opening dropdown for: ${inputId}`);
    await this.openDropdownById(inputId);
    const menu = this.page.locator('.is-invalid__menu');
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    // WHY: Click option via JS to avoid aria-hidden blocking
    await menu.locator('.is-invalid__option', { hasText: optionText }).first().click({ force: true });
    await this.page.waitForTimeout(300);
    logger.success(`Selected "${optionText}" from ${inputId}`);
  }

  private async waitForListReady(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    // WHY: /v1/call-logs/search returns 404 on QA — wait for DOM only
    await this.callLogList()
      .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
      .catch(() => null);
    logger.debug('Call Logs list is ready');
  }

  // WHY: ID capture from toaster — POST response does not return call log ID
  // Toaster shows "(Call Log ID: 163152)" — extract number from link-primary span
  private async captureIdFromToast(): Promise<number | null> {
    try {
      const toastLink = this.toasterCallLogIdLink();
      await toastLink.waitFor({ state: 'visible', timeout: 15000 });
      const text = await toastLink.textContent();
      const match = text?.match(/Call Log ID:\s*(\d+)/);
      if (match) {
        const id = parseInt(match[1]);
        logger.success(`Captured call log ID from toaster: ${id}`);
        return id;
      }
      logger.warn(`Toaster text did not match expected pattern: "${text}"`);
      return null;
    } catch {
      logger.warn('Could not capture call log ID from toaster');
      return null;
    }
  }

  // WHY: React Select — click control div to open, then click first visible option
  // Used for dropdowns where we select random from live options
  private async selectRandomFromReactSelect(
    controlLocator: ReturnType<typeof this.page.locator>,
    description: string
  ): Promise<string> {
    // WHY: aria-hidden blocks normal click — use force click on control
    await controlLocator.waitFor({ state: 'visible', timeout: 10000 });
    await controlLocator.click({ force: true });
    await this.page.waitForTimeout(500);
    const options = this.page.locator('.is-invalid__option');
    await options.first().waitFor({ state: 'visible', timeout: 5000 });
    const count = await options.count();
    const idx = Math.floor(Math.random() * count);
    const selectedText = (await options.nth(idx).textContent()) ?? '';
    await options.nth(idx).click({ force: true });
    logger.success(`Selected random "${description}": ${selectedText.trim()}`);
    return selectedText.trim();
  }

  // WHY: Multi-select React Select — open, select one or two random options
  private async selectRandomFromMultiReactSelect(
    controlLocator: ReturnType<typeof this.page.locator>,
    description: string,
    count = 1
  ): Promise<string[]> {
    // WHY: aria-hidden blocks Playwright clicks on options
    // Use JS evaluate to get all option texts, then click each by text via JS
    await this.openDropdownById('2_22_input_customerEmotion');
    await this.page.waitForTimeout(400);
    // Get all option texts from the open menu
    const optionTexts = await this.page.evaluate(() => {
      const opts = document.querySelectorAll('.is-invalid__option');
      return Array.from(opts).map(o => o.textContent?.trim() ?? '');
    });
    if (optionTexts.length === 0) throw new Error('No Customer Emotion options found');
    // Pick random indices
    const indices = new Set<number>();
    while (indices.size < Math.min(count, optionTexts.length)) {
      indices.add(Math.floor(Math.random() * optionTexts.length));
    }
    const selected: string[] = [];
    for (const idx of [...indices]) {
      const text = optionTexts[idx];
      // Click option via JS evaluate
      await this.page.evaluate((optText: string) => {
        const opts = document.querySelectorAll('.is-invalid__option');
        for (const opt of Array.from(opts)) {
          if (opt.textContent?.trim() === optText) {
            (opt as HTMLElement).click();
            return;
          }
        }
      }, text);
      selected.push(text);
      await this.page.waitForTimeout(300);
      // Re-open for next selection if needed
      if (selected.length < indices.size) {
        await this.openDropdownById('2_22_input_customerEmotion');
        await this.page.waitForTimeout(300);
      }
    }
    // Close menu
    await this.page.evaluate('document.querySelector("#callLogModal")?.click()');
    await this.page.waitForTimeout(200);
    logger.success(`Selected random "${description}": ${selected.join(', ')}`);
    return selected;
  }

  // WHY: Entity search — use openDropdownById to bypass aria-hidden
  private async searchAndSelectEntity(
    inputLocator: ReturnType<typeof this.page.locator>,
    description: string,
    searchTerm?: string
  ): Promise<string> {
    // WHY: Associated entity field — use page.mouse.click on input coordinates
    // focus+keydown works in DevTools but not in Playwright context due to form re-render timing
    const inputId = await inputLocator.getAttribute('id').catch(() => null);
    const resolvedId = inputId ?? '1_12_input_relatedEntityIdName';
    // WHY: Use page.mouse.click on exact input coordinates to open dropdown
    // Retries up to 3 times if menu doesn't open
    const resolvedInputId = resolvedId;
    let menuOpen = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const coords = await this.page.evaluate((id: string) => {
        const modal = document.querySelector('#callLogModal');
        const input = modal?.querySelector(`[id="${id}"]`);
        if (!input) return null;
        const rect = input.getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      }, resolvedInputId);
      if (coords) {
        await this.page.mouse.click(coords.x, coords.y);
      } else {
        await inputLocator.click({ force: true });
      }
      await this.page.waitForTimeout(600);
      menuOpen = await this.page.locator('.is-invalid__menu').isVisible().catch(() => false);
      logger.debug(`Associated entity dropdown open: ${menuOpen} (attempt ${attempt + 1}, inputId: ${resolvedInputId})`);
      if (menuOpen) break;
      await this.page.waitForTimeout(500);
    }
    // WHY: Wait for options to load in portal — admin has more leads, takes ~2s
    // Poll until options appear in DOM
    let optCount = 0;
    for (let i = 0; i < 10; i++) {
      optCount = await this.page.evaluate(() => document.querySelectorAll('.is-invalid__option').length);
      if (optCount > 0) break;
      await this.page.waitForTimeout(500);
    }
    logger.debug(`Options loaded: ${optCount}`);
    if (searchTerm) {
      // WHY: Use last word of name for search — full name may not filter correctly
      // e.g. "ADM1781854620513 Nienow" → search "Nienow"
      const searchQuery = searchTerm.trim().split(' ').pop() ?? searchTerm;
      logger.debug(`Typing search query: "${searchQuery}" (from: "${searchTerm}")`);
      await this.page.keyboard.type(searchQuery, { delay: 50 });
      // WHY: Poll for filtered options after typing
      let filteredCount = 0;
      for (let i = 0; i < 10; i++) {
        filteredCount = await this.page.evaluate(() => document.querySelectorAll('.is-invalid__option').length);
        if (filteredCount > 0) break;
        await this.page.waitForTimeout(500);
      }
      logger.debug(`Filtered options after typing: ${filteredCount}`);
    }
    // WHY: Click option via JS evaluate — bypasses Playwright visibility check
    const selectedText = await this.page.evaluate((term: string | null) => {
      const opts = document.querySelectorAll('.is-invalid__option');
      if (opts.length === 0) return null;
      if (term) {
        // Find option matching search term
        for (const opt of Array.from(opts)) {
          if (opt.textContent?.toLowerCase().includes(term.toLowerCase())) {
            (opt as HTMLElement).click();
            return opt.textContent?.trim() ?? '';
          }
        }
        // Fallback: click first option
        (opts[0] as HTMLElement).click();
        return opts[0].textContent?.trim() ?? '';
      }
      // No search term — pick random from first 5, skip ADM-prefixed options
      const nonAdmOpts = Array.from(opts).filter(o => !o.textContent?.trim().startsWith('ADM'));
      const pool = nonAdmOpts.length > 0 ? nonAdmOpts : Array.from(opts).slice(0, 5);
      const idx = Math.floor(Math.random() * Math.min(pool.length, 5));
      (pool[idx] as HTMLElement).click();
      return pool[idx].textContent?.trim() ?? '';
    }, searchTerm ?? null);
    if (!selectedText) throw new Error(`No ${description} options found in dropdown`);
    await this.page.waitForTimeout(300);
    logger.success(`Selected ${description}: ${selectedText.trim()}`);
    return selectedText.trim();
  }

  // WHY: SingleDatePicker — navigate calendar month by month to find target day
  // Same pattern as MeetingsPage.fillDate
  private async selectDateInPicker(date: Date): Promise<void> {
    const dayLabel = formatDateForCalendarLabel(date);
    logger.info(`Selecting date: ${date.toDateString()} (label: ${dayLabel})`);
    await this.calendarIcon().click();
    await this.calendarForwardButton().waitFor({ state: 'visible', timeout: 10000 });
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
      const backButton = this.page.getByLabel('Move backward to switch to the previous month.');
      const backVisible = await backButton.isVisible().catch(() => false);
      if (backVisible) {
        await backButton.click();
      } else {
        await this.calendarForwardButton().click();
      }
      await this.page.waitForTimeout(400);
      try {
        await dayCell.waitFor({ state: 'visible', timeout: 1000 });
        found = true;
      } catch {
        found = false;
      }
      attempts++;
    }
    if (!found) {
      logger.warn(`Date cell not found after ${attempts} navigations — falling back to direct input`);
      await this.page.keyboard.press('Escape');
      await this.dateInput().click({ clickCount: 3 });
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      await this.dateInput().fill(`${mm}/${dd}/${yyyy}`);
      await this.page.keyboard.press('Tab');
    } else {
      await dayCell.click();
    }
    logger.success(`Date selected: ${date.toDateString()}`);
  }

  // WHY: rc-time-picker panel — click icon to open, select hour/minute/second/ampm columns
  // Same pattern as MeetingsPage.fillTimePicker
  private async selectTimeInPicker(
    hour: number,
    minute: number,
    second: number,
    amPm: 'am' | 'pm'
  ): Promise<void> {
    const hourStr = String(hour).padStart(2, '0');
    const minuteStr = String(minute).padStart(2, '0');
    const secondStr = String(second).padStart(2, '0');
    logger.info(`Selecting time: ${hourStr}:${minuteStr}:${secondStr} ${amPm}`);
    // WHY: Use INPUT#time click to open time picker (more reliable than icon)
    await this.page.locator('input#time').click({ force: true });
    await this.page.waitForSelector('.rc-time-picker-panel', { timeout: 5000 });
    // WHY: Use page.evaluate to scroll and click li items inside the panel
    // avoids "outside viewport" error since panel renders outside modal scroll area
    const timeValues = [hourStr, minuteStr, secondStr, amPm];
    for (let colIdx = 0; colIdx < 4; colIdx++) {
      const val = timeValues[colIdx];
      await this.page.evaluate(([col, value]: [number, string]) => {
        /* eslint-disable */
        const panels = (document as any).querySelectorAll('.rc-time-picker-panel-select');
        const panel = panels[col];
        if (!panel) return;
        const items = panel.querySelectorAll('li');
        for (const item of items) {
          if (item.textContent?.trim() === value) {
            item.scrollIntoView({ block: 'center' });
            item.click();
            return;
          }
        }
        /* eslint-enable */
      }, [colIdx, val] as [number, string]);
      await this.page.waitForTimeout(200);
    }
    await this.page.waitForTimeout(300);
    // WHY: Click outside to close picker and confirm
    await this.page.locator('#callLogModal').click({ force: true, position: { x: 10, y: 10 } });
    await this.page
      .waitForSelector('.rc-time-picker-panel', { state: 'hidden', timeout: 3000 })
      .catch(() => {});
    logger.success(`Time selected: ${hourStr}:${minuteStr}:${secondStr} ${amPm}`);
  }

  // WHY: Duration React Select — select type then fill numeric value
  async fillDurationDirect(value: number, type: string): Promise<void> {
    await this.fillDuration(value, type);
  }

  private async fillDuration(value: number, type: string): Promise<void> {
    logger.info(`Filling duration: ${value} ${type}`);
    // WHY: Use generic selectFromDropdown — handles aria-hidden via JS mousedown
    await this.selectFromDropdown('1_42_input_duration', type);
    const modal = this.page.locator('#callLogModal');
    const valueInput = modal.locator('[id="1_42_input_callLogDuration"]');
    await valueInput.waitFor({ state: 'visible', timeout: 5000 });
    await valueInput.fill(String(value));
    logger.success(`Duration set: ${value} ${type}`);
  }

  // WHY: Retry find call log in list by navigating to ?id= URL
  private async retryFindCallLog(callLogId: number): Promise<boolean> {
    const { retries, wait } = this.retryConfig;
    for (let attempt = 1; attempt <= retries; attempt++) {
      logger.info(`Looking for call log ID ${callLogId} — attempt ${attempt}/${retries}`);
      await this.navigateTo(`${config.appUrl}/sales/calls/list?id=${callLogId}`);
      await this.waitForListReady();
      // WHY: Wait for list item to render after navigation
      await this.page.waitForTimeout(2000);
      const found = await this.callLogListItemById(callLogId)
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (found) {
        logger.success(`Call log ID ${callLogId} found`);
        return true;
      }
      if (attempt < retries) await this.page.waitForTimeout(wait);
    }
    logger.warn(`Call log ID ${callLogId} not found after ${retries} attempts`);
    return false;
  }

  // WHY: Search by text — phone number or entity name
  private async performSearch(searchText: string): Promise<void> {
    logger.info(`Searching call logs: "${searchText}"`);
    const input = this.searchInput();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill(searchText);
    await input.press('Enter');
    await this.page
      .waitForResponse(
        (res: Response) =>
          res.url().includes('/v1/call-logs') &&
          res.request().method() === 'GET' &&
          res.status() === 200,
        { timeout: 15000 }
      )
      .catch(() => null);
    await this.page.waitForTimeout(500);
    logger.success(`Search triggered for: "${searchText}"`);
  }

  // WHY: Notes section can scroll out of view — scroll before interacting
  private async scrollToNotesSection(): Promise<void> {
    try {
      await this.notesTextarea().scrollIntoViewIfNeeded();
      await this.page.waitForTimeout(300);
    } catch {
      logger.debug('Could not scroll to notes section — continuing');
    }
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToCallLogsList(): Promise<void> {
    logger.info('Navigating to Call Logs list');
    await this.navigateTo(`${config.appUrl}/sales/calls/list`);
    await this.waitForListReady();
    logger.success('On Call Logs list page');
  }

  async goToCallLogById(callLogId: number): Promise<void> {
    logger.info(`Navigating to call log ID: ${callLogId}`);
    await this.navigateTo(`${config.appUrl}/sales/calls/list?id=${callLogId}`);
    await this.waitForListReady();
    await this.detailEntityHeading().waitFor({
      state: 'visible',
      timeout: config.timeouts.navigation,
    });
    logger.success(`On call log detail for ID: ${callLogId}`);
  }

  // ──────────────────────────────────────────────────────────
  // Form Actions
  // ──────────────────────────────────────────────────────────

  async openLogACallForm(): Promise<void> {
    logger.info('Opening Log a Call form');
    // WHY: Reload page before clicking to ensure full page load and clean state
    await this.reloadPage();
    // WHY: networkidle can timeout on prod due to background requests — use domcontentloaded
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
    await this.click(this.logACallButton(), 'Log a call button');
    const modal = this.page.locator('#callLogModal');
    const entityInput = this.page.locator('[id="1_11_input_entityType"]');
    let formOpened = false;
    for (let i = 0; i < 5; i++) {
      try {
        await modal.waitFor({ state: 'visible', timeout: 15000 });
        await entityInput.waitFor({ state: 'attached', timeout: 15000 });
        // WHY: Remove aria-hidden so Playwright can interact with form elements
        await this.page.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
        formOpened = true;
        break;
      } catch {
        logger.warn(`Log a Call form did not open on attempt ${i + 1} — reloading page and retrying`);
        await this.reloadPage();
        // WHY: networkidle unreliable on prod due to background requests — use domcontentloaded
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);
        await this.waitForListReady();
        await this.click(this.logACallButton(), 'Log a call button retry');
      }
    }
    if (!formOpened) throw new Error('Log a Call form did not open after 5 attempts');
    logger.success('Log a Call form opened');
  }

  async fillEntityType(entityType: string): Promise<void> {
    logger.info(`Selecting entity type: ${entityType}`);
    const modal = this.page.locator('#callLogModal');
    const entityInput = modal.locator('[id="1_11_input_entityType"]');
    await entityInput.waitFor({ state: 'attached', timeout: 10000 });
    // WHY: Click the input directly — React Select opens menu on input focus/click
    // Clicking the control div sometimes toggles closed; clicking input is more stable
    await entityInput.click({ force: true });
    await this.page.waitForTimeout(600);
    // WHY: Menu renders in a portal OUTSIDE the modal (parent: div.css-gtl2mm)
    const menu = this.page.locator('.is-invalid__menu');
    const menuVisible = await menu.isVisible().catch(() => false);
    if (!menuVisible) {
      // Fallback: click the value container
      const valueContainer = modal.locator('[id="1_11_input_entityType"]')
        .locator('xpath=ancestor::div[contains(@class,"is-invalid__value-container")]');
      await valueContainer.click({ force: true });
      await this.page.waitForTimeout(600);
    }
    await menu.waitFor({ state: 'visible', timeout: 8000 });
    await menu.locator('.is-invalid__option', { hasText: entityType }).first().click();
    await this.page.waitForTimeout(500);
    logger.success(`Entity type selected: ${entityType}`);
  }

  async fillCallType(callType: string): Promise<void> {
    logger.info(`Selecting call type: ${callType}`);
    await this.selectFromDropdown('1_31_input_callType', callType);
  }

  async fillOutcome(outcome: string): Promise<void> {
    logger.info(`Selecting outcome: ${outcome}`);
    await this.selectFromDropdown('1_32_input_outcome', outcome);
    await this.page.waitForTimeout(300);
  }

  async fillPhoneNumber(): Promise<void> {
    logger.info('Selecting phone number');
    const modal = this.page.locator('#callLogModal');
    // WHY: Observer shows phone field uses id="1_21_input_phoneNumber" React Select
    // after entity selected. Click its is-invalid__control ancestor to open dropdown.
    const phoneInput = modal.locator('[id="1_21_input_phoneNumber"]');
    const phoneInputVisible = await phoneInput.isVisible().catch(() => false);
    if (phoneInputVisible) {
      const phoneControl = phoneInput.locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
      await phoneControl.waitFor({ state: 'visible', timeout: 10000 });
      await phoneControl.click();
      await this.page.waitForTimeout(500);
      const menu = this.page.locator('.is-invalid__menu');
      await menu.waitFor({ state: 'visible', timeout: 8000 });
      const option = menu.locator('.is-invalid__option').first();
      await option.waitFor({ state: 'visible', timeout: 5000 });
      const phoneText = await option.textContent();
      await option.click();
      await this.page.waitForTimeout(300);
      logger.success(`Phone number selected: ${phoneText?.trim()}`);
    } else {
      // WHY: Deal flow — phone auto-populated as disabled text input
      const autoPhone = modal.locator('[id="1_21_input_callLogPhoneNumber"]');
      const phoneValue = await autoPhone.inputValue().catch(() => '');
      logger.info(`Phone auto-populated (Deal flow): ${phoneValue}`);
    }
  }

  async fillCallSummary(summary: string): Promise<void> {
    logger.info('Filling call summary');
    await this.callSummaryTextarea().waitFor({ state: 'visible', timeout: 10000 });
    await this.callSummaryTextarea().fill(summary);
    logger.success('Call summary filled');
  }

  async uploadRecording(filePath: string): Promise<void> {
    logger.info(`Uploading recording: ${filePath}`);
    // WHY: setInputFiles works directly on file input even with aria-hidden
    await this.recordingFileInput().setInputFiles(filePath);
    await this.page.waitForTimeout(500);
    const displayValue = await this.recordingFileDisplay().inputValue().catch(() => '');
    logger.success(`Recording uploaded: "${displayValue}"`);
  }

  async fillNoteDuringCreate(noteText: string): Promise<void> {
    logger.info(`Adding note during create: "${noteText}"`);
    // WHY: Click the Notes tab first — notes are on a separate tab in the create form
    const notesTab = this.page.locator('#callLogModal .nav-link').filter({ hasText: 'Notes' });
    await notesTab.waitFor({ state: 'visible', timeout: 10000 });
    await notesTab.click({ force: true });
    await this.page.waitForTimeout(500);
    // WHY: Click textarea.notes-textarea first to initialize CKEditor
    // Observer confirmed: clicking textarea triggers CKEditor componentDidMount
    const notesTextarea = this.page.locator('#callLogModal [id="3"] textarea.notes-textarea');
    await notesTextarea.waitFor({ state: 'attached', timeout: 10000 });
    await notesTextarea.click({ force: true });
    await this.page.waitForTimeout(1000);
    // WHY: Type into .ck-editor__editable — CKEditor contenteditable div fires input events
    const ckEditable = this.page.locator('#callLogModal [id="3"] .ck-editor__editable');
    await ckEditable.waitFor({ state: 'visible', timeout: 10000 });
    await ckEditable.click({ force: true });
    await this.page.waitForTimeout(300);
    await this.page.keyboard.type(noteText, { delay: 30 });
    await this.page.waitForTimeout(500);
    // WHY: Wait for Add button to become enabled after typing
    // Scope to modal [id="3"] section to avoid hitting wrong Add button
    await this.page.waitForFunction(() => {
      const modal = document.querySelector('#callLogModal');
      const btn = modal?.querySelector('[id="3"] button.btn.mr2.btn-primary.d-block.my-2') as HTMLButtonElement;
      return btn && !btn.disabled;
    }, { timeout: 5000 }).catch(() => logger.warn('Add button still disabled — clicking anyway'));
    const addBtn = this.page.locator('#callLogModal [id="3"] button.btn.mr2.btn-primary.d-block.my-2');
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click({ force: true });
    await this.page.waitForTimeout(1000);
    logger.success(`Note added during create: "${noteText}"`);
  }

  // WHY: Full form fill — handles all entity flows and all outcome flows
  async fillCreateForm(
    data: CallLogData,
    selectedEntityName?: string,
    includeNoteDuringCreate = false
  ): Promise<{ entityName: string; selectedPhone: string }> {
    logger.info(`Filling create form — entity: ${data.entityType}, outcome: ${data.outcome}`);

    // Step 1: Entity Type
    await this.fillEntityType(data.entityType);

    // Step 2: Associated Entity
    const entityName = selectedEntityName
      ? (await this.searchAndSelectEntity(this.associatedEntityInput(), data.entityType, selectedEntityName))
      : (await this.searchAndSelectEntity(this.associatedEntityInput(), data.entityType));
// Step 3: Deal flow — Associated Contact (mandatory)
    if (data.entityType === 'Deal') {
      logger.info('Deal flow — filling Associated Contact');
      await this.searchAndSelectEntity(
        this.associatedContactForDealInput(),
        'Associated Contact (Deal flow)'
      );
    }

    // Step 4: Phone number (Lead/Contact flow — Deal auto-populates)
    let selectedPhone = '';
    if (data.entityType !== 'Deal') {
      await this.fillPhoneNumber();
      // WHY: Read phone value via JS to avoid aria-hidden blocking textContent()
      selectedPhone = await this.page.evaluate(() => {
        /* eslint-disable */
        const modal = (document as any).querySelector('#callLogModal');
        const input = modal?.querySelector('[id="1_21_input_phoneNumber"]');
        let el = input?.parentElement;
        while (el) {
          if ((el as any).className?.includes('is-invalid__value-container')) {
            const sv = (el as any).querySelector('[class*="singleValue"]');
            return sv?.textContent?.trim() ?? '';
          }
          el = (el as any).parentElement;
        }
        return '';
        /* eslint-enable */
      }).catch(() => '');
    } else {
      selectedPhone =
        (await this.phoneNumberDisabled().inputValue().catch(() => '')) ?? '';
    }

    // Step 4b: Contact flow — optional Associated Deal (after phone, per discovery doc)
    if (data.entityType === 'Contact' && data.includeAssociatedDeal) {
      logger.info('Contact flow — filling optional Associated Deal');
      const dealInput = this.page.locator('[id="associatedEntity"]');
      // WHY: Deal association is optional — contact may not have deals linked
      // Try to select a deal, skip silently if none available
      try {
        await this.searchAndSelectEntity(dealInput, 'Associated Deal (Contact flow)');
      } catch {
        logger.warn('No associated deal available for this contact — skipping deal association');
      }
    }

    // Step 5: Call Type
    await this.fillCallType(data.callType);

    // Step 6: Outcome
    await this.fillOutcome(data.outcome);

    // Step 7: Duration (only when Connected)
    if (data.outcome === 'Connected' && data.duration) {
      await this.fillDuration(data.duration.value, data.duration.type);
    }

    // Step 8: Date
    await this.selectDateInPicker(data.date);

    // Step 9: Time
    await this.selectTimeInPicker(
      data.timeConfig.hour,
      data.timeConfig.minute,
      data.timeConfig.second,
      data.timeConfig.amPm
    );

    // Step 10: Disposition (random from live dropdown)
    await this.selectRandomFromReactSelect(this.dispositionControl(), 'Disposition');

    // Step 10b: Recording upload (only when Connected and recording provided)
    // WHY: Recording field only enabled when outcome is Connected
    if (data.outcome === 'Connected' && data.recording) {
      await this.uploadRecording(data.recording);
    }
    // Step 11: Call Summary
    await this.fillCallSummary(data.callSummary);

    // Step 12: Overall Sentiment (random from live dropdown)
    await this.selectRandomFromReactSelect(this.sentimentControl(), 'Overall Sentiment');

    // Step 13: Customer Emotion (multi-select, random from live dropdown)
    await this.selectRandomFromMultiReactSelect(
      this.customerEmotionControl(),
      'Customer Emotion',
      Math.random() > 0.5 ? 1 : 2
    );

    // Step 14: Notes during create (optional)
    if (includeNoteDuringCreate) {
      await this.fillNoteDuringCreate(data.notes);
    }

    logger.success('Create form filled');
    return { entityName, selectedPhone };
  }

  async saveCallLog(): Promise<number | null> {
    logger.info('Saving call log');
    // WHY: Register toast capture BEFORE clicking save — toast appears immediately after save
    const idPromise = this.captureIdFromToast();
    await this.saveButton().scrollIntoViewIfNeeded();
    await this.click(this.saveButton(), 'Save button');
    await this.assertNoFormErrors('call log create form');
    const callLogId = await idPromise;
    logger.success(`Call log saved (ID: ${callLogId})`);
    return callLogId;
  }

  // ──────────────────────────────────────────────────────────
  // Search & Open
  // ──────────────────────────────────────────────────────────

  async searchByPhoneNumber(phoneNumber: string): Promise<void> {
    // WHY: phoneNumber may contain " Primary" or " Secondary" suffix from React Select
    // Extract only the numeric part (e.g. "+918559129847  Primary" → "+918559129847")
    const cleanPhone = phoneNumber.trim().split(/\s+/)[0];
    logger.info(`Searching by phone number: ${cleanPhone}`);
    await this.performSearch(cleanPhone);
  }

  async searchByEntityName(entityName: string): Promise<void> {
    logger.info(`Searching by entity name: ${entityName}`);
    await this.performSearch(entityName);
  }

  async openCallLogFromList(callLogId: number): Promise<void> {
    logger.info(`Opening call log ID: ${callLogId} from list`);
    const item = this.callLogListItemById(callLogId);
    const visible = await item.isVisible().catch(() => false);
    if (visible) {
      await item.click();
      await this.page.waitForTimeout(800);
      logger.success(`Call log ${callLogId} opened from list`);
    } else {
      logger.warn(`Call log ${callLogId} not visible — navigating directly`);
      await this.goToCallLogById(callLogId);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Edit Actions
  // ──────────────────────────────────────────────────────────

  async clickEditButton(): Promise<void> {
    logger.info('Clicking Edit button on detail panel');
    await this.detailEditButton().waitFor({ state: 'visible', timeout: 10000 });
    await this.click(this.detailEditButton(), 'Edit button');
    // WHY: Edit form reuses same form as create — wait for call type to be visible
    await this.callTypeControl().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Edit form opened');
  }

  async fillEditForm(data: CallLogData): Promise<void> {
    logger.info('Filling edit form');
    // WHY: Only editable fields — Type, Outcome, Date, Time, Summary, Sentiment, Emotion
    await this.fillCallType(data.callType);
    await this.fillOutcome(data.outcome);
    if (data.outcome === 'Connected' && data.duration) {
      await this.fillDuration(data.duration.value, data.duration.type);
    }
    await this.selectDateInPicker(data.date);
    await this.selectTimeInPicker(
      data.timeConfig.hour,
      data.timeConfig.minute,
      data.timeConfig.second,
      data.timeConfig.amPm
    );
    await this.fillCallSummary(data.callSummary);
    await this.selectRandomFromReactSelect(this.sentimentControl(), 'Overall Sentiment');
    await this.selectRandomFromMultiReactSelect(
      this.customerEmotionControl(),
      'Customer Emotion',
      Math.random() > 0.5 ? 1 : 2
    );
    logger.success('Edit form filled');
  }

  async saveEditedCallLog(): Promise<void> {
    logger.info('Saving edited call log');
    await this.saveButton().scrollIntoViewIfNeeded();
    await this.click(this.saveButton(), 'Save button');
    await this.assertNoFormErrors('call log edit form');
    await this.detailEntityHeading().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Call log updated');
  }

  // ──────────────────────────────────────────────────────────
  // Notes — Detail Panel
  // ──────────────────────────────────────────────────────────

  async addNoteFromDetailPanel(noteText: string): Promise<void> {
    logger.info(`Adding note from detail panel: "${noteText}"`);
    // WHY: Detail panel uses plain textarea.notes-textarea
    // Use click + keyboard.type() to simulate real keystrokes — React detects these
    const textarea = this.page.locator('textarea.notes-textarea').first();
    await textarea.waitFor({ state: 'attached', timeout: 15000 });
    await textarea.scrollIntoViewIfNeeded();
    // WHY: Click textarea first to initialize CKEditor — same pattern as create form
    await textarea.click({ force: true });
    await this.page.waitForTimeout(1000);
    // WHY: Type into .ck-editor__editable — CKEditor contenteditable div
    const ckEditable = this.page.locator('.call-details .ck-editor__editable').first();
    await ckEditable.waitFor({ state: 'visible', timeout: 10000 });
    await ckEditable.click({ force: true });
    await this.page.waitForTimeout(300);
    await this.page.keyboard.type(noteText, { delay: 30 });
    await this.page.waitForTimeout(500);
    // WHY: Wait for Add button to become enabled
    await this.page.waitForFunction(() => {
      const btn = document.querySelector('.call-details button.btn.mr2.btn-primary.d-block.my-2');
      return btn && !(btn as HTMLButtonElement).disabled;
    }, { timeout: 5000 }).catch(() => logger.warn('Detail Add button still disabled'));
    const addBtn = this.page.locator('.call-details button.btn.mr2.btn-primary.d-block.my-2').first();
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click({ force: true });
    await this.page.waitForTimeout(1000);
    logger.success(`Note added from detail panel: "${noteText}"`);
  }

  async assertRecordingOnDetail(expectedFileName: string): Promise<void> {
    logger.info(`Asserting recording on detail: "${expectedFileName}"`);
    // WHY: Recording filename appears in .recording-card .card-header div after save
    const card = this.recordingCard();
    await card.waitFor({ state: 'visible', timeout: 15000 });
    const text = await card.textContent() ?? '';
    if (!text.includes(expectedFileName)) {
      throw new Error(`Recording "${expectedFileName}" not found in recording card — got: "${text}"`);
    }
    logger.success(`Recording confirmed on detail: "${text.trim()}"`);
  }

  async assertNoteVisible(expectedText: string): Promise<void> {
    logger.info(`Asserting note visible: "${expectedText}"`);
    // WHY: Wait for detail panel to fully load before looking for notes section
    await this.page.waitForTimeout(2000);
    // WHY: Expand View Call Notes only if not already expanded
    // If .note-list-scroll-container already visible, notes are already expanded
    const noteListVisible = await this.page.locator('.note-list-scroll-container').isVisible().catch(() => false);
    if (!noteListVisible) {
      await this.page.evaluate(() => {
        const cta = document.querySelector('.view-call-notes-cta .cursor-pointer') as HTMLElement;
        if (cta) {
          cta.scrollIntoView({ block: 'center' });
          cta.click();
        }
      });
      await this.page.waitForTimeout(1500);
    }
    // WHY: Click refresh to load latest notes
    await this.page.evaluate(() => {
      const refresh = document.querySelector('.view-call-notes-cta .fa-sync-alt') as HTMLElement;
      if (refresh) refresh.click();
    });
    await this.page.waitForTimeout(3000);
    await this.page.waitForTimeout(1500);
    // WHY: Click refresh to load latest notes
    const refreshBtn = this.page.locator('.view-call-notes-cta .fa-sync-alt');
    const refreshVisible = await refreshBtn.isVisible().catch(() => false);
    if (refreshVisible) {
      await refreshBtn.click();
      await this.page.waitForTimeout(1500);
    }
    // WHY: Notes render in div.note-content after expanding View Call Notes
    // Observer confirmed: note text appears in div.note-content inside the notes list
    const noteContents = this.page.locator('.note-content');
    await noteContents.first().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(500);
    const count = await noteContents.count();
    let found = false;
    for (let i = 0; i < count; i++) {
      const noteText = await noteContents.nth(i).textContent() ?? '';
      logger.info(`Note ${i} text: "${noteText.trim().substring(0, 80)}"`);
      if (noteText.includes(expectedText)) {
        found = true;
        logger.success(`Note confirmed: "${noteText.trim().substring(0, 80)}"`);
        break;
      }
    }
    if (!found) {
      // WHY: Also check iframe inside note-text-container as fallback
      const noteIframes = this.page.locator('.note-text-container iframe');
      const iframeCount = await noteIframes.count().catch(() => 0);
      for (let i = 0; i < iframeCount; i++) {
        const iframeText = await noteIframes.nth(i).evaluate((el: any) => {
          return el.contentDocument?.body?.textContent?.trim() ?? '';
        });
        if (iframeText.includes(expectedText)) {
          found = true;
          logger.success(`Note confirmed in iframe: "${iframeText.substring(0, 80)}"`);
          break;
        }
      }
    }
    if (!found) throw new Error(`Note "${expectedText}" not found in note list`);
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnCallLogsListPage(): Promise<void> {
    await this.assertUrl(/\/sales\/calls\/list/);
    await expect(this.callLogList()).toBeVisible({ timeout: config.timeouts.navigation });
    logger.success('Confirmed on Call Logs list page');
  }

  async assertCallLogInList(callLogId: number): Promise<void> {
    logger.info(`Asserting call log ID ${callLogId} in list`);
    const found = await this.retryFindCallLog(callLogId);
    expect(found).toBeTruthy();
    logger.success(`Call log ID ${callLogId} confirmed in list`);
  }

  async assertCallLogNotInList(callLogId: number): Promise<void> {
    logger.info(`Asserting call log ID ${callLogId} NOT accessible`);
    await this.navigateTo(`${config.appUrl}/sales/calls/list?id=${callLogId}`);
    await this.waitForListReady();
    const detailVisible = await this.detailEntityHeading().isVisible().catch(() => false);
    if (detailVisible) {
      throw new Error(`Call log ID ${callLogId} should NOT be visible but detail panel is shown`);
    }
    logger.success(`Call log ID ${callLogId} correctly not accessible`);
  }

  async assertDetailEntityHeadingContains(entityName: string): Promise<void> {
    logger.info(`Asserting detail heading contains: "${entityName}"`);
    await this.detailEntityHeading().waitFor({ state: 'visible', timeout: 15000 });
    const text = await this.detailEntityHeading().textContent();
    if (entityName && !text?.includes(entityName)) {
      throw new Error(`Detail heading "${text}" does not contain "${entityName}"`);
    }
    logger.success(`Detail heading confirmed: "${text}"`);
  }

  async assertOutcomeOnDetail(expectedOutcome: string): Promise<void> {
    logger.info(`Asserting outcome on detail: ${expectedOutcome}`);
    await this.detailOutcomeLabel().waitFor({ state: 'visible', timeout: 10000 });
    const text = await this.detailOutcomeLabel().textContent();
    if (!text?.includes(expectedOutcome)) {
      throw new Error(`Outcome "${text}" does not contain "${expectedOutcome}"`);
    }
    logger.success(`Outcome confirmed: ${text}`);
  }

  async assertOwnerVisible(): Promise<void> {
    logger.info('Asserting Owner field visible on detail');
    await this.ownerField().waitFor({ state: 'visible', timeout: 10000 });
    const ownerText = await this.ownerField().textContent();
    if (!ownerText || ownerText.trim() === '') {
      throw new Error('Owner field is visible but has no text content');
    }
    logger.success(`Owner field confirmed: "${ownerText.trim()}"`);
  }

  async assertEditButtonVisible(): Promise<void> {
    logger.info('Asserting Edit button visible');
    await expect(this.detailEditButton()).toBeVisible({ timeout: 10000 });
    logger.success('Edit button confirmed visible');
  }

  async assertEditButtonNotVisible(): Promise<void> {
    logger.info('Asserting Edit button NOT visible');
    await expect(this.detailEditButton()).toBeHidden({ timeout: 5000 });
    logger.success('Edit button correctly absent');
  }

  async assertPhoneFieldDisabled(): Promise<void> {
    logger.info('Asserting phone field is disabled (Deal flow)');
    const disabledPhone = this.phoneNumberDisabled();
    await disabledPhone.waitFor({ state: 'visible', timeout: 10000 });
    const isDisabled = await disabledPhone.isDisabled();
    if (!isDisabled) {
      const parentDisabled = await this.page
        .locator('.is-invalid--is-disabled')
        .isVisible()
        .catch(() => false);
      if (!parentDisabled) {
        throw new Error('Phone field should be disabled for Deal flow but is not');
      }
    }
    logger.success('Phone field confirmed disabled for Deal flow');
  }

  async assertDurationEnabled(): Promise<void> {
    logger.info('Asserting Duration field is enabled (Connected outcome)');
    await this.page.waitForTimeout(500);
    // WHY: Use page.evaluate — aria-hidden blocks container.evaluate()
    const hasDisabledClass = await this.page.evaluate(() => {
      const modal = document.querySelector('#callLogModal');
      const input = modal?.querySelector('[id="1_42_input_duration"]');
      let el = input?.parentElement;
      while (el) {
        if ((el as HTMLElement).className?.includes('is-invalid__control')) {
          return (el as HTMLElement).className.includes('is-invalid__control--is-disabled');
        }
        el = el.parentElement;
      }
      return false;
    });
    if (hasDisabledClass) throw new Error('Duration should be ENABLED for Connected outcome');
    logger.success('Duration field confirmed enabled');
  }

  async assertDurationDisabled(): Promise<void> {
    logger.info('Asserting Duration field is disabled (non-Connected outcome)');
    await this.page.waitForTimeout(500);
    // WHY: Use page.evaluate — aria-hidden blocks container.evaluate()
    const hasDisabledClass = await this.page.evaluate(() => {
      const modal = document.querySelector('#callLogModal');
      const input = modal?.querySelector('[id="1_42_input_duration"]');
      let el = input?.parentElement;
      while (el) {
        if ((el as HTMLElement).className?.includes('is-invalid__control')) {
          return (el as HTMLElement).className.includes('is-invalid__control--is-disabled');
        }
        el = el.parentElement;
      }
      return true;
    });
    if (!hasDisabledClass) throw new Error('Duration should be DISABLED for non-Connected outcome');
    logger.success('Duration field confirmed disabled');
  }

  async assertSearchResultContains(phoneOrName: string): Promise<void> {
    logger.info(`Asserting search result contains: "${phoneOrName}"`);
    await expect(this.callLogListItem().first()).toBeVisible({ timeout: 15000 });
    const count = await this.callLogListItem().count();
    logger.success(`Search returned ${count} results for: "${phoneOrName}"`);
  }

  async assertToasterVisible(): Promise<void> {
    logger.info('Asserting success toaster visible');
    await this.successToaster().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Success toaster confirmed');
  }

  // ──────────────────────────────────────────────────────────
  // Cross-Module — Entity Productivity Section
  // ──────────────────────────────────────────────────────────

  async navigateToEntityViaDetailLink(): Promise<string> {
    logger.info('Navigating to entity via detail heading link');
    await this.detailEntityHeading().waitFor({ state: 'visible', timeout: 10000 });
    const entityLink = this.detailEntityLink();
    await entityLink.waitFor({ state: 'visible', timeout: 10000 });
    // WHY: Link opens in new tab — register popup event before clicking
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page'),
      entityLink.click(),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    const entityUrl = newPage.url();
    logger.success(`Entity page opened in new tab: ${entityUrl}`);
    // WHY: Switch context to new tab
    this.page = newPage;
    return entityUrl;
  }

  async openCallLogsProductivitySection(): Promise<void> {
    logger.info('Opening Call Logs productivity section on entity detail');
    const callLogsBtn = this.callLogsProductivityButton();
    await callLogsBtn.waitFor({ state: 'visible', timeout: 15000 });
    await callLogsBtn.scrollIntoViewIfNeeded();
    await callLogsBtn.click();
    await this.productivityCallLogList().waitFor({ state: 'visible', timeout: 15000 });
    logger.success('Call Logs productivity section opened');
  }

  async assertCallLogInProductivitySection(
    expectedOutcome: string,
    loggedByName: string
  ): Promise<void> {
    logger.info(
      `Asserting call log in productivity section — outcome: ${expectedOutcome}, loggedBy: ${loggedByName}`
    );
    await this.productivityCallLogItem().first().waitFor({ state: 'visible', timeout: 15000 });
    const outcomeLabel = this.productivityOutcomeLabel();
    await outcomeLabel.waitFor({ state: 'visible', timeout: 10000 });
    const outcomeText = await outcomeLabel.textContent();
    if (!outcomeText?.includes(expectedOutcome)) {
      throw new Error(
        `Productivity section outcome "${outcomeText}" does not match "${expectedOutcome}"`
      );
    }
    logger.success(`Productivity outcome confirmed: ${outcomeText}`);
    const loggedByEl = this.productivityLoggedBy();
    await loggedByEl.waitFor({ state: 'visible', timeout: 10000 });
    const loggedByText = await loggedByEl.textContent();
    if (!loggedByText?.includes(loggedByName)) {
      throw new Error(`"Logged By: ${loggedByText}" does not contain "${loggedByName}"`);
    }
    logger.success(`Logged By confirmed: ${loggedByText}`);
  }

  async returnToCallLogsList(originalPage: Page): Promise<void> {
    logger.info('Returning to Call Logs list page');
    // WHY: Close new tab and restore original page context
    await this.page.close();
    this.page = originalPage;
    await this.goToCallLogsList();
    logger.success('Returned to Call Logs list page');
  }

  // ──────────────────────────────────────────────────────────
  // Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createCallLog(
    data: CallLogData,
    options: {
      includeNoteDuringCreate?: boolean;
      selectedEntityName?: string;
    } = {}
  ): Promise<{ callLogId: number | null; entityName: string; selectedPhone: string }> {
    logger.info(`Creating call log — entity: ${data.entityType}, outcome: ${data.outcome}`);
    await this.openLogACallForm();
    const { entityName, selectedPhone } = await this.fillCreateForm(
      data,
      options.selectedEntityName,
      options.includeNoteDuringCreate ?? false
    );
    const callLogId = await this.saveCallLog();
    logger.success(`Call log created — ID: ${callLogId}, entity: ${entityName}`);
    return { callLogId, entityName, selectedPhone };
  }

  async updateCallLog(callLogId: number, newData: CallLogData): Promise<void> {
    logger.info(`Updating call log ID: ${callLogId}`);
    await this.goToCallLogById(callLogId);
    await this.clickEditButton();
    await this.fillEditForm(newData);
    await this.saveEditedCallLog();
    logger.success(`Call log ID ${callLogId} updated`);
  }
}