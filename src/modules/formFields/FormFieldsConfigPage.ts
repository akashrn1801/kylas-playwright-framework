import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

// WHY this module exists as its own directory, not folded into any single
// entity's own module (2026-09-21, Form Field Limit feature — full
// reasoning: FORM_FIELD_LIMIT_INVESTIGATION.md §3.1): the config screen
// this page object drives (/setup/fields/<entity>/list) is confirmed live
// to be ONE shared UI with a 9-entity tab strip, not a Lead-specific
// screen — every mechanic here (tabs, search, min/max ids, the regex
// react-select, its disable/auto-set behavior, the layoutCache mechanism)
// is entity-agnostic; only WHICH custom fields exist differs per entity.
// Mirrors this codebase's own existing answer to the identical "one UI
// mechanic, N per-entity call sites" shape — the Custom Fields pattern
// (generic BasePage helpers + a thin per-entity constant), and
// ProductsAndServicesPage.ts's own lived precedent for a `/setup/`-rooted
// page object living in its own src/modules/<name>/ directory. This pass
// wires up Lead only — do not add per-entity subclasses, a strategy
// pattern, or an entity registry ahead of a real second consumer (original
// doc §3.2's own explicit instruction).

export interface FormFieldsEntityConfig {
  // The tab's real, live-confirmed visible text on /setup/fields/<slug>/list
  // — confirmed NOT always identical to a module's own name convention
  // (e.g. Products & Services' real tab reads "Product & Service", not
  // "Products & Services" — FORM_FIELD_LIMIT_INVESTIGATION.md §2.1). Verify
  // live before hardcoding this for any future entity.
  tabLabel: string;
  // The URL path segment for /setup/fields/<urlSlug>/list and
  // /setup/fields/<urlSlug>/edit/<id> — confirmed for Lead: "leads".
  urlSlug: string;
}

export interface FieldConfigSnapshot {
  min: string;
  max: string;
  minDisabled: boolean;
  maxDisabled: boolean;
  // Empty string when this field type has no Regex control at all
  // (confirmed live: Number and Paragraph have none, Text does).
  regexLabel: string;
}

// WHY a named constant, not a repeated string literal (3 call sites): this
// is the app's own real, confirmed UI text for the Regex dropdown's
// default/blank option (FORM_FIELD_LIMIT_INVESTIGATION.md §2.2/§2.7), not
// an arbitrary choice this codebase made up. Naming it once means every
// place that depends on this exact string — selecting it, or checking
// whether it's already selected — reads from a single source instead of
// three independent literals that could silently drift apart if the text
// is ever re-verified and found to have changed.
const NO_REGEX_OPTION_LABEL = 'No Regex';

// WHY this class's config-mutating methods (configureFieldLimit,
// configureFieldRegex, clearFieldConfiguration) are NOT internally
// concurrency-safe, and why that is a deliberate, documented tradeoff
// rather than an oversight: every one of them mutates GLOBAL, ACCOUNT-WIDE
// field configuration (there is exactly one "leads" cfTextField min/max/
// regex setting shared by every test and every real user of this QA
// account — not a disposable per-test record). Two tests configuring the
// SAME field concurrently will race at the server, and whichever write
// lands last silently wins — there is no optimistic-locking or
// conflict-detection signal this page object could act on to fail loudly
// in that moment. The only real safeguard is process-level: every test
// file that calls these methods against the SAME field MUST wrap those
// tests in `test.describe.configure({ mode: 'serial' })` (see
// FORM_FIELD_LIMIT_INVESTIGATION.md §3.3 for the full reasoning, and this
// codebase's own "Sharding order-dependency audit" finding in
// known-issues.md that `fullyParallel: true` gives zero same-file
// execution-order guarantee without it). If that scoping is ever
// accidentally dropped, the SYMPTOM will be a confusing, hard-to-reproduce
// mismatch between what a test just configured and what
// readFieldConfigFresh()/assertFieldConfigMatches() reads back moments
// later — this comment is the diagnostic breadcrumb for whoever
// investigates that: check for `.serial` first, before suspecting this
// page object's own logic.
export class FormFieldsConfigPage extends BasePage {
  private readonly entity: FormFieldsEntityConfig;

  constructor(page: Page, entity: FormFieldsEntityConfig) {
    super(page);
    this.entity = entity;
  }

  // ─── Locators ───────────────────────────────────────────────────────────

  private readonly entityTab = (label: string): Locator =>
    this.page.getByRole('tab', { name: label, exact: true });

  // WHY the id, not getByPlaceholder('Search') (real live bug, found via a
  // live QA test run, 2026-09-21): getByPlaceholder() substring-matches by
  // default, and the app's OWN global top-bar search box has placeholder
  // text "Search across Leads, Deals and more..." — which also contains
  // the substring "Search", so both elements matched and Playwright
  // correctly refused to guess (strict-mode violation, reproduced
  // identically on retry, not a flake). Confirmed live: the field-list
  // search box's own id is #fulltext-search — an id is more stable here
  // than exact-matching the placeholder text, since it doesn't depend on
  // the global search box's own placeholder never becoming exactly
  // "Search" in some future copy change.
  private readonly searchInput = (): Locator => this.page.locator('#fulltext-search');

  private readonly addFieldButton = (): Locator =>
    this.page.getByRole('button', { name: 'Add Field', exact: true });

