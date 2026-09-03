import { faker } from '@faker-js/faker';
import { ReportEntityType } from './reportFactory';

// ──────────────────────────────────────────────────────────────────────────
// Dashboard — dashlet-type / entity-availability constants
// ──────────────────────────────────────────────────────────────────────────
// WHY every value below is copied verbatim from DASHBOARD_INVESTIGATION.md
// §2E (live-confirmed against QA via Playwright MCP, 2026-09-01) — never
// invented/guessed. Confirmed real radio `value`s, not the on-screen labels
// (CLAUDE.md rule 6): Call Log's real value is `call`, not `call_log`/
// `calllog` (matching the Reports module's own already-documented
// `/v3/reports/calls` endpoint-naming quirk — CLAUDE.md rule 15/§19).

export const DASHLET_TYPE_OPTIONS = ['smartlist', 'multilist', 'report'] as const;
export type DashletType = (typeof DASHLET_TYPE_OPTIONS)[number];

// WHY 'Grouped Smartlists' for multilist, not 'Multilist': confirmed live —
// the radio's real `value` is `multilist` but its on-screen label is
// "Grouped Smartlists" (DASHBOARD_INVESTIGATION.md §2E) — a genuine
// value/label naming difference, kept explicit here rather than derived.
export const DASHLET_TYPE_LABELS: Record<DashletType, string> = {
  smartlist: 'Smartlist',
  multilist: 'Grouped Smartlists',
  report: 'Report',
};

// WHY Smartlist and Grouped Smartlists share the identical entity list:
// confirmed live, identical 5-entity set for both (§2E's own table).
export const SMARTLIST_DASHLET_ENTITY_OPTIONS = ['lead', 'deal', 'contact', 'company', 'email'] as const;
export type SmartlistDashletEntityType = (typeof SMARTLIST_DASHLET_ENTITY_OPTIONS)[number];

// WHY Report's own entity list is a DIFFERENT 7-entity set, No Email, plus
// Task/Meeting/Call Log which Smartlist/Grouped never offer at all: this is
// the single most important, confirmed-live finding of the investigation
// (§2E) — Call Log dashlets can ONLY ever be added as Report type.
export const REPORT_DASHLET_ENTITY_OPTIONS = [
  'lead',
  'deal',
  'contact',
  'company',
  'task',
  'meeting',
  'call',
] as const;
export type ReportDashletEntityType = (typeof REPORT_DASHLET_ENTITY_OPTIONS)[number];

export type DashboardDashletEntityType = SmartlistDashletEntityType | ReportDashletEntityType;

// WHY a single label map covering all 7 distinct entity values, not one map
// per dashlet type: 'lead'/'deal'/'contact'/'company' are shared verbatim
// across both option sets (confirmed live — same value, same label, in both
// radio groups), so one map is the real, non-duplicated shape.
export const DASHBOARD_ENTITY_LABELS: Record<DashboardDashletEntityType, string> = {
  lead: 'Lead',
  deal: 'Deal',
  contact: 'Contact',
  company: 'Company',
  email: 'Email',
  task: 'Task',
  meeting: 'Meeting',
  call: 'Call Log',
};

// WHY this map exists (build decision #2, per the build task): the
// Report-type dashlet tests must create their OWN disposable Report via the
// Reports module's own ReportsPage/reportFactory (never duplicated here —
// CLAUDE.md rule 1) rather than depending on this QA account's large
// pre-existing Reports data. ReportsPage.createReport() takes a
// `ReportEntityType` ('Lead'/'Deal'/.../'Call log' — Title Case, from
// reportFactory.ts), which is a DIFFERENT string shape from this dashlet
// wizard's own lowercase `entityType` radio values — this map is the
// explicit, confirmed-safe translation between the two, scoped to exactly
// the 7 entities the Report dashlet wizard actually offers (no Quotation —
// confirmed absent from the Report dashlet's own entity list, §2E).
export const REPORT_DASHLET_ENTITY_TO_REPORT_ENTITY_TYPE: Record<ReportDashletEntityType, ReportEntityType> = {
  lead: 'Lead',
  deal: 'Deal',
  contact: 'Contact',
  company: 'Company',
  task: 'Task',
  meeting: 'Meeting',
  call: 'Call log',
};

// WHY a literal constant, not read live from the DOM at each call site: this
// is NOT the kind of environment-conditional, ever-growing picklist CLAUDE.md
// rule 4 protects against (a per-record dataset that legitimately grows/
// shrinks) — it's this account's small, curated, admin-configured set of
// system PROFILES (confirmed live via a follow-up MCP pass, 2026-09-02: the
// Assign Dashboard modal's "Assign to: Profiles" search field enumerated
// exactly two live options, "Admin" and "Restricted User"), directly
// analogous to this repo's existing precedent of hardcoding Kylas's own
// fixed platform enums (e.g. `REPORT_CATEGORY_OPTIONS` in reportFactory.ts).
// If a future environment's account setup uses different profile names,
// this constant — and only this constant — needs updating.
export const RESTRICTED_USER_PROFILE_NAME = 'Restricted User';

export interface DashboardData {
  name: string;
}

// WHY the `QA-Auto-Dashboard-<timestamp>` prefix (build decision #1):
// mirrors this repo's existing ADM<timestamp>/[QA-Auto] naming conventions
// (.claude/architecture.md's Test Data Factories section) — every disposable
// dashboard a test creates must be distinguishable at a glance and safely
// deletable in teardown without risking a real, human-created dashboard.
export function generateDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  const timestamp = Date.now().toString();
  return {
    name: `QA-Auto-Dashboard-${timestamp}-${faker.string.alphanumeric(6)}`,
    ...overrides,
  };
}

// WHY an ADM-prefixed variant, mirroring reportFactory.ts's
// generateAdminReportData(): needed specifically for the RBAC cross-role
// tests (27/28) where an admin-owned dashboard's name must be unambiguously
// distinguishable from anything a restricted user might create/see — same
// reasoning as every other module's generateAdminXxxData() (.claude/
// architecture.md's Test Data Factories section).
export function generateAdminDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  const timestamp = Date.now().toString();
  return {
    name: `ADM${timestamp}-QA-Auto-Dashboard-${faker.string.alphanumeric(6)}`,
    ...overrides,
  };
}
