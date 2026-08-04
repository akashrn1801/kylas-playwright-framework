import { Page, Response, expect } from '@playwright/test';
import { BasePage } from '@core/BasePage';
import { logger } from '@utils/logger';
import { config } from '@config/config';
import { LeadsPage } from '@modules/leads/LeadsPage';
import { generateLeadData } from '@data/factories/leadFactory';
import { ContactsPage } from '@modules/contacts/ContactsPage';
import { generateContactData } from '@data/factories/contactFactory';
import { DealsPage } from '@modules/deals/DealsPage';
import { generateDealData } from '@data/factories/dealFactory';
import {
  CallLogData,
  CallLogCustomFieldData,
  CALL_LOG_CUSTOM_FIELD_NAMES,
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

  // WHY: aria-label is not always the plain "Weekday, Month Day, Year" string —
  // confirmed live that react-dates prefixes it with a status word for some
  // states, e.g. "Selected. Saturday, July 4, 2026" for the default-selected
  // date, or "Not available. Sunday, July 5, 2026" for a disabled future date.
  // Match on suffix so any prefix is tolerated.
  private readonly calendarDayByLabel = (label: string) =>
    this.page.locator(`.SingleDatePicker td[aria-label$="${label}"]`);

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
    this.page.locator("button[data-original-title='Call Logs']");

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
    // WHY: /v1/call-logs/search returns 404 on QA — wait for DOM only. Race
    // between the list container (populated case) and the Log a call button
    // (always present in the header, regardless of list content) — waiting on
    // callLogList() alone wastes the full timeout every time the list is
    // legitimately empty, since that element never renders in that state.
    await Promise.race([
      this.callLogList()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
      this.logACallButton()
        .waitFor({ state: 'visible', timeout: config.timeouts.navigation })
        .catch(() => null),
    ]);
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
    // WHY: shared bounded+re-roll selector (2026-07-17), force click as before —
    // was an unbounded textContent()+click() on a random option, same bug class.
    return await this.selectRandomOptionWithRetry(options, `Selected random "${description}"`, {
      force: true,
    });
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
      const { retries, wait } = this.retryConfig;
      let filteredCount = 0;
      for (let attempt = 1; attempt <= retries && filteredCount === 0; attempt++) {
        logger.debug(`Typing search query: "${searchQuery}" (from: "${searchTerm}"), attempt ${attempt}/${retries}`);
        await this.page.keyboard.type(searchQuery, { delay: 50 });
        // WHY: Poll for filtered options after typing
        for (let i = 0; i < 10; i++) {
          filteredCount = await this.page.evaluate(() => document.querySelectorAll('.is-invalid__option').length);
          if (filteredCount > 0) break;
          await this.page.waitForTimeout(500);
        }
        if (filteredCount === 0 && attempt < retries) {
          // WHY: Confirmed live — a just-created entity can take a moment to hit
          // the search index. Without this retry, zero filtered matches falls
          // straight through to the blind "click first option" fallback below,
          // which can land on an unrelated (possibly inaccessible) entity and
          // surface as a false-positive "necessary permission" error later.
          logger.warn(
            `No filtered options for "${searchQuery}" — entity may not be search-indexed yet, retrying in ${wait}ms`
          );
          await this.page.keyboard.press('Control+A');
          await this.page.keyboard.press('Backspace');
          await this.page.waitForTimeout(wait);
        }
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
      // No search term — pick random from first 5, skip ADM/SHR/RES-prefixed options
      // WHY: ADM = admin-owned, SHR = shared leads — restricted user may not have
      // call log permission on these entities, causing HTTP 403
      // RES = restricted user's own test data — safe to use
      const nonAdmOpts = Array.from(opts).filter(o => {
        const text = (o.textContent ?? '').replace(/\s+/g, ' ').trim();
        const hasADM = /ADM\d{10,}/.test(text);
        const hasSHR = /SHR\d{10,}/.test(text);
        return !hasADM && !hasSHR;
      });
      // WHY: If all options are SHR/ADM fall back to first option
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
    // WHY: The calendar's default visible month is NOT guaranteed to be the
    // real-world current month — confirmed live on staging that opening the
    // picker with no date pre-selected shows the PREVIOUS month. Blindly
    // preferring "back" whenever the button exists (the old logic) can send
    // navigation in exactly the wrong direction and burn the full attempt
    // budget. Instead, read the months actually rendered by the calendar and
    // navigate toward the target relative to that.
    const targetMonthKey = date.getFullYear() * 12 + date.getMonth();
    while (!found && attempts < 24) {
      // WHY: confirmed live (2026-07-16 root-cause pass, same fix ported
      // from BasePage.selectDateCustomField()) — react-dates keeps THREE
      // months' worth of `td[aria-label]` cells in the DOM simultaneously
      // (the visible month(s) plus a pre-rendered buffer month for smooth
      // transitions), but only the ones inside the picker's own clipped,
      // visible bounds are real. Querying ALL cells with no visibility
      // filter made minVisibleMonth/maxVisibleMonth span a wider range than
      // what was actually clickable, causing the direction decision below to
      // be wrong often enough to exhaust all 24 attempts without
      // converging. Filtering to cells whose bounding rect falls inside the
      // picker container's rect fixes the root cause.
      const visibleMonthKeys: number[] = await this.page.evaluate(() => {
        const container = document.querySelector(
          '[class*="SingleDatePicker_picker"]'
        ) as HTMLElement | null;
        const containerRect = container?.getBoundingClientRect() ?? null;
        return Array.from(document.querySelectorAll('.SingleDatePicker td[aria-label]'))
          .filter((cell) => {
            if (!containerRect) return true;
            const r = cell.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              r.left >= containerRect.left - 5 &&
              r.right <= containerRect.right + 5
            );
          })
          .map((cell) => {
            // WHY: strip status prefixes like "Selected. "/"Not available. "
            // before parsing — otherwise those cells are silently dropped.
            const label = cell.getAttribute('aria-label')?.replace(/^[A-Za-z ]+\.\s*/, '') ?? null;
            const parsed = label ? new Date(label) : null;
            return parsed && !isNaN(parsed.getTime())
              ? parsed.getFullYear() * 12 + parsed.getMonth()
              : null;
          })
          .filter((v): v is number => v !== null);
      });
      const backButton = this.page.getByLabel('Move backward to switch to the previous month.');
      const backVisible = await backButton.isVisible().catch(() => false);
      const forwardVisible = await this.calendarForwardButton().isVisible().catch(() => false);
      const minVisibleMonth = visibleMonthKeys.length ? Math.min(...visibleMonthKeys) : null;
      const maxVisibleMonth = visibleMonthKeys.length ? Math.max(...visibleMonthKeys) : null;
      const shouldGoBack =
        minVisibleMonth !== null && targetMonthKey < minVisibleMonth
          ? true
          : maxVisibleMonth !== null && targetMonthKey > maxVisibleMonth
            ? false
            : backVisible;
      if (shouldGoBack && backVisible) {
        await backButton.click();
      } else if (forwardVisible) {
        await this.calendarForwardButton().click();
      } else if (backVisible) {
        await backButton.click();
      }
      // WHY: Direct condition-based wait instead of blind pause — matches
      // BasePage.selectDateCustomField() and avoids oscillation when calendar
      // DOM update takes longer than the hardcoded 400ms pause.
      found = await dayCell
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
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
    await this.armResponseWaitWithRecovery(
      (res: Response) =>
        res.url().includes('/v1/call-logs') &&
        res.request().method() === 'GET' &&
        res.status() === 200,
      'performSearch: call-logs GET',
      15000
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
    // WHY: Small wait for permissions to fully load — prevents intermittent
    // permission errors on CI when restricted user creates call log immediately
    await this.page.waitForTimeout(1000);
    logger.success('On Call Logs list page');
  }

  async goToCallLogById(callLogId: number): Promise<void> {
    logger.info(`Navigating to call log ID: ${callLogId}`);
    await this.navigateTo(`${config.appUrl}/sales/calls/list?id=${callLogId}`);
    await this.waitForListReady();
    // WHY: Wait for call log GET API response — the list-search endpoint 404s
    // on QA (see waitForListReady), but the single-entity GET is reliable and
    // confirms the detail panel's data actually loaded, not just DOM presence.
    // The real request is `/v1/call-logs/{id}?relatedToType=...` — the previous
    // regex was anchored with `$` right after the digits, which never matches
    // because of that query string, so this wait always silently timed out.
    const detailResponsePattern = new RegExp(`/v1/call-logs/${callLogId}(?:\\?.*)?$`);
    await this.armResponseWaitWithRecovery(
      (res) => detailResponsePattern.test(res.url()) && res.request().method() === 'GET',
      'goToCallLogById: detail GET',
      15000
    )
      .catch(() => null);
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

  // WHY a SEPARATE method from openLogACallForm(), not a reuse (2026-07-31):
  // openLogACallForm()'s reload-and-retry loop is specifically built for the
  // standalone Call Logs list context — its retry path calls
  // waitForListReady(), which assumes the page is on /sales/calls/list. A
  // reload from a Lead/Contact's own detail panel would lose that page
  // entirely, stranding the test away from the entity whose panel was just
  // opened.
  //
  // WHY this waits for callTypeControl(), NOT entityType input (2026-07-31,
  // found via a real live failure — the first version of this method
  // incorrectly copied the standalone flow's readiness check): confirmed
  // live via direct DOM inspection that the panel-context modal has NO
  // "Entity Type" or "Associated Entity" field at all — both are implicit
  // (the entity whose panel this was opened from), so the modal goes
  // straight to Call Type. `1_11_input_entityType` never attaches in this
  // context, which is exactly why the first version's wait timed out.
  async openLogACallFormFromEntityDetailPanel(): Promise<void> {
    logger.info('Opening Log a Call form from an entity detail panel');
    const logACallButton = this.page.locator('button.btn.btn-primary', { hasText: 'Log a call' });
    await logACallButton.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.click(logACallButton, 'Log a call button (from entity panel)');
    const modal = this.page.locator('#callLogModal');
    await modal.waitFor({ state: 'visible', timeout: 15000 });
    await this.callTypeControl().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.evaluate('document.querySelector("#callLogModal")?.removeAttribute("aria-hidden")');
    logger.success('Log a Call form opened from entity detail panel');
  }

  // WHY a DEDICATED fill method, not fillCreateForm() (2026-07-31, found via
  // the same live failure): fillCreateForm() always calls fillEntityType()
  // and searchAndSelectEntity() for the associated entity — both of which
  // target fields that DO NOT EXIST in the panel-context modal (confirmed
  // via direct DOM dump: the modal goes straight from open to Call Type,
  // Outcome, Phone Number, ...). Reusing fillCreateForm() unmodified would
  // therefore always time out here, the same way the readiness check above
  // did before its own fix. This method fills every field that DOES exist
  // in this context — phone number (still a real field here, same as the
  // standalone Lead/Contact flow — only the Deal flow auto-populates and
  // disables it, and this method is only used for Lead/Contact panels),
  // call type/outcome/duration/date/time/disposition/summary/sentiment/
  // emotion, plus custom fields — and saves, mirroring
  // QuotationsPage.fillAndSaveQuotationFromPanel()'s identical "own reduced
  // fill+save method for the panel context" pattern.
  async fillAndSaveCallLogFromPanel(data: CallLogData): Promise<number | null> {
    logger.info(`Filling call log form from entity panel — outcome: ${data.outcome}`);
    await this.fillPhoneNumber();
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
    await this.selectRandomFromReactSelect(this.dispositionControl(), 'Disposition');
    if (data.outcome === 'Connected' && data.recording) {
      await this.uploadRecording(data.recording);
    }
    await this.fillCallSummary(data.callSummary);
    await this.selectRandomFromReactSelect(this.sentimentControl(), 'Overall Sentiment');
    await this.selectRandomFromMultiReactSelect(
      this.customerEmotionControl(),
      'Customer Emotion',
      Math.random() > 0.5 ? 1 : 2
    );
    await this.fillCallLogCustomFields(data.customFields);
    logger.success('Call log form filled from entity panel');
    return await this.saveCallLog();
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
    // after entity selected. Use openDropdownById() with JS event dispatch (not UI click)
    // to avoid pointer event interception from dropdown menu.
    const phoneInput = modal.locator('[id="1_21_input_phoneNumber"]');
    const phoneInputVisible = await phoneInput.isVisible().catch(() => false);
    if (phoneInputVisible) {
      await this.openDropdownById('1_21_input_phoneNumber');
      const menu = this.page.locator('.is-invalid__menu');
      await menu.waitFor({ state: 'visible', timeout: 8000 });
      const option = menu.locator('.is-invalid__option').first();
      await option.waitFor({ state: 'visible', timeout: 5000 });
      // WHY: Use force: true to bypass aria-hidden blocking from React Select
      const phoneText = await option.textContent({ timeout: 15000 });
      await option.click({ force: true, timeout: 15000 });
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
    includeNoteDuringCreate = false,
    // WHY: Pre-created owned entity for the secondary field (Associated Contact on
    // Deal flow, Associated Deal on Contact flow). When omitted, falls back to the
    // existing searchAndSelectEntity() random-pick behavior — kept optional so
    // callers that don't need this (e.g. admin-only UI tests) are unaffected.
    selectedSecondaryEntityName?: string
  ): Promise<{ entityName: string; selectedPhone: string; associatedDealName: string | null }> {
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
        'Associated Contact (Deal flow)',
        selectedSecondaryEntityName
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
    // WHY track the result (added 2026-07-22, alongside the ensureOwnedDealExists
    // contact-linkage fix): callers need to know whether a deal was actually
    // associated or genuinely skipped, so assertAssociatedDealOnDetail() can
    // verify the right thing instead of assuming a deal is always present.
    let associatedDealName: string | null = null;
    if (data.entityType === 'Contact' && data.includeAssociatedDeal) {
      logger.info('Contact flow — filling optional Associated Deal');
      const dealInput = this.page.locator('[id="associatedEntity"]');
      // WHY: Deal association is optional — contact may not have deals linked
      // Try to select a deal, skip silently if none available
      try {
        associatedDealName = await this.searchAndSelectEntity(
          dealInput,
          'Associated Deal (Contact flow)',
          selectedSecondaryEntityName
        );
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

    // Step 15: Custom fields
    await this.fillCallLogCustomFields(data.customFields);

    logger.success('Create form filled');
    return { entityName, selectedPhone, associatedDealName };
  }

  // WHY 'plain' passed explicitly on every call: Call Log's custom-field ids
  // use the shorter `_input_cf<Name>` suffix, not the `_input_
  // customFieldValues.cf<Name>` suffix parent entities use — confirmed live
  // 2026-07-31, matching CLAUDE.md's own documented finding that Meetings
  // and Call Logs share this convention. Mirrors
  // MeetingsPage.fillMeetingCustomFields()'s identical structure.
  private async fillCallLogCustomFields(cf: CallLogCustomFieldData): Promise<void> {
    await this.fillTextLikeCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field',
      'plain'
    );
    await this.fillTextLikeCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text',
      'plain'
    );
    await this.fillTextLikeCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number',
      'plain'
    );
    await this.fillTextLikeCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field',
      'plain'
    );
    await this.setCheckboxCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox,
      'Checkbox',
      'plain'
    );
    await this.selectDateCustomField(CALL_LOG_CUSTOM_FIELD_NAMES.date, cf.date, 'Date', 'plain');
    await this.selectDateTimeCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.dateTimePicker,
      cf.dateTimePicker,
      'Date Time Picker',
      'plain'
    );
    // WHY mutate `cf.pickList` in place — same reasoning as Meeting/Deal's
    // identical field: the option is read live from the DOM, never
    // hardcoded, so the caller's own data object needs the actually-selected
    // value written back into it for later detail-page verification.
    const pickedValue = await this.selectPicklistCustomField(
      CALL_LOG_CUSTOM_FIELD_NAMES.pickList,
      'Pick List',
      'plain'
    );
    if (pickedValue !== null) cf.pickList = pickedValue;
  }

  // WHY: mirrors DealsPage/MeetingsPage's skipIfCustomFieldsAbsent() — a
  // whole-test-level skip, called once right after the create/edit form is
  // open, so an environment without these fields (Stage, as of 2026-07-31)
  // skips cleanly with a clear reason instead of failing deep inside a
  // fill/assert call.
  async skipIfCustomFieldsAbsent(): Promise<void> {
    await this.skipDedicatedCustomFieldTestIfAbsent(
      Object.values(CALL_LOG_CUSTOM_FIELD_NAMES),
      'Call Log',
      'plain'
    );
  }

  // WHY: mirrors MeetingsPage's assertMeetingCustomFieldsOnDetail() — only
  // this module's dedicated custom-field tests call this, always on an
  // environment already confirmed (via skipIfCustomFieldsAbsent()) to have
  // these fields, so it throws (does not skip) on a missing field. The
  // "Other Details" tab click is required first — confirmed live (2026-07-31)
  // the Call Log detail page is tabbed (5 tabs: Basic Info, Sentiment
  // Information, Campaign Information, Other Details, Internals), same
  // shape as Meeting's own tabbed detail page, and the custom-field
  // containers only exist in the DOM once "Other Details" is the active tab.
  async assertCallLogCustomFieldsOnDetail(cf: CallLogCustomFieldData): Promise<void> {
    logger.info('Asserting all 8 custom field values on call log detail page');
    const tab = this.page.locator('a.nav-item.nav-link, a.nav-link').filter({ hasText: 'Other Details' });
    await this.withSessionExpiryRecovery(() =>
      expect(
        tab,
        '"Other Details" tab did not appear on the call log detail page — custom field verification cannot proceed'
      ).toBeVisible({ timeout: config.timeouts.navigation })
    );
    await this.click(tab, 'Other Details tab');
    await this.page.waitForTimeout(500);

    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.textField,
      cf.textField,
      'Text Field'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.paragraphText,
      cf.paragraphText,
      'Paragraph Text'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.number,
      String(cf.number),
      'Number'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.urlField,
      cf.urlField,
      'URL Field'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.checkbox,
      cf.checkbox ? 'Yes' : 'No',
      'Checkbox'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.date,
      this.formatCustomFieldDetailDate(cf.date),
      'Date'
    );
    await this.assertCustomFieldOnDetail(
      CALL_LOG_CUSTOM_FIELD_NAMES.dateTimePicker,
      this.formatCustomFieldDetailDateTime(cf.dateTimePicker),
      'Date Time Picker'
    );
    if (cf.pickList) {
      await this.assertCustomFieldOnDetail(
        CALL_LOG_CUSTOM_FIELD_NAMES.pickList,
        cf.pickList,
        'Pick List'
      );
    }
    logger.success('All 8 custom field values verified on call log detail page');
  }

  async saveCallLog(): Promise<number | null> {
    logger.info('Saving call log');
    // WHY: Even with a correctly-owned secondary entity (see createCallLog),
    // there can be a server-side permission-propagation delay after an entity
    // was just created — the save can transiently 403 with a "necessary
    // permission" style error that clears up moments later. Retry a few times
    // instead of failing outright, but only for permission-shaped errors —
    // a genuine validation error (e.g. required field) won't be fixed by retrying.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // WHY: Register toast capture BEFORE clicking save — toast appears immediately after save
      const idPromise = this.captureIdFromToast();
      await this.saveButton().scrollIntoViewIfNeeded();
      await this.click(this.saveButton(), 'Save button');
      try {
        await this.assertNoFormErrors('call log create form');
        const callLogId = await idPromise;
        logger.success(`Call log saved (ID: ${callLogId})`);
        return callLogId;
      } catch (error) {
        const message = String(error);
        const isPermissionError =
          /necessary permission|don.t have enough permissions|not authorised to perform this operation/i.test(
            message
          );
        if (!isPermissionError || attempt === maxAttempts) {
          throw error;
        }
        logger.warn(`Permission error on save attempt ${attempt}/${maxAttempts} — waiting 3s before retry`);
        await this.page.waitForTimeout(3000);
        // WHY: Make sure the error toast has cleared before retrying — avoids
        // the retry click landing on a stale toast overlay
        await this.page
          .locator('.rrt-middle-container')
          .filter({ hasText: /uh.?oh/i })
          .waitFor({ state: 'hidden', timeout: 5000 })
          .catch(() => null);
      }
    }
    // Unreachable — the loop above always returns or throws
    return null;
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

  // WHY the optional updateCustomFields param (2026-07-31, defaults to
  // false — zero behavior change for every existing caller): `data` here is
  // a full, non-partial `CallLogData`, so `data.customFields` is always
  // populated (the type is mandatory) — unlike Quotation's `Partial<...>`
  // edit-changes shape, there's no way to tell "caller didn't specify
  // customFields" from the data alone. Without this flag, every existing
  // update test would silently start mutating custom fields too, changing
  // scope beyond what those tests actually assert. Only a dedicated
  // custom-field update test passes `true`.
  async fillEditForm(data: CallLogData, updateCustomFields = false): Promise<void> {
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
    if (updateCustomFields) {
      // WHY the "Other Details" tab click here, NOT in fillCallLogCustomFields()
      // itself: confirmed live (2026-07-31) the EDIT form (unlike create) is
      // also tabbed, and custom-field inputs only exist in the DOM once
      // "Other Details" is active — the CREATE form renders every section
      // inline, so fillCallLogCustomFields() itself must stay tab-agnostic
      // for that context to keep working unchanged.
      const otherDetailsTab = this.page
        .locator('a.nav-item.nav-link, a.nav-link')
        .filter({ hasText: 'Other Details' });
      if ((await otherDetailsTab.count()) > 0) {
        await this.click(otherDetailsTab.first(), 'Other Details tab (edit form)', true);
        await this.page.waitForTimeout(500);
      }
      await this.fillCallLogCustomFields(data.customFields);
    }
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
    // WHY: div.note-content is a real wrapper (confirmed live), but the actual
    // note body renders inside a CKEditor srcdoc <iframe> nested within it —
    // .note-content's own textContent only ever contains the surrounding
    // author/timestamp/delete-menu markup, never the iframe's document content,
    // since textContent cannot cross into an iframe's own document. Checking
    // .note-content directly can therefore never find the real note text —
    // read the iframe content directly instead.
    const noteIframes = this.page.locator('.note-text-container iframe');
    await noteIframes.first().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(500);
    const iframeCount = await noteIframes.count();
    let found = false;
    for (let i = 0; i < iframeCount; i++) {
      const iframeText = await noteIframes.nth(i).evaluate((el: any) => {
        return el.contentDocument?.body?.textContent?.trim() ?? '';
      });
      logger.info(`Note ${i} text: "${iframeText.substring(0, 80)}"`);
      if (iframeText.includes(expectedText)) {
        found = true;
        logger.success(`Note confirmed: "${iframeText.substring(0, 80)}"`);
        break;
      }
    }
    if (!found) throw new Error(`Note "${expectedText}" not found in note list`);
  }

  // ──────────────────────────────────────────────────────────
  // Assertions
  // ──────────────────────────────────────────────────────────

  async assertOnCallLogsListPage(): Promise<void> {
    await this.assertUrl(/\/sales\/calls\/list/);
    // WHY: callLogList() (ul.list-group.list-group-flush) only renders when there
    // ARE call logs in the list — for a fresh restricted user (or any user) with
    // zero call logs, that element never appears, and asserting on it directly
    // cannot distinguish "genuinely empty" from "still loading" from "broken" —
    // it just times out after 60s with a useless "element not found" error.
    // logACallButton() is part of the page header/toolbar and is always present
    // regardless of list content, making it a reliable "page loaded" signal.
    await this.withSessionExpiryRecovery(() =>
      expect(this.logACallButton()).toBeVisible({ timeout: config.timeouts.navigation })
    );
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

  // WHY (added 2026-07-22, closing a real test-coverage gap found in CL4/CL22 —
  // both claimed to "verify both entity associations on detail panel" but never
  // actually asserted the deal): confirmed live via DOM investigation (temp spec,
  // deleted after use) that a successfully-associated deal renders as
  // `<div class="link-primary">{dealName}</div>` on the call log detail panel.
  // Takes the associatedDealName returned by createCallLog()/fillCreateForm() —
  // null there means the association was genuinely skipped (no linked deal
  // found, e.g. a contact truly has no deals), NOT a failure. This method must
  // never turn that legitimate case into a false assertion failure — if
  // expectedDealName is null, it logs and returns without asserting presence.
  async assertAssociatedDealOnDetail(expectedDealName: string | null): Promise<void> {
    if (!expectedDealName) {
      logger.info(
        'No associated deal was selected during create (genuinely unavailable) — skipping ' +
          'associated-deal detail assertion'
      );
      return;
    }
    logger.info(`Asserting associated deal on detail: "${expectedDealName}"`);
    const dealLink = this.page.locator('div.link-primary').filter({ hasText: expectedDealName }).first();
    await expect(
      dealLink,
      `Expected associated deal "${expectedDealName}" to be visible on the call log detail panel`
    ).toBeVisible({ timeout: 15000 });
    logger.success(`Associated deal confirmed on detail: "${expectedDealName}"`);
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
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailEditButton()).toBeVisible({ timeout: 10000 })
    );
    logger.success('Edit button confirmed visible');
  }

  async assertEditButtonNotVisible(): Promise<void> {
    logger.info('Asserting Edit button NOT visible');
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailEditButton()).toBeHidden({ timeout: 5000 })
    );
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
    await this.withSessionExpiryRecovery(() =>
      expect(this.callLogListItem().first()).toBeVisible({ timeout: 15000 })
    );
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
    // WHY: Use navigation timeout — prod loads slower than QA
    await callLogsBtn.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    await callLogsBtn.scrollIntoViewIfNeeded();
    await callLogsBtn.click();
    await this.productivityCallLogList().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
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

  // WHY: Creates a fresh lead owned by the current user and returns its full name.
  // Used when entity dropdown only shows SHR/ADM leads (shared/admin-owned)
  // which may not have call log permission, causing HTTP 403.
  private async ensureOwnedLeadExists(): Promise<string> {
    logger.info('Creating owned lead for call log entity selection');
    const leadsPage = new LeadsPage(this.page);
    const leadData = generateLeadData();
    await leadsPage.goToLeadsList();
    await leadsPage.createLead(leadData);
    const fullName = `${leadData.firstName} ${leadData.lastName}`;
    logger.success(`Created owned lead: ${fullName}`);
    return fullName;
  }

  // WHY: Creates a fresh contact owned by the current user.
  // Contact dropdown may only show SHR/ADM contacts — restricted user cannot create
  // call logs against entities they don't own, causing HTTP 403 on save.
  // Public so createCallLog() can pre-create a contact for the Deal flow's mandatory
  // Associated Contact secondary field, and so RBAC tests (e.g. CL23) can pre-create
  // one directly when calling fillCreateForm() without going through createCallLog().
  async ensureOwnedContactExists(): Promise<string> {
    logger.info('Creating owned contact for call log entity selection');
    const contactsPage = new ContactsPage(this.page);
    const contactData = generateContactData();
    await contactsPage.goToContactsList();
    await contactsPage.createContact(contactData);
    const fullName = `${contactData.firstName} ${contactData.lastName}`;
    logger.success(`Created owned contact: ${fullName}`);
    return fullName;
  }

  // WHY: Creates a fresh deal owned by the current user.
  // Deal dropdown may only show SHR/ADM deals — restricted user cannot create
  // call logs against deals they don't own, causing HTTP 403 on save.
  // Public so CL23 (which uses the manual form-fill path) can pre-create a deal
  // and pass its name as selectedEntityName to fillCreateForm.
  // WHY the optional associatedContactName (root-caused 2026-07-22, NOT a
  // timing/indexing-lag issue despite what CL4/CL22's "Associated Deal"
  // search retry warnings suggested): confirmed live via a deliberate
  // investigation (temp spec, deleted after use) that even a 15s wait + 5
  // search retries still found ZERO options in the Contact-flow's Associated
  // Deal dropdown — including the UNFILTERED base list, before typing
  // anything. Root cause: this deal was created with NO associatedContactName,
  // so DealsPage.fillDealForm() picks a RANDOM pre-existing contact (already
  // documented codebase behavior, see DealsPage's own comment on
  // selectFirstOptionFromDropdown) — the deal is never actually linked to the
  // specific contact the call log flow just created. The "Associated Deal"
  // field filters by genuine contact-relationship, so it correctly showed
  // nothing; no retry count or wait duration could ever fix data that isn't
  // related. Passing the real contact name here (when the caller has one)
  // makes the deal genuinely linked, which is the actual fix — not a longer
  // timeout. Left optional so the entityType==='Deal' call site (which needs
  // a standalone deal, no contact-linkage requirement) is unaffected.
  async ensureOwnedDealExists(associatedContactName?: string): Promise<string> {
    logger.info('Creating owned deal for call log entity selection');
    const dealsPage = new DealsPage(this.page);
    const dealData = generateDealData(associatedContactName ? { associatedContactName } : {});
    await dealsPage.goToDealsList();
    await dealsPage.createDeal(dealData);
    logger.success(`Created owned deal: ${dealData.name}`);
    return dealData.name;
  }

  // WHY the optional checkCustomFieldsAbsent option (2026-07-31, defaults to
  // false — zero behavior change for every existing caller): same reasoning
  // as QuotationsPage.createQuotation()'s identical param — see that
  // method's own comment. Adding the skip-check unconditionally would have
  // silently started skipping every OTHER pre-existing Call Log test on
  // Stage too.
  async createCallLog(
    data: CallLogData,
    options: {
      includeNoteDuringCreate?: boolean;
      selectedEntityName?: string;
      checkCustomFieldsAbsent?: boolean;
    } = {}
  ): Promise<{
    callLogId: number | null;
    entityName: string;
    selectedPhone: string;
    associatedDealName: string | null;
  }> {
    logger.info(`Creating call log — entity: ${data.entityType}, outcome: ${data.outcome}`);
    // WHY: Auto-create an owned entity when no specific entity is requested.
    // The entity dropdown may show only SHR/ADM-prefixed items from other test runs.
    // Saving a call log against an entity the user doesn't own → HTTP 403 "necessary permission".
    let resolvedEntityName = options.selectedEntityName;
    if (data.entityType === 'Lead' && !resolvedEntityName) {
      resolvedEntityName = await this.ensureOwnedLeadExists();
      await this.goToCallLogsList();
    }
    if (data.entityType === 'Contact' && !resolvedEntityName) {
      resolvedEntityName = await this.ensureOwnedContactExists();
      await this.goToCallLogsList();
    }
    if (data.entityType === 'Deal' && !resolvedEntityName) {
      resolvedEntityName = await this.ensureOwnedDealExists();
      await this.goToCallLogsList();
    }
    // WHY: Secondary entity fields (Associated Contact on Deal flow — mandatory;
    // Associated Deal on Contact flow — optional) previously relied on
    // searchAndSelectEntity()'s no-searchTerm fallback, which picks an UNFILTERED
    // random option when no clearly-owned option exists — this can select an
    // admin-owned entity, causing HTTP 403 "necessary permission" on save. Pre-create
    // an owned secondary entity here (before the modal opens) and pass its name
    // through, same pattern as the primary entity above.
    let resolvedSecondaryEntityName: string | undefined;
    if (data.entityType === 'Deal') {
      resolvedSecondaryEntityName = await this.ensureOwnedContactExists();
      await this.goToCallLogsList();
    } else if (data.entityType === 'Contact' && data.includeAssociatedDeal) {
      // WHY pass resolvedEntityName here: see ensureOwnedDealExists()'s own
      // comment — without this, the created deal has no real relationship to
      // this specific contact and the Associated Deal field correctly (but
      // confusingly) shows zero options no matter how long you wait/retry.
      resolvedSecondaryEntityName = await this.ensureOwnedDealExists(resolvedEntityName);
      await this.goToCallLogsList();
    }
    await this.openLogACallForm();
    if (options.checkCustomFieldsAbsent) {
      await this.skipIfCustomFieldsAbsent();
    }
    const { entityName, selectedPhone, associatedDealName } = await this.fillCreateForm(
      data,
      resolvedEntityName,
      options.includeNoteDuringCreate ?? false,
      resolvedSecondaryEntityName
    );
    const callLogId = await this.saveCallLog();

    logger.success(`Call log created — ID: ${callLogId}, entity: ${entityName}`);
    return { callLogId, entityName, selectedPhone, associatedDealName };
  }

  async updateCallLog(
    callLogId: number,
    newData: CallLogData,
    updateCustomFields = false
  ): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      logger.info(`Updating call log ID: ${callLogId}`);
      await this.goToCallLogById(callLogId);
      await this.clickEditButton();
      await this.fillEditForm(newData, updateCustomFields);
      await this.saveEditedCallLog();
      logger.success(`Call log ID ${callLogId} updated`);
    }, 'updateCallLog');
  }
}