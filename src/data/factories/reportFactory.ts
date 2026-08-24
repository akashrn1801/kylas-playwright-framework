import { faker } from '@faker-js/faker';

// ──────────────────────────────────────────────────────────────────────────
// Reports — field-name mapping, option lists, per-entity Dimension/Metric
// constants
// ──────────────────────────────────────────────────────────────────────────
// WHY every option list below is copied verbatim from a real, live
// investigation of /sales/reports/create (.claude/investigation-notes-reports.md
// Part B, plus a targeted re-verification pass done immediately before this
// factory was written — see ReportsPage.ts's own comments for exact
// selectors/network captures behind each constant that needed fresh
// confirmation). These are Kylas PLATFORM enums (Report Type/Chart Type) or
// standard, always-present fields (Dimension/Metric names for each Entity
// Type) — not the kind of environment-conditional, account-configurable
// option list CLAUDE.md rule 4 protects against. ReportsPage still reads the
// live DOM to find these exact options before selecting them — see
// ReportsPage.selectExactFromReactSelect().

// WHY 'category' is the "Report Type" concept and 'reportType' is the
// "Entity Type" concept — THE single most important gotcha this whole module
// is built around. Confirmed live via direct DOM inspection of the Create
// form: the visible "Report Type" label (One Dimensional/Multi Dimensional/
// Hierarchy/Goal vs Achievement) sits on an input literally id="report_12_
// input_category"; the visible "Entity Type" label (Lead/Deal/...) sits on a
// DIFFERENT input, id="report_31_input_reportType". Naming these factory
// properties to match the API's real field names (not the on-screen labels)
// is the only way to avoid silently sending data to the wrong field — see
// ReportsPage.ts's locator comments for the live DOM evidence.
export const REPORT_CATEGORY_OPTIONS = [
  'One Dimensional',
  'Multi Dimensional',
  'Hierarchy',
  'Goal vs Achievement',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORY_OPTIONS)[number];

// WHY only 'One Dimensional' | 'Multi Dimensional' are actually exercised by
// any generator/test in this build: Hierarchy and Goal vs Achievement have no
// recorded expected behavior yet (investigation-notes-reports.md's Edge Case
// Investigation never explored either beyond confirming the option exists) —
// out of scope for this build per the task's own "what NOT to build" list.
// The full ReportCategory union above is kept for type accuracy against the
// real live option list; this narrower type is what generateReportData()
// actually accepts.
export type SupportedReportCategory = Extract<
  ReportCategory,
  'One Dimensional' | 'Multi Dimensional'
>;

// WHY 8 entity types, not the 9 the live Entity Type dropdown actually shows:
// Email is explicitly out of scope for this build (task instruction) — kept
// out of this union entirely so a caller can never accidentally request it.
export const REPORT_ENTITY_TYPE_OPTIONS = [
  'Lead',
  'Deal',
  'Contact',
  'Company',
  'Task',
  'Meeting',
  'Quotation',
  'Call log',
] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPE_OPTIONS)[number];

export const REPORT_CHART_TYPE_OPTIONS = ['Bar', 'Pie', 'Table', 'Funnel'] as const;
export type ChartType = (typeof REPORT_CHART_TYPE_OPTIONS)[number];

// WHY this exact list, not a shorter representative sample: confirmed live,
// full enumeration (investigation-notes-reports.md Part B §2) — "Custom" is
// deliberately last (matches its real DOM position, the option every
// Date-range-boundary test in this build actually selects).
export const REPORT_DATE_RANGE_OPTIONS = [
  'Today',
  'Yesterday',
  'Tomorrow',
  'Last N Days',
  'Next N Days',
  'Last 7 Days',
  'Next 7 Days',
  'Last 15 Days',
  'Next 15 Days',
  'Last 30 Days',
  'Next 30 Days',
  'Week to Date',
  'Current Week',
  'Last Week',
  'Next Week',
  'Month to Date',
  'Current Month',
  'Last Month',
  'Next Month',
  'Quarter to Date',
  'Current Quarter',
  'Last Quarter',
  'Next Quarter',
  'Current Financial Quarter',
  'Last Financial Quarter',
  'Next Financial Quarter',
  'Year to Date',
  'Current Year',
  'Last Year',
  'Next Year',
  'Current Financial Year',
  'Last Financial Year',
  'Next Financial Year',
  'Before Current Date And Time',
  'After Current Date And Time',
  'Custom',
] as const;
export type DateRangeOption = (typeof REPORT_DATE_RANGE_OPTIONS)[number];

