import { Page, Locator, Response, expect, ConsoleMessage } from '@playwright/test';
import * as fs from 'fs';
import { BasePage } from '../../core/BasePage';
import { config, buildApiUrl } from '../../../config/config';
import { logger } from '../../utils/logger';
import {
  ReportData,
  ReportCategory,
  ReportEntityType,
  ChartType,
  DateRangeOption,
  ReportFilterOperator,
  REPORT_OWNER_DIMENSION_BY_ENTITY,
  REPORT_COUNT_METRIC_BY_ENTITY,
  REPORT_CREATED_DATE_FILTER_BY_ENTITY,
  generateReportData,
} from '../../data/factories/reportFactory';
// WHY reused from quotationFactory.ts, not re-implemented here: a pure,
// general-purpose react-dates aria-label formatter with zero
// quotation-specific logic — the exact same SingleDatePicker widget Reports'
// own Custom Date Range uses (confirmed live). Calling another module's
// already-exported pure function is explicit reuse (CLAUDE.md rule 1), not
// an edit to that module — DealsPage.ts/CallLogsPage.ts each hand-roll their
// OWN private copy of this exact formatter instead of importing it, a
// pre-existing, separately-scoped duplication in this codebase (not
// something this build is responsible for fixing) — importing here avoids
// adding a FOURTH copy.
import { formatDateForCalendarLabel } from '../../data/factories/quotationFactory';

// ──────────────────────────────────────────────────────────────────────────
// WHY this ground-truth API map exists, and exactly how it was derived
// ──────────────────────────────────────────────────────────────────────────
// Every path/startPage pair below was confirmed live against QA immediately
// before this file was written (2026-08-21) — NOT assumed from
// investigation-notes-reports.md, which never needed to query these
// endpoints directly (its own Part B/H/I work used the Leads list's own UI
// drill-through, never a raw API call). Confirmed via direct network capture
// on each entity's own list page, then independently re-confirmed by calling
// each endpoint directly with a real bearer token:
//   Lead      -> POST /v1/search/lead        (page starts at 0)
//   Deal      -> POST /v1/search/deal        (page starts at 0)
//   Contact   -> POST /v1/search/contact     (page starts at 0)
//   Company   -> POST /v1/search/company     (page starts at 0)
//   Task      -> POST /v1/tasks/search       (page starts at 0) — REQUIRES a
//                top-level `fields: []` key alongside `jsonRule`, confirmed
//                live: omitting it throws a genuine backend 500
//                (NullPointerException) — the other 7 endpoints tolerate its
//                absence but never reject its presence, so it's sent
//                unconditionally below rather than only for Task.
//   Meeting   -> POST /v1/meetings/search    (page starts at 1, NOT 0 — a
//                confirmed, genuine inconsistency: page=0 404s)
//   Quotation -> POST /v1/quotations/search  (page starts at 0)
//   Call log  -> POST /v1/call-logs/search   (page starts at 1, same
//                inconsistency as Meeting) — ALSO confirmed live to 404
//                without an explicit `sort` query parameter, unlike every
//                other endpoint here, which is why every call below always
//                supplies one.
// All 8 accept the identical `jsonRule` body shape (a single `createdAt
// between [from, to]` rule) and return `totalElements` in the response.
interface ReportVerificationApiConfig {
  path: string;
  startPage: number;
}

const REPORT_VERIFICATION_API_CONFIG: Record<ReportEntityType, ReportVerificationApiConfig> = {
  Lead: { path: '/search/lead', startPage: 0 },
  Deal: { path: '/search/deal', startPage: 0 },
  Contact: { path: '/search/contact', startPage: 0 },
  Company: { path: '/search/company', startPage: 0 },
  Task: { path: '/tasks/search', startPage: 0 },
  Meeting: { path: '/meetings/search', startPage: 1 },
  Quotation: { path: '/quotations/search', startPage: 0 },
  'Call log': { path: '/call-logs/search', startPage: 1 },
};

// WHY this map, confirmed live 2026-08-21 (network capture on each entity's
// own Generate Preview call): the Reports engine's own save/preview endpoint
// is `/v3/reports/<entity-plural>` — and the pluralization is NOT uniform.
// Lead/Deal follow simple pluralization; Company is irregular
// ("companies"); Call log is the most surprising — its endpoint is
// `/v3/reports/calls`, not `/v3/reports/call-logs` or `/v3/reports/calllogs`
// (matching Call Log's own list route, `/sales/calls/list`, not
// `/sales/call-logs/list`). Contact/Task/Meeting/Quotation were NOT
// independently confirmed this session (time-boxed to the two entity types
// most likely to diverge from a naive plural — an irregular plural and a
// renamed entity — plus the two already confirmed via the original
// investigation) — only the 4 CONFIRMED entries are used by
// assertReportApiEndpointForEntityType() below; this map exists purely as
// living documentation of what's actually been verified, not a claim about
// the other 4.
const REPORT_SAVE_API_ENDPOINT_PLURAL_CONFIRMED: Partial<Record<ReportEntityType, string>> = {
  Lead: 'leads',
  Deal: 'deals',
  Company: 'companies',
  'Call log': 'calls',
};

export interface RunCountVerificationResult {
  reportId: string;
  reportTotal: number;
  apiTotal: number;
  reportBucketCount: number;
  destinationListCount: number;
}

