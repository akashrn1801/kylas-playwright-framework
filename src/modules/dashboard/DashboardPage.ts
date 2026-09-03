import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';
import {
  DashboardData,
  DashletType,
  DashboardDashletEntityType,
  DASHBOARD_ENTITY_LABELS,
  DASHLET_TYPE_LABELS,
} from '../../data/factories/dashboardFactory';

// ──────────────────────────────────────────────────────────────────────────
// WHY every selector below is built from live confirmation, not guessed
// prose — this module was built from a live-investigation pass (2026-09-01,
// admin + restricted, QA), confirmed via Playwright MCP DOM/network
// inspection, PLUS a second, targeted live follow-up pass (2026-09-02) that
// specifically nailed down the Add-Dashlet wizard's step-navigation, Step
// 2's real row/radio/label shape, the Assign Dashboard modal's real
// structure, and the exact DOM signal behind "Mark as Primary"'s disabled
// state. Never guessed from prose alone (CLAUDE.md rule 12) — the durable,
// reusable findings from that investigation live in `.claude/known-issues.md`'s
// Dashboard section and `.claude/reference-patterns.md` §20; the original
// working investigation file was consolidated into those permanent docs and
// deleted.
// ──────────────────────────────────────────────────────────────────────────

// WHY this lives here, not in dashboardFactory.ts: this is page-STRUCTURE
// knowledge (real DOM `data-target` ids for the account's default sections),
// not test-input data — same distinction this codebase already draws
// elsewhere (locators/structural constants live with the page object; data
// shapes live in the factory). Confirmed live — only these 5 sections exist
// by default in this QA account (Contact/Company sections are NOT present
// by default, contrary to a naive assumption every entity gets its own
// section).
export interface DefaultDashboardSection {
  label: string;
  sectionId: string;
}

export const DEFAULT_DASHBOARD_SECTIONS: DefaultDashboardSection[] = [
  { label: 'Leads', sectionId: 'lead_section' },
  { label: 'Deals', sectionId: 'deal_section' },
  { label: 'Tasks', sectionId: 'task_section' },
  { label: 'Call logs', sectionId: 'call_section' },
  { label: 'Emails', sectionId: 'email_section' },
];

// WHY 2-4, not 1 (the app's own real minimum) and not "however many are
// available" (the app enforces no real maximum): confirmed live via two
// rounds of MCP investigation (2026-09-02) specifically dispatched to check
// this — Grouped Smartlists' Step 2 is a genuine multi-select (`.checked`
// stayed `true` on 3 simultaneously-checked rows after sequential clicks),
// its own real Next-button-enablement minimum is exactly 1 (not 2+), and NO
// maximum exists at all (all 12 of Lead's available rows could be checked
// simultaneously with Next staying enabled and the resulting dashlet
// correctly persisting and rendering all 12 after reload). 2-4 is therefore
// a deliberate TEST-design choice, not a claim about any app-enforced
// constraint — chosen specifically to exercise genuine multi-select behavior
// (more than the single-select minimum every other dashlet type already
// covers) while keeping each test's own added dashlet small, predictable,
// and fast to render/verify.
export const MULTILIST_MIN_SELECTIONS = 2;
export const MULTILIST_MAX_SELECTIONS = 4;

