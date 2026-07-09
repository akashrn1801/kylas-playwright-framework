import { config } from '../../config/config';
import { Page, Locator, expect } from '@playwright/test';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import { isSignInUrl, tryRecoverSessionForPage } from '../auth/authManager';

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── Navigation ───────────────────────────────────────────

  async navigateTo(url: string): Promise<void> {
    logger.info(`Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async reloadPage(): Promise<void> {
    logger.info('Reloading page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  // ─── Click Actions ────────────────────────────────────────

  async click(locator: Locator, description = 'element', force = false): Promise<void> {
    logger.info(`Clicking: ${description}`);
    // WHY: captured BEFORE the action, not inside the catch block — by the
    // time an exception is caught here, the page may already be on
    // /signIn (that's the trigger condition itself), so deriving "where to
    // go back to" at that point would just point back at signIn.
    const urlBeforeAction = this.page.url();
    try {
      // WHY: Explicit timeout prevents silent infinite hang when an element never renders.
      // Without a timeout, waitFor inherits the test timeout (up to 600s) — the test
      // then hangs until Playwright teardown instead of failing with an actionable error.
      await locator.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await locator.click({ timeout: 15000, force });
    } catch (error) {
      // WHY: mid-test session recovery (2026-07-09) — confirmed live and via
      // CI logs that Kylas's QA backend occasionally returns a spurious
      // auth-recognition failure on an unrelated request, which the app's
      // own frontend responds to by redirecting to /signIn — unrelated to
      // the actual ~12h token lifetime. Gated strictly on actually being on
      // that URL right now (never on "any error") so a real RBAC denial —
      // which this app expresses as an in-page toast, confirmed via
      // CallLogsPage's own permission-error handling, never a redirect —
      // can't be mistaken for this. tryRecoverSessionForPage() itself
      // throws (not returns false) if it lands on a permission-denied page
      // after recovering, so that case still surfaces as a real failure
      // here too. The retry below is the same, unwrapped Playwright call —
      // no second recovery attempt, no swallowing — so a failure on retry
      // (including a second redirect) propagates directly as a genuine error.
      if (!isSignInUrl(this.page.url())) {
        throw error;
      }
      logger.warn(
        `"${description}" failed while on a signIn/login page — attempting one-time session recovery`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAction);
      await locator.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await locator.click({ timeout: 15000, force });
    }
  }

  async clickByText(text: string): Promise<void> {
    logger.info(`Clicking by text: ${text}`);
    await this.page.getByText(text).click();
  }

  // ─── Input Actions ────────────────────────────────────────

  async fill(locator: Locator, value: string, description = 'field'): Promise<void> {
    logger.info(`Filling ${description} with: ${value}`);
    // WHY: see click()'s identical comment — must capture before the try.
    const urlBeforeAction = this.page.url();
    try {
      await locator.waitFor({ state: 'visible' });
      await locator.clear();
      await locator.fill(value);
    } catch (error) {
      // WHY: same mid-test session recovery as click() above — see that
      // method's comment for the full rationale. Kept as a single,
      // non-recursive retry of the exact same calls.
      if (!isSignInUrl(this.page.url())) {
        throw error;
      }
      logger.warn(
        `Filling "${description}" failed while on a signIn/login page — attempting one-time session recovery`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAction);
      await locator.waitFor({ state: 'visible' });
      await locator.clear();
      await locator.fill(value);
    }
  }

  async selectOption(locator: Locator, value: string, description = 'dropdown'): Promise<void> {
    logger.info(`Selecting ${value} in ${description}`);
    await locator.waitFor({ state: 'visible' });
    await locator.selectOption(value);
  }

  // ─── Wait Helpers ─────────────────────────────────────────

  async waitForVisible(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'hidden', timeout });
  }

  async waitForUrl(
    urlPattern: string | RegExp,
    timeout = config.timeouts.navigation
  ): Promise<void> {
    logger.info(`Waiting for URL: ${urlPattern}`);
    // WHY: Confirmed live (2026-07-07) — Playwright's waitForURL defaults to
    // waitUntil: 'load' when not specified, which waits for EVERY resource on
    // the page (images, third-party embeds/chat-widget iframes, analytics
    // beacons) to finish, not just the URL changing. Under real-world load
    // this occasionally exceeds even a 60s timeout despite the navigation
    // having functionally succeeded already. Every other navigation-wait in
    // this codebase (waitForXDetailsPage() etc.) already uses
    // domcontentloaded for exactly this reason — bring this shared helper in
    // line with that established, proven convention.
    await this.page.waitForURL(urlPattern, { timeout, waitUntil: 'domcontentloaded' });
  }

  // ─── Assertion Helpers ────────────────────────────────────

  async assertVisible(locator: Locator, description = 'element', timeout = 30000): Promise<void> {
    logger.info(`Asserting visible: ${description}`);
    await expect(locator).toBeVisible({ timeout });
  }

  async assertText(locator: Locator, expectedText: string): Promise<void> {
    logger.info(`Asserting text: ${expectedText}`);
    await expect(locator).toHaveText(expectedText);
  }

  async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    logger.info(`Asserting URL: ${expectedUrl}`);
    await expect(this.page).toHaveURL(expectedUrl);
  }

  // ─── Utility ──────────────────────────────────────────────

  async takeScreenshot(name: string): Promise<void> {
    logger.info(`Taking screenshot: ${name}`);
    await this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  async isVisible(locator: Locator): Promise<boolean> {
    return await locator.isVisible();
  }

  async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.textContent()) || '';
  }
  async assertNoFormErrors(context = 'form'): Promise<void> {
    logger.info(`Checking for validation errors in ${context}`);

    // WHY: Wait briefly for any error messages to appear after save action
    await this.page.waitForTimeout(1500);

    // Field level errors
    const fieldErrors = await this.page
      .locator('input.is-invalid, select.is-invalid, textarea.is-invalid')
      .evaluateAll((els: any[]) => els.map((el) => el.name || el.id || 'unknown'));

    // Inline validation messages
    const inlineErrors = await this.page
      .locator('.invalid-feedback:visible, .error-message:visible, .alert-danger:visible')
      .allTextContents();

    // Toast/notification errors
    const toastErrors = await this.page
      .locator(
        '.toast, .toast-error, .toast-danger, .notification-error, [class*="toast"][class*="error"], [class*="alert"][class*="error"], .Toastify__toast--error, .swal2-error'
      )
      .allTextContents();

    // Any visible error containers — use specific selectors to avoid false positives
    // WHY: [class*="error"] is too broad — matches React Select is-invalid__ classes
    // which contain currency values (INR). Use only known error container classes.
    const errorContainers = await this.page
      .locator(
        '.error-container:visible, .form-error:visible, .field-error:visible, .alert.alert-danger:visible'
      )
      .allTextContents();

    const allErrors = [...inlineErrors, ...toastErrors, ...errorContainers]
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (allErrors.length > 0 || fieldErrors.length > 0) {
      throw new Error(
        `Validation errors found in ${context}:\n` +
          `Fields with errors: ${fieldErrors.join(', ')}\n` +
          `Error messages: ${allErrors.join(' | ')}`
      );
    }

    logger.success(`No validation errors found in ${context}`);
  }

  async assertFormErrorToast(expectedMessageSubstring: string, context = 'form'): Promise<void> {
    logger.info(`Asserting error toast in ${context}: "${expectedMessageSubstring}"`);
    const toast = this.page
      .locator('.toastr.rrt-error .rrt-middle-container, .rrt-middle-container')
      .filter({ hasText: expectedMessageSubstring });
    await expect(
      toast.first(),
      `Expected an error toast containing "${expectedMessageSubstring}" in ${context}, but it never appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });
    logger.success(`Error toast confirmed in ${context}: "${expectedMessageSubstring}"`);
  }

  // ─── Custom Field Helpers (generic — reusable across entities/modules) ────
  // WHY: Kylas custom fields currently exist only on specific entities in
  // specific environments (e.g. these 9 Lead custom fields, QA-only as of
  // 2026-07-08) and are expected to be added to more entities/environments
  // later with identical names/types. Every method below checks DOM presence
  // first and skips gracefully — with a clear log explaining why — when a
  // field is absent, so the exact same call site starts working the moment
  // the field is added elsewhere, with zero code changes required.
  //
  // Methods are parameterized by the raw Kylas field name (e.g. "TextField")
  // rather than typed to any one entity, so Contacts/Companies/Deals can
  // reuse them unchanged when they get their own custom fields later.

  private customFieldInputLocator(fieldName: string): Locator {
    // WHY: matches by suffix, not the full id — the numeric prefix Kylas
    // generates (e.g. "7_11_input_...") was confirmed live (2026-07-08) to be
    // a static per-render wrapper index, not something that varies by field,
    // pipeline, or context. Matching on the suffix alone is exactly as
    // reliable today and removes any dependency on that prefix ever staying
    // the same, at no extra cost.
    //
    // WHY scoped to input/textarea: confirmed live (2026-07-08) — react-dates
    // renders an accessibility <p id="DateInput__screen-reader-message-<the
    // input's own id>"> alongside a Date/DateTimePicker field, which (being
    // built by prefixing the real input's id) ALSO ends with this same
    // suffix and breaks strict-mode uniqueness. Every one of the 9 field
    // types is either an <input> or a <textarea> (ParagraphText) — excluding
    // every other tag removes this collision without narrowing which real
    // fields can match.
    const suffix = `_input_customFieldValues.cf${fieldName}`;
    return this.page.locator(`input[id$="${suffix}"], textarea[id$="${suffix}"]`);
  }

  private async isCustomFieldPresent(fieldName: string): Promise<boolean> {
    return (await this.customFieldInputLocator(fieldName).count()) > 0;
  }

  private logCustomFieldSkipped(description: string, fieldName: string, action: string): void {
    logger.info(
      `Custom field "${description}" (cf${fieldName}) not found in this environment — skipping ${action}. ` +
        'This field is expected to exist on QA today and on Stage/Prod later with an identical name; ' +
        'no code change will be required when it is added there.'
    );
  }

  // WHY: TextField, ParagraphText, Number (as a string), and UrlField all
  // render as a plain <input>/<textarea> and are filled identically via
  // Playwright's fill() — one parameterized method instead of four
  // near-duplicates. Callers convert non-string values (e.g. Number) to a
  // string before calling.
  async fillTextLikeCustomField(
    fieldName: string,
    value: string,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'fill');
      return;
    }
    await this.fill(this.customFieldInputLocator(fieldName), value, `custom field: ${description}`);
  }

  async setCheckboxCustomField(
    fieldName: string,
    checked: boolean,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'checkbox toggle');
      return;
    }
    const checkbox = this.customFieldInputLocator(fieldName);
    const isChecked = await checkbox.isChecked().catch(() => false);
    if (isChecked !== checked) {
      await this.click(checkbox, `custom field checkbox: ${description}`);
    }
  }

  // WHY: shared by any single-select react-select control, custom field or
  // standard field alike — selectPicklistCustomField() below is a thin,
  // presence-checked wrapper for custom fields; standard fields that are
  // always present (e.g. Lead's Campaign/Source) call this directly with
  // their own control locator instead of duplicating the open/read/click
  // sequence. Returns the value actually selected — never hardcode which
  // option exists, always read the live menu.
  protected async selectRandomFromSingleReactSelect(
    control: Locator,
    description: string
  ): Promise<string> {
    await this.click(control, `react-select control: ${description}`);
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    await options.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const optionTexts = (await options.allInnerTexts()).map((t) => t.trim());
    if (optionTexts.length === 0) {
      throw new Error(
        `${description}: react-select opened but has zero live options — cannot select a value`
      );
    }
    const randomIndex = Math.floor(Math.random() * optionTexts.length);
    const selectedValue = optionTexts[randomIndex];
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    logger.success(`${description} set to: ${selectedValue}`);
    return selectedValue;
  }

  // WHY: returns the selected value (rather than void) because PickList
  // options are read live from the DOM and never hardcoded — the caller
  // needs to know what was actually picked in order to verify it later.
  // Returns null when the field is absent, so callers can tell "skipped"
  // apart from "selected an empty-looking value".
  async selectPicklistCustomField(
    fieldName: string,
    description = fieldName
  ): Promise<string | null> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'picklist selection');
      return null;
    }
    const control = this.customFieldInputLocator(fieldName).locator(
      'xpath=ancestor::div[contains(@class,"__control")]'
    );
    return this.selectRandomFromSingleReactSelect(control, `Custom field "${description}"`);
  }

  // WHY: shared by any multi-select react-select control, custom field or
  // standard field alike — mirrors selectRandomFromSingleReactSelect's
  // reuse pattern above. selectMultiPicklistCustomField() below is a thin,
  // presence-checked wrapper for custom fields; standard fields that are
  // always present (e.g. Lead's "Products or Services") call this directly
  // with their own control locator. Confirmed live (2026-07-08) this also
  // works correctly for lookup-backed multi-selects (Products or Services
  // searches real Product records under the hood) — not just static-option
  // ones — because clearing existing chips first reliably repopulates the
  // menu with whatever was just freed up, regardless of how the option list
  // itself is sourced.
  //
  // Selects a RANDOM COUNT between 2 and however many options actually
  // exist live — computed from the live option count, never a fixed number.
  async selectRandomFromMultiValueReactSelect(
    control: Locator,
    description: string
  ): Promise<string[]> {
    // WHY: confirmed live (2026-07-08 update-path investigation) — on edit,
    // this field already has chips selected from create. Without clearing
    // them first, newly-clicked options ADD to the existing selection
    // instead of replacing it (confirmed by the math: an edit that selected
    // 4 new options produced 8 total selected — the union of the old 4 and
    // the new 4). An update must replace, not accumulate, so remove every
    // existing chip before selecting the new set.
    // WHY: bounded — confirmed live (2026-07-08) that an unbounded version of
    // this loop can hang for the entire test timeout if a chip's remove
    // button doesn't detach the chip on click (stale reference/re-render
    // race). A field realistically holds at most the total live option
    // count worth of chips, so that count plus headroom is a safe, generous
    // bound that still fails fast and loudly instead of hanging silently.
    const maxChipsToClear = 50;
    let clearedCount = 0;
    let existingChip = control.locator('.is-invalid__multi-value__remove').first();
    while (
      (await existingChip.isVisible({ timeout: 1000 }).catch(() => false)) &&
      clearedCount < maxChipsToClear
    ) {
      await existingChip.click({ timeout: 5000 });
      // WHY: confirmed live (2026-07-08) — clicking a chip's remove button
      // also bubbles into the control's own click handler and pops the
      // options menu open, which then renders on top of (and blocks clicks
      // on) the remaining chips' remove buttons. Close it before the next
      // removal attempt so it never gets the chance to intercept a click.
      const menuOpen = await this.page
        .locator('.is-invalid__menu')
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (menuOpen) {
        await this.page.keyboard.press('Escape');
      }
      await this.page.waitForTimeout(150);
      existingChip = control.locator('.is-invalid__multi-value__remove').first();
      clearedCount++;
    }
    if (clearedCount >= maxChipsToClear) {
      throw new Error(
        `${description}: still had chips to clear after ${maxChipsToClear} removal attempts — a chip's remove button may not be detaching it`
      );
    }
    // WHY: defense in depth — the loop above exits based on isVisible()
    // checks that can theoretically race a re-render; confirm zero chips
    // actually remain rather than only trusting the loop's own exit
    // condition, so an incomplete clear fails loudly here instead of
    // silently producing a wrong total that only surfaces later as a
    // confusing detail-page verification mismatch.
    const remainingChips = await control.locator('.is-invalid__multi-value__remove').count();
    if (remainingChips > 0) {
      throw new Error(
        `${description}: ${remainingChips} chip(s) still present after the clear loop reported done — clearing is unreliable`
      );
    }

    // WHY: this very first open always happens with zero chips selected
    // (the chip-clearing block above guarantees it) — clicking the control
    // div itself is safe here since there's no remove icon anywhere inside
    // it yet to accidentally hit. Once at least one chip exists, later
    // reopen-clicks in the loop below switch to clicking the control's own
    // <input> instead — see that comment for why.
    const controlInput = control.locator('input').first();
    await this.click(control, `multi-select control: ${description}`);
    const menuOptions = this.page.locator('.is-invalid__menu .is-invalid__option');
    await menuOptions.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const allOptionTexts = (await menuOptions.allInnerTexts()).map((t) => t.trim());
    if (allOptionTexts.length === 0) {
      throw new Error(
        `${description}: multi-select opened but has zero live options — cannot select values`
      );
    }
    const minSelect = Math.min(2, allOptionTexts.length);
    const selectCount =
      minSelect + Math.floor(Math.random() * (allOptionTexts.length - minSelect + 1));
    const toSelect = [...allOptionTexts].sort(() => Math.random() - 0.5).slice(0, selectCount);

    const selected: string[] = [];
    for (const optionText of toSelect) {
      // WHY: the options menu can close after each selection on a multi-select —
      // reopen it before every pick rather than assuming it stays open.
      //
      // WHY this reopen click targets the control's own <input>, never the
      // control div: confirmed live (2026-07-08) via document.elementFromPoint()
      // instrumentation — Playwright's default click() targets the CENTER of
      // an element's bounding box, and the control div's box grows as chips
      // accumulate. Once enough chips wrap onto multiple lines, that center
      // point can drift directly onto a previously-added chip's own "x"
      // remove icon (a sibling element layered inside the same control div)
      // instead of empty control space — silently un-selecting that chip
      // instead of reopening the menu. This was the actual root cause of the
      // "chip drop" flake previously attributed to an unconfirmed app-level
      // React race (see CLAUDE.md's "Lead multi-select fields ('chip drop')
      // — root-caused and fixed" entry). The input is a distinct
      // child DOM node with its own small bounding box that never overlaps a
      // chip's remove icon, so clicking it is immune to this collision
      // regardless of how many chips are already selected. It's only safe to
      // use here (not for the very first open above) because by this point
      // at least one chip already exists, so the input is no longer covered
      // by the empty-state placeholder text.
      const menuOpen = await this.page
        .locator('.is-invalid__menu')
        .isVisible()
        .catch(() => false);
      if (!menuOpen) {
        await this.click(controlInput, `multi-select control: ${description}`);
        await this.page
          .locator('.is-invalid__menu .is-invalid__option')
          .first()
          .waitFor({ state: 'visible', timeout: config.timeouts.expect });
      }
      const option = this.page
        .locator('.is-invalid__menu .is-invalid__option')
        .filter({ hasText: optionText })
        .first();
      await option.click();
      await this.page.waitForTimeout(200);

      // WHY: confirmed live (2026-07-08) — a click here can silently fail to
      // register a new chip (e.g. a stale menu reference during rapid
      // sequential selections under load), producing a widget with fewer
      // values selected than this method believed it selected. That
      // discrepancy previously only surfaced much later, confusingly, during
      // detail-page verification — confirm the chip actually landed before
      // trusting it, and retry once if it didn't.
      const chipLanded = (locator: string) =>
        control
          .locator('.is-invalid__multi-value__label')
          .filter({ hasText: locator })
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false);

      if (!(await chipLanded(optionText))) {
        logger.warn(
          `${description}: chip for "${optionText}" did not appear after clicking — retrying once`
        );
        const menuOpenForRetry = await this.page
          .locator('.is-invalid__menu')
          .isVisible()
          .catch(() => false);
        if (!menuOpenForRetry) {
          await this.click(controlInput, `multi-select control: ${description}`);
          await this.page
            .locator('.is-invalid__menu .is-invalid__option')
            .first()
            .waitFor({ state: 'visible', timeout: config.timeouts.expect });
        }
        await this.page
          .locator('.is-invalid__menu .is-invalid__option')
          .filter({ hasText: optionText })
          .first()
          .click();
        await this.page.waitForTimeout(200);
        if (!(await chipLanded(optionText))) {
          throw new Error(
            `${description}: chip for "${optionText}" still did not appear after a retry — selection is unreliable`
          );
        }
      }
      selected.push(optionText);
    }
    await this.page.keyboard.press('Escape');

    // WHY: confirmed live (2026-07-08) — every individual chip can verify as
    // landed at the moment it's clicked (the per-click check above), yet a
    // later selection or the closing Escape can still cause an earlier chip
    // to silently drop before Save — a lead selected 7 options with every
    // one individually confirmed, but only 5 were actually present by the
    // time the form was saved. Re-verify the FULL final set together, after
    // the whole sequence and Escape complete, so this gap is caught here —
    // at the point of fill, with full context — instead of surfacing later
    // as a confusing detail-page verification mismatch.
    const finalChipCount = await control.locator('.is-invalid__multi-value__label').count();
    if (finalChipCount !== selected.length) {
      const finalChipTexts = await control
        .locator('.is-invalid__multi-value__label')
        .allInnerTexts();
      throw new Error(
        `${description}: selected ${selected.length} values [${selected.join(', ')}] but only ${finalChipCount} chip(s) remain in the control after the full selection completed: [${finalChipTexts.join(', ')}] — some selections were silently dropped`
      );
    }

    logger.success(`${description} set to: ${selected.join(', ')}`);
    return selected;
  }

  // WHY: presence-checked wrapper for custom fields — resolves the control
  // from the custom-field id suffix, then delegates to
  // selectRandomFromMultiValueReactSelect() for the actual interaction. Returns
  // null vs [] would be ambiguous with "selected nothing"; [] covers both
  // "skipped" and "field had zero options" cases identically for this
  // method's existing callers, matching its prior behavior.
  async selectMultiPicklistCustomField(
    fieldName: string,
    description = fieldName
  ): Promise<string[]> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'multi-picklist selection');
      return [];
    }
    const control = this.customFieldInputLocator(fieldName).locator(
      'xpath=ancestor::div[contains(@class,"__control")]'
    );
    return this.selectRandomFromMultiValueReactSelect(control, `Custom field "${description}"`);
  }

  private formatCustomFieldDateLabel(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  // WHY: matches the react-dates SingleDatePicker pattern already proven in
  // QuotationsPage.selectDateInPicker() — confirmed live (2026-07-08) that
  // Lead's "Date" custom field uses the identical widget.
  //
  // WHY read-the-calendar instead of guess-a-direction: an earlier version
  // of this method tried "search forward N months, then reset and search
  // backward N months" — this failed live in a case where the target date
  // exactly equaled the field's current value (zero navigation should have
  // been needed) yet the calendar had opened on a month 6 months away in
  // EITHER direction from that value, disproving the assumption that the
  // calendar always starts on the field's current value's month. Guessing
  // a starting position and a search direction is fundamentally the wrong
  // approach when the starting position isn't reliably knowable in advance.
  // CallLogsPage.selectDateInPicker() (proven across 43 passing tests)
  // solves this correctly: read the aria-labels of whatever day cells are
  // ACTUALLY rendered right now, parse their real month/year, and navigate
  // toward the target relative to that — no assumption about the starting
  // point required, because the direction is recomputed from reality on
  // every iteration. Ported here with a fallback identical to CallLogsPage's:
  // if 24 navigations still don't find it, type the date directly into the
  // input as MM/DD/YYYY rather than continuing to click blindly.
  async selectDateCustomField(
    fieldName: string,
    date: Date,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'date selection');
      return;
    }
    const input = this.customFieldInputLocator(fieldName);
    await this.click(input, `custom field date input: ${description}`);
    const label = this.formatCustomFieldDateLabel(date);
    const dayCell = this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);
    const forwardButton = this.page.getByLabel('Move forward to switch to the next month.');
    const backwardButton = this.page.getByLabel('Move backward to switch to the previous month.');

    let found = await dayCell.isVisible({ timeout: 1500 }).catch(() => false);
    const targetMonthKey = date.getFullYear() * 12 + date.getMonth();
    let attempts = 0;
    while (!found && attempts < 24) {
      const visibleMonthKeys: number[] = await this.page.evaluate(() =>
        Array.from(document.querySelectorAll('.SingleDatePicker td[aria-label]'))
          .map((cell) => {
            // WHY: strip status prefixes like "Selected. "/"Not available. "
            // before parsing — otherwise those cells are silently dropped.
            const cellLabel =
              cell.getAttribute('aria-label')?.replace(/^[A-Za-z ]+\.\s*/, '') ?? null;
            const parsed = cellLabel ? new Date(cellLabel) : null;
            return parsed && !isNaN(parsed.getTime())
              ? parsed.getFullYear() * 12 + parsed.getMonth()
              : null;
          })
          .filter((v): v is number => v !== null)
      );
      const backVisible = await backwardButton.isVisible().catch(() => false);
      const forwardVisible = await forwardButton.isVisible().catch(() => false);
      const minVisibleMonth = visibleMonthKeys.length ? Math.min(...visibleMonthKeys) : null;
      const maxVisibleMonth = visibleMonthKeys.length ? Math.max(...visibleMonthKeys) : null;
      const shouldGoBack =
        minVisibleMonth !== null && targetMonthKey < minVisibleMonth
          ? true
          : maxVisibleMonth !== null && targetMonthKey > maxVisibleMonth
            ? false
            : backVisible;
      if (shouldGoBack && backVisible) {
        await backwardButton.click();
      } else if (forwardVisible) {
        await forwardButton.click();
      } else if (backVisible) {
        await backwardButton.click();
      }
      await this.page.waitForTimeout(400);
      found = await dayCell.isVisible({ timeout: 1000 }).catch(() => false);
      attempts++;
    }
    if (!found) {
      logger.warn(
        `Custom field "${description}" (cf${fieldName}): day cell not found after ${attempts} calendar navigations — falling back to typing the date directly`
      );
      await this.page.keyboard.press('Escape');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      await input.click({ clickCount: 3 });
      await input.fill(`${mm}/${dd}/${yyyy}`);
      await this.page.keyboard.press('Tab');
    } else {
      await dayCell.click();
    }
    logger.success(`Custom field "${description}" date set to: ${date.toDateString()}`);
  }

  // WHY: confirmed live (2026-07-08) — DateTimePicker is NOT the same single
  // widget as Date. It pairs the same SingleDatePicker for its date half with
  // a SEPARATE rc-time-picker widget for time (identical to the one already
  // handled in MeetingsPage.fillTimePicker()/CallLogsPage) — the time input
  // starts disabled and only becomes enabled once a date has been picked.
  async selectDateTimeCustomField(
    fieldName: string,
    date: Date,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'date-time selection');
      return;
    }
    await this.selectDateCustomField(fieldName, date, description);

    const timeInput = this.page.locator(`[id$="_input_customFieldValues.cf${fieldName}_time"]`);
    await expect(
      timeInput,
      `Custom field "${description}" (cf${fieldName}): time input never became enabled after selecting a date`
    ).toBeEnabled({ timeout: config.timeouts.expect });
    // WHY: force — the rc-time-picker input sits behind a clock icon that can
    // intercept the click at its exact center, same as confirmed live in the
    // investigation that produced this method.
    await this.click(timeInput, `custom field time input: ${description}`, true);
    await this.page.waitForSelector('.rc-time-picker-panel', { timeout: config.timeouts.expect });

    const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    const hourStr = String(hour12).padStart(2, '0');
    const minuteStr = String(date.getMinutes()).padStart(2, '0');
    const amPm = date.getHours() < 12 ? 'am' : 'pm';
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
    await columns
      .nth(2)
      .locator('li', { hasText: new RegExp(`^${amPm}$`, 'i') })
      .click();
    await this.page.waitForTimeout(200);
    await this.page.keyboard.press('Escape');

    logger.success(
      `Custom field "${description}" date-time set to: ${date.toDateString()} ${hourStr}:${minuteStr} ${amPm}`
    );
  }

  // WHY: matches the detail-page display format confirmed live (2026-07-08)
  // on the Lead entity: a date custom field renders as "Jul 13, 2026", and a
  // date-time custom field renders as the same date format plus
  // " at h:mm am/pm" (lowercase am/pm, no leading zero on hour — the
  // rc-time-picker default). This is a Kylas-platform rendering convention,
  // not something specific to Lead, so it lives here (protected, not
  // private) rather than in LeadsPage — ready for Contacts/Companies/Deals
  // to call once they get their own Date/DateTimePicker custom fields,
  // instead of re-deriving the same format independently.
  protected formatCustomFieldDetailDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected formatCustomFieldDetailDateTime(date: Date): string {
    const datePart = this.formatCustomFieldDetailDate(date);
    const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    const minuteStr = String(date.getMinutes()).padStart(2, '0');
    const amPm = date.getHours() < 12 ? 'am' : 'pm';
    return `${datePart} at ${hour12}:${minuteStr} ${amPm}`;
  }

  // WHY: shared by any single-value detail-page field, custom or standard —
  // assertCustomFieldOnDetail() below is a thin wrapper that prefixes the
  // custom-field "cf" convention; standard fields (e.g. Lead's Currency,
  // Budget) call this directly with their own container id (confirmed live
  // 2026-07-08 — standard fields use the exact same `[id="X"] .title`
  // read-only-info markup, just without the "cf" prefix). Render-race safe
  // by design — uses Playwright's auto-retrying toContainText() instead of
  // a one-shot textContent()/innerText() read. This framework already
  // tracked down a real bug class where a one-shot read raced React's
  // re-render after a GET response resolved (see the assert*Updated fixes
  // across Companies/Contacts/Deals/Leads/Quotations); do not reintroduce
  // that pattern here.
  async assertFieldOnDetailByContainerId(
    containerId: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    const valueLocator = this.page.locator(`[id="${containerId}"] .title`);
    await expect(
      valueLocator,
      `Expected "${description}" (container #${containerId}) to show "${expectedValue}" on the detail page, but it never appeared`
    ).toContainText(expectedValue, { timeout: config.timeouts.expect });
    logger.success(`"${description}" verified on detail page: "${expectedValue}"`);
  }

  async assertCustomFieldOnDetail(
    fieldName: string,
    expectedValue: string,
    description = fieldName
  ): Promise<void> {
    await this.assertFieldOnDetailByContainerId(
      `cf${fieldName}`,
      expectedValue,
      `Custom field "${description}"`
    );
  }

  // WHY: shared by any multi-value detail-page field, custom or standard —
  // assertMultiPicklistCustomFieldOnDetail() below is a thin "cf"-prefixed
  // wrapper; standard fields (e.g. Lead's "Products or Services", confirmed
  // live 2026-07-08 to use the identical `.with-details-multi-value` markup
  // despite being a lookup field under the hood, not a static picklist)
  // call this directly with their own container id.
  //
  // WHY the truncation handling exists at all: confirmed live (2026-07-08) —
  // a multi-value field's detail-page display truncates to "first 2 values
  // (in the widget's own render order, NOT selection order) + (+N)" once
  // more than 2 are selected, and the remaining N values are not present
  // anywhere in the DOM — no title, no data attribute, no aria-label, no
  // tooltip or click-to-expand on the "+N" indicator (confirmed by dumping
  // every attribute on every node in the container). Asserting every
  // selected value is therefore impossible through this UI when there are
  // more than 2 — verify only what it actually exposes: exactly 2 rendered
  // values (each genuinely a member of what was selected) plus a correct
  // remaining count.
  async assertMultiValueFieldOnDetailByContainerId(
    containerId: string,
    expectedValues: string[],
    description: string
  ): Promise<void> {
    const container = this.page.locator(`[id="${containerId}"] .with-details-multi-value`);
    const items = container.locator('li');
    await expect(
      items.first(),
      `"${description}" (container #${containerId}): expected at least one rendered value on the detail page, but none appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });

    const rawTexts = await items.allInnerTexts();
    const itemTexts = rawTexts.map((t) => t.replace(/^,\s*/, '').trim());
    const isMoreCount = (t: string): boolean => /^\(\+\d+\)$/.test(t);
    const moreCountText = itemTexts.find(isMoreCount) ?? null;
    const visibleValues = itemTexts.filter((t) => !isMoreCount(t));

    if (!moreCountText) {
      // WHY: no truncation indicator present — the UI rendered every
      // selection, so every expected value must be among them.
      for (const value of expectedValues) {
        if (!visibleValues.includes(value)) {
          throw new Error(
            `"${description}" (container #${containerId}): expected "${value}" among rendered values [${visibleValues.join(', ')}], but it was missing`
          );
        }
      }
      logger.success(
        `"${description}" verified on detail page (no truncation): all ${expectedValues.length} values present`
      );
      return;
    }

    if (visibleValues.length !== 2) {
      throw new Error(
        `"${description}" (container #${containerId}): expected exactly 2 visible values before the truncation indicator, found ${visibleValues.length}: [${visibleValues.join(', ')}]`
      );
    }
    for (const value of visibleValues) {
      if (!expectedValues.includes(value)) {
        throw new Error(
          `"${description}" (container #${containerId}): rendered value "${value}" is not one of the selected values [${expectedValues.join(', ')}]`
        );
      }
    }
    const expectedMoreText = `(+${expectedValues.length - 2})`;
    if (moreCountText !== expectedMoreText) {
      throw new Error(
        `"${description}" (container #${containerId}): expected truncation indicator "${expectedMoreText}" (${expectedValues.length} total selected, 2 shown) but found "${moreCountText}"`
      );
    }
    logger.success(
      `"${description}" verified on detail page (truncated display): 2 of ${expectedValues.length} selected values shown, remaining count confirmed as ${moreCountText}`
    );
  }

  async assertMultiPicklistCustomFieldOnDetail(
    fieldName: string,
    expectedValues: string[],
    description = fieldName
  ): Promise<void> {
    await this.assertMultiValueFieldOnDetailByContainerId(
      `cf${fieldName}`,
      expectedValues,
      `Custom field "${description}"`
    );
  }

  // WHY: the inverse of assertNoFormErrors() — asserts a field-level
  // validation error DOES appear, scoped to the same selector convention
  // already used by LeadsPage.assertValidationError().
  async assertCustomFieldValidationError(
    fieldName: string,
    expectedMessage: string,
    description = fieldName
  ): Promise<void> {
    const error = this.page
      .locator('.invalid-feedback:visible, .help-text.error:visible')
      .filter({ hasText: expectedMessage });
    await expect(
      error.first(),
      `Expected validation error "${expectedMessage}" for custom field "${description}" (cf${fieldName}), but it never appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });
    logger.success(
      `Custom field "${description}" validation error confirmed: "${expectedMessage}"`
    );
  }

  async getLoggedInUserName(role: 'admin' | 'restricted' = 'restricted'): Promise<string> {
    try {
      const namesFile = path.join(
        __dirname,
        '../auth/storageStates',
        process.env.ENV || 'qa',
        'userNames.json'
      );
      if (fs.existsSync(namesFile)) {
        const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
        if (names[role]) {
          return names[role];
        }
      }
    } catch (_e) {
      // fall through to DOM fallback
    }
    // DOM fallback
    await this.page.locator('.user-profile-dropdown').click();
    const nameLocator = this.page.locator('.user-info .user-name').first();
    await nameLocator.waitFor({ state: 'visible', timeout: 5000 });
    const name = await nameLocator.innerText();
    await this.page.keyboard.press('Escape');
    return name.trim();
  }
}