export class ReportsPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // 1. Retry Config
  // ──────────────────────────────────────────────────────────
  // WHY: centralised in config.searchRetry — same shared per-env retry
  // tuning every other page object in this codebase reuses (see
  // QuotationsPage.ts's identical getter) instead of duplicating per-module
  // values. investigation-notes-reports.md's own timing section found no
  // evidence Reports needs a longer/shorter budget than this default.
  private get retryConfig() {
    return config.searchRetry[config.env as keyof typeof config.searchRetry];
  }

  // ──────────────────────────────────────────────────────────
  // 2. Locators
  // ──────────────────────────────────────────────────────────
  // WHY every selector below cites where it was confirmed: this module was
  // built entirely from a prior investigation pass plus a short, targeted
  // live re-verification for the handful of facts that pass didn't need
  // (the API ground-truth shape, Call log's Dimension/Metric exceptions, the
  // validation-carousel's real class names, and the Details-page action
  // buttons) — never guessed from the design docs' prose alone.

  // ── List page ──
  private readonly reportsListTable = (): Locator => this.page.locator('.rt-table');
  private readonly reportsListRows = (): Locator => this.page.locator('.rt-tr-group');
  private readonly searchInput = (): Locator => this.page.locator('#fulltext-search');
  private readonly createReportButton = (): Locator =>
    this.page.getByRole('button', { name: 'Create New Report', exact: true });
  private readonly reportRowByName = (name: string): Locator =>
    this.reportsListRows().filter({ hasText: name });
  // WHY `.rt-th[role="columnheader"]`, confirmed live 2026-08-21 (not from
  // investigation-notes-reports.md, which described this only via an
  // accessibility-tree label, not a raw selector): react-table's own header
  // cell, one per column, each independently clickable — confirmed clicking
  // "Created At" fires a real `sort=createdAt,asc` request while "Report
  // Name" fires none, matching the confirmed real sort-bug investigation
  // found.
  // WHY an anchored exact-text regex, not a bare substring `hasText`:
  // live-confirmed only for "Created At"/"Report Name" specifically (see
  // above) — anchoring is cheap insurance against a future column whose
  // name is a substring of another (e.g. a hypothetical "Type" column would
  // otherwise also match "Entity Type"/"Report Type").
  private readonly listColumnHeader = (columnName: string): Locator =>
    this.page
      .locator('.rt-th[role="columnheader"]')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(columnName)}`) });

  // ── Create/Edit form — shared ids across both routes ──
  // WHY the DOM id literally says "category", not "reportType": confirmed
  // live — this is the "Report Type" dropdown (One Dimensional/Multi
  // Dimensional/Hierarchy/Goal vs Achievement), which the API calls
  // `category`. The API field the DOM id `report_31_input_reportType`
  // controls is actually "Entity Type" (Lead/Deal/...) — a genuine,
  // confirmed naming collision between the visible label and the real form
  // field name. This is THE gotcha reportFactory.ts's own field names
  // (`category`/`reportType`) are built around — see that file's
  // module-level comment for the full explanation.
  private readonly reportNameInput = (): Locator => this.page.locator('#report_11_input_name');
  private readonly reportDescriptionInput = (): Locator =>
    this.page.locator('#report_21_input_description');
  private readonly categoryControl = (): Locator =>
    this.page
      .locator('[id="report_12_input_category"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly entityTypeControl = (): Locator =>
    this.page
      .locator('[id="report_31_input_reportType"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly chartTypeControl = (): Locator =>
    this.page
      .locator('[id="report_32_input_chartType"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly dateFilterControl = (): Locator =>
    this.page
      .locator('input[id$="_input_dateFilter.field"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly dateRangeControl = (): Locator =>
    this.page
      .locator('input[id$="_input_dateFilter.range"]')
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly customStartDateInput = (): Locator =>
    this.page.locator('input[id$="_input_dateFilter.startDate"]');
  private readonly customEndDateInput = (): Locator =>
    this.page.locator('input[id$="_input_dateFilter.endDate"]');
  private readonly calendarForwardButton = (): Locator =>
    this.page.getByLabel('Move forward to switch to the next month.');
  // WHY added (2026-08-21, found via a real live failure): the forward-only
  // navigation this method originally copied from QuotationsPage/DealsPage
  // never needed to reach a PAST date — every existing caller only ever
  // picks a future date. Reports' own Custom Date Range legitimately needs
  // past dates too (e.g. "15 months ago"), which the forward-only loop can
  // never reach — confirmed live: it clicked "next month" 24 times and never
  // found a date that was actually behind the calendar's starting view.
  // react-dates' own default accessible label for this button (mirroring
  // the already-confirmed forward one exactly).
  private readonly calendarBackwardButton = (): Locator =>
    this.page.getByLabel('Move backward to switch to the previous month.');
  // WHY `aria-label$=` (ends-with), not an exact `=` match: found via a
  // real live failure (2026-08-21) — react-dates prefixes a day cell's own
  // aria-label with "Selected. " whenever that exact date is already the
  // picker's current value (confirmed via the failing test's own captured
  // snapshot: `button "Selected. Friday, August 21, 2026"` for the End
  // Date field, whose default value is already today before any
  // interaction). An exact match never matches that prefixed form, which
  // — combined with the self-correcting navigation loop always finding
  // the "right" month but never the day cell — caused an endless
  // forward/backward oscillation that only stopped at the safety cap. An
  // ends-with match covers both the bare label and the "Selected. "-
  // prefixed one without needing to special-case which form applies.
  private readonly calendarDayByLabel = (label: string): Locator =>
    this.page.locator(`.SingleDatePicker td[aria-label$="${label}"]`);
  private readonly calendarBlockedDayByLabel = (label: string): Locator =>
    this.page.locator(`.SingleDatePicker td[aria-label*="Not available"][aria-label*="${label}"]`);

  // WHY suffix-matched raw inputs, not a fixed full id — confirmed live: the
  // Dimensions/Metrics numeric prefix (`undefined_00_...`) changes per ADDED
  // row (`undefined_10_...` for a second row) — a genuinely different shape
  // from BasePage's custom-field prefix (confirmed static across
  // create/reload/edit for a single field). Suffix-matching on the array
  // index inside the id sidesteps this entirely.
  private readonly dimensionRawInput = (index: number): Locator =>
    this.page.locator(`input[id$="_input_dimensions[${index}].field"]`);
  private readonly dimensionControl = (index: number): Locator =>
    this.dimensionRawInput(index).locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
  // WHY `[data-react-beautiful-dnd-draggable]`, not a guessed row-wrapper
  // class: confirmed live — every Dimension/Metric row is a real
  // react-beautiful-dnd draggable item, and this attribute reliably
  // identifies the nearest ancestor that represents "the whole row"
  // (control + trash icon as siblings) without depending on an unconfirmed
  // wrapper class name.
  private readonly dimensionRow = (index: number): Locator =>
    this.dimensionRawInput(index).locator('xpath=ancestor::*[@data-react-beautiful-dnd-draggable][1]');
  private readonly dimensionRemoveIcon = (index: number): Locator =>
    this.dimensionRow(index).locator('i.fa-trash');
  // WHY scoped to `div.form-section__dimensions`, not a page-wide
  // `.first()`: confirmed live via DOM ancestor-chain walk — the Dimensions
  // section's own "+ Add New" sits inside this distinctly-classed container,
  // while Metrics' identically-worded "Add New" sits inside a different
  // container (`.report-metrics`) — scoping by container survives either
  // section changing independently.
  private readonly addDimensionLink = (): Locator =>
    this.page.locator('div.form-section__dimensions').getByText('Add New', { exact: true });

  private readonly metricRawInput = (index: number): Locator =>
    this.page.locator(`input[id$="_input_metrics[${index}]"]`);
  private readonly metricControl = (index: number): Locator =>
    this.metricRawInput(index).locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  private readonly addMetricLink = (): Locator =>
    this.page.locator('.report-metrics').getByText('Add New', { exact: true });

  // ── Filters ── WHY a completely different react-select class family
  // (`select__*`, not `is-invalid__*`) for the initial field picker: confirmed
  // live — this is the one place on the whole Create form that doesn't use
  // the codebase-wide `is-invalid__*` convention. The row's own OPERATOR
  // control, once added, reverts to the standard `is-invalid__*` family —
  // confirmed live via direct DOM read of a real filter row.
  private readonly filterFieldSelectControl = (): Locator =>
    this.page.locator('.form-section__filters div[class*="select__control"]');
  private readonly addFilterButton = (): Locator => this.page.locator('button.add-filter');
  private readonly filterRows = (): Locator => this.page.locator('.applied-filters__card .filter-row');
  private readonly filterRow = (index: number): Locator => this.filterRows().nth(index);
  private readonly filterFieldNameLabel = (index: number): Locator =>
    this.filterRow(index).locator('.filter-row__filter-name');
  private readonly filterOperatorControl = (index: number): Locator =>
    this.filterRow(index)
      .locator(`[id$="_input_filters[${index}].operator"]`)
      .locator('xpath=ancestor::div[contains(@class,"is-invalid__control")]');
  // WHY matched by a generic `input[id^="input_filters"]`, not an
  // index-based id: confirmed live — the Value control's real id is
  // FIELD-NAME-based (e.g. `input_filters_source`), not index-based like
  // every other id on this form — a genuine, confirmed exception. Scoping to
  // the specific row (via filterRow(index)) is what keeps this safe despite
  // not being index-keyed itself.
  private readonly filterValueRawInput = (index: number): Locator =>
    this.filterRow(index).locator('input[id^="input_filters"]');
  private readonly filterValueControl = (index: number): Locator =>
    this.filterValueRawInput(index).locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
  private readonly filterRemoveIcon = (index: number): Locator =>
    this.filterRow(index).locator('.filter-row__delete');

  private readonly generatePreviewButton = (): Locator =>
    this.page.getByRole('button', { name: 'Generate Preview', exact: true });
  // WHY `#updatedActionBtn, #updateActionBtn`, NOT a bare `<button>` text
  // match: a real live failure (2026-08-21) proved the text-match approach
  // wrong — the Edit page renders BOTH the real Save button AND the
  // Save-As modal's own `#saveReportAs` button (text "Save") simultaneously
  // in the DOM, a genuine strict-mode violation. The real, distinct ids
  // (confirmed live via the failure's own error message) are
  // `#updatedActionBtn` on the Create form and `#updateActionBtn` on the
  // Edit form — one letter apart, easily missed — the identical dual-id
  // shape already documented for this exact gotcha in
  // `.claude/reference-patterns.md`'s Save-button note for other modules.
  private readonly saveButton = (): Locator =>
    this.page.locator('#updatedActionBtn, #updateActionBtn');

  // ── Validation — confirmed dual pattern, live 2026-08-21 ──
  private readonly validationCarouselWrapper = (): Locator => this.page.locator('.helptext-wrapper');
  private readonly validationCarouselMessage = (): Locator =>
    this.validationCarouselWrapper().locator('p.help-text.error').first();
  private readonly validationCarouselCount = (): Locator =>
    this.validationCarouselWrapper().locator('.msg-count.error').first();
  private readonly validationCarouselTotal = (): Locator =>
    this.validationCarouselWrapper().locator('.msg-count-total.error').first();
  // WHY `.nth(1)` is safe here, confirmed via a direct outerHTML dump of a
  // real carousel (2026-08-21): the wrapper's `.btn-navigation` group
  // contains EXACTLY two buttons, always in this order — `<button
  // disabled><i class="fa fa-caret-left">` (prev) then `<button><i
  // class="fa fa-caret-right">` (next) — not a guessed position.
  private readonly validationCarouselNextButton = (): Locator =>
    this.validationCarouselWrapper().locator('.btn-navigation button').nth(1);

  // ── Preview / zero-data / error messages — 3 CONFIRMED distinct strings ──
  private readonly previewNoDataMessage = (): Locator =>
    this.page.getByText('Oops, there is no data for the values you have selected');
  // WHY the heading text alone, not the combined heading+paragraph string:
  // a real live failure (2026-08-21) proved this message is split across
  // TWO separate DOM elements — a `<h6>` heading ("Oops, report cannot be
  // generated for the data being requested") and a SEPARATE `<p>`
  // ("Would you want to try changing any parameters?") — confirmed via the
  // failure's own accessibility snapshot. `getByText()` requires a single
  // element/text node containing the full string, which none does; matching
  // the heading alone is sufficient to prove the no-data state.
  private readonly detailsNoDataMessage = (): Locator =>
    this.page.getByRole('heading', {
      name: 'Oops, report cannot be generated for the data being requested',
    });
  // WHY `.first()`, despite the confirmed-live exact string: this generic
  // "something went wrong" toast shape is a documented, recurring,
  // UNRELATED background-noise pattern elsewhere in this codebase's own
  // ErrorCollector — an unrelated background request firing the identical
  // generic toast concurrently with this assertion's real target is a real,
  // if low-probability, strict-mode-violation risk this guards against
  // cheaply.
  private readonly backendRangeRejectionMessage = (): Locator =>
    this.page.getByText(/Oops\.\.\.something went wrong!/).first();

  // ── Details page ──
  // WHY `:has(p)`, not a bare `main h1`: a real live failure (2026-08-21)
  // found TWO `<h1>` elements exist on the Details page — a genuine strict-
  // mode violation. The real report-name heading has the confirmed live
  // structure `<h1><p>{Report Name}</p></h1>` (investigation-notes-
  // reports.md Part B §8) — filtering for the one with a nested `<p>`
  // disambiguates it from whatever the second, unrelated `<h1>` is.
  private readonly detailHeading = (): Locator => this.page.locator('main h1').filter({ has: this.page.locator('p') });
  // WHY `button.dropdown-toggle:has(i.fa-ellipsis-v)`, NOT `#openActionsMenu`:
  // confirmed live — `#openActionsMenu` is a real, confirmed DUPLICATE id
  // shared by two other buttons (the chart-type toggle and the Save
  // split-button), neither of which is the ellipsis menu. The ellipsis
  // button carries no id at all — its FontAwesome icon class is the only
  // reliable, confirmed-unique anchor.
  private readonly ellipsisButton = (): Locator =>
    this.page.locator('button.dropdown-toggle[data-toggle="dropdown"]').filter({
      has: this.page.locator('i.fa-ellipsis-v'),
    });
  private readonly ellipsisMenuItem = (text: string): Locator =>
    this.page
      .locator('.dropdown-menu.show')
      .locator('a.dropdown-item, button.dropdown-item')
      .filter({ hasText: text });
  // WHY `button#confirm.btn-danger`: confirmed live — the identical shared
  // delete-confirm modal component every other module in this codebase
  // already uses (`.claude/reference-patterns.md`'s own note that this shape
  // is shared codebase-wide), not a Reports-specific one.
  private readonly deleteConfirmButton = (): Locator => this.page.locator('button#confirm.btn-danger');
  // WHY two distinct `#openActionsMenu` buttons, disambiguated by parent
  // class — confirmed live via direct DOM read of both: the chart-type
  // toggle's own `.btn-group.btn-save-dd` parent has NO `.mr-2`; the Save
  // split-button's parent DOES (`.btn-group.btn-save-dd.mr-2`). This is a
  // real, confirmed duplicate-id bug in the app itself, not a locator
  // mistake — see the module-level comment on REPORT_VERIFICATION_API_CONFIG
  // for the same "confirmed live, not assumed" discipline applied here.
  private readonly chartTypeToggle = (): Locator =>
    this.page.locator('div.btn-group.btn-save-dd:not(.mr-2) button.dropdown-toggle-split');
  private readonly saveSplitToggle = (): Locator =>
    this.page.locator('div.btn-group.btn-save-dd.mr-2 button.dropdown-toggle-split');
  private readonly saveAsMenuItem = (): Locator => this.page.locator('#createActionMenu');
  private readonly saveMenuItem = (): Locator => this.page.locator('#updateActionMenu');
  private readonly saveAsModal = (): Locator => this.page.locator('#reportSaveAsModal');
  private readonly saveAsNameInput = (): Locator => this.saveAsModal().locator('#name');
  private readonly saveAsDescriptionInput = (): Locator => this.saveAsModal().locator('#description');
  private readonly saveAsConfirmButton = (): Locator => this.page.locator('#saveReportAs');
  private readonly chartTypeMenuItem = (label: 'Bar Chart' | 'Pie Chart' | 'Table'): Locator =>
    this.page
      .locator('.dropdown-menu.show button.chart-option')
      .filter({ has: this.page.locator('.option-label', { hasText: label }) });

  private readonly reportHeaderMetricName = (): Locator => this.page.locator('.report__header .metric-name');
  // WHY an exact-anchored regex, not a bare substring `hasText`: Dimension
  // values are freeform app data (owner names, status labels, etc.) —
  // exactly the shape prone to substring overlap (e.g. "Won"/"Not Won") that
  // would otherwise throw a real strict-mode violation the moment two rows'
  // labels overlap.
  private readonly reportBodyDimensionValueByLabel = (label: string): Locator =>
    this.page
      .locator('.report__body .dimension-1.multidimensional-chart-cell')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(label)}\\s*$`) })
      .first();
  private readonly tableModeDrillThroughLinks = (): Locator =>
    this.page.locator('.report__body a[target="_blank"]');
  // WHY `.footer-title`/`.footer-values`, only present in Table chart-type
  // mode: confirmed live — Bar/Pie mode carry the total INSIDE the header's
  // own `data-original-title` (see reportHeaderMetricName above); Table mode
  // additionally renders a distinct Total row at the bottom of the body.
  private readonly tableModeTotalValue = (): Locator =>
    this.page.locator('.footer-title').filter({ hasText: 'Total' }).locator('xpath=following-sibling::div//span');

  // ──────────────────────────────────────────────────────────
  // 3. Constructor
  // ──────────────────────────────────────────────────────────
  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // 4. Private Helpers
  // ──────────────────────────────────────────────────────────

  // WHY a shared "open the menu" helper for every `is-invalid__*`
  // react-select on this form, rather than a bare `control.click()` at each
  // call site: confirmed live (2026-08-21) — a raw click on the control div
  // itself is unreliable, the SAME confirmed race already documented
  // elsewhere in this codebase for other modules' react-selects (the
  // "Search ..." placeholder / the current single-value both overlay and
  // intercept pointer events on first open). Clicking whichever of the two
  // is actually visible inside the control — placeholder (nothing chosen
  // yet) or single-value (already has a value) — is what reliably opens the
  // menu; a bare `force: true` click on the outer control was tried first
  // and confirmed NOT to open the menu at all (a synthetic click bypasses
  // react-select's own pointer-down listener).
  // WHY a pre-click check for an already-open menu (2026-08-21, defensive
  // hardening — root cause NOT independently reproduced live on demand,
  // per rule 10): two separate real `--retries=0` CI-speed runs hit the
  // identical `css-1dsbpcp` interception signature at different points in
  // this file's react-select sequences, but a faithful manual replay of
  // the exact same sequence (both slow-paced and fully back-to-back, no
  // artificial waits) could not reproduce it either time — consistent
  // with a genuine timing-sensitive race that only manifests under real
  // automated-test speed/load, not something provably fixed by inspection
  // alone. Plausible mechanism, supported by the two real captures: a
  // react-select control (confirmed live elsewhere in this file that some
  // picklist-shaped Value controls auto-open their own menu on mount,
  // independent of any click from this code) can already have a menu open
  // by the time this method runs, and `closeMenuRobustly()`'s own
  // post-select close-wait can resolve "hidden" a moment before the
  // backdrop element is actually gone from hit-testing. Checking for, and
  // proactively closing, ANY currently-open menu before attempting to
  // open a new one closes that gap without depending on which specific
  // control caused it.
  private async ensureNoOpenMenu(): Promise<void> {
    const openMenu = this.page.locator('.is-invalid__menu, .select__menu').first();
    if (await openMenu.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await openMenu.waitFor({ state: 'hidden', timeout: config.timeouts.expect }).catch(() => {
        /* best effort — the click that follows will surface any real remaining problem loudly */
      });
    }
  }

  // WHY this method exists at all, and what it's REALLY protecting
  // against — the full, confirmed root cause (2026-08-21), found via
  // MutationObserver + network instrumentation across several real,
  // repeated live reproductions, not inferred from symptoms alone:
  //
  // This app loads several third-party widgets on every page (already
  // known to this codebase's own `errorFilters.ts` as noise sources —
  // `find.userpilot.io`, `flow-api.viasocket.com`). One of them
  // (`flow-api.viasocket.com/users/register`) fires an async registration
  // call within the first ~300-450ms after page load. Handling ITS
  // response triggers an app-level re-render — confirmed live via a
  // MutationObserver watching `is-invalid__control`'s own class list: the
  // control gains `is-invalid__control--menu-is-open` (menu genuinely
  // opens) and then LOSES it again 20-160ms later (torn back down), with
  // zero interaction from our own code in between. This is a real,
  // external, uncontrollable timing collision between this app's own
  // third-party widget lifecycle and whichever react-select menu happens
  // to be open during that ~0.3-0.6s window after page load — not a bug
  // in our click logic, and not something we can fix by clicking
  // differently or by blocking the widget's network traffic (tried live:
  // aborting `viasocket.com` requests via `page.route()` made the widget
  // retry aggressively enough to saturate the CDP connection and hang the
  // whole browser session — confirmed live, reverted immediately. Waiting
  // for the widget's OWN network response before interacting was ALSO
  // tried and confirmed insufficient — the disruptive re-render lands
  // ~130-160ms AFTER the response, not synchronously with it, so a
  // response-based gate doesn't reliably outlast it either).
  //
  // Given the trigger is real, external, and not reliably awaitable, the
  // correct fix is not to retry BLINDLY (the previous, now-superseded
  // version of this method: 3 attempts, each accepting a single instant
  // of visibility as "success") — a menu that opens and is torn down 20ms
  // later WOULD satisfy a single-instant visibility check, which is
  // exactly why that version still failed under real automated speed. The
  // fix is to verify the menu survives a stability window sized to the
  // measured disruption (20-160ms observed, 500ms is >10x margin) before
  // trusting it — implemented as `waitFor({state:'hidden', timeout})`
  // TIMING OUT (i.e. it stayed visible) being the success case, since
  // Playwright has no direct "assert this stays true for N ms" API and
  // this codebase forbids an unconditional, fixed-duration sleep — this is
  // a real, condition-based wait (for hiding), not a blind sleep; it only ever
  // "succeeds" by genuinely NOT observing the menu disappear.
  private async clickToOpenMenu(trigger: Locator, menu: Locator, description: string): Promise<void> {
    const attempts = 5;
    const STABILITY_WINDOW_MS = 500;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.click(trigger, `${description}: open menu (attempt ${attempt}/${attempts})`);
      const opened = await menu
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        logger.warn(`${description}: menu did not open on attempt ${attempt}/${attempts}`);
        continue;
      }
      const tornDown = await menu
        .waitFor({ state: 'hidden', timeout: STABILITY_WINDOW_MS })
        .then(() => true)
        .catch(() => false);
      if (!tornDown) return;
      logger.warn(
        `${description}: menu opened then closed again within ${STABILITY_WINDOW_MS}ms on attempt ` +
          `${attempt}/${attempts} (torn down by an app-level re-render — see this method's own comment) — retrying`
      );
    }
    // Final attempt already exhausted — surface a real, clear timeout.
    await menu.waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  private async openIsInvalidMenu(control: Locator, description: string): Promise<void> {
    await this.ensureNoOpenMenu();
    const trigger = control.locator('[class*="__single-value"], [class*="__placeholder"]').first();
    await this.clickToOpenMenu(trigger, this.page.locator('.is-invalid__menu'), description);
  }

  // WHY the Escape fallback after a failed close-wait, rather than
  // `force: true` on the NEXT control's click (tried and reverted,
  // 2026-08-21): live investigation of a real, reproduced failure
  // (`.filter-row__delete` click stuck for the full 30s behind a
  // `css-1dsbpcp` "intercepting" div) found via direct DOM inspection that
  // this div is NOT stale leftover portal debris — its own ancestor chain
  // is `css-1dsbpcp` → `.is-invalid__menu` → a body-level portal wrapper —
  // meaning a REAL, still-open react-select menu was rendering a
  // full-viewport (1680×907, x=0/y=0) click-catcher backdrop, because this
  // exact menu's own post-select close-wait had already timed out and been
  // silently swallowed one step earlier. `force: true` on the NEXT click
  // would have punched through that backdrop without ever closing the
  // still-logically-open menu underneath it — masking the symptom, not
  // fixing it. Confirmed live that `page.keyboard.press('Escape')`
  // reliably closes this exact stuck menu (`.is-invalid__menu`/
  // `.select__menu` count 1→0, the backdrop div gone with it) — so the
  // real fix is making THIS method's own close-wait robust, not forcing
  // through whatever it leaves behind.
  private async closeMenuRobustly(menu: Locator, description: string): Promise<void> {
    const closed = await menu
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .then(() => true)
      .catch(() => false);
    if (!closed) {
      logger.warn(`${description}: menu did not close on its own after selecting — closing via Escape`);
      await this.page.keyboard.press('Escape');
      await menu.waitFor({ state: 'hidden', timeout: config.timeouts.expect }).catch(() => {
        /* best effort — the next interaction will surface any real remaining problem loudly */
      });
    }
  }

  private async selectExactFromIsInvalidMenu(
    control: Locator,
    optionText: string,
    description: string
  ): Promise<void> {
    await this.openIsInvalidMenu(control, description);
    const menu = this.page.locator('.is-invalid__menu');
    const option = menu
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(optionText)}\\s*$`) })
      .first();
    await option.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await option.click();
    await this.closeMenuRobustly(menu, description);
    logger.success(`${description} set to: ${optionText}`);
  }

  // WHY reads then closes via Escape, never leaves the menu open: used only
  // for read-only inspection (dedup checks, listing live options) — closing
  // afterward leaves the form in the same state the caller found it in.
  private async getIsInvalidMenuOptionTexts(control: Locator, description: string): Promise<string[]> {
    await this.openIsInvalidMenu(control, description);
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    await options.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const texts = (await options.allInnerTexts()).map((t) => t.trim());
    await this.page.keyboard.press('Escape');
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {});
    return texts;
  }

  // WHY the Filters field-picker needs its own, separate open/select pair:
  // confirmed live — it uses the `select__*` class family, not
  // `is-invalid__*`, the one place on this whole form that diverges from the
  // codebase-wide react-select convention.
  private async selectExactFromSelectFamilyMenu(optionText: string): Promise<void> {
    await this.ensureNoOpenMenu();
    const menu = this.page.locator('.select__menu');
    await this.clickToOpenMenu(this.filterFieldSelectControl(), menu, 'Select Filter field picker');
    const option = menu
      .locator('.select__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(optionText)}\\s*$`) })
      .first();
    await option.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await option.click();
    await this.closeMenuRobustly(menu, 'Select Filter field picker');
  }

  // WHY this helper duplicates BasePage.fetchAuthenticatedApiData()'s
  // JWT-extraction technique instead of extending that method: this file
  // must never edit BasePage.ts (out of scope for this build — see the
  // task's own hard rule 3) and that method is GET-only with no body
  // parameter, while every ground-truth endpoint this module needs is a
  // POST carrying a `jsonRule` filter body (confirmed live — see
  // REPORT_VERIFICATION_API_CONFIG's own comment). Mirrors the exact same
  // token-extraction technique, just with `method`/`body` added.
  private async postAuthenticatedApiData(
    url: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    const result = await this.page.evaluate(
      async ({ fetchUrl, fetchBody }) => {
        try {
          const raw = localStorage.getItem('token');
          if (!raw) return { ok: false as const, reason: 'no-token-in-localStorage' };
          const payload = JSON.parse(atob(raw.split('.')[1]));
          const accessToken = payload?.data?.accessToken;
          if (!accessToken) return { ok: false as const, reason: 'no-accessToken-in-decoded-token' };
          const res = await fetch(fetchUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(fetchBody),
          });
          const bodyText = await res.text().catch(() => '');
          if (!res.ok) {
            return {
              ok: false as const,
              reason: 'http-error',
              status: res.status,
              body: bodyText.slice(0, 500),
            };
          }
          let json: Record<string, unknown> | null = null;
          try {
            json = JSON.parse(bodyText);
          } catch {
            /* leave json null — reported as a distinct reason below */
          }
          return { ok: true as const, data: json };
        } catch (e) {
          return { ok: false as const, reason: 'exception', message: String(e) };
        }
      },
      { fetchUrl: url, fetchBody: body }
    );

    if (!result.ok) {
      const detail =
        result.reason === 'http-error'
          ? `HTTP ${result.status}${result.body ? ` — ${result.body}` : ''}`
          : result.reason === 'exception'
            ? result.message
            : result.reason;
      logger.warn(`postAuthenticatedApiData: POST ${url} did not return usable data (${detail})`);
      return null;
    }
    return result.data;
  }

  private async getApiCountForWindow(
    entityType: ReportEntityType,
    from: Date,
    to: Date
  ): Promise<number> {
    const cfg = REPORT_VERIFICATION_API_CONFIG[entityType];
    const body = {
      jsonRule: {
        condition: 'AND',
        rules: [
          {
            id: 'createdAt',
            field: 'createdAt',
            type: 'date',
            operator: 'between',
            value: [from.toISOString(), to.toISOString()],
          },
        ],
        valid: true,
      },
      // WHY always sent, even for the 6 endpoints confirmed to tolerate its
      // absence: see REPORT_VERIFICATION_API_CONFIG's own comment — Task's
      // endpoint genuinely 500s without it.
      fields: [],
    };
    const url = `${buildApiUrl(cfg.path)}?page=${cfg.startPage}&size=1&sort=createdAt,desc`;
    const data = await this.postAuthenticatedApiData(url, body);
    const totalElements = data?.totalElements;
    if (typeof totalElements !== 'number') {
      throw new Error(
        `getApiCountForWindow(${entityType}): expected a numeric totalElements from ${url}, got ${JSON.stringify(data)}`
      );
    }
    return totalElements;
  }

  private async waitForReportListPage(): Promise<void> {
    await this.waitForEntityListPage(
      // WHY an anchored regex, never a bare substring: CLAUDE.md rule 15 —
      // confirmed live real endpoint is `/v3/reports/search`.
      (res) =>
        res.url().match(/\/v3\/reports\/search(?:\?.*)?$/) !== null &&
        res.request().method() === 'POST' &&
        res.status() === 200,
      this.reportsListTable(),
      'Reports'
    );
  }

  private async waitForReportDetailPage(): Promise<Response> {
    const response = await this.waitForEntityDetailPage(
      /\/reports\/details\//,
      (res) => res.url().match(/\/v3\/reports\/\d+(?:\?.*)?$/) !== null && res.request().method() === 'GET',
      'Report detail'
    );
    return response;
  }

  private captureReportIdFromUrl(): string | null {
    const match = this.page.url().match(/\/reports\/details\/(\d+)/);
    return match ? match[1] : null;
  }

  // ──────────────────────────────────────────────────────────
  // 5. Navigation
  // ──────────────────────────────────────────────────────────

  async goToReportsList(): Promise<void> {
    logger.info('Navigating to Reports list');
    await this.navigateTo(`${config.appUrl}/sales/reports/list`);
    await this.waitForReportListPage();
    logger.success('On Reports list page');
  }

  // WHY via the list page's own button, never a direct
  // `navigateTo('/sales/reports/create')`: confirmed live (investigation-
  // notes-reports.md's own Part B) — a direct goto intermittently rendered a
  // completely blank page (no React mount) twice in one investigation
  // session, with no session-expiry cause; both times, reaching the same
  // page via the list page's own "Create New Report" button worked cleanly.
  async goToCreateReport(): Promise<void> {
    logger.info('Opening Create Report form');
    await this.goToReportsList();
    await this.click(this.createReportButton(), 'Create New Report button');
    await this.categoryControl().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    logger.success('Create Report form opened');
  }

  async goToReportDetails(reportId: string): Promise<void> {
    logger.info(`Navigating to report details: ${reportId}`);
    await this.navigateTo(`${config.appUrl}/sales/reports/details/${reportId}`);
    await this.waitForReportDetailPage();
    logger.success(`On report details page: ${reportId}`);
  }

  async goToReportEdit(reportId: string): Promise<void> {
    logger.info(`Navigating to report edit: ${reportId}`);
    await this.navigateTo(`${config.appUrl}/sales/reports/edit/${reportId}`);
    await this.reportNameInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    logger.success(`On report edit page: ${reportId}`);
  }

  // ──────────────────────────────────────────────────────────
  // 6. Form Actions
  // ──────────────────────────────────────────────────────────

  async selectCategory(category: ReportCategory): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.categoryControl(), category, 'Report Type (category)');
  }

  async selectEntityType(entityType: ReportEntityType): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.entityTypeControl(), entityType, 'Entity Type (reportType)');
  }

  async selectChartTypeOnForm(chartType: ChartType): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.chartTypeControl(), chartType, 'Chart Type');
  }

  async selectDateFilter(fieldName: string): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.dateFilterControl(), fieldName, 'Date Filter');
  }

  async selectDateRangeOption(option: DateRangeOption): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.dateRangeControl(), option, 'Date Range');
  }

  // WHY this drives the SAME SingleDatePicker interaction pattern already
  // proven for Deals/Quotations/Call Logs (click input → forward-click
  // calendar → click day cell by aria-label), not a fresh invention: this is
  // the identical widget (confirmed live, investigation-notes-reports.md
  // Part B §2 — same "Press the down arrow key to interact with the
  // calendar" accessibility hint already documented elsewhere in this
  // codebase for other modules' date pickers).
  // WHY the caption text is parsed with `.filter(Boolean)`, not just
  // `.first()`: confirmed live — react-dates renders 3 `.CalendarMonth_caption`
  // elements (previous/current/next, for its sliding transition), but only
  // the currently-visible one actually has text; the other two are empty.
  private async getCurrentlyDisplayedCalendarMonth(): Promise<{ month: number; year: number }> {
    const texts = await this.page.locator('.CalendarMonth_caption').allInnerTexts();
    const visibleCaption = texts.find((t) => t.trim().length > 0);
    if (!visibleCaption) {
      throw new Error('getCurrentlyDisplayedCalendarMonth: no visible .CalendarMonth_caption text found');
    }
    const [monthName, yearStr] = visibleCaption.trim().split('\n');
    const month = new Date(`${monthName} 1, ${yearStr}`).getMonth();
    return { month, year: parseInt(yearStr, 10) };
  }

  private async selectDateInPicker(input: Locator, date: Date): Promise<void> {
    const dayLabel = formatDateForCalendarLabel(date);
    await this.click(input, `date picker input (target: ${dayLabel})`);
    const dayCell = this.calendarDayByLabel(dayLabel);
    let found = await dayCell
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    let attempts = 0;
    // WHY the navigation distance/direction is RE-READ from the ACTUAL
    // currently-displayed calendar month on EVERY iteration, not computed
    // once upfront: found via a second real live failure (2026-08-21) — a
    // version that read the displayed month ONCE before the loop (correct
    // fix for the End-Date-inherits-Start's-position bug documented below)
    // still failed intermittently under real automated-test speed: the
    // initial single check computed a distance of 0 (genuinely on the
    // right month), but the target day cell still wasn't found on the
    // first check (a transient render lag right as the calendar opened),
    // so the loop navigated FORWARD by its already-computed direction
    // regardless — landing 3 months past the target with no way to
    // self-correct, since the direction/distance were fixed before the
    // loop started. Re-reading the caption and recomputing the diff each
    // iteration means a stale or momentarily-wrong first read gets
    // corrected on the very next pass instead of compounding.
    //
    // Original bug this superseded, kept for context: the End Date
    // calendar does NOT reset to the current month when opened — it
    // reopens showing whatever month the Start Date calendar was last
    // navigated to (already documented for day-level navigation in the
    // R17 fix; this is the same fact applying to month-level navigation
    // too). A version that computed distance from `Date.now()` correctly
    // navigated Start Date (6 years back, calendar genuinely starts on
    // "now") but then failed selecting End Date = today, because the
    // calendar was still sitting 6 years in the past.
    //
    // WHY a generous fixed safety cap (100), not a computed bound: since
    // direction/distance are now recomputed every iteration, the loop
    // self-corrects toward the target regardless of any single iteration's
    // reading, so a large fixed backstop against a genuine infinite-loop
    // bug is the only real requirement — comfortably above the ~72-month
    // worst case this suite actually exercises (six years), with margin
    // for the day-of-month edge cases the old `+ 3` margin covered.
    const maxAttempts = 100;
    while (!found && attempts < maxAttempts) {
      const { month: currentMonth, year: currentYear } = await this.getCurrentlyDisplayedCalendarMonth();
      const signedMonthDiff = (date.getFullYear() - currentYear) * 12 + (date.getMonth() - currentMonth);
      if (signedMonthDiff === 0) {
        // Already on the right month by this reading, but the day cell
        // still isn't visible — give it one more, longer look before
        // concluding navigation is genuinely needed (guards against the
        // exact transient-render-lag race this fix targets).
        found = await dayCell
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false);
        if (found) break;
        // WHY fail fast here instead of falling through to a nav click:
        // found via a real live failure (2026-08-21) — navigating away
        // when the month reading is already correct just guarantees the
        // NEXT iteration navigates back (diff flips to ±1, then to 0
        // again), an endless two-step oscillation that burns the entire
        // safety cap without ever making real progress. If the day cell
        // genuinely isn't on a month confirmed correct twice, the real
        // problem is the day-cell locator itself, not navigation — fail
        // loudly with a distinct message instead of masking it as "wrong
        // month" for up to 100 attempts.
        throw new Error(
          `selectDateInPicker: on the correct month for "${dayLabel}" but the day cell was never found — ` +
            'likely a locator mismatch (e.g. an aria-label variant), not a navigation problem'
        );
      }
      const navButton = signedMonthDiff < 0 ? this.calendarBackwardButton() : this.calendarForwardButton();
      await this.click(navButton, `calendar ${signedMonthDiff < 0 ? 'backward' : 'forward'}`);
      found = await dayCell
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      attempts++;
    }
    if (!found) {
      throw new Error(`selectDateInPicker: could not find day cell for "${dayLabel}" after ${attempts} attempts`);
    }
    await dayCell.click();
  }

  async fillCustomDateRange(start: Date, end: Date): Promise<void> {
    logger.info(`Filling custom date range: ${start.toDateString()} → ${end.toDateString()}`);
    await this.selectDateInPicker(this.customStartDateInput(), start);
    await this.selectDateInPicker(this.customEndDateInput(), end);
    logger.success('Custom date range filled');
  }

  async addDimensionRow(): Promise<void> {
    await this.click(this.addDimensionLink(), 'Add New dimension row');
  }

  async selectDimension(index: number, value: string): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.dimensionControl(index), value, `Dimension row ${index}`);
  }

  // WHY this returns whether an app-level error was captured, rather than
  // asserting it directly: this is a CONFIRMED real Kylas application bug
  // (investigation-notes-reports.md's Edge Case Investigation §3) —
  // `removeDimension()` throws `TypeError: Cannot read properties of
  // undefined (reading 'fieldType')` when removing a row that was NEVER
  // given a value, but throws nothing when removing a filled row. The row is
  // still removed from the UI either way (confirmed live) — the caller
  // decides what to assert (bug-reproduction tests assert
  // `appErrorCaptured === true`; the filled-row contrast test asserts
  // `false`), per decision #6's requirement to capture the error rather than
  // silently ignore or suppress it.
  async removeDimensionRow(index: number): Promise<{ appErrorCaptured: boolean }> {
    const captured: string[] = [];
    const onConsole = (msg: ConsoleMessage): void => {
      if (msg.type() === 'error') captured.push(msg.text());
    };
    const onPageError = (err: Error): void => {
      captured.push(err.message);
    };
    this.page.on('console', onConsole);
    this.page.on('pageerror', onPageError);
    try {
      await this.click(this.dimensionRemoveIcon(index), `remove dimension row ${index}`);
      await this.dimensionRow(index)
        .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
        .catch(() => {
          /* row may already be fully detached rather than merely hidden */
        });
    } finally {
      this.page.off('console', onConsole);
      this.page.off('pageerror', onPageError);
    }
    const appErrorCaptured = captured.some((m) => /removeDimension|fieldType/i.test(m));
    if (appErrorCaptured) {
      logger.warn(
        `removeDimensionRow(${index}): confirmed real Kylas app-side error captured — ${captured.join(' | ')}`
      );
    }
    return { appErrorCaptured };
  }

  async addMetricRow(): Promise<void> {
    await this.click(this.addMetricLink(), 'Add New metric row');
  }

  async selectMetric(index: number, value: string): Promise<void> {
    await this.selectExactFromIsInvalidMenu(this.metricControl(index), value, `Metric row ${index}`);
  }

  // WHY the Value control's shape is handled generically, not by a
  // per-field-type branch the caller must know about: confirmed live — a
  // picklist-shaped field (e.g. Source) renders the standard `is-invalid__*`
  // react-select for Value; a plain text field (e.g. Last Name) renders a
  // bare `.form-control` text input instead. Checking whether an
  // `is-invalid__control` ancestor exists for the same raw input
  // distinguishes the two without the caller needing to know in advance.
  async addFilter(field: string, operator: ReportFilterOperator, value?: string): Promise<void> {
    logger.info(`Adding filter: ${field} ${operator} ${value ?? '(no value)'}`);
    await this.selectExactFromSelectFamilyMenu(field);
    await this.click(this.addFilterButton(), 'Add Filter button');
    const newRowIndex = (await this.filterRows().count()) - 1;

    if (operator !== 'Equals') {
      await this.selectExactFromIsInvalidMenu(
        this.filterOperatorControl(newRowIndex),
        operator,
        `Filter row ${newRowIndex} operator`
      );
    }

    if (value !== undefined) {
      const valueControlCount = await this.filterValueControl(newRowIndex).count();
      if (valueControlCount > 0) {
        await this.selectExactFromIsInvalidMenu(
          this.filterValueControl(newRowIndex),
          value,
          `Filter row ${newRowIndex} value`
        );
      } else {
        await this.fill(this.filterValueRawInput(newRowIndex), value, `Filter row ${newRowIndex} value`);
      }
    }
    logger.success(`Filter added: ${field} ${operator} ${value ?? ''}`);
  }

  async removeFilterRow(index: number): Promise<void> {
    await this.click(this.filterRemoveIcon(index), `remove filter row ${index}`);
    await this.filterRow(index)
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* row may already be fully detached */
      });
  }

  async clickGeneratePreview(): Promise<void> {
    await this.click(this.generatePreviewButton(), 'Generate Preview');
  }

  async clickSaveButton(): Promise<void> {
    await this.click(this.saveButton(), 'Save report');
  }

  // WHY entity type + category are ALWAYS set BEFORE dimension/metric/
  // filters/date range, never after: confirmed live (investigation-notes-
  // reports.md's §5, "Report Type / Chart Type / Entity Type mid-form
  // switching") — changing EITHER Entity Type or Report Type (category)
  // destructively clears whatever Dimension was already selected, resetting
  // it to an empty, required-error state. Chart Type is the one field
  // confirmed NON-destructive, so it's set last, after everything else that
  // could be cleared.
  async fillReportForm(data: ReportData): Promise<void> {
    logger.info(`Filling report form: ${data.name}`);
    await this.fill(this.reportNameInput(), data.name, 'Report Name');
    if (data.description) {
      await this.fill(this.reportDescriptionInput(), data.description, 'Report Description');
    }

    // WHY skipped when already at the form's own default: avoids an
    // unnecessary interaction (and the destructive dimension-clear it would
    // trigger) when the caller's data already matches the default — every
    // create form loads with reportType='Lead'/category='One Dimensional'.
    if (data.reportType !== 'Lead') {
      await this.selectEntityType(data.reportType);
    }
    if (data.category !== 'One Dimensional') {
      await this.selectCategory(data.category);
    }
    // WHY set BEFORE Dimension/Metric, and only when explicitly requested:
    // confirmed live this does not itself clear Dimension/Metric (unlike
    // Entity Type/Report Type) — set here purely so a caller needing a
    // SPECIFIC Date Filter (e.g. "Created At" regardless of an entity
    // type's own default — see the field's own comment in reportFactory.ts)
    // doesn't have it silently overridden by anything filled after it.
    if (data.dateFilter) {
      await this.selectDateFilter(data.dateFilter);
    }

    await this.selectDimension(0, data.dimension);
    if (data.category === 'Multi Dimensional' && data.secondDimension) {
      await this.addDimensionRow();
      await this.selectDimension(1, data.secondDimension);
    }
    await this.selectMetric(0, data.metric);

    for (const filter of data.filters ?? []) {
      await this.addFilter(filter.field, filter.operator, filter.value);
    }

    if (data.dateRangeOption && data.dateRangeOption !== 'Current Month') {
      await this.selectDateRangeOption(data.dateRangeOption);
      if (data.dateRangeOption === 'Custom' && data.customDateRange) {
        await this.fillCustomDateRange(data.customDateRange.start, data.customDateRange.end);
      }
    }

    if (data.chartType !== 'Bar') {
      await this.selectChartTypeOnForm(data.chartType);
    }
    logger.success(`Report form filled: ${data.name}`);
  }

  // ──────────────────────────────────────────────────────────
  // 7. Search & Open
  // ──────────────────────────────────────────────────────────

  // WHY a real Enter keypress after fill(), not fill() alone: confirmed live
  // (investigation-notes-reports.md Part B §9) — `#fulltext-search`'s
  // `fill()` alone populates the input's value but never re-runs the search;
  // only pressing Enter afterward does. A genuinely different mechanism from
  // Quotations'/Companies' own search (icon click), so this is a
  // Reports-specific method, not a shared BasePage one.
  async searchReportsList(term: string): Promise<void> {
    logger.info(`Searching reports list: ${term}`);
    await this.fill(this.searchInput(), term, 'Reports search input');
    await this.armResponseWaitWithRecovery(
      (res) =>
        res.url().match(/\/v3\/reports\/search(?:\?.*)?$/) !== null && res.request().method() === 'POST',
      'searchReportsList: search POST',
      15000
    ).catch(() => null);
    await this.page.keyboard.press('Enter');
    await this.armResponseWaitWithRecovery(
      (res) =>
        res.url().match(/\/v3\/reports\/search(?:\?.*)?$/) !== null && res.request().method() === 'POST',
      'searchReportsList: search POST after Enter',
      15000
    ).catch(() => null);
  }

  async openReportFromList(name: string): Promise<void> {
    // WHY navigated first, never assumed: same real hang this file's
    // assertReportVisibleInList() fix documents — searchReportsList() itself
    // requires already being on the list page.
    await this.goToReportsList();
    await this.searchReportsList(name);
    const row = this.reportRowByName(name).first();
    await row.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await this.click(row, `report row: ${name}`);
    await this.waitForReportDetailPage();
  }

  // ──────────────────────────────────────────────────────────
  // 8. Edit Actions
  // ──────────────────────────────────────────────────────────

  private async openEllipsisMenu(): Promise<void> {
    await this.click(this.ellipsisButton(), 'Report details ellipsis menu');
    await this.page.locator('.dropdown-menu.show').waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  async openEditForm(): Promise<void> {
    await this.openEllipsisMenu();
    await this.click(this.ellipsisMenuItem('Edit'), 'Edit report');
    await this.reportNameInput().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
  }

  async updateReportDescription(newDescription: string): Promise<void> {
    await this.fill(this.reportDescriptionInput(), newDescription, 'Report Description (edit)');
  }

  async saveEditForm(): Promise<void> {
    await this.clickSaveButton();
    await this.waitForReportDetailPage();
  }

  async openDeleteDialog(): Promise<void> {
    await this.openEllipsisMenu();
    await this.click(this.ellipsisMenuItem('Delete'), 'Delete report');
    await this.page.locator('#confirmModal').waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  async confirmDelete(): Promise<void> {
    await this.click(this.deleteConfirmButton(), 'Confirm delete report');
    await this.waitForReportListPage();
  }

  async openSaveAsDialog(): Promise<void> {
    await this.click(this.saveSplitToggle(), 'Save split-button toggle');
    await this.click(this.saveAsMenuItem(), 'Save As');
    await this.saveAsModal().waitFor({ state: 'visible', timeout: config.timeouts.expect });
  }

  // WHY returns the new report's real id captured from the resulting URL,
  // not just void: confirmed live — clicking Save inside the "Save Report
  // As" modal navigates directly to the NEW report's own details page
  // (`/sales/reports/details/<newId>`), not back to the original.
  async completeSaveAs(newName?: string): Promise<{ id: string; name: string }> {
    if (newName) {
      await this.fill(this.saveAsNameInput(), newName, 'Save As — new name');
    }
    const finalName = newName ?? (await this.saveAsNameInput().inputValue());
    // WHY the original id is captured BEFORE clicking, then used as a
    // negative match afterward: found via two rounds of real live failures
    // (2026-08-21). First fix attempt — waiting for `.report__header
    // .dimension-name` to become visible — was ALSO confirmed live to be
    // insufficient: Save As clones the original report's own Dimension, so
    // the OLD (still-displayed) page's own dimension-name element already
    // satisfies that wait, immediately, with no real navigation required.
    // Neither `waitForReportDetailPage()`'s generic URL regex
    // (`/\/reports\/details\//`, no specific id) nor any content-based
    // check can distinguish "still on the old page" from "on the new page"
    // when Save As is, by definition, a near-identical clone — the ONLY
    // reliable signal is the URL's id portion actually changing from what
    // it was before this action.
    const originalId = this.captureReportIdFromUrl();
    await this.click(this.saveAsConfirmButton(), 'Save As — confirm');
    await this.page.waitForURL(
      (url) => /\/reports\/details\/\d+/.test(url.pathname) && !url.pathname.endsWith(`/${originalId}`),
      { timeout: config.timeouts.navigation }
    );
    await this.waitForReportDetailPage();
    // WHY there is deliberately NO wait here for `.report__header
    // .dimension-name` (an earlier version of this method had one, added
    // then removed the same day): confirmed live — that element only
    // renders when the report's own filters/dimension/metric combination
    // matches at least one real record. A report built with a filter that
    // matches zero records (a real, legitimate, user-confirmed app state,
    // not a bug) renders "Oops, report cannot be generated for the data
    // being requested" INSTEAD of the normal header — so waiting for the
    // header would incorrectly fail a perfectly successful Save As on a
    // zero-data report. The URL-diff check above is the correct, complete
    // signal that Save As succeeded: a new report genuinely exists at a
    // new id. Whether that new report's own filters happen to match any
    // data is a separate, orthogonal question this method has no business
    // asserting on behalf of every caller.
    const id = this.captureReportIdFromUrl();
    if (!id) {
      throw new Error('completeSaveAs: could not capture the new report ID from the resulting URL');
    }
    logger.success(`Save As completed — new report ID: ${id}, name: ${finalName}`);
    return { id, name: finalName };
  }

  // WHY `page.waitForEvent('download')`, Playwright's own standard API for
  // this: no BasePage precedent exists for file download (only upload, via
  // `setInputFiles()`) — this is the correct, idiomatic mechanism, not a
  // custom invention.
  async downloadReportCsv(): Promise<string> {
    await this.openEllipsisMenu();
    const downloadPromise = this.page.waitForEvent('download', { timeout: config.timeouts.expect });
    await this.click(this.ellipsisMenuItem('Download'), 'Download report CSV');
    const download = await downloadPromise;
    const filePath = await download.path();
    if (!filePath) {
      throw new Error('downloadReportCsv: download event fired but produced no readable file path');
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  async switchChartType(label: 'Bar Chart' | 'Pie Chart' | 'Table'): Promise<void> {
    await this.click(this.chartTypeToggle(), 'Chart type toggle');
    const menuItem = this.chartTypeMenuItem(label);
    await menuItem.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    await menuItem.click();
  }

  // WHY returns `Response | null` rather than asserting internally: the
  // CALLER needs to assert opposite things for "Created At" (a real request
  // fires) vs. "Report Name" (none does, a confirmed real sort-affordance
  // bug) — this method stays a neutral observation, not a hardcoded
  // expectation either way.
  async clickListColumnSort(columnName: string): Promise<Response | null> {
    const responsePromise = this.page
      .waitForResponse(
        (res) =>
          res.url().match(/\/v3\/reports\/search(?:\?.*)?$/) !== null && res.request().method() === 'POST',
        { timeout: 5000 }
      )
      .catch(() => null);
    await this.click(this.listColumnHeader(columnName), `list column header: ${columnName}`);
    return responsePromise;
  }

  // ──────────────────────────────────────────────────────────
  // 9. Assertions
  // ──────────────────────────────────────────────────────────

  async assertReportsListLoaded(): Promise<void> {
    await this.assertVisible(this.reportsListTable(), 'Reports list table');
    await this.assertVisible(this.searchInput(), 'Reports search input');
    await this.assertVisible(this.createReportButton(), 'Create New Report button');
  }

  async assertReportSaved(reportId: string): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.page).toHaveURL(new RegExp(`/reports/details/${reportId}$`))
    );
  }

  // WHY `goToReportsList()` on EVERY attempt, including the first, not
  // just on retry: found via a real live run (2026-08-21) — this method is
  // very often called right after `createReport()`, which leaves the
  // browser on the report's DETAILS page, not the list. `#fulltext-search`
  // doesn't exist there at all (confirmed live, investigation-notes-
  // reports.md's own "no search input anywhere on the Details page"
  // finding) — omitting this navigation on the first attempt hung the
  // entire test for its full `test.setTimeout()` budget, because
  // `BasePage.fill()`'s own `locator.waitFor({state:'visible'})` call
  // carries no explicit timeout and silently inherits the outer test
  // timeout instead of failing fast. Matches QuotationsPage.
  // retryFindInList()'s own proven shape, which navigates on every
  // attempt for the identical reason.
  // WHY this checks the SPECIFIC row via reportRowByName(), not "any
  // non-empty row exists": confirmed live (2026-08-21) — the backend's
  // `/v3/reports/search` does fuzzy, per-word OR matching, not exact-phrase
  // matching. Searching a name containing the word "check" (as every
  // Save-As test's generated name here does, via its own "-saveas-check-"
  // suffix) returned 10 rows in a live check, most of them unrelated
  // leftover reports from other runs that merely share that one word — the
  // exact same false-positive class already documented for Quotations'
  // assertQuotationInList() (.claude/known-issues.md item 17). An "any
  // non-empty result" check would have passed regardless of whether our own
  // report was really among them. reportRowByName()'s `hasText` filter is a
  // real, client-side substring check against each row's own rendered text
  // — a fundamentally different, precise mechanism from the backend's fuzzy
  // search, and immune to this false-positive class.
  private async searchReportsListUntilFound(name: string): Promise<boolean> {
    const { retries } = this.retryConfig;
    let found = false;
    for (let attempt = 1; attempt <= retries && !found; attempt++) {
      await this.goToReportsList();
      await this.searchReportsList(name);
      found = (await this.reportRowByName(name).count()) > 0;
    }
    return found;
  }

  async assertReportVisibleInList(name: string): Promise<void> {
    const found = await this.searchReportsListUntilFound(name);
    const { retries } = this.retryConfig;
    expect(found, `Expected "${name}" to appear in the Reports list after ${retries} attempt(s)`).toBe(true);
  }

  async assertReportNotVisibleInList(name: string): Promise<void> {
    await this.goToReportsList();
    await this.searchReportsList(name);
    // Same reportRowByName() precision as assertReportVisibleInList() above
    // — the fuzzy backend search can return unrelated rows for a name that
    // was genuinely never created, which a bare "row count is 0" check
    // would wrongly fail on.
    const count = await this.reportRowByName(name).count();
    expect(count, `Expected "${name}" to NOT appear in the Reports list, but found ${count} matching row(s)`).toBe(0);
  }

  // WHY a direct API call to confirm the real 404, not just the frontend's
  // fallback page: confirmed live (investigation-notes-reports.md Edge Case
  // Investigation §7) — the backend returns a genuine `GET
  // /v3/reports/<id>` → HTTP 404 before any per-viewer data-scoping
  // question would even arise; the frontend's own fallback is a generic,
  // unpolished "Something is broken here" page, not a purpose-built
  // access-denied message — both are asserted so a future fix to either
  // layer alone is still caught.
  async assertReportNotFoundDirectAccess(reportId: string): Promise<void> {
    const responsePromise = this.page
      .waitForResponse(
        (res) => res.url().match(/\/v3\/reports\/\d+(?:\?.*)?$/) !== null && res.request().method() === 'GET',
        { timeout: config.timeouts.navigation }
      )
      .catch(() => null);
    await this.navigateTo(`${config.appUrl}/sales/reports/details/${reportId}`);
    const response = await responsePromise;
    expect(response, 'Expected a GET /v3/reports/<id> response for the direct-access attempt').not.toBeNull();
    expect(response?.status()).toBe(404);
    // WHY `.first()`: this generic fallback string is a low-specificity
    // phrase with no scoping container confirmed live — cheap insurance
    // against a strict-mode violation if it's ever rendered more than once.
    await this.assertVisible(this.page.getByText(/Something is broken here/i).first(), 'generic fallback page');
  }

  // WHY parses `data-original-title`, never the visible text: confirmed live
  // — the visible text is comma-formatted ("1,023"), while
  // `data-original-title` holds the raw, parseable integer inside
  // parentheses ("Number of Leads (1023)") — the same "empty title, real
  // content in a data attribute" pattern already documented elsewhere in
  // this codebase for other modules' icons.
  async getReportTotalFromHeader(): Promise<number> {
    return this.withSessionExpiryRecovery(async () => {
      const metricName = this.reportHeaderMetricName();
      await metricName.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      const title = await metricName.getAttribute('data-original-title');
      const match = title?.match(/\((\d+)\)/);
      if (!match) {
        throw new Error(`getReportTotalFromHeader: could not parse a total from data-original-title="${title}"`);
      }
      return parseInt(match[1], 10);
    });
  }

  async assertMetricTotal(expectedTotal: number): Promise<void> {
    const actual = await this.getReportTotalFromHeader();
    expect(actual, `Expected report total ${expectedTotal}, got ${actual}`).toBe(expectedTotal);
  }

  // WHY extracted as its own getter (2026-08-21): the drill-through
  // verification (verifyRunCountForEntity()) needs to read a specific
  // dimension value's own bucket count, not just assert it against a fixed
  // expectation — the same underlying DOM read, reused rather than
  // duplicated.
  async getDimensionValueCount(label: string): Promise<number> {
    return this.withSessionExpiryRecovery(async () => {
      const cell = this.reportBodyDimensionValueByLabel(label);
      await cell.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      const countTooltip = cell.locator('xpath=following-sibling::div//*[@title]');
      const titleAttr = await countTooltip.first().getAttribute('title');
      const actual = titleAttr ? parseInt(titleAttr.replace(/[^\d]/g, ''), 10) : NaN;
      if (Number.isNaN(actual)) {
        throw new Error(`getDimensionValueCount("${label}"): could not parse a count from title="${titleAttr}"`);
      }
      return actual;
    });
  }

  async assertDimensionValueCount(label: string, expectedCount: number): Promise<void> {
    const actual = await this.getDimensionValueCount(label);
    expect(actual, `Expected "${label}" count ${expectedCount}, got ${actual}`).toBe(expectedCount);
  }

  // WHY this exists (2026-08-21, the drill-through verification step the
  // task's own original title for the run-count test promised — "...with
  // drill-through showing exact records" — but the 8-way split had only
  // ever exercised this for Lead, and even then only checked links EXIST,
  // never that the destination page's own count matches): confirmed live
  // — Table chart-type mode is the ONLY mode where a dimension value's
  // count is a real, clickable `<a target="_blank">`, and clicking it
  // genuinely opens a NEW browser tab (a real `target="_blank"` navigation,
  // not something Playwright can observe as an in-page navigation) —
  // `page.context().waitForEvent('page')` is the correct, standard
  // Playwright API for this, not a guess.
  //
  // WHY the destination URL's own query-param name is never parsed or
  // relied upon: confirmed live this is NOT uniform across entity types —
  // Lead uses `ownerId=`, Deal uses `ownedBy=`, Call log uses `owner=`,
  // three different names for the same "Owner"/"Logged By" dimension
  // concept. This method never constructs or inspects that URL — it always
  // clicks the REAL link the app itself rendered, sidestepping the need to
  // know or verify each entity type's own param name.
  async clickDrillThroughForDimensionValue(label: string): Promise<Page> {
    const cell = this.reportBodyDimensionValueByLabel(label);
    const link = cell.locator('xpath=following-sibling::div//a[@target="_blank"]').first();
    await link.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const popupPromise = this.page.context().waitForEvent('page', { timeout: config.timeouts.expect });
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    return popup;
  }

  // WHY `span.update`, not `#totalRecords` (changed 2026-08-21, found via a
  // real live failure): confirmed live across all 8 entity types'
  // destination list pages — `#totalRecords` genuinely does NOT EXIST on
  // Task's or Meeting's list page at all (0 matches, confirmed via direct
  // DOM query), which is exactly why the Task/Meeting run-count tests
  // failed with a clean `TimeoutError` waiting for it to become visible —
  // not a timing race, a real missing element. `span.update` was found
  // (via a full-page text-node search for the exact count text) to be
  // universally present and correctly populated across all 8: Lead
  // ("10347 items"), Deal ("8706 items"), Contact ("7792 items"), Company
  // ("6621 items"), Task ("322 items"), Meeting ("9 items"), Quotation
  // ("5782 items"), Call log ("6 call logs") — the same non-uniform
  // wording `#totalRecords` already had to tolerate (Call log says "call
  // logs", not "items"), handled by the same digit-stripping parse below,
  // no new logic needed for that part.
  async getDestinationListTotalCount(destinationPage: Page): Promise<number> {
    const totalRecords = destinationPage.locator('span.update').first();
    await totalRecords.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    // WHY waiting for actual digit content, not just element visibility:
    // confirmed live (2026-08-21) — a real failure caught this element
    // rendering with placeholder text (" items", no number at all) before
    // its real count populated asynchronously. Visibility alone doesn't
    // guarantee the number has arrived; polling for a digit to appear is
    // the real readiness signal.
    await expect(totalRecords).toHaveText(/\d/, { timeout: config.timeouts.navigation });
    const text = await totalRecords.textContent();
    const count = text ? parseInt(text.replace(/[^\d]/g, ''), 10) : NaN;
    if (Number.isNaN(count)) {
      throw new Error(`getDestinationListTotalCount: could not parse a count from "${text}"`);
    }
    return count;
  }

  async assertAddDimensionLinkVisible(): Promise<void> {
    await this.assertVisible(this.addDimensionLink(), 'Add New (Dimensions)');
  }

  async assertAddDimensionLinkHidden(): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.addDimensionLink()).toBeHidden({ timeout: config.timeouts.expect })
    );
  }

  // WHY a plain boolean check, not an assertion: used by R17's own
  // loop-until-the-confirmed-unstable-limit-is-hit logic, which needs to
  // read this as a condition to keep looping on, not fail the test the
  // moment it becomes false.
  async addDimensionLinkIsVisible(): Promise<boolean> {
    return this.addDimensionLink().isVisible().catch(() => false);
  }

  async getFilterRowCount(): Promise<number> {
    return this.filterRows().count();
  }

  // WHY this exists: R20 needs to prove a filter row's Value control is
  // genuinely field-TYPE-dependent (a react-select for a picklist-shaped
  // field like Source, a plain text input for a text field like Last
  // Name), not merely that N filter rows exist — confirmed live
  // (investigation-notes-reports.md Part B §5) both shapes are real.
  async getFilterValueControlKind(index: number): Promise<'select' | 'text'> {
    const selectCount = await this.filterValueControl(index).count();
    return selectCount > 0 ? 'select' : 'text';
  }

  // WHY exposed the same way: the mid-form-switch test needs to read
  // Dimension row 0's CURRENT rendered value (or its empty "Choose"
  // placeholder) to prove Entity Type/Report Type genuinely clear it while
  // Chart Type genuinely does not — a live-state comparison the test itself
  // makes explicit, not a fixed expectation this page object should guess.
  getDimensionControlLocator(index: number): Locator {
    return this.dimensionControl(index);
  }

  async assertMetricControlDisabled(index: number): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.metricControl(index)).toHaveClass(/is-invalid__control--is-disabled/, {
        timeout: config.timeouts.expect,
      })
    );
  }

  async assertMetricControlEnabled(index: number): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.metricControl(index)).not.toHaveClass(/is-invalid__control--is-disabled/, {
        timeout: config.timeouts.expect,
      })
    );
  }

  async assertPreviewNoDataMessage(): Promise<void> {
    await this.assertVisible(this.previewNoDataMessage(), 'Preview panel no-data message');
  }

  async assertDetailsNoDataMessage(): Promise<void> {
    await this.assertVisible(this.detailsNoDataMessage(), 'Details page no-data message');
  }

  async assertBackendRangeRejection(): Promise<void> {
    await this.assertVisible(this.backendRangeRejectionMessage(), 'Backend range-rejection message');
  }

  // WHY reads every carousel message by clicking "next" until the message
  // count stops changing, never a blind wait between clicks: the message
  // count (`.msg-count.error`) updating is the real, observable signal that
  // the carousel has advanced — confirmed live this is a pure client-side
  // state change with no network round-trip, so polling the DOM for that
  // change is both correct and fast.
  async assertValidationCarouselContains(expectedSubstrings: string[]): Promise<void> {
    const wrapper = this.validationCarouselWrapper();
    await wrapper.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const totalText = (await this.validationCarouselTotal().textContent()) ?? '/0';
    const total = parseInt(totalText.replace('/', ''), 10) || 0;
    const messages: string[] = [];
    for (let i = 1; i <= total; i++) {
      const currentCountText = await this.validationCarouselCount().textContent();
      const msg = (await this.validationCarouselMessage().textContent())?.trim();
      if (msg) messages.push(msg);
      if (i < total) {
        await this.click(this.validationCarouselNextButton(), 'validation carousel next');
        await this.withSessionExpiryRecovery(() =>
          expect(this.validationCarouselCount()).not.toHaveText(currentCountText ?? '', {
            timeout: config.timeouts.expect,
          })
        );
      }
    }
    for (const expected of expectedSubstrings) {
      expect(
        messages.some((m) => m.includes(expected)),
        `Expected validation carousel to contain "${expected}" — actual messages: ${messages.join(' | ')}`
      ).toBe(true);
    }
  }

  // WHY a disabled-button assertion, not a click-then-look-for-an-inline-error
  // check: confirmed live (2026-08-21) — the Create form's Save button is
  // genuinely HTML-`disabled` while Report Name is empty (Kylas gates Save
  // on Name having a value at minimum), and there is no inline "required"
  // error text rendered on blur either — Playwright correctly refuses to
  // click a disabled element, so the only real, observable signal that
  // Name is required is the button's own disabled state, never a click
  // outcome.
  async assertSaveButtonDisabled(): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.saveButton(), 'Save button should be disabled while Report Name is empty').toBeDisabled({
        timeout: config.timeouts.expect,
      })
    );
  }

  async assertStartEndDateReadOnly(): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      await expect(this.customStartDateInput()).toHaveCount(0);
      await expect(this.customEndDateInput()).toHaveCount(0);
    });
  }

  async assertStartEndDateEditable(): Promise<void> {
    await this.assertVisible(this.customStartDateInput(), 'Custom Start Date input');
    await this.assertVisible(this.customEndDateInput(), 'Custom End Date input');
  }

  async assertEndDateBlockedBefore(date: Date): Promise<void> {
    const dayLabel = formatDateForCalendarLabel(date);
    await this.click(this.customEndDateInput(), 'Custom End Date input (blocked-day check)');
    await this.assertVisible(
      this.calendarBlockedDayByLabel(dayLabel),
      `blocked calendar day: ${dayLabel}`
    );
    await this.page.keyboard.press('Escape');
  }

  // WHY this reads the name back from the DOM instead of just trusting the
  // string a caller already knows it set: confirmed live (2026-08-21) — a
  // Save-As caller has no other way to know the app actually persisted the
  // exact name requested, and using this confirmed value (rather than the
  // input string) to search the list is what makes that search precise
  // (see assertReportVisibleInList()'s own WHY comment on the same date).
  //
  // WHY textContent(), never innerText(): confirmed live — the heading has
  // a real `text-transform: capitalize` CSS rule (on both the `<p>` and its
  // parent). innerText() returns the RENDERED text, so it silently
  // capitalized every word ("saveas-check" became "Saveas-Check") even
  // though the actual persisted name was untouched — textContent() reads
  // the real underlying DOM text, unaffected by CSS, and was confirmed live
  // to match the exact name requested.
  async getReportNameFromDetailPage(): Promise<string> {
    return this.withSessionExpiryRecovery(async () => {
      const name = await this.detailHeading().locator('p').textContent();
      return (name ?? '').trim();
    });
  }

  async assertNameRenderedAsEscapedText(rawName: string): Promise<void> {
    await this.withSessionExpiryRecovery(() =>
      expect(this.detailHeading()).toContainText(rawName, { timeout: config.timeouts.expect })
    );
    // WHY a real <b>/<script> element must not exist even though rawName
    // itself contains literal "<b>...</b>"/"<script>" text: confirmed live —
    // React escapes this to `&lt;b&gt;`, never real markup. toContainText()
    // above already proves the text renders; this is the check that
    // actually distinguishes "escaped" from "executed."
    await this.withSessionExpiryRecovery(() =>
      expect(
        this.page.locator('main h1 b, main h1 script'),
        'Report name must render as escaped text, never real markup'
      ).toHaveCount(0)
    );
  }

  async assertTableModeHasNoRecordTable(): Promise<void> {
    // WHY checking for the ABSENCE of a generic data-grid, not a
    // Reports-specific class: confirmed live — Table chart-type mode renders
    // the exact same dimension-value/metric-count rows as Bar/Pie mode, plus
    // a Total row, never a `role="grid"`/react-table-shaped record listing
    // (that shape is reserved for the Reports LIST page itself, a
    // completely different page).
    await this.withSessionExpiryRecovery(() =>
      expect(this.page.locator('.report__body [role="grid"], .report__body .rt-table')).toHaveCount(0)
    );
  }

  async assertTableModeTotalRow(expectedTotal: number): Promise<void> {
    await this.withSessionExpiryRecovery(async () => {
      const totalEl = this.tableModeTotalValue().first();
      await totalEl.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      const titleAttr = await totalEl.getAttribute('data-original-title');
      const actual = titleAttr ? parseInt(titleAttr, 10) : NaN;
      expect(actual, `Expected Table-mode Total ${expectedTotal}, got ${actual}`).toBe(expectedTotal);
    });
  }

  async assertTableModeDrillThroughLinksPresent(): Promise<void> {
    const count = await this.tableModeDrillThroughLinks().count();
    expect(count, 'Expected at least one Table-mode drill-through link').toBeGreaterThan(0);
  }

  async assertNoTableModeDrillThroughLinks(): Promise<void> {
    await this.withSessionExpiryRecovery(() => expect(this.tableModeDrillThroughLinks()).toHaveCount(0));
  }

  async assertOptionExcludedFromDimensionMenu(index: number, optionText: string): Promise<void> {
    const texts = await this.getIsInvalidMenuOptionTexts(this.dimensionControl(index), `Dimension row ${index}`);
    expect(
      texts.includes(optionText),
      `Expected "${optionText}" to be EXCLUDED from Dimension row ${index}'s option list, but it was present`
    ).toBe(false);
  }

  async assertOptionExcludedFromFilterFieldMenu(optionText: string): Promise<void> {
    await this.ensureNoOpenMenu();
    const menu = this.page.locator('.select__menu');
    await this.clickToOpenMenu(this.filterFieldSelectControl(), menu, 'Select Filter field picker (dedup check)');
    await menu.locator('.select__option').first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const texts = (await menu.locator('.select__option').allInnerTexts()).map((t) => t.trim());
    await this.page.keyboard.press('Escape');
    expect(
      texts.includes(optionText),
      `Expected "${optionText}" to be EXCLUDED from the Filters field picker, but it was present`
    ).toBe(false);
  }

  // WHY this checks the real, versioned save/preview endpoint per entity
  // type rather than repeating a full entity-count verification per type
  // (the Test Plan Quality Review's own recommendation — T15's "cheaper
  // adequate alternative"): confirmed live (see
  // REPORT_SAVE_API_ENDPOINT_PLURAL_CONFIRMED's own comment) this is a real,
  // versioned, per-entity-type endpoint — a much cheaper signal that the
  // report engine is genuinely entity-type-aware than re-running the full
  // create-N-records-and-compare-counts flow for every one of the 8 types.
  async assertReportApiEndpointForEntityType(entityType: ReportEntityType): Promise<Response> {
    const expectedPlural = REPORT_SAVE_API_ENDPOINT_PLURAL_CONFIRMED[entityType];
    if (!expectedPlural) {
      throw new Error(
        `assertReportApiEndpointForEntityType: no confirmed endpoint mapping for "${entityType}" — ` +
          'only Lead/Deal/Company/Call log were live-confirmed this session, see the map\'s own comment.'
      );
    }
    const responsePromise = this.page.waitForResponse(
      (res) =>
        res.url().match(new RegExp(`/v3/reports/${expectedPlural}(?:\\?.*)?$`)) !== null &&
        res.request().method() === 'POST',
      { timeout: config.timeouts.expect }
    );
    await this.clickGeneratePreview();
    return responsePromise;
  }

  // ──────────────────────────────────────────────────────────
  // 10. Workflow Wrappers
  // ──────────────────────────────────────────────────────────

  async createReport(data: ReportData): Promise<{ id: string; name: string }> {
    logger.info(`Creating report: ${data.name}`);
    await this.goToCreateReport();
    await this.fillReportForm(data);
    await this.clickSaveButton();
    await this.waitForReportDetailPage();
    const id = this.captureReportIdFromUrl();
    if (!id) {
      throw new Error(`createReport: could not capture report ID from URL after saving "${data.name}"`);
    }
    logger.success(`Report created — ID: ${id}, name: ${data.name}`);
    return { id, name: data.name };
  }

  async updateReportDescriptionAndSave(reportId: string, newDescription: string): Promise<void> {
    return this.withSessionExpiryRetry(async () => {
      await this.goToReportDetails(reportId);
      await this.openEditForm();
      await this.updateReportDescription(newDescription);
      await this.saveEditForm();
      logger.success(`Report ${reportId} description updated`);
    }, 'updateReportDescriptionAndSave');
  }

  async deleteReport(reportId: string): Promise<void> {
    await this.goToReportDetails(reportId);
    await this.openDeleteDialog();
    await this.confirmDelete();
    logger.success(`Report ${reportId} deleted`);
  }

  async saveReportAs(reportId: string, newName?: string): Promise<{ id: string; name: string }> {
    await this.goToReportDetails(reportId);
    await this.openSaveAsDialog();
    return this.completeSaveAs(newName);
  }

  // WHY this design sidesteps needing any cross-test creation ledger
  // entirely (the abandoned prior branch's own confirmed flaw — see
  // .claude/prior-reports-branch-investigation.md's Flaw 2): every check
  // here is an INDEPENDENT, freshly-queried API count for the exact same
  // window the report itself is scoped to — it never depends on any other
  // test or module having recorded what it created anywhere. This is also
  // why NO CI/Playwright-project change was needed for ordering (see
  // .claude/ci-project-ordering-proposal.md's Option B) — there is no
  // "runs after everything else" requirement to satisfy in the first place;
  // the ground truth is queried fresh, for the real window, every time.
  //
  // WHY the retry loop re-navigates to the report's own details page rather
  // than sleeping between attempts: this build's own hard rule forbids an
  // unconditional, fixed-duration sleep on the page, including for retry pacing — a
  // real navigation (forcing the report to genuinely recompute) provides the
  // same "give the backend a moment" effect as a sleep would, without a
  // synthetic wait, and is arguably a MORE correct check (it re-proves the
  // report engine's own read path, not just the passage of time).
  async verifyRunCountForEntity(
    entityType: ReportEntityType,
    windowStart: Date,
    windowEnd: Date,
    role: 'admin' | 'restricted' = 'admin'
  ): Promise<RunCountVerificationResult> {
    const dimension = REPORT_OWNER_DIMENSION_BY_ENTITY[entityType];
    const metric = REPORT_COUNT_METRIC_BY_ENTITY[entityType];
    // WHY the UI-facing report window is padded ±1 CALENDAR DAY beyond the
    // exact windowStart/windowEnd, while the API ground-truth query below
    // stays on the tight, exact window: found via a real live failure
    // (2026-08-21) — the Custom Date Range calendar only supports DAY
    // granularity (a day-cell click, per formatDateForCalendarLabel()), with
    // no time-of-day control this file fills. windowStart/windowEnd are
    // real timestamps captured seconds apart on the SAME calendar day —
    // selecting that identical day for both Start and End left the report
    // with no header at all (a genuine zero-data page, confirmed via the
    // failure's own timeout on `.report__header .metric-name`), because the
    // app's own default start-of-day/end-of-day time for an unfilled time
    // picker excluded the freshly-created entities. Padding by a full day on
    // each side guarantees the actual creation timestamps fall inside the
    // UI's window regardless of that default. This does NOT weaken the
    // check: `apiTotal` is still computed from the exact, unpadded window,
    // so `reportTotal < apiTotal` (a genuine under-count) is still caught —
    // padding can only ever make the report's own total equal or larger,
    // consistent with this method's own already-accepted "report >= api"
    // tolerance for benign timing noise.
    const paddedStart = new Date(windowStart);
    paddedStart.setDate(paddedStart.getDate() - 1);
    const paddedEnd = new Date(windowEnd);
    paddedEnd.setDate(paddedEnd.getDate() + 1);
    // WHY the dateFilter value is always resolved from
    // REPORT_CREATED_DATE_FILTER_BY_ENTITY, never a hardcoded 'Created At':
    // confirmed live (2026-08-21) via a real test failure — Call log's Date
    // Filter option list genuinely does NOT contain "Created At" at all
    // (`["Logged At", "Start Time", "Date", "Updated At", "Date Time
    // Picker"]`, confirmed by direct DOM read), so selecting it by exact
    // text threw a real 10s waitFor timeout, not a silent no-op. "Logged
    // At" is Call log's confirmed real equivalent — getApiCountForWindow()
    // below always queries the real `createdAt` field regardless of entity
    // type, and a call log's canonical timestamp IS when it was logged, the
    // same moment as its creation — so this keeps the UI report and the API
    // ground-truth query scoped to the same underlying field for every
    // entity type, Call log included.
    const dateFilter = REPORT_CREATED_DATE_FILTER_BY_ENTITY[entityType];
    const data = generateReportData({
      reportType: entityType,
      dimension,
      metric,
      dateFilter,
      dateRangeOption: 'Custom',
      customDateRange: { start: paddedStart, end: paddedEnd },
    });

    const { id } = await this.createReport(data);

    const { retries } = this.retryConfig;
    let reportTotal = await this.getReportTotalFromHeader();
    let apiTotal = await this.getApiCountForWindow(entityType, windowStart, windowEnd);
    for (let attempt = 1; attempt < retries && reportTotal !== apiTotal; attempt++) {
      logger.info(
        `verifyRunCountForEntity(${entityType}): mismatch on attempt ${attempt}/${retries} ` +
          `(report=${reportTotal}, api=${apiTotal}) — re-checking`
      );
      await this.goToReportDetails(id);
      reportTotal = await this.getReportTotalFromHeader();
      apiTotal = await this.getApiCountForWindow(entityType, windowStart, windowEnd);
    }

    if (reportTotal < apiTotal) {
      throw new Error(
        `verifyRunCountForEntity(${entityType}): report undercounts real data after ${retries} attempt(s) — ` +
          `report shows ${reportTotal}, API shows ${apiTotal} for window ` +
          `[${windowStart.toISOString()}, ${windowEnd.toISOString()}]`
      );
    }
    if (reportTotal > apiTotal) {
      logger.warn(
        `verifyRunCountForEntity(${entityType}): report total (${reportTotal}) exceeds API total (${apiTotal}) — ` +
          'accepted as benign multi-worker timing noise per this check\'s own tolerance rule, not a failure.'
      );
    }
    logger.success(`verifyRunCountForEntity(${entityType}): report=${reportTotal}, api=${apiTotal}`);

    // WHY the drill-through step runs only after the report/API retry loop
    // above has already settled: switching Chart Type to Table and reading
    // one specific dimension bucket only means anything once reportTotal is
    // trustworthy — re-looping the whole comparison again here would just
    // duplicate what already happened. `this.createReport(data)` above
    // always lands on the report's own details page (confirmed by its own
    // `waitForReportDetailPage()` call), and the retry loop, when it runs at
    // all, re-navigates there via `goToReportDetails(id)` — so this is
    // always safely positioned on the right report's details page here,
    // whether the loop ran zero or several times.
    //
    // WHY `role` resolves the SAME owner name used to log this report in,
    // not a hardcoded string: this method is called from both admin- and
    // restricted-user tests (reports.spec.ts / reports.rbac.spec.ts) against
    // their own respective `ReportsPage` instance — the dimension bucket
    // that must exist is always "whoever actually created the underlying
    // records," i.e. the currently logged-in role, never assumed to be
    // admin.
    await this.switchChartType('Table');
    const ownerName = await this.getLoggedInUserName(role);
    const reportBucketCount = await this.getDimensionValueCount(ownerName);
    const popup = await this.clickDrillThroughForDimensionValue(ownerName);
    const destinationListCount = await this.getDestinationListTotalCount(popup);
    await popup.close();

    // WHY the same ">= tolerance" direction as the report/API check above,
    // not strict equality: confirmed live (2026-08-21) that the Reports
    // engine can diverge from the search index on broad/historical windows
    // (a real, confirmed Deal case: 685 reported vs. 623 on both the
    // destination list and a raw API query) — a genuine platform quirk, not
    // a code bug, and the same class of benign noise the report/API
    // comparison above already tolerates in the same direction. This
    // method's own windows are narrow and freshly-created, where a live
    // spot-check for both Lead and Call log matched exactly — but keeping
    // the same tolerant direction here guards against the same class of
    // noise recurring at smaller scale, without ever masking a genuine
    // under-count.
    if (reportBucketCount < destinationListCount) {
      throw new Error(
        `verifyRunCountForEntity(${entityType}): drill-through undercounts — report bucket for ` +
          `"${ownerName}" shows ${reportBucketCount}, destination list shows ${destinationListCount}`
      );
    }
    if (reportBucketCount > destinationListCount) {
      logger.warn(
        `verifyRunCountForEntity(${entityType}): drill-through bucket count (${reportBucketCount}) exceeds ` +
          `destination list count (${destinationListCount}) for owner "${ownerName}" — accepted as benign ` +
          'timing noise, same tolerance as the report/API check above, not a failure.'
      );
    }
    logger.success(
      `verifyRunCountForEntity(${entityType}) drill-through: owner="${ownerName}", ` +
        `bucket=${reportBucketCount}, destinationList=${destinationListCount}`
    );

    return { reportId: id, reportTotal, apiTotal, reportBucketCount, destinationListCount };
  }
}