// WHY this exact 6-operator list, not a superset: confirmed live as the full
// option set on a Filter row's Operator react-select
// (investigation-notes-reports.md Part B §5).
export const REPORT_FILTER_OPERATOR_OPTIONS = [
  'Equals',
  'Not Equals',
  'Is Set',
  'Is Not Set',
  'In',
  'Not In',
] as const;
export type ReportFilterOperator = (typeof REPORT_FILTER_OPERATOR_OPTIONS)[number];

export interface ReportFilter {
  field: string;
  operator: ReportFilterOperator;
  // WHY optional: 'Is Set'/'Is Not Set' take no value at all (confirmed live
  // — the Value control never even renders for these two operators).
  value?: string;
}

export interface ReportData {
  name: string;
  // WHY optional: confirmed live — Report Description has no asterisk and
  // the backend accepts a report with no description with zero validation
  // error.
  description?: string;
  // WHY 'category', not 'reportType' — see the module-level comment above.
  category: SupportedReportCategory;
  // WHY 'reportType', not 'entityType' — see the module-level comment above.
  reportType: ReportEntityType;
  chartType: ChartType;
  // WHY optional, and why this exists at all: confirmed live (2026-08-21)
  // that Date Filter's default value is NOT uniform across Entity Types —
  // 7 of 8 confirmed entity types (Lead/Deal/Contact/Company/Task/Meeting/
  // Quotation) default to "Created At," but Call log defaults to "Call
  // Logged At" instead, a genuine, confirmed exception. Any caller that
  // needs a specific, real Date Filter (rather than whatever an
  // entity-type's own default happens to be) must set this explicitly —
  // see ReportsPage.verifyRunCountForEntity()'s own use of this field for
  // exactly that reason.
  dateFilter?: string;
  dimension: string;
  // WHY optional: only used for Multi Dimensional reports (a 2nd dimension
  // row, added via the live "+ Add New" link — confirmed live, only
  // available once category is 'Multi Dimensional').
  secondDimension?: string;
  metric: string;
  // WHY optional, defaults applied by ReportsPage.fillReportForm(): most
  // tests need zero filters (confirmed live — Filters is genuinely optional,
  // the true minimum save has none).
  filters?: ReportFilter[];
  dateRangeOption?: DateRangeOption;
  // WHY only meaningful when dateRangeOption === 'Custom': the Start/End
  // Date react-dates pickers only exist in the DOM at all once Date Range is
  // switched to 'Custom' (confirmed live — every other Date Range value
  // renders Start/End Date as plain read-only text with no input to fill).
  customDateRange?: { start: Date; end: Date };
}

// WHY this per-entity map exists at all, rather than always defaulting to
// 'Owner' (2026-08-21, live-verified while building this module — a real,
// confirmed exception the earlier investigation pass never checked since it
// only ever exercised Lead): Call log's own Dimension option list does NOT
// include "Owner" — confirmed live via direct DOM read of the Dimension
// react-select with Entity Type = Call log (54-item Lead list vs. Call log's
// own list, "Owner" completely absent from the latter). Call log's own
// equivalent ownership dimension is literally named "Logged By" (sitting
// alongside "Logged By Fields"/"Created By"/"Created By Fields" in that same
// option list) — CallLogsPage.ts's own `#owner` detail-page field is this
// same underlying concept, just surfaced with a different label in the
// Reports engine's own Dimension picker. Every other confirmed entity type
// (Lead/Deal/Contact/Company/Task/Meeting/Quotation) has a literal "Owner"
// option (confirmed live, investigation-notes-reports.md's "Metric Option
// Names Per Entity Type" section) — Call log is a genuine, one-off exception,
// not a guess.
export const REPORT_OWNER_DIMENSION_BY_ENTITY: Record<ReportEntityType, string> = {
  Lead: 'Owner',
  Deal: 'Owner',
  Contact: 'Owner',
  Company: 'Owner',
  Task: 'Owner',
  Meeting: 'Owner',
  Quotation: 'Owner',
  'Call log': 'Logged By',
};