  // WHY scoped to a single `.rt-table` container, not a bare page-wide
  // `.rt-tr` (locator-reviewer finding, 2026-09-21 — a real rule-17 risk,
  // not just style): this screen has a 9-entity tab strip, and neither
  // investigation document confirmed whether an inactive tab's own grid
  // stays mounted-but-hidden in the DOM rather than being unmounted when a
  // different tab is active. Confirmed live (this implementation pass):
  // `document.querySelector('.rt-table')` returns exactly one element on
  // this list page — mirroring ProductsAndServicesPage.ts's own
  // listTable()/nameCell() pattern (its actual precedent, not a
  // reference-patterns.md entry — see the regexFieldLabel() comment below
  // for the same correction), which scopes every row lookup through its
  // own listTable() container first rather than trusting a bare class
  // selector. Scoping here the same way removes any dependency on the
  // "other tabs' rows aren't in the DOM" assumption ever holding.
  private readonly listTable = (): Locator => this.page.locator('.rt-table').first();

  private readonly listRows = (): Locator => this.listTable().locator('.rt-tr');

  // WHY .rt-tr/.rt-td, not a semantic ARIA role: confirmed live — this grid
  // has no row/cell roles at all (a react-table-style grid), the same
  // shape ProductsAndServicesPage.ts's own listRow()/nameCell() pattern
  // already uses for an unrelated /setup/ screen. WHY nth(1), not a
  // label/header lookup: confirmed live column order is checkbox, Label,
  // Internal Name, Type, Data Type, Filterable, Sortable, Required,
  // Status, Masked — the Label cell (index 1) is what's clickable for
  // admin.
  private readonly fieldRow = (internalName: string): Locator =>
    this.listRows().filter({
      has: this.page.locator('.rt-td', {
        hasText: new RegExp(`^\\s*${this.escapeRegExp(internalName)}\\s*$`),
      }),
    });

  private readonly fieldRowLabelCell = (internalName: string): Locator =>
    this.fieldRow(internalName).locator('.rt-td').nth(1);

  // WHY fixed ids, not a per-field label lookup (confirmed live,
  // FORM_FIELD_LIMIT_INVESTIGATION.md §2.1): identical ids/shape confirmed
  // across all 3 field types tested (Text/Number/Paragraph) — a fixed
  // position in this one specific admin config form, not tied to the
  // individual field being edited.
  private readonly minInput = (): Locator => this.page.locator('#input_label_13_input_min');
  private readonly maxInput = (): Locator => this.page.locator('#input_label_14_input_max');

  // WHY a label-sibling walk, not the react-select's own auto-generated
  // hash class (e.g. confirmed live as "css-2b097c-container"): hash-based
  // CSS-module classnames are not guaranteed stable across app builds —
  // this walk is semantic and hash-independent, the same xpath-ancestor/
  // sibling-walk convention ProductsAndServicesPage.ts's own
  // nameFieldError() already uses for an unrelated /setup/ field.
  private readonly regexFieldLabel = (): Locator =>
    this.page.locator('label.form-label').filter({ hasText: /^Regex$/ });

  private readonly regexControl = (): Locator =>
    this.regexFieldLabel().locator('xpath=following-sibling::div[1]');

  // WHY [class*="-menu"] + a "No Regex" text anchor, not a hardcoded hash
  // class: react-select always suffixes its open-menu container's class
  // with "-menu" — but so does this app's own Bootstrap `.dropdown-menu`
  // convention (the ellipsis-menu pattern documented in
  // reference-patterns.md §2 uses it too), so the substring alone is not
  // sufficient scoping on its own. Confirmed live, specifically on this
  // field-edit page with the Regex dropdown open (not just assumed from
  // the substring match): `[class*="-menu"]` resolves to exactly 4
  // elements here (this dropdown plus 3 unrelated ones — a product menu,
  // the app-wide add popup, the user-profile menu), and requiring the
  // element to also contain "No Regex" (always the first, default option
  // — never absent, so this anchor never depends on which option happens
  // to be currently selected) narrows that to exactly 1. Re-verify this
  // count live if this locator ever needs reuse on a page with a
  // different set of concurrently-open menus — the 4-vs-1 count is a
  // property of this specific page, not a general guarantee. Per the
  // hard-rule directive, options are read live from this menu, never
  // hardcoded — a 7th option added later needs zero changes here.
  private readonly regexMenu = (): Locator =>
    this.page.locator('[class*="-menu"]').filter({ hasText: NO_REGEX_OPTION_LABEL });

  // WHY div:not(:has(div)) — confirmed live this isolates exactly the leaf
  // option divs (each with zero child elements) from the menu's own
  // non-leaf wrapper divs, which otherwise also match a plain
  // `.locator('div')` and pollute the option list with their own
  // concatenated textContent.
  private readonly regexMenuOptions = (): Locator =>
    this.regexMenu().locator('div:not(:has(div))');

  private readonly regexOptionByLabel = (label: string): Locator =>
    this.regexMenuOptions().filter({
      hasText: new RegExp(`^\\s*${this.escapeRegExp(label)}\\s*$`),
    });

  // WHY these 3 semantic classes, not the info panel's own container hash
  // class (confirmed live via direct DOM read, FORM_FIELD_LIMIT_
  // INVESTIGATION.md §2.7):
  //   <div>Pattern: <code class="text-primary">...</code></div>
  //   <div>Valid: <span class="text-green">...</span></div>
  //   <div>Invalid: <span class="text-danger">...</span></div>
  // — real, stable, semantic Bootstrap-style utility classes, not
  // generated hashes. Per the hard-rule directive, valid/invalid example
  // values are always read from here live, never hardcoded.
  private readonly regexPatternText = (): Locator => this.page.locator('code.text-primary');
  private readonly regexValidExampleText = (): Locator => this.page.locator('span.text-green');
  private readonly regexInvalidExampleText = (): Locator => this.page.locator('span.text-danger');