export class DashboardPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // 2. Locators
  // ──────────────────────────────────────────────────────────

  // ── Page-level / header ── §2A
  private readonly dashlitContainer = (): Locator => this.page.locator('.dashlit-container');
  private readonly dashboardHeaderTitle = (): Locator => this.page.locator('.dashboard-header h2');
  private readonly dashboardActions = (): Locator => this.page.locator('.dashboard-actions');
  private readonly createNewButton = (): Locator =>
    this.dashboardActions().locator('button').filter({ hasText: 'Create New' }).first();
  // WHY `:has(i.fa-cog)`, not a bare `.dropdown-toggle`: confirmed live —
  // `.dashboard-actions` contains more than one `.dropdown-toggle`-shaped
  // control; the gear icon is the one distinguishing anchor.
  private readonly gearToggle = (): Locator =>
    this.dashboardActions()
      .locator('.dropdown-toggle')
      .filter({ has: this.page.locator('i.fa-cog') });
  private readonly gearMenu = (): Locator => this.dashboardActions().locator('.dropdown-menu.show');
  private readonly gearMenuItem = (text: string): Locator =>
    this.gearMenu()
      .locator('a.dropdown-item')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(text)}\\s*$`) });

  // WHY the adjacent-sibling CSS combinator (`#dropdownMenuButton + .dropdown-menu`),
  // not a bare `.dropdown-menu` anywhere on the page: confirmed live — the
  // switcher's own menu is a plain sibling `<div>` to the toggle button, and
  // the gear menu (also `.dropdown-menu`) coexists on the same header, so an
  // unscoped match would be ambiguous (CLAUDE.md rule 17).
  private readonly switcherToggle = (): Locator => this.page.locator('#dropdownMenuButton');
  private readonly switcherMenu = (): Locator => this.page.locator('#dropdownMenuButton + .dropdown-menu.show');
  private readonly switcherItemByName = (name: string): Locator =>
    this.switcherMenu()
      .locator('a.dropdown-item')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`) });

  // ── Entity sections ── §2B
  private readonly sectionHeader = (sectionId: string): Locator =>
    this.page.locator(`[data-target="#${sectionId}"]`);
  private readonly gridSectionByLabel = (label: string): Locator =>
    this.page.locator('.grid-section').filter({
      has: this.page.locator('h2', { hasText: new RegExp(`^\\s*${this.escapeRegExp(label)}\\s*$`) }),
    });
  // WHY scoped to `.editForm()`, not page-wide: this exact string is only
  // ever asserted against right after opening the new-dashboard form
  // (assertEmptyState()'s only call site) — scoping costs nothing today and
  // removes a plausible future collision if this copy is ever reused
  // elsewhere in the app (CLAUDE.md rule 17: "currently unique" is not
  // "permanently unique").
  private readonly emptyStateText = (): Locator =>
    this.editForm().getByText('No Dashlet Added Yet', { exact: true });

  // WHY one shared container locator across all 3 dashlet-type classes,
  // matched by an exact-text descendant rather than a specific header-span
  // class: `span.text-truncate` is confirmed, via direct live HTML evidence
  // (a real outerHTML dump), for BOTH `.smartlist-dashlet` and
  // `.report-dashlet` — but `.multilist-dashlet`'s own header title element
  // shape was never captured that precisely. Requiring `span.text-truncate`
  // specifically would silently fail every multilist-dashlet assertion if
  // that class turns out not to apply there (locator-reviewer finding,
  // 2026-09-02) — DB34-DB38/DB51-DB55 each add a Grouped Smartlists
  // (multilist) dashlet. Matching any descendant whose own collapsed text
  // equals the title exactly (anchored regex) is safe for the two confirmed
  // types AND doesn't depend on an unconfirmed class for the third.
  private readonly dashletContainerByTitle = (title: string): Locator =>
    this.page.locator('.smartlist-dashlet, .multilist-dashlet, .report-dashlet').filter({
      has: this.page.locator('*', {
        hasText: new RegExp(`^\\s*${this.escapeRegExp(title)}\\s*$`),
      }),
    });
  private readonly dashletTrashIcon = (dashlet: Locator): Locator => dashlet.locator('i.fa-trash');

  // ── Edit mode / Create-Edit form ── §2C/§2D
  private readonly editForm = (): Locator => this.page.locator('.dashboard-create-form');
  // WHY `.dashboard-name input`, no `id`/`name`/class of its own on the
  // input itself: confirmed live, a case where no better option exists at
  // all (CLAUDE.md rule 17's own "no better option exists" carve-out).
  private readonly dashboardNameInput = (): Locator => this.editForm().locator('.dashboard-name input');
  private readonly addDashletLink = (): Locator => this.editForm().locator('div.text-primary.add-dashlet.w-30');
  private readonly saveButton = (): Locator => this.page.locator('#saveBtn');
  private readonly saveAsButton = (): Locator => this.page.locator('#saveAsBtn');
  private readonly cancelButton = (): Locator => this.editForm().locator('.cancel');

  // WHY matched by title text within `.modal.show`, no stable id found:
  // confirmed live (§2C) — "Discard Dashboard" title, "You haven't
  // configure the dashboard yet..." body (verbatim, including the grammar).
  private readonly discardModal = (): Locator =>
    this.page.locator('.modal.show').filter({ hasText: 'Discard Dashboard' });
  private readonly discardModalYesButton = (): Locator =>
    this.discardModal().getByRole('button', { name: 'Yes', exact: true });
  private readonly discardModalNoButton = (): Locator =>
    this.discardModal().getByRole('button', { name: 'No', exact: true });

  // WHY real, stable ids here, unlike every other modal in this flow:
  // confirmed live (§2H, re-confirmed 2026-09-02) — `#confirmModal`/`#cancel`/
  // `#confirm.btn-danger`, matching the shared Note-delete pattern already
  // documented codebase-wide (.claude/reference-patterns.md §6).
  private readonly deleteConfirmModal = (): Locator => this.page.locator('#confirmModal');
  private readonly deleteConfirmDeleteButton = (): Locator => this.page.locator('button#confirm.btn-danger');

  // ── Add-Dashlet wizard ── §2E, re-confirmed live 2026-09-02
  // WHY `#dashlet-wizard`: confirmed live, a real, stable modal id.
  private readonly wizardModal = (): Locator => this.page.locator('#dashlet-wizard');
  private readonly wizardCloseButton = (): Locator =>
    this.wizardModal().locator('button.close[data-dismiss="modal"]');
  private readonly wizardDashletTypeRadio = (type: DashletType): Locator =>
    this.wizardModal().locator(`#dashletType_${type}`);
  private readonly wizardEntityTypeRadio = (entity: DashboardDashletEntityType): Locator =>
    this.wizardModal().locator(`input[name="entityType"][value="${entity}"]`);
  // WHY matched by role+exact-text with no `.or()` fallback: confirmed live
  // (2026-09-02 follow-up) these ARE real `<button>` elements
  // (`btn btn-outline-primary` for Cancel/Back, `btn btn-primary` for
  // Next/Add) with no stable id — scoping to the wizard modal is what makes
  // an unscoped text match safe.
  private readonly wizardButtonByText = (text: string): Locator =>
    this.wizardModal().getByRole('button', { name: text, exact: true });
  private readonly wizardNextButton = (): Locator => this.wizardButtonByText('Next');
  private readonly wizardAddButton = (): Locator => this.wizardButtonByText('Add');
  // WHY `input[id^="check_"]` with NO `type` restriction — a real bug found
  // and fixed via live investigation (2026-09-02): confirmed live that
  // Step 2's row markup is otherwise IDENTICAL across all 3 dashlet types
  // (same `div.row`/`.col-auto`/empty-unclickable-`<label>` shape,
  // confirmed entity-independent for Lead/Company/Email), but the input's
  // own `type` attribute differs — Smartlist and Report render
  // `type="radio"` (single-select), while Grouped Smartlists (multilist)
  // renders `type="checkbox"` (its own header text literally says "Select
  // MULTIPLE smartlists"). The original `[type="radio"]`-restricted
  // locator matched ZERO elements for every multilist add, for every
  // entity — confirmed live via direct DOM query (`radioMatchedRowCount: 0,
  // checkboxMatchedRowCount: 12`) — meaning `goToWizardStep2()`'s own wait
  // on this locator would time out after a full `config.timeouts.navigation`
  // for any multilist dashlet, a bug that had simply never been observed
  // yet because every DB8/DB20 run so far failed earlier, during the
  // Smartlist loop, before ever reaching the multilist one. Dropping the
  // `type` restriction is safe and correct: both input types share the
  // identical `check_`-prefixed id convention, and a plain `.click()`
  // toggles either one identically (checking a radio or a checkbox is the
  // same native DOM action) — no dashlet-type branching needed anywhere
  // that calls this. `ALL rows are present in the DOM at once
  // (client-side pagination), confirmed live (§2E/§4 item 8), so a
  // name-based filter never needs to click through pagination controls
  // first.
  private readonly wizardConfigureRadios = (): Locator =>
    this.wizardModal().locator('input[type="radio"][id^="check_"], input[type="checkbox"][id^="check_"]');
  // WHY the ROW, not the label, is the unit selected against — confirmed
  // live (2026-09-02 follow-up, real outerHTML dump): each row is
  // `<div class="row ..."><div class="col-auto"><input id="check_N"><label
  // for="check_N"></label></div><div class="col">Name</div><div
  // class="col">Description</div></div>` — the `<label>` is EMPTY and
  // NOT clickable (a real click on it times out); only the radio/checkbox
  // `<input>` itself is directly clickable, and the option's visible name
  // lives in a SIBLING `.col` div, not the label. `div.row` is filtered to
  // only rows that actually contain a `check_`-prefixed input, so this
  // never matches an unrelated Bootstrap layout `.row` elsewhere in the
  // same modal.
  //
  // WHY the `has:` locator is a BARE `this.page.locator(...)`, NOT
  // `this.wizardConfigureRadios()` (a real bug, found and fixed via a live
  // QA test failure, 2026-09-02): `.filter({has: innerLocator})` requires
  // `innerLocator` to resolve as a DESCENDANT of each candidate row —
  // `wizardConfigureRadios()` is scoped through `this.wizardModal()`
  // (`#dashlet-wizard`), which is an ANCESTOR of the row, never a
  // descendant of it, so that compound selector can never match anything
  // inside a row and `wizardConfigureRows()` always returned a count of 0
  // — confirmed live: `goToWizardStep2()`'s own wait on the bare
  // `wizardConfigureRadios()` locator succeeded (proving Step 2 genuinely
  // rendered), while `selectRandomWizardConfigureOption()` immediately
  // threw "no configure options available" straight after. Mirrors the
  // already-correct, already-working pattern this file's own
  // `gridSectionByLabel()`/`wizardConfigureRowByName()` use — a bare,
  // page-rooted locator for the `has:` check, never one built through an
  // ancestor scope.
  //
  // WHY both `type="radio"` and `type="checkbox"` here too: see
  // `wizardConfigureRadios()`'s own WHY comment — Grouped Smartlists
  // (multilist) renders `type="checkbox"` for this exact same row shape,
  // confirmed live and entity-independent (2026-09-02). Without this, every
  // multilist dashlet add would filter down to zero rows here too.
  private readonly wizardConfigureRows = (): Locator =>
    this.wizardModal().locator('div.row').filter({
      has: this.page.locator('input[type="radio"][id^="check_"], input[type="checkbox"][id^="check_"]'),
    });
  private readonly wizardConfigureRowNameColumn = (row: Locator): Locator =>
    row.locator('div.col:not(.col-auto)').first();
  private readonly wizardConfigureRowByName = (name: string): Locator =>
    this.wizardConfigureRows().filter({
      has: this.page.locator('div.col:not(.col-auto)', {
        hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`),
      }),
    });

  // ── Assign Dashboard — confirmed live 2026-09-02 follow-up (§6 open
  // question #7, never completed by the original investigation) ──
  private readonly assignDashboardModal = (): Locator =>
    this.page.locator('#details_modal.assign-dashboard-modal');
  // WHY `is-invalid__control` family for the assignee search, confirmed
  // live: unlike the "Assign to" type picker (a different, plain react-select
  // family, `css-*-control` — not touched by this build since "Profiles" is
  // already its live-confirmed default and every real caller only needs
  // Profile-based assignment), the assignee SEARCH field uses this
  // codebase's own standard `is-invalid__*` convention, letting this reuse
  // BasePage.selectRandomFromSearchableReactSelect() unchanged.
  private readonly assigneesRawInput = (): Locator =>
    this.assignDashboardModal().locator('[id="assign_dashboard_assignees"]');
  private readonly assigneesControl = (): Locator =>
    this.assigneesRawInput().locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly assignDashboardSaveButton = (): Locator =>
    this.assignDashboardModal().getByRole('button', { name: 'Save', exact: true });

  // ──────────────────────────────────────────────────────────
  // 3. Constructor
  // ──────────────────────────────────────────────────────────
  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // 4. Private Helpers
  // ──────────────────────────────────────────────────────────

  private async openGearMenu(): Promise<void> {
    await this.click(this.gearToggle(), 'Dashboard gear menu');
    await this.gearMenu().waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  private async openSwitcher(): Promise<void> {
    await this.click(this.switcherToggle(), 'Dashboard switcher');
    await this.switcherMenu().waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  // WHY this always handles the Discard modal, never assumes Cancel exits
  // directly: confirmed live (§2C/§4 item 3) — Cancel ALWAYS opens this
  // modal, even with zero pending changes.
  private async cancelEditMode(confirm: boolean): Promise<void> {
    await this.click(this.cancelButton(), 'Cancel edit mode');
    await this.discardModal().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    // WHY: confirmed real via a live QA run (2026-09-02) — the Discard
    // Dashboard modal carries the identical `aria-hidden="true"` quirk
    // already root-caused for `#dashlet-wizard`/`#details_modal` (see
    // stripOpenModalAriaHidden()'s own comment) — a third, independent
    // confirmation this is a genuine app-wide Bootstrap-modal convention.
    await this.stripOpenModalAriaHidden();
    if (confirm) {
      await this.click(this.discardModalYesButton(), 'Discard Dashboard modal: Yes');
      await this.editForm().waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
    } else {
      await this.click(this.discardModalNoButton(), 'Discard Dashboard modal: No');
      await this.discardModal().waitFor({ state: 'hidden', timeout: config.timeouts.expect });
    }
  }

  // WHY this exists at all (§4 item 4): a pristine, never-edited EXISTING
  // dashboard shows only Save As; a pristine, never-saved NEW dashboard
  // shows only Save; only after a real edit do both converge on
  // Save(primary)+Save As(dropdown). This resolves that split deterministically
  // rather than guessing which button is present.
  private async clickSave(): Promise<void> {
    if (await this.saveButton().isVisible().catch(() => false)) {
      await this.click(this.saveButton(), 'Save dashboard');
      return;
    }
    if (await this.saveAsButton().isVisible().catch(() => false)) {
      await this.click(this.saveAsButton(), 'Save As dashboard (pristine-existing-dashboard default button)');
      return;
    }
    throw new Error('clickSave: neither #saveBtn nor #saveAsBtn is visible — unexpected edit-form button state');
  }

  // ──────────────────────────────────────────────────────────
  // 5. Navigation
  // ──────────────────────────────────────────────────────────

  async goToDashboard(): Promise<void> {
    logger.info('Navigating to Dashboard (/sales/home)');
    await this.navigateTo(`${config.appUrl}/sales/home`);
    await this.assertDashboardLoaded();
    logger.success('On Dashboard page');
  }

  async assertDashboardLoaded(): Promise<void> {
    await this.waitForVisible(this.dashlitContainer(), config.timeouts.navigation);
    await this.waitForVisible(this.dashboardHeaderTitle(), config.timeouts.navigation);
  }

  // ──────────────────────────────────────────────────────────
  // 6. Form Actions
  // ──────────────────────────────────────────────────────────

  // WHY wrapped in withSessionExpiryRecovery internally, not left to each
  // call site: flaky-test-auditor finding (2026-09-02) — this exact read is
  // this file's single most-called assertion primitive (every create/rename/
  // switch/delete workflow reads it), and 2 internal callers already wrapped
  // their OWN call to it while 7+ direct call sites across both spec files
  // didn't. Wrapping it here protects every caller by construction instead
  // of relying on each one remembering to (CLAUDE.md rule 3).
  //
  // WHY an explicit `{ timeout: ... }` on `.innerText()`, confirmed necessary
  // by a REAL failure (2026-09-02 QA run, not a guess): this repo's own
  // playwright.config.ts never sets `actionTimeout` (confirmed via grep),
  // and Playwright's own real default for that setting is 0 — unbounded —
  // matching the identical, already-documented bug class in
  // .claude/known-issues.md ("DealsPage.getAssociatedContactId()... having
  // no explicit timeout at all"). Live evidence: when an earlier bug left
  // the page mid-wizard/mid-unsaved-create-form (a real, different root
  // cause, tracked separately), this exact unguarded `.innerText()` call
  // hung for 28 MINUTES inside a test's own `finally` teardown before the
  // outer `test.setTimeout()` finally killed the browser out from under it
  // — turning a fast, legible ~60s failure into a 30-minute one with a
  // misleading "Target page... has been closed" error masking the real
  // cause. A bounded timeout here means a teardown call site now fails fast
  // and diagnosably instead of silently absorbing whatever budget remains.
  async getCurrentDashboardName(): Promise<string> {
    return this.withSessionExpiryRecovery(async () =>
      (await this.dashboardHeaderTitle().innerText({ timeout: config.timeouts.navigation })).trim()
    );
  }

  // WHY collapse/expand must check edit mode first: confirmed live (§4 item
  // 2) — in edit mode, the section header's `data-toggle` attribute is
  // blanked, disabling the click entirely.
  async isInEditMode(): Promise<boolean> {
    return this.editForm().isVisible().catch(() => false);
  }

  async isSectionExpanded(sectionId: string): Promise<boolean> {
    const expanded = await this.sectionHeader(sectionId).getAttribute('aria-expanded', { timeout: config.timeouts.navigation });
    return expanded === 'true';
  }

  // WHY `expect(...).toHaveAttribute(...)` (Playwright's own auto-retrying
  // poll), not a single immediate `getAttribute()` read: confirmed real via
  // a live QA run (2026-09-02) — `expandSection()`'s previous single-shot
  // read occasionally caught the header's `aria-expanded` attribute a
  // moment before Bootstrap's collapse transition/React re-render actually
  // committed it, throwing a false negative on a click that had, in fact,
  // succeeded (confirmed by an immediately-following, otherwise-identical
  // test passing cleanly). This is the same "wait for a real signal, not an
  // instant read" discipline already established throughout this codebase
  // (e.g. DealsPage.cloneDeal()) — `toHaveAttribute()` polls until the
  // value matches or the timeout elapses, rather than trusting one read.
  async collapseSection(sectionId: string): Promise<void> {
    if (await this.isSectionExpanded(sectionId)) {
      await this.click(this.sectionHeader(sectionId), `Collapse section #${sectionId}`);
      await this.withSessionExpiryRecovery(() =>
        expect(this.sectionHeader(sectionId)).toHaveAttribute('aria-expanded', 'false', {
          timeout: config.timeouts.navigation,
        })
      );
    }
  }

  async expandSection(sectionId: string): Promise<void> {
    if (!(await this.isSectionExpanded(sectionId))) {
      await this.click(this.sectionHeader(sectionId), `Expand section #${sectionId}`);
      await this.withSessionExpiryRecovery(() =>
        expect(this.sectionHeader(sectionId)).toHaveAttribute('aria-expanded', 'true', {
          timeout: config.timeouts.navigation,
        })
      );
    }
  }

  async assertCollapseDisabledInEditMode(sectionId: string): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      const toggleAttr = await this.sectionHeader(sectionId).getAttribute('data-toggle', {
        timeout: config.timeouts.navigation,
      });
      if (toggleAttr === 'collapse') {
        throw new Error(
          `assertCollapseDisabledInEditMode: #${sectionId}'s data-toggle is still "collapse" while in edit mode`
        );
      }
    });
  }

  async enterEditMode(): Promise<void> {
    await this.openGearMenu();
    await this.click(this.gearMenuItem('Edit'), 'Gear menu: Edit');
    await this.editForm().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  }

  async cancelEditModeAndDiscard(): Promise<void> {
    await this.cancelEditMode(true);
  }

  async cancelEditModeAndKeepEditing(): Promise<void> {
    await this.cancelEditMode(false);
  }

  async renameDashboard(newName: string): Promise<void> {
    await this.fill(this.dashboardNameInput(), newName, 'Dashboard Name');
  }

  async saveDashboard(): Promise<void> {
    await this.clickSave();
    await this.editForm().waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
  }

  // ──────────────────────────────────────────────────────────
  // 7. Search & Open
  // ──────────────────────────────────────────────────────────

  // WHY a bounded retry of the WHOLE open-switcher-click-verify sequence,
  // not a single attempt (fixed 2026-09-03, root-caused via two real
  // failures in the same 22-minute --workers=1 run, not a guess):
  // (1) DB13 (admin) — the click succeeded, but the immediate, single
  // `getCurrentDashboardName()` read afterward still showed the PREVIOUS
  // dashboard's title ("expected ...CAEIAF active, got Default Dashboard")
  // — switching dashboards triggers an async re-render (the target
  // dashboard's own dashlet data loading) that doesn't complete
  // synchronously with the click, so a one-shot read can catch a stale
  // title. Fixed by polling for the real end-state instead of reading once.
  // (2) DB25 (restricted) — the real failure was the SWITCHER-ITEM CLICK
  // itself timing out at 15s, confirmed via the raw Playwright call log:
  // `waiting for locator('#dropdownMenuButton + .dropdown-menu.show')
  // .locator('a.dropdown-item').filter(...)` — the switcher menu was open
  // and the item existed, but the click never became actionable in time
  // (this codebase's own established "some other DOM churn intercepts a
  // freshly-opened dropdown" class — see reference-patterns.md §18's
  // stability-window pattern, built for the identical symptom on a
  // different control). A single attempt has no way to recover from this;
  // retrying the whole sequence (fresh openSwitcher + fresh click) does,
  // since the interfering churn is transient, not a permanent block.
  // Bounded to 3 attempts, matching every other retry mechanism in this
  // codebase. Escape between attempts closes any stray still-open switcher
  // menu left by a failed attempt, so it can't intercept the next one's
  // click.
  async switchToDashboard(name: string): Promise<void> {
    logger.info(`Switching to dashboard: ${name}`);
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.openSwitcher();
        await this.click(
          this.switcherItemByName(name),
          `Switcher item: ${name} (attempt ${attempt}/${maxAttempts})`
        );
        await expect
          .poll(() => this.getCurrentDashboardName(), {
            timeout: config.timeouts.expect,
            message: `switchToDashboard: "${name}" never became active`,
          })
          .toBe(name);
        logger.success(`Switched to dashboard: ${name}`);
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `switchToDashboard: attempt ${attempt}/${maxAttempts} failed for "${name}": ${String(error)}` +
            (attempt < maxAttempts ? ' — retrying' : '')
        );
        await this.page.keyboard.press('Escape').catch(() => {});
      }
    }
    throw new Error(
      `switchToDashboard: exhausted ${maxAttempts} attempts for "${name}": ${String(lastError)}`
    );
  }

  async isDashboardInSwitcher(name: string): Promise<boolean> {
    await this.openSwitcher();
    const visible = await this.switcherItemByName(name)
      .isVisible()
      .catch(() => false);
    // WHY closed explicitly rather than left open: this is a read-only probe
    // — callers shouldn't have to know the switcher was left open as a side
    // effect.
    // WHY re-clicking the toggle, not `Escape`: confirmed live (2026-09-02
    // root-cause investigation) that an `Escape` keypress does not reliably
    // close this app's Bootstrap dropdowns — a left-open switcher then
    // desyncs the NEXT `openSwitcher()` call, whose own toggle click would
    // toggle an already-open dropdown CLOSED instead of opening it,
    // producing a confusing failure several calls later. Clicking the same
    // toggle again is the same deterministic action a real user would take.
    await this.click(this.switcherToggle(), 'Close dashboard switcher');
    await this.switcherMenu()
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {});
    return visible;
  }

  async findDashletByTitle(title: string): Promise<Locator> {
    const dashlet = this.dashletContainerByTitle(title);
    const found = await dashlet
      .first()
      .waitFor({ state: 'visible', timeout: config.timeouts.expect })
      .then(() => true)
      .catch(() => false);
    if (!found) {
      throw new Error(`findDashletByTitle: dashlet "${title}" not found on the current dashboard`);
    }
    return dashlet.first();
  }

  async isDashletPresent(title: string): Promise<boolean> {
    return this.dashletContainerByTitle(title)
      .first()
      .isVisible()
      .catch(() => false);
  }

  // WHY a count, not a hardcoded default-dashlet title: this account's exact
  // default dashlets are real, environment-owned data (CLAUDE.md rule 4) —
  // asserting "at least one dashlet rendered in this section" is the real,
  // durable invariant; asserting a specific title like "New Leads" would be
  // exactly the kind of hardcoded-picklist-option fragility that rule guards
  // against.
  async getDashletCountInSection(label: string): Promise<number> {
    return this.gridSectionByLabel(label).locator('.smartlist-dashlet, .multilist-dashlet, .report-dashlet').count();
  }

  // ──────────────────────────────────────────────────────────
  // 8. Edit Actions
  // ──────────────────────────────────────────────────────────

  // WHY this exists at all — a REAL, confirmed root cause, found via live
  // investigation after a real QA test run reproduced a 100% deterministic
  // Step-1-to-Step-2 hang twice (2026-09-02): `#dashlet-wizard` carries
  // `aria-hidden="true"` on its own modal root the moment it opens.
  // Playwright's `getByRole()` respects `aria-hidden` on ancestors and
  // excludes the whole subtree from the accessibility tree — so
  // `wizardModal().getByRole('button', {name:'Next', exact:true})` matches
  // ZERO elements FOREVER while the attribute is present, even though the
  // button is visually rendered and CSS-clickable (`isVisible()` → true).
  // This is not a timing race — waiting longer never helps, confirmed via
  // live reproduction. This is the exact same already-known, already-
  // documented Kylas app-wide quirk as `#callLogModal` in
  // `src/modules/call-logs/CallLogsPage.ts` (8 separate
  // `removeAttribute("aria-hidden")` call sites there) — simply never
  // applied to this brand-new module's own modals.
  //
  // WHY one GENERIC helper (`.modal.show[aria-hidden="true"]`, not a
  // per-modal-id method): the identical failure signature recurred on TWO
  // further, completely independent modals in this same file during real
  // QA verification (`#details_modal`'s Assign-Dashboard Save button, then
  // the Discard-Dashboard confirmation modal's Yes/No buttons, which has no
  // stable id at all) — three occurrences in one file confirms this is a
  // genuine, app-wide Bootstrap-modal convention in this Kylas instance,
  // not a per-modal quirk worth three separate hand-rolled methods. Every
  // modal in this file already carries the shared `.modal.show` class
  // (confirmed live for `#dashlet-wizard`/`#details_modal`, and it's the
  // literal locator this file already uses for `discardModal()`/
  // `assignDashboardModal()`) — stripping the attribute from whichever
  // modal is CURRENTLY open covers all of them with one call, and is a
  // no-op (querySelectorAll over zero or already-clean elements) when
  // nothing needs it. Called defensively at every `getByRole()`-based modal
  // button click site, not just once per modal-open, since a step
  // transition re-rendering the modal's content could plausibly re-add the
  // attribute (not independently confirmed either way, but the check itself
  // is a single sub-millisecond `evaluate()` call — cheap insurance).
  // Locators built on plain CSS (radios, `wizardCloseButton`,
  // `deleteConfirmDeleteButton`) are unaffected — only `getByRole()`-based
  // lookups are excluded by `aria-hidden`.
  private async stripOpenModalAriaHidden(): Promise<void> {
    await this.page.evaluate(() => {
      document.querySelectorAll('.modal.show[aria-hidden="true"]').forEach((el) => el.removeAttribute('aria-hidden'));
    });
  }

  // WHY the wizard's own "remaining time" isn't guessed with a blind wait
  // anywhere in this flow (CLAUDE.md rule 2): every transition below waits
  // on a real, visible state change (a step's own distinguishing control
  // becoming visible) before proceeding.
  async openAddDashletWizard(): Promise<void> {
    await this.click(this.addDashletLink(), '+ Add new dashlet');
    await this.wizardModal().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    await this.stripOpenModalAriaHidden();
  }

  // WHY `force: true` here: confirmed live (2026-09-02 root-cause
  // investigation) this is NOT what causes the Step-2 hang (see
  // stripOpenModalAriaHidden()'s own comment for the real cause) — a forced
  // click on these two radios correctly checks them and correctly enables
  // the wizard's "Next" button (verified via a direct outerHTML dump: no
  // `disabled` attribute remained). Kept as-is since it's confirmed
  // harmless and already proven working, not because of any remaining
  // uncertainty.
  async selectDashletType(type: DashletType): Promise<void> {
    await this.click(this.wizardDashletTypeRadio(type), `Dashlet type: ${type}`, true);
  }

  async selectDashletEntityType(entity: DashboardDashletEntityType): Promise<void> {
    await this.click(this.wizardEntityTypeRadio(entity), `Dashlet entity type: ${entity}`, true);
  }

  async assertEntityTypeNotOfferedForDashletType(
    type: DashletType,
    entity: DashboardDashletEntityType
  ): Promise<void> {
    await this.selectDashletType(type);
    await this.withSessionExpiryRecovery(async () => {
      // WHY also asserting the wizard itself is still open: a "prove
      // absence" check (option count === 0) looks IDENTICAL to a
      // session-expiry symptom (the whole page/modal having disappeared) —
      // confirming the wizard is still genuinely open first is what makes a
      // zero count trustworthy as a real, meaningful absence rather than a
      // false pass caused by the page no longer being on the wizard at all.
      await expect(this.wizardModal()).toBeVisible({ timeout: config.timeouts.expect });
      const count = await this.wizardEntityTypeRadio(entity).count();
      if (count !== 0) {
        throw new Error(
          `assertEntityTypeNotOfferedForDashletType: entity "${entity}" IS present for dashlet type "${type}" ` +
            `(expected it to be absent)`
        );
      }
    });
  }

  async goToWizardStep2(): Promise<void> {
    await this.stripOpenModalAriaHidden();
    await this.click(this.wizardNextButton(), 'Add-Dashlet wizard: Next (Step 1 -> 2)');
    await this.wizardConfigureRadios()
      .first()
      .waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  }

  // WHY a dedicated, hand-rolled bounded-retry here rather than reusing
  // BasePage.selectRandomOptionWithRetry(): that shared helper assumes ONE
  // locator serves as both the readable-text source AND the click target —
  // true for every other module's react-select options, but NOT true here.
  // Confirmed live (2026-09-02 follow-up): Step 2's radio `<input>` itself
  // carries no text, and its `<label>` is empty; the real option NAME lives
  // in a sibling `.col` div, while the actually-clickable element is the
  // radio input. Forcing this onto the shared helper would either read
  // empty text (breaking every caller that needs the resolved name back,
  // e.g. addDashlet()) or click the wrong element. This mirrors that
  // helper's own proven SHAPE (3 attempts, a fresh random index each retry,
  // each read+click bounded to 15s) without pretending the two DOM shapes
  // are the same (CLAUDE.md rule 1 cuts both ways — reusing a helper whose
  // internal assumptions don't hold is its own kind of debt).
  async selectRandomWizardConfigureOption(): Promise<string> {
    const rows = this.wizardConfigureRows();
    const total = await rows.count();
    if (total === 0) {
      throw new Error('selectRandomWizardConfigureOption: no configure options available');
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const idx = Math.floor(Math.random() * total);
      const row = rows.nth(idx);
      try {
        const text = (await this.wizardConfigureRowNameColumn(row).textContent({ timeout: 15000 }))?.trim() ?? 'unknown';
        // WHY both input types: see wizardConfigureRadios()'s own WHY
        // comment — Grouped Smartlists render checkboxes, not radios, for
        // this identical row shape (confirmed live, entity-independent,
        // 2026-09-02).
        await row.locator('input[type="radio"], input[type="checkbox"]').click({ timeout: 15000 });
        logger.success(`Add-Dashlet wizard: configure option selected: "${text}" (index ${idx} of ${total})`);
        return text;
      } catch (error) {
        lastError = error;
        logger.info(
          `selectRandomWizardConfigureOption: read/click on row ${idx} failed (attempt ${attempt}/3), retrying with a fresh row: ${String(error)}`
        );
      }
    }
    throw new Error(`selectRandomWizardConfigureOption: failed after 3 attempts — ${String(lastError)}`);
  }

  // WHY a separate method, not a `count` param bolted onto
  // selectRandomWizardConfigureOption() above: that method's whole contract
  // (pick ONE, return its name) is fundamentally single-select — genuinely
  // confirmed live as the correct model for Smartlist/Report Step 2 (radio
  // groups: checking a second row un-checks the first). Grouped Smartlists
  // is the only dashlet type where Step 2 is a genuine multi-select
  // (checkboxes — confirmed live, `.checked` stayed `true` simultaneously
  // across multiple rows), so it needs its own distinct selection+return
  // shape (an array of every name actually selected) rather than forcing an
  // N=1 method to awkwardly grow a loop around itself.
  //
  // WHY distinct indices are pre-selected via a Fisher-Yates shuffle, not
  // "re-roll a fresh random index per pick and hope for no collision" (the
  // single-select method's own retry-shape, which only needs to avoid
  // collision across FAILED-attempt re-rolls, not across successful picks):
  // this method must select several DISTINCT rows in one pass — a random
  // Math.random()-per-pick approach could re-pick an already-checked row,
  // which is harmless to the DOM (re-clicking a checked checkbox unchecks
  // it) but would silently produce fewer real selections than intended.
  // Shuffling the full index range once and taking a prefix guarantees N
  // distinct rows with no possibility of an accidental double-pick.
  //
  // WHY the returned array's [0] element (not the whole array, not the
  // dashlet's own generic "Grouped Smartlists" header text) is what
  // `addDashletOnce()` uses as this dashlet's identifying title for the
  // caller's later `assertDashletVisible()` check: confirmed live
  // (2026-09-02, a dedicated MCP investigation dispatched specifically for
  // this) that a Grouped Smartlists dashlet's own header is ALWAYS the
  // literal, identical string "Grouped Smartlists" for every entity — using
  // that generic string to identify "the dashlet THIS test just added" would
  // be genuinely ambiguous once more than one Grouped Smartlists dashlet
  // exists on the same dashboard (exactly the shape DB34-38/DB51-55's shared-
  // dashboard restructuring guarantees — 5 simultaneous "Grouped Smartlists"-
  // titled dashlets, one per entity). The same investigation also confirmed
  // each entity's dashlet renders in its OWN dynamically-created,
  // entity-scoped section (`id="{entity}_section"`, created the moment that
  // entity's first dashlet is added — real for a brand-new custom dashboard,
  // not just Default Dashboard's own 5 pre-existing ones) and that built-in
  // smartlist option names are consistently entity-specific in their own
  // text (e.g. "New Leads" vs "New Deals" — confirmed live via direct
  // outerHTML on two different entities' dashlets). `dashletContainerByTitle()`'s
  // `has:` filter matches on ANY descendant whose own text equals the given
  // title — so asserting on one of the ACTUALLY-SELECTED row names (which
  // appear as this specific dashlet's own inner `.multilist-dashlet__smartlist-name`
  // sub-rows) correctly and uniquely identifies this exact dashlet among its
  // "Grouped Smartlists"-titled siblings, with zero need for a separate
  // section-scoped assertion helper.
  async selectRandomWizardConfigureOptions(min: number, max: number): Promise<string[]> {
    if (min < 1 || min > max) {
      throw new Error(
        `selectRandomWizardConfigureOptions: invalid range (min=${min}, max=${max}) — min must be >= 1 and <= max`
      );
    }
    const rows = this.wizardConfigureRows();
    const total = await rows.count();
    if (total === 0) {
      throw new Error('selectRandomWizardConfigureOptions: no configure options available');
    }
    const targetCount = Math.min(total, min + Math.floor(Math.random() * (max - min + 1)));
    const shuffledIndices = Array.from({ length: total }, (_, i) => i);
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }

    // WHY a queue backed by the shuffle's own unused remainder ("spares"),
    // not a fixed upfront slice retried in place (locator-reviewer finding,
    // 2026-09-02): mirrors an already-documented lesson elsewhere in this
    // codebase (.claude/known-issues.md — "retrying the SAME index is
    // sometimes futile; one specific index can be persistently non-
    // actionable while every other index works fine", the reason
    // `BasePage.selectRandomOptionWithRetry()` always re-rolls a fresh index
    // on every attempt). If one targeted row exhausts its own 3 attempts,
    // this substitutes a genuinely fresh, never-yet-tried row from the same
    // shuffle rather than failing the whole method outright over one bad
    // row — degrading gracefully to fewer than `targetCount` selections only
    // once the spare pool itself is exhausted, never silently retrying a
    // row already proven non-actionable.
    const queue = shuffledIndices.slice(0, targetCount);
    const spares = shuffledIndices.slice(targetCount);

    const selectedNames: string[] = [];
    let lastError: unknown;
    while (selectedNames.length < targetCount && queue.length > 0) {
      const idx = queue.shift() as number;
      let selected = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const row = rows.nth(idx);
        try {
          const text = (await this.wizardConfigureRowNameColumn(row).textContent({ timeout: 15000 }))?.trim() ?? 'unknown';
          await row.locator('input[type="checkbox"]').click({ timeout: 15000 });
          selectedNames.push(text);
          selected = true;
          break;
        } catch (error) {
          lastError = error;
          logger.info(
            `selectRandomWizardConfigureOptions: read/click on row ${idx} failed (attempt ${attempt}/3): ${String(error)}`
          );
        }
      }
      if (!selected) {
        const replacement = spares.shift();
        if (replacement === undefined) {
          logger.warn(
            `selectRandomWizardConfigureOptions: row ${idx} failed after 3 attempts and no untried row remains to ` +
              `substitute — proceeding with ${selectedNames.length} of the intended ${targetCount} selections`
          );
          break;
        }
        logger.info(
          `selectRandomWizardConfigureOptions: row ${idx} persistently non-actionable — substituting untried row ${replacement}`
        );
        queue.push(replacement);
      }
    }
    // WHY this guards on TOTAL failure only (zero selections), not on
    // finishing below `targetCount` (locator-reviewer finding, 2026-09-02):
    // a caller receiving fewer than intended still gets a genuine, real
    // multi-select result to assert on; a caller receiving nothing has a
    // broken contract at the source, which is what actually needs to fail
    // loudly here rather than surface several calls downstream as a
    // confusing "dashlet 'undefined' not found" timeout.
    if (selectedNames.length === 0) {
      throw new Error(`selectRandomWizardConfigureOptions: zero options were successfully selected — ${String(lastError)}`);
    }
    logger.success(
      `Add-Dashlet wizard: ${selectedNames.length} configure options selected: ${selectedNames.join(', ')} ` +
        `(of ${total} available)`
    );
    return selectedNames;
  }

  // WHY a separate, exact-match method (not reused for the random case
  // above): build decision #2 requires Report-type dashlets to pick THIS
  // test's own freshly-created disposable Report, never a random one from
  // this QA account's large pre-existing Reports data. Clicks the row's own
  // radio/checkbox `<input>` directly — see selectRandomWizardConfigureOption()'s
  // own comment for why the `<label>` can't be used, and
  // wizardConfigureRadios()'s own comment for why both input types are
  // matched (Report dashlets use radios; this method is only ever called
  // for Report today, but matching both keeps it correct if that changes).
  async selectWizardConfigureOptionByName(name: string): Promise<void> {
    const row = this.wizardConfigureRowByName(name);
    await row.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.click(row.locator('input[type="radio"], input[type="checkbox"]'), `Wizard configure option: ${name}`);
  }

  async goToWizardStep3(): Promise<void> {
    await this.stripOpenModalAriaHidden();
    await this.click(this.wizardNextButton(), 'Add-Dashlet wizard: Next (Step 2 -> 3)');
    await this.wizardAddButton().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  }

  // WHY a bounded re-click retry, not a single unguarded wait: confirmed
  // real via a live QA run (2026-09-02) — an isolated, non-rapid single
  // dashlet add's "Add" click can leave the wizard open past a full 60s
  // wait with no error, then close cleanly on a second click. This is the
  // same "click succeeded but nothing visibly happened" shape already
  // root-caused and fixed elsewhere in this codebase for other modules
  // (e.g. `DealsPage.cloneDeal()`'s Save click, `CompaniesPage.clickAddCompany()`'s
  // modal-open race) — reusing that same proven bounded-retry SHAPE here,
  // not inventing a new one. Root cause not independently confirmed for
  // this specific occurrence (rule 10) — hardened defensively given the
  // precedent, not claimed as a proven fix.
  async confirmAddDashlet(): Promise<void> {
    const attempts = 2;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.stripOpenModalAriaHidden();
        await this.click(this.wizardAddButton(), `Add-Dashlet wizard: Add (attempt ${attempt}/${attempts})`);
        await this.wizardModal().waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
        return;
      } catch (error) {
        // WHY the WHOLE attempt (click + wait) is inside this try/catch,
        // not just the post-click wait: a real bug in this method's own
        // first version, found live (2026-09-02) — `this.click()` itself
        // can throw (its own internal visibility wait timing out) BEFORE
        // ever reaching the wizard-closed check, which silently bypassed
        // this retry entirely since only the wait was guarded. Wrapping
        // the full attempt means any failure in either step gets a real
        // second try.
        lastError = error;
        logger.warn(
          `confirmAddDashlet: attempt ${attempt}/${attempts} failed: ${String(error)}` +
            (attempt < attempts ? ' — retrying' : '')
        );
      }
    }
    throw new Error(`confirmAddDashlet: failed after ${attempts} attempts — ${String(lastError)}`);
  }

  // WHY the confirmed real close (X) button, not an Escape keypress:
  // confirmed live (2026-09-02 follow-up) — `button.close[data-dismiss=
  // "modal"]` dismisses the wizard immediately at every step, with NO
  // confirmation prompt (unlike the dashboard-level edit-mode Cancel, which
  // always shows the Discard modal). Used by the read-only "entity not
  // offered" check (test 15) to back out without adding anything.
  async closeWizardWithoutAdding(): Promise<void> {
    await this.click(this.wizardCloseButton(), 'Add-Dashlet wizard: close (X)');
    await this.wizardModal().waitFor({ state: 'hidden', timeout: config.timeouts.expect });
  }

  async removeDashletByTitle(title: string): Promise<void> {
    const dashlet = await this.findDashletByTitle(title);
    await this.click(this.dashletTrashIcon(dashlet), `Remove dashlet: ${title}`);
    await dashlet.waitFor({ state: 'hidden', timeout: config.timeouts.expect });
  }

  // WHY this arms and awaits the real `mark_as_preferred` network response
  // before returning, rather than firing the click and returning immediately
  // (fixed 2026-09-02, root-caused via a real DB14 failure): confirmed live
  // — `mark_as_preferred`'s own POST is genuinely async, and the original
  // fire-and-forget click let the caller's own next step (typically an
  // immediate `reloadPage()`) race ahead of it. A real occurrence: DB14
  // reloaded and landed back on "Default Dashboard" instead of the
  // just-marked dashboard — the exact same "navigating away cancels/outraces
  // an in-flight mutation" mechanism this session's own render-race
  // investigation already proved for the Add-Dashlet wizard (see
  // `.claude/known-issues.md`'s Dashboard render-race entry), just hitting a
  // different action. A second, real occurrence in the same evidence set:
  // DB26 (a different test, same action) captured a genuine `HTTP 403 "Can
  // not read the dashboard"` on this exact endpoint — proof the request can
  // also fail outright, which the old fire-and-forget click had no way to
  // surface; it would have silently proceeded as if the mark succeeded.
  // Deliberately does NOT resurrect the already-proven-unhelpful
  // `isMarkAsPrimaryDisabled()` poll (reverted 2026-09-02 after running the
  // full 60s with zero success — that UI signal only recomputes on a fresh
  // page load, never live in-session) — waiting for the actual network
  // response is a completely different, genuine signal, not a retry of the
  // same dead end.
  async openMarkAsPrimary(): Promise<void> {
    await this.openGearMenu();
    const responsePromise = this.armResponseWaitWithRecovery(
      (res) => /\/v1\/dashboards\/\d+\/mark_as_preferred$/.test(res.url()) && res.request().method() === 'POST',
      'Mark as Primary: mark_as_preferred response',
      config.timeouts.navigation
    );
    await this.click(this.gearMenuItem('Mark as Primary'), 'Gear menu: Mark as Primary');
    const response = await responsePromise;
    if (!response.ok()) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `openMarkAsPrimary: mark_as_preferred returned HTTP ${response.status()} — ${body || '(empty body)'}`
      );
    }
  }

  // WHY a plain `.disabled` class check, not `aria-disabled`/HTML `disabled`:
  // confirmed live (2026-09-02 follow-up, real outerHTML) — on the current
  // primary dashboard this is `<a class="dropdown-item disabled">`; on any
  // other dashboard it's `<a class="dropdown-item">` with no `.disabled` at
  // all. Anchors don't support an HTML `disabled` attribute, and no
  // `aria-disabled` is rendered here — this account's real signal is purely
  // the CSS class.
  async isMarkAsPrimaryDisabled(): Promise<boolean> {
    await this.openGearMenu();
    const disabled = await this.gearMenuItem('Mark as Primary').evaluate((el) => el.classList.contains('disabled'), {
      timeout: config.timeouts.navigation,
    });
    // WHY re-clicking the toggle, not `Escape`: see isDashboardInSwitcher()'s
    // identical, evidence-backed comment above.
    await this.click(this.gearToggle(), 'Close gear menu');
    await this.gearMenu()
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {});
    return disabled;
  }

  async hasEditOptionInGearMenu(): Promise<boolean> {
    await this.openGearMenu();
    const visible = await this.gearMenuItem('Edit')
      .isVisible()
      .catch(() => false);
    // WHY re-clicking the toggle, not `Escape`: see isDashboardInSwitcher()'s
    // identical, evidence-backed comment above.
    await this.click(this.gearToggle(), 'Close gear menu');
    await this.gearMenu()
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {});
    return visible;
  }

  async getGearMenuItemTexts(): Promise<string[]> {
    await this.openGearMenu();
    const texts = (await this.gearMenu().locator('a.dropdown-item').allInnerTexts()).map((t) => t.trim());
    // WHY re-clicking the toggle, not `Escape`: see isDashboardInSwitcher()'s
    // identical, evidence-backed comment above.
    await this.click(this.gearToggle(), 'Close gear menu');
    await this.gearMenu()
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {});
    return texts;
  }

  async openDeleteDialog(): Promise<void> {
    await this.openGearMenu();
    await this.click(this.gearMenuItem('Delete'), 'Gear menu: Delete');
    await this.deleteConfirmModal().waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  async confirmDelete(): Promise<void> {
    await this.click(this.deleteConfirmDeleteButton(), 'Delete Dashboard modal: Delete');
    await this.deleteConfirmModal().waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
  }

  // ── Assign Dashboard ──
  async openAssignDashboardDialog(): Promise<void> {
    await this.openGearMenu();
    await this.click(this.gearMenuItem('Assign Dashboard'), 'Gear menu: Assign Dashboard');
    await this.assignDashboardModal().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.stripOpenModalAriaHidden();
  }

  // ──────────────────────────────────────────────────────────
  // 9. Assertions
  // ──────────────────────────────────────────────────────────

  async assertDefaultSectionsVisible(): Promise<void> {
    for (const section of DEFAULT_DASHBOARD_SECTIONS) {
      await this.assertVisible(this.sectionHeader(section.sectionId), `${section.label} section header`);
      await this.assertVisible(this.gridSectionByLabel(section.label), `${section.label} grid section`);
    }
  }

  async assertSectionHasDashlets(label: string): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      const count = await this.getDashletCountInSection(label);
      if (count === 0) {
        throw new Error(`assertSectionHasDashlets: "${label}" section has zero dashlets`);
      }
    });
  }

  async assertDashletVisible(title: string): Promise<void> {
    await this.assertVisible(this.dashletContainerByTitle(title).first(), `Dashlet: ${title}`);
  }

  async assertDashletNotPresent(title: string): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      const present = await this.isDashletPresent(title);
      if (present) {
        throw new Error(`assertDashletNotPresent: dashlet "${title}" is still present`);
      }
    });
  }

  async assertEmptyState(): Promise<void> {
    await this.assertVisible(this.emptyStateText(), 'No Dashlet Added Yet empty state');
  }

  async assertDashboardActiveAfterReload(name: string): Promise<void> {
    await this.reloadPage();
    await this.assertDashboardLoaded();
    // WHY re-select from the switcher, never just reload and check current
    // view: confirmed live (§4 item 5) — a fresh page load always lands on
    // the account's PRIMARY dashboard, never whichever was last viewed.
    await this.switchToDashboard(name);
  }

  async assertDashboardNotInSwitcher(name: string): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      const present = await this.isDashboardInSwitcher(name);
      if (present) {
        throw new Error(`assertDashboardNotInSwitcher: "${name}" unexpectedly present in the switcher`);
      }
    });
  }

  // ──────────────────────────────────────────────────────────
  // 10. Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  // WHY split out from createDashboard() as its own public step: a few tests
  // (the empty-state check, and the read-only "Call Log has no Smartlist
  // option" wizard inspection) need to observe/act on the new-dashboard form
  // BEFORE the first Save — confirmed live that Add-Dashlet is already
  // available on a never-saved new dashboard.
  async openCreateNewDashboardForm(): Promise<void> {
    await this.click(this.createNewButton(), 'Create New dashboard');
    await this.editForm().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  }

  async createDashboard(data: DashboardData): Promise<string> {
    logger.info(`Creating dashboard: ${data.name}`);
    await this.openCreateNewDashboardForm();
    await this.renameDashboard(data.name);
    await this.saveDashboard();
    const current = await this.getCurrentDashboardName();
    if (current !== data.name) {
      throw new Error(`createDashboard: expected header "${data.name}", got "${current}"`);
    }
    logger.success(`Dashboard created: ${data.name}`);
    return data.name;
  }

  // WHY this deletes by name via the switcher first, never assumes the
  // caller is already viewing the target dashboard: teardown code frequently
  // runs after a test has switched away or the page has reloaded.
  //
  // WHY presence-checked FIRST (fixed 2026-09-03, root-caused via a real
  // sandbox --workers=2 CI failure, not a guess): DB10/DB22's own `finally`
  // blocks call this a SECOND time, defensively, even after their own `try`
  // block already deleted the exact same dashboard — by their own comment's
  // stated intent, "a guaranteed no-op if deletion already succeeded."
  // Before this fix that was only true by accident: a genuinely-gone
  // dashboard isn't in the switcher, so the old code fell straight into
  // `switchToDashboard(name)`, whose click has nothing to find and hangs
  // for its full `config.timeouts.navigation` wait — 60s locally, but
  // `sandbox.yml` sets `NAVIGATION_TIMEOUT: 120000` in CI, which exactly
  // equals CI's own outer TEST timeout (also 120000ms per
  // playwright.config.ts), leaving zero headroom. A single such doomed
  // wait was already enough to blow the whole test's budget in CI (this
  // was never safe, just previously masked by local's much larger
  // 60s-wait-vs-480s-test-timeout ratio); the DB13/DB25 fix's 3-attempt
  // retry (same file, same day) made it worse by tripling the exposure.
  // Confirmed live: DB10 and DB22 both failed on a real sandbox run with a
  // bare `Test timeout of 120000ms exceeded` and NO assertion error — this
  // method's own `logger.success('Dashboard deleted: ...')` never printed
  // for the redundant call, but the calling test's OWN success log (e.g.
  // `logger.success('DB22 passed')`) DID print seconds later, proving the
  // test's real logic had already finished; Playwright's outer timeout had
  // simply already fired and force-closed the page mid-wait
  // (`Error: locator.waitFor: Target page, context or browser has been
  // closed` on the retry attempts that followed), independent of whatever
  // the JS continuation went on to log. A real presence check makes the
  // "guaranteed no-op" promise true by construction instead of by luck,
  // and costs nothing extra for the real (non-redundant) delete path —
  // `isDashboardInSwitcher()` is a fast, timeout-free `isVisible()` probe.
  async deleteDashboardByName(name: string): Promise<void> {
    logger.info(`Deleting dashboard: ${name}`);
    if (!(await this.isDashboardInSwitcher(name))) {
      logger.info(`Dashboard "${name}" not present in switcher — nothing to delete`);
      return;
    }
    const current = await this.getCurrentDashboardName();
    if (current !== name) {
      await this.switchToDashboard(name);
    }
    await this.openDeleteDialog();
    await this.confirmDelete();
    logger.success(`Dashboard deleted: ${name}`);
  }

  // WHY a single flow method covering type+entity+configure+preview+add,
  // rather than 4 separate public calls at every test call site: this is
  // the exact repeated sequence every dashlet-adding test needs (§2E confirms
  // one identical wizard shape for every type/entity combination) — mirrors
  // this codebase's own "workflow wrapper" convention (e.g. ReportsPage.createReport()
  // composing several Form Action methods into one).
  //
  // WHY `exactConfigureName` is optional, not two separate public methods:
  // every caller needs the identical type/entity/step-navigation/preview/add
  // sequence — the ONLY thing that differs is how Step 2's option gets
  // picked (build decision #2: Report-type dashlets must pick this test's
  // own freshly-created disposable Report by exact name; Smartlist/Grouped
  // Smartlist dashlets may pick any available built-in option at random,
  // CLAUDE.md rule 4). Returns the resolved title so callers can assert the
  // dashlet's presence afterward without having to separately track which
  // option a random pick landed on.
  //
  // WHY `type === 'multilist'` branches to `selectRandomWizardConfigureOptions()`
  // (plural) instead of the single-select method above: Grouped Smartlists
  // is the one dashlet type confirmed live (2026-09-02) to be a genuine
  // multi-select — see that method's own WHY comment for the full evidence
  // and for why returning `names[0]`, not the whole array or the dashlet's
  // own generic "Grouped Smartlists" header, is what safely and uniquely
  // identifies this specific dashlet for the caller's later existence check.
  private async addDashletOnce(
    type: DashletType,
    entity: DashboardDashletEntityType,
    exactConfigureName?: string
  ): Promise<string> {
    await this.openAddDashletWizard();
    await this.selectDashletType(type);
    await this.selectDashletEntityType(entity);
    await this.goToWizardStep2();
    let resolvedName: string;
    if (exactConfigureName) {
      await this.selectWizardConfigureOptionByName(exactConfigureName);
      resolvedName = exactConfigureName;
    } else if (type === 'multilist') {
      const selectedNames = await this.selectRandomWizardConfigureOptions(
        MULTILIST_MIN_SELECTIONS,
        MULTILIST_MAX_SELECTIONS
      );
      resolvedName = selectedNames[0];
    } else {
      resolvedName = await this.selectRandomWizardConfigureOption();
    }
    await this.goToWizardStep3();
    await this.confirmAddDashlet();
    return resolvedName;
  }

  // WHY a single long poll on the ORIGINAL attempt, never a "wait a few
  // seconds, then destroy the wizard and resubmit from scratch" retry
  // (redesigned 2026-09-02, replacing a 2-attempt design of the same date —
  // see `.claude/known-issues.md`'s Dashboard render-race entry for the full
  // evidence): a dedicated live network-trace investigation PROVED, not just
  // suspected, that reopening the wizard on a timeout actively cancels the
  // original attempt's own still-in-flight confirmation request — captured
  // live as a genuine `net::ERR_ABORTED` on the exact dashlet's own
  // count-fetch, timed to the instant the retry's "+ Add new dashlet" click
  // fired. The original 2-attempt design (5s first check, reopen-and-retry,
  // 60s second check) wasn't giving a slow render more time — it was
  // destroying the one attempt that might have gone on to succeed, then
  // starting a fresh attempt that got no better treatment. A single poll
  // extended to this codebase's own `config.timeouts.navigation` budget
  // gives ONE attempt the SAME total time the old design's second attempt
  // had, without ever discarding in-flight work. This does not resolve WHY
  // the underlying render is sometimes slow (still not established whether
  // that's app-side or environment-side — see known-issues.md) — it only
  // stops the test's own logic from making a slow-but-recoverable render
  // unrecoverable.
  //
  // WHY `.waitFor({state:'visible', timeout})`, NOT `.isVisible({timeout})`
  // — a real bug found in THIS method's own first version, live (2026-09-02):
  // Playwright's `isVisible()` is a single, instant, non-polling DOM read —
  // its `timeout` option does not make it wait or retry at all. `.waitFor()`
  // genuinely polls for up to the given timeout, which is what this check
  // actually needs.
  private async isDashletRendered(title: string, timeoutMs: number): Promise<boolean> {
    return this.dashletContainerByTitle(title)
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .then(() => true)
      .catch(() => false);
  }

  async addDashlet(
    type: DashletType,
    entity: DashboardDashletEntityType,
    exactConfigureName?: string
  ): Promise<string> {
    logger.info(
      `Adding dashlet: type=${DASHLET_TYPE_LABELS[type]}, entity=${DASHBOARD_ENTITY_LABELS[entity]}` +
        (exactConfigureName ? `, option="${exactConfigureName}"` : ' (random option)')
    );
    const resolvedName = await this.addDashletOnce(type, entity, exactConfigureName);
    const added = await this.isDashletRendered(resolvedName, config.timeouts.navigation);
    if (!added) {
      throw new Error(
        `addDashlet: "${resolvedName}" (${DASHBOARD_ENTITY_LABELS[entity]}, ${DASHLET_TYPE_LABELS[type]}) ` +
          `did not render within ${config.timeouts.navigation}ms`
      );
    }
    logger.success(`Dashlet added: ${DASHBOARD_ENTITY_LABELS[entity]} (${DASHLET_TYPE_LABELS[type]}) — "${resolvedName}"`);
    return resolvedName;
  }

  // WHY this does NOT verify `isMarkAsPrimaryDisabled()` before returning
  // (a fix attempted and then reverted, 2026-09-02): confirmed real via a
  // live QA run — that check ran the FULL 60-second bound with zero
  // success, strong evidence the gear menu's own `.disabled` class is only
  // (re)computed on a fresh page load/data-fetch, never updated live within
  // the same SPA session after this click — consistent with this file's
  // own already-confirmed finding that "primary" status is resolved at
  // page-load time (§4 item 5). Polling for a signal that structurally
  // never arrives pre-reload would make every caller hang for a full
  // minute on every call, strictly worse than the original gap it was
  // meant to close. The real "did this take effect" signal is exactly what
  // every current caller (DB14/DB26) already does downstream — reload, then
  // check. A genuine, occasional reload-timing gap here (the caller landing
  // on the previous primary instead of the new one) remains a real,
  // disclosed possibility, not silently fixed — see this build's own final
  // test-run report.
  async markCurrentDashboardAsPrimary(): Promise<void> {
    await this.openMarkAsPrimary();
    logger.success('Marked current dashboard as Primary');
  }

  // WHY one guarded sequence, not 3 independently-`.catch()`'d steps at each
  // test's own call site: flaky-test-auditor finding (2026-09-02) — 3
  // separately-swallowed steps mean a failure in the FIRST (switching to
  // Default Dashboard) doesn't stop the SECOND (Mark as Primary) from
  // running anyway, against whatever dashboard is still active — very
  // plausibly the disposable one about to be deleted next, which would then
  // become this account's persistent primary. "Mark as Primary" is a real,
  // account-persisted per-user preference (confirmed live), not session-
  // scoped — a wrong dashboard ending up marked primary is a genuine,
  // surprising side effect for whoever next opens this account, the same
  // class of shared-state risk as the documented adminActive Products-
  // fixture-corruption incident (.claude/known-issues.md). One try/catch
  // around the whole sequence means a failed switch never reaches the
  // mark-as-primary step at all.
  async restorePrimaryToDefaultDashboard(): Promise<void> {
    try {
      await this.switchToDashboard('Default Dashboard');
      await this.markCurrentDashboardAsPrimary();
    } catch (error) {
      logger.warn(
        `restorePrimaryToDefaultDashboard: failed to restore Default Dashboard as this account's primary — ` +
          `manual verification may be needed: ${String(error)}`
      );
    }
  }

  // WHY "Assign to" is left untouched at its default: confirmed live
  // (2026-09-02 follow-up) — "Profiles" is already the modal's live default
  // selection, and every real caller in this build only ever needs
  // Profile-based assignment (RBAC test 27) — no need to touch the
  // assign-to type control at all. `profileName` is a parameter, not a
  // hardcoded internal value — see dashboardFactory.ts's own
  // `RESTRICTED_USER_PROFILE_NAME` for why the one real value passed today
  // is not itself a rule-4 violation.
  async assignDashboardToProfile(profileName: string): Promise<void> {
    logger.info(`Assigning dashboard to profile: ${profileName}`);
    await this.openAssignDashboardDialog();
    await this.selectRandomFromSearchableReactSelect(
      this.assigneesControl(),
      this.assigneesRawInput(),
      profileName,
      'Assign Dashboard: assignee search',
      profileName
    );
    await this.stripOpenModalAriaHidden();
    await this.click(this.assignDashboardSaveButton(), 'Assign Dashboard: Save');
    await this.assignDashboardModal().waitFor({ state: 'hidden', timeout: config.timeouts.navigation });
    logger.success(`Dashboard assigned to profile: ${profileName}`);
  }
}