// WHY hardcoded literal strings, never derived by pluralizing the entity
// name programmatically: confirmed live, one at a time, for every entity
// type (investigation-notes-reports.md's "Metric Option Names Per Entity
// Type" section, plus a fresh live check for Call log during this build) —
// Company's plural is "Companies" (irregular), and Call log's metric string
// is "Number of Call logs" (lowercase "logs", NOT "Number of Call Logs" —
// confirmed via direct DOM read of the Metric react-select's option list
// with Entity Type = Call log). Guessing either of these two would silently
// select the wrong metric or fail to match any option at all.
export const REPORT_COUNT_METRIC_BY_ENTITY: Record<ReportEntityType, string> = {
  Lead: 'Number of Leads',
  Deal: 'Number of Deals',
  Contact: 'Number of Contacts',
  Company: 'Number of Companies',
  Task: 'Number of Tasks',
  Meeting: 'Number of Meetings',
  Quotation: 'Number of Quotations',
  'Call log': 'Number of Call logs',
};

// WHY this per-entity map exists (2026-08-21, found via a real live test
// failure): Call log's own Date Filter option list, confirmed live via
// direct DOM read, is `["Logged At", "Start Time", "Date", "Updated At",
// "Date Time Picker"]` — "Created At" is not merely non-default for Call
// log (already documented), it is COMPLETELY ABSENT from the option list,
// so selecting it by exact text throws instead of silently picking the
// wrong thing. "Logged At" is the confirmed real equivalent — consistent
// with the platform's own default control value for Call log ("Call
// Logged At") and with getApiCountForWindow()'s ground-truth query, which
// always filters on the real `createdAt` field: a call log's canonical
// timestamp IS when it was logged, the same moment as its creation.
// Every other confirmed entity type (spot-checked live for Lead, which
// does list "Created At" verbatim) uses the literal "Created At" text.
export const REPORT_CREATED_DATE_FILTER_BY_ENTITY: Record<ReportEntityType, string> = {
  Lead: 'Created At',
  Deal: 'Created At',
  Contact: 'Created At',
  Company: 'Created At',
  Task: 'Created At',
  Meeting: 'Created At',
  Quotation: 'Created At',
  'Call log': 'Logged At',
};

// Kept as named exports for the two most-used Lead-specific constants — same
// reasoning as REPORT_LEAD_OWNER_DIMENSION/REPORT_LEAD_COUNT_METRIC existing
// as a single source of truth in every other module's own factory (e.g.
// LEAD_CUSTOM_FIELD_NAMES in leadFactory.ts).
export const REPORT_LEAD_OWNER_DIMENSION = REPORT_OWNER_DIMENSION_BY_ENTITY.Lead;
export const REPORT_LEAD_SOURCE_DIMENSION = 'Source';
export const REPORT_LEAD_COUNT_METRIC = REPORT_COUNT_METRIC_BY_ENTITY.Lead;

export function generateReportData(overrides: Partial<ReportData> = {}): ReportData {
  const reportType = overrides.reportType ?? 'Lead';
  return {
    name: `Report - ${faker.company.buzzPhrase()} - ${faker.string.alphanumeric(8)}`,
    description: faker.lorem.sentence(),
    category: 'One Dimensional',
    reportType,
    chartType: 'Bar',
    dimension: REPORT_OWNER_DIMENSION_BY_ENTITY[reportType],
    metric: REPORT_COUNT_METRIC_BY_ENTITY[reportType],
    ...overrides,
  };
}

// WHY ADM<timestamp> prefix — same RBAC-isolation convention documented in
// .claude/architecture.md's "Test Data Factories" section — guarantees a
// restricted user's negative-visibility assertion against this report can
// never collide with old, never-cleaned-up QA report data (this environment
// already has 100+ permanent pre-existing reports, confirmed live).
export function generateAdminReportData(overrides: Partial<ReportData> = {}): ReportData {
  const timestamp = Date.now().toString();
  const base = generateReportData(overrides);
  return {
    ...base,
    name: overrides.name ?? `ADM${timestamp} - Report - ${faker.string.alphanumeric(6)}`,
  };
}

// WHY a RES<timestamp>-prefixed variant, mirroring ADM above: needed for the
// RBAC "restricted user's own report must be provably distinguishable from
// admin/other stale QA data" assertions (e.g. R9/R10's list-visibility
// checks) — same reasoning as every other module's generateSharedXxxData()/
// generateAdminXxxData() pair.
export function generateRestrictedReportData(overrides: Partial<ReportData> = {}): ReportData {
  const timestamp = Date.now().toString();
  const base = generateReportData(overrides);
  return {
    ...base,
    name: overrides.name ?? `RES${timestamp} - Report - ${faker.string.alphanumeric(6)}`,
  };
}