  private readonly submitButton = (): Locator =>
    this.page.getByRole('button', { name: 'Submit', exact: true });

  // ─── Constructor ────────────────────────────────────────────────────────
  // (declared above the locators per this file's own layout — constructor
  // logic itself is trivial: super(page) + store the entity config.)

  // ─── Navigation ─────────────────────────────────────────────────────────

  // WHY this retries on a "wrongPage" landing, not just session-expiry
  // (real, confirmed live finding, 2026-09-21 — FFR3 failed under real
  // --workers=2 load with an 8-minute timeout inside searchField() waiting
  // for #fulltext-search; a screenshot captured at the moment of failure
  // showed the restricted user's browser sitting on the DASHBOARD, not the
  // Form Fields list page at all — #fulltext-search simply doesn't exist
  // there, so the wait could never resolve until Playwright's own test
  // timeout force-closed the browser). navigateTo() (called below) only
  // recovers from a signIn/Forbidden landing — it has no protection
  // against this THIRD outcome: a same-origin, session-still-valid landing
  // on a completely different page. This mirrors the identical "wrongPage"
  // classification already built into fixtures/index.ts's
  // navigateAndConfirmLoggedIn() (documented in .claude/known-issues.md's
  // "First real sharded qa run (Build #239)" entry, root-caused there to
  // the app's own server-side "resume last visited section" behavior
  // colliding with a different concurrent session/tab under real
  // multi-worker load) — but that existing fix only covers FIXTURE-SETUP
  // navigation, a separate code path from this method's own mid-test
  // navigation. Scoped narrowly to THIS page object rather than patching
  // BasePage.navigateTo() itself (used by every page object in the
  // codebase, and likely carrying this identical gap repo-wide) — fixing
  // navigateTo() is outside this task's blast radius per CLAUDE.md rule 9
  // (ripple-check any shared code change) and is flagged as a separate,
  // real, not-yet-investigated finding rather than silently folded in
  // here.
  async open(): Promise<void> {
    const targetUrl = `${config.appUrl}/setup/fields/${this.entity.urlSlug}/list`;
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.navigateTo(targetUrl);
      if (this.page.url().startsWith(targetUrl)) break;
      if (attempt === maxAttempts) {
        throw new Error(
          `FormFieldsConfigPage.open(): expected to land on "${targetUrl}" but landed on ` +
            `"${this.page.url()}" after ${maxAttempts} attempts`
        );
      }
      logger.warn(
        `FormFieldsConfigPage.open(): landed on "${this.page.url()}" instead of "${targetUrl}" — ` +
          `retrying navigation (attempt ${attempt}/${maxAttempts})`
      );
    }
    // WHY wrapped in withSessionExpiryRecovery() (CLAUDE.md rule 3 — every
    // raw Playwright assertion written directly in a module file must be):
    // a session that expires in the gap between the wrongPage-checked
    // navigation above and this specific assertion running would otherwise
    // time out here with no recovery attempt at all.
    // WHY ALSO wrapped in withRateLimitRecovery() (2026-09-29 — real CI
    // failures, sandbox run 36541336794: FFTK13/FFTK17's own "Expected the
    // Task tab to be active... element(s) not found" failures were this
    // exact assertion failing because the app's own HTTP-429 "Too many
    // requests" error page had replaced the tab strip entirely — see
    // isRateLimitedPage()'s own WHY comment in authManager.ts for the full
    // incident): nested outside withSessionExpiryRecovery so either
    // recovery class can independently catch and retry this same assertion.
    await this.withRateLimitRecovery(() =>
      this.withSessionExpiryRecovery(() =>
        expect(
          this.entityTab(this.entity.tabLabel),
          `Expected the "${this.entity.tabLabel}" tab to be active on the Form Fields list`
        ).toHaveClass(/active/, { timeout: config.timeouts.navigation })
      )
    );
  }

  // WHY reads live, never a hardcoded tab list (per the hard-rule
  // directive): a future 10th entity tab needs zero code changes here.
  async getVisibleEntityTabLabels(): Promise<string[]> {
    const tabs = this.page.getByRole('tab');
    await tabs.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const texts = await tabs.allTextContents();
    return texts.map((t) => t.trim()).filter(Boolean);
  }

  // ─── Search & open ──────────────────────────────────────────────────────

  // WHY the explicit bounded waitFor() here, before delegating to the
  // shared this.fill() (2026-09-29, real CI failures — sandbox run
  // 36464460839: FFD24/FFL41/FFL49 all failed with "Test timeout of
  // 480000ms exceeded" + "locator.clear/waitFor: Target page, context or
  // browser has been closed" while inside this exact call): BasePage.fill()
  // itself has no timeout of its own on its internal `waitFor({state:
  // 'visible'})` — its only real backstop is the outer TEST timeout, so
  // whenever this search input is slow to appear, the test silently burns
  // its entire remaining budget before Playwright's own timeout finally
  // tears down the browser context mid-action, producing a confusing
  // "context has been closed" symptom instead of a clear, attributable
  // error. This is a repo-wide property of the shared fill() helper (used
  // by nearly every module), not something to change there — rippling that
  // change would be a high-blast-radius edit CLAUDE.md rule 9 explicitly
  // warns against, well beyond this feature's scope. Scoped here instead:
  // a real, bounded, condition-based wait (config.timeouts.navigation,
  // already this file's own convention elsewhere, e.g. openFieldForEdit())
  // that fails loudly and fast, naming the exact locator, instead of
  // silently exhausting the whole test timeout.
  async searchField(internalName: string): Promise<void> {
    await this.withRateLimitRecovery(async () => {
      await this.searchInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      // WHY a direct, explicitly-bounded fill here instead of the shared
      // this.fill() (2026-09-29 — real CI failures, sandbox run
      // 36541336794: FFRCO5/FFCO1/FFCO2/FFCO3 in Company's shard all
      // cascaded from this exact call): this.fill()'s own internal
      // actionability retry has no timeout of its own either — confirmed
      // live via trace.zip inspection that the real trigger is the app's
      // own HTTP-429 "Too many requests" error page silently replacing this
      // search input mid-fill, with nothing to reattach to, riding the full
      // 480s test timeout with no earlier signal (the exact same "no bound
      // on the fill itself" gap the waitFor above was already fixed for,
      // per that fix's own WHY comment — this closes the other half of it,
      // scoped here rather than in the shared BasePage.fill() for the
      // identical high-blast-radius reason that fix already cites).
      logger.info(`Filling Form Fields search: ${internalName}`);
      await this.searchInput().fill(internalName, { timeout: config.timeouts.navigation });
    });
  }

  // WHY this also waits for minInput() to be visible, not just the URL
  // pattern (real, confirmed live finding, 2026-09-21 — FFL35 failed under
  // real --workers=2 load with "configureFieldRegex: cfTextField has no
  // Regex control on its edit page", thrown by configureFieldRegex()'s own
  // presence-check running immediately after this method returned): the
  // URL changes via client-side routing before the edit form's own
  // field-specific content (including the Regex section) has finished
  // rendering — under real concurrent server load this gap widens enough
  // for a caller's very next line to read stale/absent DOM. minInput()
  // (#input_label_13_input_min) is confirmed present on every field type
  // this page object supports (Text/Number/Paragraph all have Min/Max
  // Length) — waiting for it here is a universal, field-agnostic signal
  // that the edit form has genuinely rendered before any caller proceeds
  // to check for field-TYPE-specific content like the Regex control.
  async openFieldForEdit(internalName: string): Promise<void> {
    await this.open();
    await this.searchField(internalName);
    // WHY wrapped in withRateLimitRecovery() (2026-09-29 — real CI failures,
    // sandbox run 36573185433: FFRC6's own "field row: cfFormFieldLimitParagraph
    // ... element(s) not found" timeout was this exact click's own internal
    // waitFor(visible) failing because the app's own HTTP-429 "Too many
    // requests" error page had replaced the field list table entirely — see
    // isRateLimitedPage()'s WHY comment in authManager.ts for the full
    // incident, and open()'s identical composition above): this method's
    // three steps (row click, URL assertion, Min Length render assertion) all
    // read from the same page, so all three get the same protection.
    await this.withRateLimitRecovery(() =>
      this.click(this.fieldRowLabelCell(internalName), `field row: ${internalName}`)
    );
    // WHY wrapped (CLAUDE.md rule 3): see open()'s identical comment.
    // WHY ALSO wrapped in withRateLimitRecovery(): same incident as above —
    // nested outside withSessionExpiryRecovery so either recovery class can
    // independently catch and retry this same assertion (mirrors open()'s
    // established composition).
    await this.withRateLimitRecovery(() =>
      this.withSessionExpiryRecovery(() =>
        expect(
          this.page,
          `Expected navigation to the "${internalName}" field's edit page`
        ).toHaveURL(/\/setup\/fields\/[^/]+\/edit\//, { timeout: config.timeouts.navigation })
      )
    );
    // WHY wrapped in withRateLimitRecovery() (2026-09-29 — real CI failure,
    // sandbox run 36573185433: FFRC25's own "Expected the
    // cfFormFieldLimitText edit form's Min Length input to render" failure
    // captured the app's own 429 error page verbatim in its page snapshot):
    // same reasoning as the two calls above.
    await this.withRateLimitRecovery(() =>
      this.withSessionExpiryRecovery(() =>
        expect(
          this.minInput(),
          `Expected the "${internalName}" edit form's Min Length input to render`
        ).toBeVisible({ timeout: config.timeouts.navigation })
      )
    );
  }

  // ─── Form actions ───────────────────────────────────────────────────────

  private async fillMinMax(min: string, max: string): Promise<void> {
    await this.click(this.minInput(), 'Min Length');
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.press('Backspace');
    if (min) await this.minInput().pressSequentially(min);
    await this.click(this.maxInput(), 'Max Length');
    await this.page.keyboard.press('ControlOrMeta+a');
    await this.page.keyboard.press('Backspace');
    if (max) await this.maxInput().pressSequentially(max);
  }

  private async submit(): Promise<void> {
    await this.click(this.submitButton(), 'Submit (field config)');
    // WHY wrapped (CLAUDE.md rule 3): see open()'s identical comment.
    // WHY ALSO wrapped in withRateLimitRecovery() (2026-09-30 — real CI
    // failure, sandbox run 36663556957: Task's FFRTK6 failed here, stuck on
    // `/setup/fields/tasks/edit/182468` for the full 120000ms wait instead
    // of navigating back to the list after Submit). Confirmed as the same
    // incident class as FFRTK7/FFTK8's own confirmed app-error-boundary
    // interception in this same run/shard, not treated as a coincidence —
    // see authManager.isAppErrorBoundaryPage()'s own WHY comment.
    await this.withRateLimitRecovery(() =>
      this.withSessionExpiryRecovery(() =>
        expect(
          this.page,
          'Expected navigation back to the Form Fields list after Submit'
        ).toHaveURL(/\/setup\/fields\/[^/]+\/list/, { timeout: config.timeouts.navigation })
      )
    );
  }

  // WHY this early-return exists at all (real live bug, found via a real
  // afterAll cleanup run against QA, 2026-09-21): the app disables the
  // Submit button whenever nothing on the form has actually changed from
  // the field's currently-saved state — confirmed live: clicking Submit
  // with Min/Max already blank leaves the button permanently disabled
  // (`disabled` DOM property, not just visual), and a click() against it
  // then hangs for its full timeout waiting for "enabled" that never
  // comes — not a real app error, just this method asking for a submit
  // the app was never going to allow. This is NOT an edge case — cleanup
  // (or any reconfigure) running against a field already at its target
  // state is a NORMAL path (a previous test failed before configuring it;
  // two sequential tests both target the same already-set value) — so
  // "already at target" must be treated as a real, expected success, not
  // routed through a submit the app itself refuses.
  // WHY this checks for ANY active Regex, not just one that locks Min/Max
  // (two real, confirmed-live incidents, both 2026-09-22, on the SAME
  // underlying gap — the second found only because the first fix was
  // incomplete): the first incident (FFRC4 hanging 15s+/26 retries on a
  // disabled `#input_label_13_input_min`) was root-caused to a fixed-
  // pattern Regex (PAN Card) leaving Min/Max DOM-disabled — fixed by
  // clearing Regex first whenever `minDisabled || maxDisabled`. That fix
  // shipped, then a SEPARATE Contact run failed FFC11 with a genuine
  // server-side rejection ("Enter a valid Text Field, e.g.
  // john.doe@example.com" — Kylas's own live Email-format error text, not
  // a length-boundary message) even though Min/Max were NOT disabled at
  // the time. Root cause: confirmed live and already documented elsewhere
  // in this feature (FFC49/FFL50, "choosing Email format leaves the
  // min/max length fields open for editing") — Email format is a REAL
  // regex constraint on the field's actual value, but it does NOT disable
  // the Min/Max inputs the way a fixed-pattern format (PAN Card, Driver
  // Licence, Voting Card, Passport) does. A field left in "Email active,
  // Min/Max coincidentally already reading the caller's own target
  // numbers" state slipped straight past the locked-only check AND the
  // original min/max early-return (both matched, so both said "nothing to
  // do"), while the field's real, live constraint remained Email the whole
  // time — the next plain-length value this method's caller tried to save
  // was correctly rejected by the app for not looking like an email
  // address. Checking `currentRegex !== NO_REGEX_OPTION_LABEL` directly,
  // independent of the disabled-state signal, catches BOTH the locking
  // and non-locking regex shapes with one check — Min/Max being enabled is
  // not evidence Regex is inactive, only evidence it isn't the fixed-
  // pattern kind. Mirrors clearFieldConfiguration()'s own already-proven
  // "select No Regex first, THEN touch Min/Max" sequence — selecting No
  // Regex lifts any disabled lock (if present) client-side immediately, no
  // submit round-trip needed before fillMinMax() can proceed. A plain
  // min/max target is fundamentally incompatible with ANY active Regex
  // constraint (Email included) — clearing it is the only way to reach the
  // caller's actual requested state, not a surprising side effect.
  async configureFieldLimit(internalName: string, min: string, max: string): Promise<void> {
    await this.openFieldForEdit(internalName);
    const current = await this.readCurrentFieldConfig();
    const hasRegexControl = (await this.regexFieldLabel().count()) > 0;
    const regexActive = hasRegexControl && current.regexLabel !== NO_REGEX_OPTION_LABEL;
    if (current.min === min && current.max === max && !regexActive) {
      logger.success(
        `${internalName} already at min=${min || '(blank)'} max=${max || '(blank)'} — nothing to submit`
      );
      return;
    }
    if (regexActive) {
      logger.info(
        `${internalName} has an active Regex format ("${current.regexLabel}") — clearing it to ` +
          '"No Regex" before setting min/max directly, regardless of whether it currently locks the inputs'
      );
      await this.click(this.regexControl(), 'Regex select control');
      await this.click(
        this.regexOptionByLabel(NO_REGEX_OPTION_LABEL),
        `Regex option: ${NO_REGEX_OPTION_LABEL}`
      );
    }
    await this.fillMinMax(min, max);
    await this.submit();
    logger.success(`Configured ${internalName} min=${min || '(blank)'} max=${max || '(blank)'}`);
  }

  // WHY presence-checks the Regex control before use (this codebase's own
  // established custom-field environment-safety contract): confirmed live,
  // Regex exists ONLY on Text field — absent entirely from Number's and
  // Paragraph's edit pages.
  //
  // WHY the same already-at-target early return as configureFieldLimit()
  // above: the Submit-disabled-when-nothing-changed behavior that method's
  // check guards against was confirmed live against the Min/Max controls
  // specifically, not independently re-confirmed against the Regex
  // control — but it is a property of the Submit button/form itself (the
  // app has no way to know WHICH control a "change" came from), not of
  // Min/Max in particular, so the same defensive check applies here on
  // that reasoning rather than waiting for a second live incident to
  // justify it.
  // WHY this also detects and clears a LEFTOVER, unlocked Min/Max — even
  // when the Regex label already matches the caller's target (real,
  // confirmed live bug, found 2026-09-22/23 via a Company RBAC run —
  // FFRCO24 failed a genuinely valid Email value with "Enter the value
  // having length between 10 - 10", a length-boundary error, not an
  // email-format one): live-diagnostic confirmed that switching a field's
  // Regex FROM a fixed-pattern, min/max-LOCKING format (PAN Card, Driver
  // Licence, Voting Card, Passport) TO Email — the one format among the 5
  // confirmed NOT to lock Min/Max (FFC49/FFCO35's own mechanism test) —
  // leaves the PRIOR format's own auto-filled numeric Min/Max (e.g. PAN
  // Card's "10"/"10") sitting there, still ACTIVE as an independent length
  // constraint, merely unlocked (editable) rather than cleared. This is
  // the SAME confirmed, intentional app behavior already proven for
  // "switching back to No Regex does not clear Min/Max values" (FFC50/
  // FFCO36) — not a bug in the app, but a real gap in this method: every
  // real call site in this codebase calls configureFieldRegex() expecting
  // IT ALONE to define the field's entire active constraint, so a
  // leftover numeric length rule silently smuggled in from whatever format
  // happened to be active BEFORE is never what the caller asked for.
  // Every OTHER format transition (locking->locking) self-corrects for
  // free, since the DESTINATION format overwrites Min/Max with its own
  // implied length — this gap is specific to switching TO Email (or any
  // future non-locking format), and specifically escaped detection until
  // now because this entity is the first to actually test "a genuinely
  // valid Email value is accepted" (Lead/Contact both omitted that one
  // test out of an unrelated caution, so neither ever exercised this
  // path). WHY the check must run even when the label is unchanged: a
  // caller than finds the label ALREADY correct (this method's own
  // pre-existing early-return) would otherwise permanently inherit
  // whatever leftover state a PAST test left behind, with no further
  // chance to detect or fix it — exactly what happened to FFRCO24 (the
  // regex label was already "Email" from an earlier test, so the old
  // early-return fired and never even looked at Min/Max).
  async configureFieldRegex(internalName: string, regexLabel: string): Promise<void> {
    await this.openFieldForEdit(internalName);
    if ((await this.regexFieldLabel().count()) === 0) {
      throw new Error(
        `configureFieldRegex: "${internalName}" has no Regex control on its edit page — ` +
          'this method is only valid for a field type confirmed to have one (Text)'
      );
    }
    let current = await this.readCurrentFieldConfig();
    const needsLabelChange = current.regexLabel !== regexLabel;
    const hasLeftoverMinMax = (c: FieldConfigSnapshot): boolean =>
      !c.minDisabled && !c.maxDisabled && (c.min !== '' || c.max !== '');
    // WHY excluded for a "No Regex" target (real regression found and fixed
    // 2026-09-23, Task rollout — FFCO36 failed live: "expected min '10',
    // got ''"): this method's own WHY comment above already documented that
    // switching back to "No Regex" is CONFIRMED, INTENTIONAL app behavior
    // that PRESERVES the prior format's leftover Min/Max as a now-editable
    // value rather than clearing it (FFL51/FFC50/FFCO36/FFTK36 all assert
    // this directly) — but the clearing logic below was never actually
    // scoped to exclude that target, so it silently clobbered the exact
    // behavior this method's own comment said was safe. The leftover-clear
    // is still correct and necessary for every OTHER non-locking target
    // (confirmed for "Email" via FFRCO24) — only "No Regex" is the
    // documented exception.
    const targetIsNoRegex = regexLabel === NO_REGEX_OPTION_LABEL;

    if (!needsLabelChange && (!hasLeftoverMinMax(current) || targetIsNoRegex)) {
      logger.success(`${internalName} already has regex="${regexLabel}" — nothing to submit`);
      return;
    }

    if (needsLabelChange) {
      await this.click(this.regexControl(), 'Regex select control');
      await this.click(this.regexOptionByLabel(regexLabel), `Regex option: ${regexLabel}`);
      current = await this.readCurrentFieldConfig();
    }

    if (hasLeftoverMinMax(current) && !targetIsNoRegex) {
      logger.info(
        `${internalName}'s Min/Max still hold a leftover value ("${current.min}"/"${current.max}") ` +
          `from a previous format after switching to regex="${regexLabel}" — clearing it so this ` +
          'format is the only active constraint'
      );
      await this.fillMinMax('', '');
    }

    await this.submit();
    logger.success(`Configured ${internalName} regex="${regexLabel}"`);
  }

  // WHY select "No Regex" FIRST, only when a Regex control exists and
  // isn't already on "No Regex" (confirmed-correct sequence, FORM_FIELD_
  // LIMIT_INVESTIGATION_FOLLOWUP.md §3.3, live-tested end-to-end against a
  // real regex-active field with a fresh page-load verification
  // afterward): selecting "No Regex" is what lifts the DOM-level
  // `disabled` lock a fixed-pattern regex option puts on Min/Max Length —
  // attempting to clear them first would fail outright while a regex like
  // PAN Card is still active.
  //
  // WHY the whole method short-circuits when already blank (same real live
  // bug as configureFieldLimit() above, found via the SAME afterAll
  // cleanup run — this was in fact the method that actually surfaced it
  // first): a field already in its blank/No-Regex default state has
  // nothing to submit, and the app disables Submit in exactly that
  // situation — routing through fillMinMax('','') + submit() anyway is
  // what hung the afterAll safety-net hook on a field cleanup had already
  // left blank from a prior successful run.
  async clearFieldConfiguration(internalName: string): Promise<void> {
    await this.openFieldForEdit(internalName);
    const current = await this.readCurrentFieldConfig();
    const hasRegexControl = (await this.regexFieldLabel().count()) > 0;
    const alreadyBlank =
      current.min === '' &&
      current.max === '' &&
      (!hasRegexControl || current.regexLabel === NO_REGEX_OPTION_LABEL);
    if (alreadyBlank) {
      logger.success(`${internalName} already blank/No-Regex — nothing to submit`);
      return;
    }
    if (hasRegexControl && current.regexLabel !== NO_REGEX_OPTION_LABEL) {
      await this.click(this.regexControl(), 'Regex select control');
      await this.click(
        this.regexOptionByLabel(NO_REGEX_OPTION_LABEL),
        `Regex option: ${NO_REGEX_OPTION_LABEL}`
      );
    }
    await this.fillMinMax('', '');
    await this.submit();
    logger.success(`Cleared configuration for ${internalName}`);
  }

  // ─── Reads / assertions ─────────────────────────────────────────────────

  private async readSelectedRegexLabel(): Promise<string> {
    if ((await this.regexFieldLabel().count()) === 0) return '';
    return (await this.regexControl().innerText()).trim();
  }

  // WHY split out from readFieldConfigFresh() below: both a fresh
  // verification read AND a same-session "is there actually anything to
  // change" pre-check (configureFieldLimit()/configureFieldRegex()/
  // clearFieldConfiguration() above) need the exact same 5 field reads —
  // but only the former should pay for a fresh navigation. A
  // config-mutating method that just navigated via openFieldForEdit()
  // would otherwise trigger a second, pointless navigation for no reason.
  // Assumes the caller is already on the field's own edit page.
  private async readCurrentFieldConfig(): Promise<FieldConfigSnapshot> {
    return {
      min: await this.minInput().inputValue(),
      max: await this.maxInput().inputValue(),
      minDisabled: await this.minInput().isDisabled(),
      maxDisabled: await this.maxInput().isDisabled(),
      regexLabel: await this.readSelectedRegexLabel(),
    };
  }

  // WHY self-starting with a fresh navigation, not an in-session read:
  // confirmed (follow-up doc §3.3) that verifying a config change actually
  // persisted must be done via a genuinely fresh page load — an
  // in-session-only read can be fooled by client-side state that never
  // actually reached the server.
  async readFieldConfigFresh(internalName: string): Promise<FieldConfigSnapshot> {
    await this.openFieldForEdit(internalName);
    return this.readCurrentFieldConfig();
  }

  // WHY this exists as its own method rather than leaving every test to
  // hand-roll its own comparison: a bare `expect(actual).toEqual(expected)`
  // on the whole snapshot fails with Playwright's generic diff output,
  // which does not explain WHICH field of the snapshot mismatched or why
  // that matters (e.g. "minDisabled: true" vs "false" reads very
  // differently from "min: '10'" vs "''"). Failing here names each
  // mismatched property individually with its expected/actual pair, so a
  // future debugging session reads the failure and immediately knows
  // whether persistence, the disable-lock, or the regex selection itself
  // is what broke — without having to re-run the test under a debugger to
  // find out.
  async assertFieldConfigMatches(
    internalName: string,
    expected: Partial<FieldConfigSnapshot>,
    description = internalName
  ): Promise<void> {
    const actual = await this.readFieldConfigFresh(internalName);
    const expectedKeys = Object.keys(expected) as (keyof FieldConfigSnapshot)[];
    const mismatches = expectedKeys
      .filter((key) => actual[key] !== expected[key])
      .map((key) => `  ${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(actual[key])}`);
    if (mismatches.length > 0) {
      throw new Error(
        `Fresh config-page read for "${description}" did not match the expected state:\n` +
          mismatches.join('\n')
      );
    }
    logger.success(`Fresh read confirmed expected config for "${description}"`);
  }

  // Assumes the caller is currently ON the field's own edit page with a
  // regex option already selected and its info panel visible. WHY this is
  // NOT automatically true right after configureFieldRegex(): that method
  // ends with submit(), which navigates back to the list page — callers
  // needing this info after configuring must explicitly call
  // openFieldForEdit(internalName) again first (see leadFieldLimits.spec.ts's
  // assertGeneratedValueMatchesLivePattern() for the pattern). Per the
  // hard-rule directive, these example values are always read live from
  // the app's own on-screen text, never hardcoded.
  async getRegexPatternInfo(): Promise<{
    pattern: string;
    validExample: string;
    invalidExample: string;
  }> {
    return {
      pattern: (await this.regexPatternText().innerText()).trim(),
      validExample: (await this.regexValidExampleText().innerText()).trim(),
      invalidExample: (await this.regexInvalidExampleText().innerText()).trim(),
    };
  }

  // WHY reads live, never a hardcoded option list: per the hard-rule
  // directive. Must be called while already on a field's edit page with a
  // Regex control present (Text).
  async getRegexOptionLabels(): Promise<string[]> {
    await this.click(this.regexControl(), 'Regex select control');
    await this.regexMenu().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const texts = await this.regexMenuOptions().allTextContents();
    // WHY close the menu again: leaves the page in the state this method
    // found it in — a caller that only wants the option list shouldn't be
    // left with an open menu as a side effect.
    await this.page.keyboard.press('Escape');
    return texts.map((t) => t.trim()).filter(Boolean);
  }

  // ─── RBAC assertions ────────────────────────────────────────────────────

  // WHY this feature's RBAC scope is list-visibility only, and deliberately
  // never navigates to an individual field's edit URL (explicit
  // human-operator decision, FORM_FIELD_LIMIT_INVESTIGATION.md §1.2/§2.6/
  // §5): the "Forbidden" page a restricted user genuinely sees there is
  // the exact same component BasePage.navigateTo()'s own
  // isSessionExpiryPage() check already recognizes for an unrelated reason
  // (invalid session) and would attempt to "recover" from — a real,
  // confirmed collision risk deliberately avoided entirely here rather
  // than worked around.
  async assertListVisibleReadOnly(): Promise<void> {
    await this.open();
    // WHY wrapped (CLAUDE.md rule 3): see open()'s identical comment.
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.searchInput(),
        'Expected the Form Fields search box to be visible for a restricted user'
      ).toBeVisible({ timeout: config.timeouts.expect })
    );
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.listRows().first(),
        'Expected at least one field row to be visible for a restricted user'
      ).toBeVisible({ timeout: config.timeouts.expect })
    );
  }

  // WHY this calls open() itself, matching assertListVisibleReadOnly()'s
  // own self-navigating pattern above (real, confirmed live bug, found
  // 2026-09-21 via FFR3's real failure — see assertRowNotClickable()'s own
  // identical fix and comment below for the full incident detail): this
  // method previously assumed the caller had already navigated to the
  // Form Fields list, which was never actually true for its own real call
  // site (FFR2) — meaning the "Add Field" button's absence was being
  // checked against whatever page the restricted user's session happened
  // to land on by default, not the Form Fields list at all. The assertion
  // still passed (no such button exists on the Dashboard either), but it
  // was passing VACUOUSLY — proving nothing about the actual RBAC
  // boundary it claims to test.
  async assertAddFieldButtonAbsent(): Promise<void> {
    await this.open();
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.addFieldButton(),
        'Expected no "Add Field" button to be visible for a restricted user'
      ).toBeHidden({ timeout: config.timeouts.expect })
    );
  }

  // WHY a "URL unchanged after click" check, not a cursor-style read: both
  // are confirmed-real signals (FORM_FIELD_LIMIT_INVESTIGATION.md §2.6),
  // but a genuine no-navigation outcome is the more direct, user-facing
  // proof that the row is truly non-interactive, not just visually styled
  // differently.
  //
  // WHY this calls open() itself, matching assertListVisibleReadOnly()'s
  // own self-navigating pattern (real, confirmed live bug, found
  // 2026-09-21 — this is FFR3's actual, definitive root cause, found by
  // reading the real live log of an isolated re-run: it showed "Filling
  // Form Fields search: cfTextField" with NO preceding navigation log line
  // at all). This method previously assumed the caller had already
  // navigated to the Form Fields list — never true for its own real call
  // site (FFR3), which went straight from a fresh restrictedPage fixture
  // (landing on the Dashboard, its own default post-login page) into
  // searchField(), whose #fulltext-search locator simply doesn't exist on
  // the Dashboard — hanging for the full test timeout, then getting force-
  // closed, producing the "Target page, context or browser has been
  // closed" error. An earlier fix pass (open()'s own "wrongPage" retry,
  // still valid and kept) mis-attributed this exact symptom to a
  // concurrent-load navigation race — a reasonable-looking but incorrect
  // diagnosis built from a screenshot alone, corrected here once the real
  // log was read directly: open() was never even being called in this
  // path, so no navigation-race fix could have addressed it.
  async assertRowNotClickable(internalName: string): Promise<void> {
    await this.open();
    await this.searchField(internalName);
    const urlBefore = this.page.url();
    await this.fieldRowLabelCell(internalName)
      .click({ timeout: config.timeouts.expect })
      .catch(() => {
        /* a genuinely non-interactive row may not even report itself
           clickable to Playwright — that is itself consistent with "not
           clickable" and must not fail this assertion */
      });
    // WHY waitForURL() timing out is the SUCCESS case here (the same
    // stability-window idiom already proven in this codebase — see
    // reference-patterns.md §18 — applied to "prove nothing happened"
    // instead of "prove a menu survived"): a blind fixed-duration sleep here
    // would be exactly the anti-pattern this repo's pre-commit hook blocks
    // (CLAUDE.md rule 2) — a fixed sleep can't distinguish "the click
    // genuinely had no effect" from "the click's own navigation just
    // hasn't landed yet." Waiting for a real URL-change condition and
    // treating its timeout as the pass condition is a real, falsifiable
    // check: if the row WERE clickable, the app would navigate to its
    // edit URL well within this window, and the wait would resolve
    // (failing the assertion below) instead of timing out.
    const navigatedAway = await this.page
      .waitForURL((url) => url.toString() !== urlBefore, { timeout: config.timeouts.expect })
      .then(() => true)
      .catch(() => false);
    expect(
      navigatedAway,
      'Expected clicking a field row to have no effect (no navigation) for a restricted user'
    ).toBe(false);
  }
}
