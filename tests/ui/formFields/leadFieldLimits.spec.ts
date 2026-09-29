import { test, expect, withLeadFormFieldLock } from './formFieldsTestLock';
import { Page } from '@playwright/test';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import {
  FormFieldsConfigPage,
  FormFieldsEntityConfig,
} from '../../../src/modules/formFields/FormFieldsConfigPage';
import {
  LEAD_FORM_FIELD_LIMIT_NAMES,
  LEAD_LAYOUT_CACHE_KEY,
  generateLeadData,
  LeadData,
  generateLeadCustomFieldInvalidTextField,
  generateLeadCustomFieldInvalidParagraphText,
  generateInvalidPanCardValue,
  generateValidEmailFormatValue,
  generateInvalidEmailFormatValue,
  generateValidDriverLicenceValue,
  generateInvalidDriverLicenceValue,
  generateValidVotingCardValue,
  generateInvalidVotingCardValue,
  generateValidPassportValue,
  generateInvalidPassportValue,
} from '../../../src/data/factories/leadFactory';
import { faker } from '@faker-js/faker';
import { logger } from '../../../src/utils/logger';
import { config } from '../../../config/config';
import * as path from 'path';

// WHY this file has NO test.describe.configure({ mode: 'serial' }) at all
// (2026-09-29, removed — previously restructured 2026-09-21 into several
// small per-field serial blocks instead of one file-wide block; see git
// history for both prior shapes): every test here configures or depends on
// the exact current configuration of one of only 3 shared, account-wide
// custom fields (cfTextField/cfNumber/cfParagraphText) — not a disposable
// per-test record — so tests touching the SAME field must still run
// one-at-a-time. That real requirement is met by `formFieldsTestLock.ts`'s
// auto-applied, scope:'test' `leadFormFieldLock` fixture (imported from
// `./formFieldsTestLock` below), which acquires a real cross-process file
// lock for EVERY test's entire duration (in this file AND in
// tests/rbac/formFields/leadFieldLimits.rbac.spec.ts) and releases it only
// once that test finishes — two tests can never actually execute
// concurrently regardless of describe grouping, so `.serial` mode was
// enforcing an ordering constraint the lock already guaranteed for free.
//
// What `.serial` mode ALSO did, which was never actually wanted: Playwright
// recycles a worker after any serial-block test failure (confirmed at
// Playwright's own source, node_modules/playwright/lib/worker/
// workerProcessEntry.js — a failure sets `_isStopped = true`, and every
// subsequent test the same worker would have run is marked "skipped"
// without ever attempting it; only a retry of the WHOLE block gets those
// tests a real chance to run). Live-confirmed real cost of this (2026-09-28
// sandbox run 36464460839, shard 3/8): one genuine failure in Task's RBAC
// suite cascade-skipped 48 unrelated tests across two files in the same
// invocation, none of which ever got their own real attempt. With `.serial`
// removed, the lock alone still prevents any actual race, and a failure in
// one test no longer takes its neighbors down with it.
//
// WHY every test independently (re-)configures its own field state rather
// than relying on declaration/execution order: tests must remain
// independent and order-agnostic (explicit design rule, unaffected by this
// change) — the lock exists only to prevent two tests from racing the SAME
// write, not to let a later test assume an earlier one's leftover state.
//
// WHY digit-count/character-length boundary values are always built from
// the SAME min/max constants a given test itself passes to
// configureFieldLimit() — never a second, independently-chosen literal
// that happens to match: per the hard-rule directive, and per
// FORM_FIELD_LIMIT_INVESTIGATION_FOLLOWUP.md §4's confirmed rule that
// Number validates digit-count length (not numeric magnitude) — mechanically
// identical to Text/Paragraph's own character-length validation, so one
// "repeat a character N times" builder correctly serves all three field
// types.

const LEAD_ENTITY: FormFieldsEntityConfig = { tabLabel: 'Lead', urlSlug: 'leads' };
const OTHER_DETAILS_TAB = 'Other Details';

const TEXT_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.textField}`;
const NUMBER_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.number}`;
const PARAGRAPH_FIELD_INTERNAL_NAME = `cf${LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText}`;

// WHY these specific min/max pairs, not the field type's absolute ceiling:
// small, fast-to-type values are sufficient to exercise the real
// under/at/over boundary logic (already confirmed to be a simple length
// comparison, FORM_FIELD_LIMIT_INVESTIGATION.md §2.5/§2.8) without the
// runtime cost of typing hundreds of characters per test across 27+
// boundary tests.
const TEXT_MIN = 3;
const TEXT_MAX = 6;
const TEXT_REPEAT_CHAR = 'A';

const PARAGRAPH_MIN = 5;
const PARAGRAPH_MAX = 9;
const PARAGRAPH_REPEAT_CHAR = 'B';

const NUMBER_MIN = 3;
const NUMBER_MAX = 6;
const NUMBER_REPEAT_CHAR = '1';

function repeatChar(char: string, length: number): string {
  return char.repeat(Math.max(0, length));
}

// ─── Shared local action helpers ──────────────────────────────────────────
// WHY these live only in this spec file, not exported from a page object or
// factory: they are thin, test-shaped compositions of already-public
// page-object methods (never a raw Locator — CLAUDE.md's own "no locators
// in test files" rule), built specifically for this file's own repeated
// shape (configure → clear cache → fill one field → assert). Nothing here
// is reusable production page-object behavior in its own right.

// WHY 'key-not-found' is treated as a successful no-op, not a failure (real
// live bug, found via a real test run, 2026-09-21): BasePage.ts's own WHY
// comment on clearApplicationCache() already anticipates this exact
// distinction ("already absent — arguably fine, idempotent" vs. a genuine
// failure) — this is the calling code actually honoring that contract, not
// a new judgment call. A session that has never opened the Lead create/edit
// form yet (routinely true for a restricted user's fresh browser context,
// which is EVERY restricted-role test in this file) has nothing cached at
// all — there is no key to delete, and "nothing cached" is already the
// exact end state clearing the cache is meant to produce. Failing here
// would be the same category of bug as the Submit-disabled-on-no-change fix
// in FormFieldsConfigPage.ts: treating an operation that's already at its
// target state as an error instead of a normal, valid outcome. Every OTHER
// failure reason ('db-not-found', 'store-not-found', 'exception') still
// fails loudly — those genuinely mean something is wrong, not "already
// clear."
async function clearLeadApplicationCache(targetPage: Page): Promise<void> {
  const leadsPage = new LeadsPage(targetPage);
  const result = await leadsPage.clearApplicationCache(LEAD_LAYOUT_CACHE_KEY);
  if (result.ok || result.reason === 'key-not-found') return;
  expect(
    result.ok,
    `Expected the Lead application cache to clear successfully, got: ${JSON.stringify(result)}`
  ).toBe(true);
}

// ============================================================================
// Lead create/update flow for this feature — architecture note
// ============================================================================
// WHY exactly two Lead-mutation paths exist below, deliberately different,
// never merged into one shared function (2026-09-22, direct instruction
// after a multi-day investigation into a "Save click resolves but no
// create/update request ever fires" symptom that reproduced across several
// unrelated tests — FFL6, FFL16 — under real full-suite load only,
// never in isolation): a wrapped, directly-proven capture of the Save
// button's real React onClick handler confirmed the handler DOES fire, and
// produces zero network activity and zero console/page errors — i.e. this
// is not a Playwright click-registration problem, it is the app's own
// handler silently declining to submit under some real, still-unidentified
// client-side race condition. Because the handler firing but doing nothing
// cannot be fixed or worked around from the click side (there is nothing
// wrong with the click itself), the only real mitigation is a RELIABLE
// RETRY WITH A FULL MODAL RESET when it happens — which is exactly what
// LeadsPage.createLead()/updateLead() already do, proven across hundreds of
// pre-existing tests in leads.spec.ts. This file used to duplicate that
// retry logic in its own, less battle-tested helpers
// (saveAndCaptureLeadId(), createBareLead()'s own retry loop) — removed
// entirely in favor of calling the one proven mechanism directly.
//
// PATH 1 — ACCEPT (createLeadExpectingAccept() / updateLeadExpectingAccept()):
// used whenever this test's own value is expected to be genuinely valid and
// PERSISTED server-side. Delegates entirely to
// LeadsPage.createLead()/updateLead() — the exact same mechanism every
// other Lead-creating/editing test in this codebase already relies on. This
// file's own helpers do exactly one thing beyond that: build the LeadData
// payload with the single custom field under test overridden to the exact
// boundary value being checked, leaving every other field at its own
// realistic generated default.
//
// PATH 2 — REJECT (openLeadFormExpectingRejection() /
// openEditLeadFormExpectingRejection()): used whenever this test's own
// value is expected to be permanently, correctly BLOCKED client-side (no
// network request should ever fire). Deliberately does NOT go through
// LeadsPage.createLead()/updateLead(): that mechanism waits up to
// config.timeouts.navigation for a create/update response and, finding
// none, classifies the silent miss as a transient backend error and
// retries the whole create/update up to 3 more times — the WRONG
// interpretation for a value that is supposed to never reach the backend
// at all, and an expensive one (minutes of wasted retry per test). These
// two functions perform ONLY the open+fill half of the flow — no Save
// click at all — because the inline validation error this path exists to
// check for renders on blur, before Save is ever clicked (confirmed live,
// see hasInlineFormError()'s own WHY comment below); the caller asserts it
// directly via assertInlineErrorPresent()/hasInlineFormError().
//
// WHY THIS SPLIT MUST NEVER BE COLLAPSED: if a future change routes a
// reject-expecting test through the ACCEPT path, the symptom is NOT a
// clean, obvious failure — it is a slow one (the test hangs through a full
// transient-retry budget) that eventually fails with a confusing
// "exhausted transient retries" error instead of the real, intended
// assertion ("expected an inline validation error"). If a future change
// routes an accept-expecting test through the REJECT path, the symptom is
// a false pass or a silent no-op: clickModalSaveButton() never confirms a
// request fired, so a genuinely broken save could go undetected. Each
// path's own function names say directly which case they're for — treat a
// reject-path helper appearing in an accept-test's body (or vice versa) as
// a bug to fix immediately, not a style choice.
// ============================================================================

// WHY field-name -> LeadCustomFieldData key mapping: this file's own tests
// only ever target these 3 custom fields (Text/Paragraph/Number) — this is
// a deliberately narrow, explicit map, not a generic derivation, matching
// this codebase's own established "never guess a mapping, hand-verify and
// hardcode it" convention (e.g. reference-patterns.md §22's layoutCache
// key). Throws on an unmapped name rather than silently no-op'ing, since a
// typo'd field name here would otherwise silently generate a Lead with the
// WRONG field set to the test's value — a false pass waiting to happen.
// WHY the return type is this narrow 3-literal union, not the full
// `keyof LeadCustomFieldData` (real type error found and fixed here): the
// wider type would let TypeScript's control-flow narrowing in
// buildLeadDataWithFieldOverride() below treat the non-number branch as
// "any of the OTHER 6+ custom-field keys," each with its own, genuinely
// different value type (boolean, string[], etc.) — making a single string
// assignment across all of them correctly unsafe and un-typeable. Since
// this function only ever returns one of these 3 values, declaring exactly
// that is both more honest and what makes the caller's own narrowing sound.
type SupportedCustomFieldKey = 'textField' | 'paragraphText' | 'number';

function customFieldNameToDataKey(fieldName: string): SupportedCustomFieldKey {
  if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.textField) return 'textField';
  if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText) return 'paragraphText';
  if (fieldName === LEAD_FORM_FIELD_LIMIT_NAMES.number) return 'number';
  throw new Error(
    `customFieldNameToDataKey: unmapped field name "${fieldName}" — this file only targets Text/Paragraph/Number`
  );
}

// WHY a single field+value pair, not a bare (fieldName, value) parameter
// pair repeated across 6 different functions: a real discriminated type
// documents the CONCEPT ("the one custom field this specific test is
// exercising") once, rather than two same-shaped strings whose meaning is
// only clear from parameter position.
interface LeadFieldUnderTest {
  fieldName: string;
  value: string;
}

// WHY this construction (building a full, realistic LeadData object with
// ONE field overridden) is shared by BOTH the accept and reject paths
// below, even though "no duplicated logic between the accept and reject
// paths" is the standing rule here: this is pure DATA construction, not
// SAVE-MECHANISM logic — the thing the accept/reject split exists to keep
// separate. Sharing this one, narrowly-scoped builder removes real
// duplication (the field-key lookup, the number-vs-string coercion)
// without blurring which SAVE path either caller ultimately takes.
function buildLeadDataWithFieldOverride(lastName: string, field: LeadFieldUnderTest): LeadData {
  // WHY generate a FULL, realistic Lead first and then overwrite one field,
  // rather than passing a partial customFields object into generateLeadData()
  // itself (real type error found and fixed here, not a style choice):
  // Partial<LeadData> is a SHALLOW partial — it makes the `customFields`
  // property itself optional, but does not recursively make
  // LeadCustomFieldData's own properties optional, so a `{ textField: '...' }`
  // object is not assignable where a full LeadCustomFieldData is expected.
  // Building the full object first and assigning into it keeps every field
  // fully, honestly typed — no `any`, no unsafe cast to paper over the
  // mismatch.
  const leadData = generateLeadData({ lastName });
  const dataKey = customFieldNameToDataKey(field.fieldName);
  if (dataKey === 'number') {
    // WHY a separate branch, not a shared cast: LeadCustomFieldData.number
    // is a real `number`, never a string — the Number custom field's own
    // live UI input is numeric-only (an HTML input[type=number]), so this
    // one key's value type genuinely differs from every other key on the
    // interface.
    leadData.customFields.number = Number(field.value);
  } else {
    leadData.customFields[dataKey] = field.value;
  }
  return leadData;
}

// Client-side-blocked rejection — applies to EVERY min/max/regex violation
// in this suite (Number, every Regex option, AND Text/Paragraph min/max):
// confirmed live (FORM_FIELD_LIMIT_INVESTIGATION.md §2.7/§2.8 for Number/
// Regex) the inline error appears on blur, before any Save click, and Save
// itself fires no network request while it's present — checking the inline
// error directly is therefore sufficient, faster, and more precise proof
// of rejection than also clicking Save (which for this mechanism would
// prove nothing further).
//
// CORRECTION, 2026-09-21 — real live discrepancy found and resolved via a
// dedicated re-investigation (same rigor as the earlier Number-field
// digit-count resolution, 5 separate live trials, evidence saved to
// .claude/evidence/failure-triage-investigator/2026-09-21-text-field-
// inline-error-discrepancy/): FORM_FIELD_LIMIT_INVESTIGATION.md §2.5 (and
// reference-patterns.md §9's "ParagraphText... no client-side check" line)
// both claim Text/Paragraph min/max are validated SERVER-SIDE ONLY, via a
// generic toast, with NO inline error — this is confirmed WRONG. Live
// reproduction (2 min/max configs, create AND update forms, Text AND
// Paragraph, 5 trials total) found the IDENTICAL inline mechanism as
// Number/Regex every time — byte-identical `form-control is-invalid`
// class, the same `.invalid-feedback`/`.msg-count-wrapper.error`
// paginated-banner component, message template "Enter the value having
// length between {min} - {max}". Network-request logging on every trial
// confirmed ZERO requests fire while the inline error is present.
// WHY the catch below re-throws anything that isn't specifically
// assertNoFormErrors()'s own "Validation errors found in ..." error (its
// one and only throw site, BasePage.ts's assertNoFormErrors()): a bare
// `catch { errorThrown = true }` would silently reinterpret ANY unrelated
// failure inside that call (a session-expiry redirect, a transient DOM
// race, an unrelated Playwright timeout) as "the expected validation error
// is present" — a real false-positive risk that would mask an unrelated
// break as a passing test. Narrowing to the exact message this method is
// documented to throw keeps the intended case working while letting a
// genuinely different failure propagate and fail loudly instead.
async function hasInlineFormError(leadsPage: LeadsPage, context: string): Promise<boolean> {
  try {
    await leadsPage.assertNoFormErrors(context);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Validation errors found in')) {
      return true;
    }
    throw error;
  }
}

async function assertInlineErrorPresent(leadsPage: LeadsPage, context: string): Promise<void> {
  const errorPresent = await hasInlineFormError(leadsPage, context);
  expect(
    errorPresent,
    `Expected an inline validation error to be present in ${context}, but assertNoFormErrors() found none`
  ).toBe(true);
}

// ── PATH 1: ACCEPT ─────────────────────────────────────────────────────────

// WHY this is the ONLY way this file creates a Lead it expects to actually
// persist — see this section's own top-of-block architecture note for the
// full reasoning. Delegates entirely to LeadsPage.createLead(); this
// function owns nothing beyond building the LeadData payload and asserting
// a real ID came back.
// WHY `{ minimal: true, onlyCustomField: ... }` (real root-cause fix,
// 2026-09-22 — see LeadsPage.ts's fillLeadCustomFields()/fillLeadForm() own
// WHY comments for the full evidence chain): this file's tests configure a
// narrow account-wide constraint on ONE custom field, then create/update a
// Lead — filling every OTHER field via generateLeadData()'s random defaults
// (the previous, pre-fix behavior) risked one of those defaults violating a
// constraint some OTHER, unrelated test left active on a DIFFERENT field,
// producing a real, correctly-blocked-by-the-app inline validation error
// that was misclassified as a flaky "transient backend" failure — confirmed
// live as the actual cause of the FFL9/FFL15 failures this fix resolves.
// Filling ONLY the one field this specific test actually cares about removes
// the risk entirely, for every test in this file, not just these two.
async function createLeadExpectingAccept(
  leadsPage: LeadsPage,
  lastName: string,
  field: LeadFieldUnderTest
): Promise<number> {
  const leadData = buildLeadDataWithFieldOverride(lastName, field);
  const leadId = await leadsPage.createLead(leadData, {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  expect(
    leadId,
    `Expected Lead creation to succeed (field="${field.fieldName}", value="${field.value}") but createLead() returned null`
  ).not.toBeNull();
  return leadId as number;
}

// WHY kept as a named, single-purpose wrapper rather than inlining
// leadsPage.createLead(generateLeadData({ lastName })) at every call site:
// the name documents INTENT (a minimal Lead created purely as an edit
// target for a later test step) even though the implementation is nothing
// but a direct delegation to the one proven creation mechanism — no retry,
// no network capture, no logic of its own. If this function is ever found
// doing anything MORE than constructing minimal LeadData and calling
// leadsPage.createLead(), that is itself a sign the "exactly one way to
// create a Lead" invariant has been broken.
// WHY `{ minimal: true }` with no `onlyCustomField` — a genuinely bare Lead,
// zero custom fields filled at all (see this fix's own top-level WHY comment
// on createLeadExpectingAccept()): this function creates a plain edit
// TARGET, not a Lead any test asserts custom-field values on, so there is no
// field that needs a value here, and every custom field left unfilled is one
// fewer opportunity to collide with some OTHER test's still-active
// constraint on an unrelated field.
async function createBareLead(leadsPage: LeadsPage, lastName: string): Promise<number> {
  const leadId = await leadsPage.createLead(generateLeadData({ lastName }), { minimal: true });
  expect(
    leadId,
    `Expected a bare minimal Lead ("${lastName}") to be created successfully`
  ).not.toBeNull();
  return leadId as number;
}

// WHY this is the ONLY way this file updates a Lead it expects the change
// to actually persist — mirrors createLeadExpectingAccept() exactly, using
// LeadsPage.updateLead()'s own two-step shape (fillEditForm() then
// saveEditedLead(), the latter already has its own real PUT-response wait —
// see its own WHY comment in LeadsPage.ts) rather than a single opaque
// call, so this function's own steps stay traceable in the log.
async function updateLeadExpectingAccept(
  leadsPage: LeadsPage,
  leadId: number,
  lastName: string,
  field: LeadFieldUnderTest
): Promise<void> {
  await leadsPage.searchAndOpenLead('', leadId);
  await leadsPage.clickEditIcon();
  await leadsPage.fillEditForm(buildLeadDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
  await leadsPage.saveEditedLead();
}

// ── PATH 2: REJECT ──────────────────────────────────────────────────────────

// WHY this performs ONLY the open+fill half of Lead creation, never a
// Save click at all — see this section's own top-of-block architecture
// note for why LeadsPage.createLead() is deliberately wrong for this case,
// and hasInlineFormError()'s own WHY comment below for why no click is
// needed in the first place (the inline error renders on blur). The
// caller always asserts the resulting inline error directly, never a
// captured Lead ID.
async function openLeadFormExpectingRejection(
  leadsPage: LeadsPage,
  lastName: string,
  field: LeadFieldUnderTest
): Promise<void> {
  await leadsPage.clickAddLead();
  await leadsPage.fillLeadForm(buildLeadDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

// WHY a separate edit-form equivalent of openLeadFormExpectingRejection()
// rather than one shared function branching on create-vs-edit: create and
// edit reach the form through genuinely different navigation (clickAddLead()
// vs. searchAndOpenLead()+clickEditIcon()) — branching on a boolean inside
// one function would hide that difference behind a flag instead of making
// it visible in the call site's own function name.
async function openEditLeadFormExpectingRejection(
  leadsPage: LeadsPage,
  leadId: number,
  lastName: string,
  field: LeadFieldUnderTest
): Promise<void> {
  await leadsPage.searchAndOpenLead('', leadId);
  await leadsPage.clickEditIcon();
  await leadsPage.fillEditForm(buildLeadDataWithFieldOverride(lastName, field), {
    minimal: true,
    onlyCustomField: customFieldNameToDataKey(field.fieldName),
    onlyCustomFieldName: field.fieldName,
  });
}

// WHY no reject-path "click Save and confirm no persisted change" helper
// exists here (checked directly, not assumed — grepped every reject-edit
// call site in this file): every reject-edit test asserts its inline error
// directly after filling the blocked value, via assertInlineErrorPresent()
// below — the same already-established fact that this codebase's own
// investigation docs confirm (the inline error appears on blur, BEFORE any
// Save click, and Save itself fires no network request while it's
// present). A "click Save then check no error" helper would therefore be
// dead code: nothing in this file's own reject-edit tests ever needs to
// click Save at all to prove the value was blocked.

async function assertCustomFieldPersistedOnDetail(
  leadsPage: LeadsPage,
  leadId: number,
  fieldName: string,
  expectedValue: string,
  description: string
): Promise<void> {
  await leadsPage.searchAndOpenLead('', leadId);
  await leadsPage.clickDetailPageTab(OTHER_DETAILS_TAB);
  await leadsPage.assertCustomFieldOnDetail(fieldName, expectedValue, description);
}

async function clearAllFieldConfigurations(adminPage: Page): Promise<void> {
  const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
  await configPage.clearFieldConfiguration(TEXT_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(NUMBER_FIELD_INTERNAL_NAME);
  await configPage.clearFieldConfiguration(PARAGRAPH_FIELD_INTERNAL_NAME);
}

test.describe('Lead Field Limits', () => {
  // WHY no test.describe.configure({ mode: 'serial' }) anywhere in this
  // file — see this file's top-of-file comment for the full reasoning
  // (formFieldsTestLock.ts's cross-process lock already serializes every
  // test for real; .serial mode was only adding an unwanted skip-cascade).

  // WHY test.describe.configure({{ timeout: 480000 }}) here (2026-09-29,
  // real CI failures — sandbox run 36464460839: FFRTK6/FFC6/FFCO25/FFPS6 all
  // failed with "admin page failed to reach the app's /sales/ area (only
  // 0ms left before the fixture-setup deadline...)"): fixtures/index.ts's
  // createRolePage() computes its own fixture-setup deadline from
  // `testInfo.timeout * 0.85` BEFORE any test in this file ever calls
  // test.setTimeout(480000) inside its own body — too late to affect that
  // calculation, since fixture setup runs before the test body. Every test
  // here was therefore getting only the CI default 120000ms (a ~102000ms
  // deadline) for fixture setup, not the 480000ms the test actually needs —
  // and a single slow navigation attempt can legitimately consume that
  // entire 102000ms budget, leaving zero time for the already-correct
  // wrongPage recovery retry to ever run. describe.configure is resolved at
  // test-collection time, so testInfo.timeout is already correct by the
  // time ANY fixture (including adminPage/restrictedPage) initializes for
  // these tests — fixing the deadline math without touching
  // fixtures/index.ts's shared session-recovery logic at all. The existing
  // per-test test.setTimeout(480000) calls below are now redundant but
  // harmless (same value) — left in place rather than mass-edited out.
  test.describe.configure({ timeout: 480000 });


  // WHY this hook, in addition to (not instead of) the standalone verified
  // cleanup tests near the end of this file: a guaranteed-on-failure
  // safety net, run unconditionally regardless of whether any test above
  // it passed — the same convention already used elsewhere in this
  // codebase for guaranteed teardown of shared/global state (e.g.
  // Dashboard's disposable-dashboard-per-test teardown).
  test.afterAll(async ({ browser }) => {
    // WHY test.setTimeout(600000) here (2026-09-29, real CI failures —
    // sandbox run 36464460839: FFD37/FFD20 in dealFieldLimits.spec.ts and
    // FFTK38 in taskFieldLimits.spec.ts both failed with "Test timeout of
    // 120000ms exceeded while setting up formFieldLock" / "afterAll hook
    // timeout of 120000ms exceeded"): playwright.config.ts sets the CI
    // default test timeout to 120000ms — afterAll hooks get that same
    // default and do NOT inherit any individual test's own
    // test.setTimeout(480000) bump (that only extends the ONE test that
    // calls it). This hook's own lock acquisition can legitimately need to
    // wait up to ~480000ms for a DIFFERENT worker's still-in-progress,
    // full-length test on the SAME entity to finish and release the same
    // lock — 120000ms was never enough headroom for that, independent of
    // anything being actually wrong; it was a real, guaranteed-to
    // -eventually-fire timeout-budget mismatch. Sized generously above the
    // known ~480000ms worst case, not a guess.
    test.setTimeout(600000);
    // WHY this doesn't request the adminPage fixture: Playwright's
    // afterAll hooks can only depend on worker-scoped fixtures —
    // adminPage is test-scoped (a fresh authenticated Page created and
    // torn down per individual test), so it cannot be injected here.
    // Instead this builds a context directly from the on-disk
    // storage-state file architecture.md documents as this codebase's own
    // stable, public convention (`src/auth/storageStates/<env>/<role>.json`,
    // written once by globalSetup.ts before any test runs) — not a reach
    // into fixtures/index.ts's own private internals.
    //
    // WHY the actual field-clearing is wrapped in withLeadFormFieldLock()
    // (real, confirmed live bug, 2026-09-21 — see formFieldsTestLock.ts's
    // own WHY comment on that export for the full incident): this exact
    // hook cannot request the `leadFormFieldLock` fixture (the same
    // worker-scoped-only limitation the comment above already explains),
    // and this describe block's own lack of a .serial override means
    // Playwright's parallelWithHooks chunking can run MULTIPLE copies of
    // this hook concurrently across different chunks. Without this lock,
    // one chunk's afterAll can wipe cfTextField/cfNumber/cfParagraphText
    // while a DIFFERENT chunk's still-running, lock-protected test depends
    // on that exact config — confirmed live as the real cause of FFL34 and
    // FFL52 both failing under --workers=2 with "expected an inline
    // validation error, found none" (the field's regex/min/max had been
    // cleared out from under them mid-test).
    const adminStorageStatePath = path.join(
      __dirname,
      '../../../src/auth/storageStates',
      config.env,
      'admin.json'
    );
    const context = await browser.newContext({ storageState: adminStorageStatePath });
    const page = await context.newPage();
    try {
      await withLeadFormFieldLock(() => clearAllFieldConfigurations(page));
      logger.success('afterAll safety-net cleanup completed');
    } catch (error) {
      // WHY logged, not re-thrown: a safety-net hook failing must never
      // mask or override the real pass/fail signal of the tests that
      // already ran above it. If FFL54/FFL55 already ran and passed, this
      // is a pure no-op re-confirmation; if this session's storage state
      // has since gone stale (this hook deliberately does NOT use
      // AuthManager's session-refresh machinery — that's the adminPage
      // fixture's job, not a worker-scoped hook's), this is a best-effort
      // second attempt, not the primary cleanup guarantee.
      logger.warn(`afterAll safety-net cleanup failed (non-fatal): ${String(error)}`);
    } finally {
      await context.close();
    }
  });

  // ─── Navigation ──────────────────────────────────────────────────────
  // WHY no .serial here: these 3 tests are read-only (open the list page,
  // search, read a snapshot) — they mutate no shared field configuration,
  // so no ordering/mutual-exclusion guarantee is needed among them beyond
  // what formFieldsTestLock.ts's lock already provides unconditionally.

  test.describe('Navigation', () => {
    test('@smoke @prodSafe FFL1 admin should open the Lead field settings page and see the entity tabs', async ({
      adminPage,
    }) => {
      // WHY this test needs the same extended timeout as this file's heavier
      // create-lead tests despite doing almost nothing itself (real,
      // confirmed live bug, 2026-09-21): every test in both this file and
      // formFields.rbac.spec.ts shares ONE cross-process lock
      // (formFieldsTestLock.ts) — and CI's own project-wide default test
      // timeout is only 120000ms (playwright.config.ts), far shorter than
      // this lock's own legitimate worst-case wait if it's ever queued behind
      // a slow holder. A short-timeout test that has to wait for the lock can
      // get killed by ITS OWN timeout while merely waiting — confirmed live:
      // FFL1 itself was killed this way (8.0m, the local default ceiling)
      // after FFL54 (a different test, no explicit timeout of its own) hung
      // while holding the lock. Every lock-participating test needs a
      // matching, sufficiently generous timeout regardless of what it does
      // internally, or it becomes the weak link the WHOLE shared-lock chain
      // can be starved through.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.open();
      const tabs = await configPage.getVisibleEntityTabLabels();
      expect(
        tabs.length,
        'Expected more than one entity tab on the Form Fields screen'
      ).toBeGreaterThan(1);
      expect(tabs, 'Expected the "Lead" tab to be present among the live tab labels').toContain(
        'Lead'
      );
      logger.success('FFL1 passed');
    });

    test('@smoke @prodSafe FFL2 admin should search the field list by internal name and see it filter correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.open();
      await configPage.searchField(TEXT_FIELD_INTERNAL_NAME);
      // WHY openFieldForEdit() succeeding is itself the proof search
      // narrowed correctly: it clicks the one row matching this internal
      // name and asserts real navigation to that field's edit page — a
      // search that failed to narrow the list (or matched the wrong row)
      // would fail this same assertion with a clear, specific error.
      await configPage.openFieldForEdit(TEXT_FIELD_INTERNAL_NAME);
      logger.success('FFL2 passed');
    });

    test("@smoke @prodSafe FFL3 admin should open an individual custom field's edit page from the list", async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      const snapshot = await configPage.readFieldConfigFresh(TEXT_FIELD_INTERNAL_NAME);
      expect(
        typeof snapshot.min,
        'Expected the field edit page to expose real Min Length control state'
      ).toBe('string');
      expect(
        typeof snapshot.maxDisabled,
        'Expected the field edit page to expose real Max Length disabled-state'
      ).toBe('boolean');
      logger.success('FFL3 passed');
    });
  }); // end describe('Navigation')

  // ─── Text field character-length limits ─────────────────────────────
  // WHY .serial here (and in every subsequent describe block below):
  // every test in this block mutates cfTextField's shared min/max
  // configuration — this file's own top-of-file comment has the full
  // reasoning for why the file is split into per-field blocks like this
  // one instead of one file-wide block, and why the split is still safe.

  test.describe('Text field limits', () => {

    test('@regression FFL4 admin should set a min/max character limit on the Text field and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: String(TEXT_MIN), max: String(TEXT_MAX) },
        'Text field'
      );
      logger.success('FFL4 passed');
    });



    test('@regression FFL6 typing exactly the minimum allowed characters in the Text field is accepted when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN);
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFL6 passed');
    });



    test('@regression FFL8 typing too many characters in the Text field is rejected when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value: generateLeadCustomFieldInvalidTextField(TEXT_MAX),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL8 Add Lead — Text over max');
      logger.success('FFL8 passed');
    });

    test('@regression FFL9 typing too few characters in the Text field is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value: repeatChar(TEXT_REPEAT_CHAR, TEXT_MIN - 1),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL9 Edit Lead — Text under min');
      logger.success('FFL9 passed');
    });



    test('@regression FFL11 typing exactly the maximum allowed characters in the Text field is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        TEXT_FIELD_INTERNAL_NAME,
        String(TEXT_MIN),
        String(TEXT_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFL11 passed');
    });


  }); // end describe('Text field limits')

  // ─── Number field digit-count limits ─────────────────────────────────

  test.describe('Number field limits', () => {

    test('@regression FFL13 admin should set a min/max digit limit on the Number field and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await configPage.assertFieldConfigMatches(
        NUMBER_FIELD_INTERNAL_NAME,
        { min: String(NUMBER_MIN), max: String(NUMBER_MAX) },
        'Number field'
      );
      logger.success('FFL13 passed');
    });



    test('@regression FFL15 typing exactly the minimum allowed digits in the Number field is accepted when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN);
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFL15 passed');
    });



    test('@regression FFL17 typing too many digits in the Number field is rejected when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX + 1),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL17 Add Lead — Number over max');
      logger.success('FFL17 passed');
    });

    test('@regression FFL18 typing too few digits in the Number field is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MIN - 1),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL18 Edit Lead — Number under min');
      logger.success('FFL18 passed');
    });



    test('@regression FFL20 typing exactly the maximum allowed digits in the Number field is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(NUMBER_MIN),
        String(NUMBER_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      const value = repeatChar(NUMBER_REPEAT_CHAR, NUMBER_MAX);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value,
        'Number field'
      );
      logger.success('FFL20 passed');
    });



    // WHY this test exists as a real regression assertion, not just left as
    // a retracted investigation finding: FORM_FIELD_LIMIT_INVESTIGATION_
    // FOLLOWUP.md §4 fully resolved the original "stuck error" finding as a
    // false positive — the field's own validation was correct all along; a
    // genuinely-corrected value clears the error and saves normally. This
    // test proves that resolution as living, ongoing coverage rather than
    // leaving it as prose in a markdown file no future run ever re-checks.

  }); // end describe('Number field limits')

  // ─── Paragraph field character-length limits ─────────────────────────

  test.describe('Paragraph field limits', () => {

    test('@regression FFL23 admin should set a min/max character limit on the Paragraph field and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await configPage.assertFieldConfigMatches(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: String(PARAGRAPH_MIN), max: String(PARAGRAPH_MAX) },
        'Paragraph field'
      );
      logger.success('FFL23 passed');
    });

    test('@regression FFL24 typing too few characters in the Paragraph field is rejected when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN - 1),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL24 Add Lead — Paragraph under min');
      logger.success('FFL24 passed');
    });



    test('@regression FFL26 typing exactly the maximum allowed characters in the Paragraph field is accepted when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MAX);
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFL26 passed');
    });





    test('@regression FFL29 typing exactly the minimum allowed characters in the Paragraph field is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      const value = repeatChar(PARAGRAPH_REPEAT_CHAR, PARAGRAPH_MIN);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value,
        'Paragraph field'
      );
      logger.success('FFL29 passed');
    });



    test('@regression FFL31 typing too many characters in the Paragraph field is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        String(PARAGRAPH_MIN),
        String(PARAGRAPH_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.paragraphText,
        value: generateLeadCustomFieldInvalidParagraphText(PARAGRAPH_MAX),
      });
      await assertInlineErrorPresent(leadsPage, 'FFL31 Edit Lead — Paragraph over max');
      logger.success('FFL31 passed');
    });
  }); // end describe('Paragraph field limits')

  // ─── Format rules (Regex) — Text field ────────────────────────────────
  // WHY this group also covers "Regex mechanism tests" further below
  // (FFL49-51, config-page-only): both sections mutate cfTextField's
  // Regex setting, so they stay in the SAME serial block as each other —
  // the split boundary is drawn at the FIELD level (this whole block vs.
  // "Text field limits" above), not further, since these two sections are
  // already contiguous in this file and splitting them further would
  // require reordering tests, which this restructuring deliberately does
  // not do.

  test.describe('Text field format rules (Regex)', () => {
    // WHY 5 options fully covered (not just a subset), each with its own
    // configure+valid+invalid triple: per explicit scope requirement — every
    // real, non-default option confirmed in FORM_FIELD_LIMIT_INVESTIGATION.md
    // §2.7's live-confirmed table gets proven coverage, not an assumed
    // extrapolation from the 1-2 options that happened to be spot-checked
    // during investigation. Every valid/invalid value below is generated by
    // leadFactory.ts's own shape-aware generators (never a hardcoded
    // literal) and, per the hard-rule directive, cross-checked against the
    // pattern actually read live off the config page before use.

    // WHY cross-checking the generated value against the pattern read LIVE
    // off the config page, not just trusting the generator (per the explicit
    // "prove it, don't assume" requirement): the generator encodes this
    // codebase's own understanding of each pattern's shape, captured at
    // investigation time — reading the pattern fresh and testing against it
    // here catches the (unlikely but real) case where the app's own pattern
    // has since been corrected or changed, failing loudly and specifically
    // rather than silently asserting against a stale assumption.
    //
    // WHY this re-opens the field's edit page itself, rather than trusting
    // the caller is already on it: configureFieldRegex() ends with submit(),
    // which navigates back to the list page (FormFieldsConfigPage.ts's own
    // submit() — this is a real, load-bearing navigation, not incidental) —
    // the pattern/example text this function reads only exists on the
    // field's OWN edit page, so every caller needs this fresh re-open
    // regardless of having just configured the same field seconds earlier.
    async function assertGeneratedValueMatchesLivePattern(
      configPage: FormFieldsConfigPage,
      internalName: string,
      value: string,
      shouldMatch: boolean,
      description: string
    ): Promise<void> {
      await configPage.openFieldForEdit(internalName);
      const { pattern } = await configPage.getRegexPatternInfo();
      const actuallyMatches = new RegExp(pattern).test(value);
      expect(
        actuallyMatches,
        `Expected generated value "${value}" to ${shouldMatch ? '' : 'NOT '}match the live pattern ` +
          `"${pattern}" for ${description}, but it ${actuallyMatches ? 'did' : 'did not'}`
      ).toBe(shouldMatch);
    }

    // WHY FFL32/35/38/41/44 (the "configure + verify persists" test for each
    // option) is its own test, separate from the valid/invalid create tests
    // below — explicit scope requirement: do not compress config-verification
    // and enforcement-verification into one test, even though the original,
    // narrower 3-option coverage had briefly combined them.
    test('@regression FFL32 admin sets the Text field format to PAN Card and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'PAN Card' },
        'Text field'
      );
      logger.success('FFL32 passed');
    });





    test('@regression FFL35 admin sets the Text field format to Email and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Email' },
        'Text field'
      );
      logger.success('FFL35 passed');
    });



    test('@regression FFL38 admin sets the Text field format to Driving Licence and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Driver Licence' },
        'Text field'
      );
      logger.success('FFL38 passed');
    });



    test('@regression FFL40 an invalid Driving Licence value is rejected when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Driver Licence'
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL40 Add Lead — invalid Driver Licence');
      logger.success('FFL40 passed');
    });

    test('@regression FFL41 admin sets the Text field format to Voting Card and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Voting Card' },
        'Text field'
      );
      logger.success('FFL41 passed');
    });

    test('@regression FFL42 a valid Voting Card value is accepted when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        true,
        'Voting Card'
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFL42 passed');
    });



    test('@regression FFL44 admin sets the Text field format to Passport and it saves correctly', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { regexLabel: 'Passport' },
        'Text field'
      );
      logger.success('FFL44 passed');
    });



    test('@regression FFL46 an invalid Passport value is rejected when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'Passport'
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL46 Add Lead — invalid Passport');
      logger.success('FFL46 passed');
    });

    // WHY only ONE option (PAN Card) gets a representative update pair,
    // rather than repeating this for all 5: FORM_FIELD_LIMIT_INVESTIGATION.md
    // §2.7 already confirmed create/update behave identically for regex
    // (same inline error, same paginated banner, same client-side block) —
    // one full create+update pair proves that equivalence; repeating it per
    // option would prove nothing new (per the original design doc's own
    // stated reasoning, not overridden by the regex-coverage expansion).


    test('@regression FFL48 an invalid PAN number is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const value = generateInvalidPanCardValue();
      await assertGeneratedValueMatchesLivePattern(
        configPage,
        TEXT_FIELD_INTERNAL_NAME,
        value,
        false,
        'PAN Card'
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL48 Edit Lead — invalid PAN Card');
      logger.success('FFL48 passed');
    });

    // ─── Regex mechanism tests (config-page-only, no Lead form involved) ──

    test('@regression FFL49 choosing a fixed format (PAN Card) automatically locks and fills in the min/max length fields', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      // WHY re-opening the field's edit page here: configureFieldRegex()
      // ends with submit(), which navigates back to the list page — the
      // pattern-info panel this test reads only exists on the field's own
      // edit page.
      await configPage.openFieldForEdit(TEXT_FIELD_INTERNAL_NAME);
      // WHY the expected min/max aren't hardcoded "10"/"10" here: derived
      // instead from the live pattern's own confirmed shape (5 letters + 4
      // digits + 1 letter = 10 characters) read fresh off the config page —
      // per the hard-rule directive, never assumed from investigation notes.
      const { pattern } = await configPage.getRegexPatternInfo();
      const impliedLength = String(
        Array.from(pattern.matchAll(/\{(\d+)\}/g)).reduce((sum, m) => sum + Number(m[1]), 0)
      );
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: impliedLength, max: impliedLength, minDisabled: true, maxDisabled: true },
        'Text field (PAN Card)'
      );
      logger.success('FFL49 passed');
    });

    test('@regression FFL50 choosing Email format leaves the min/max length fields open for editing', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { minDisabled: false, maxDisabled: false },
        'Text field (Email)'
      );
      logger.success('FFL50 passed');
    });

    test('@regression FFL51 switching back to "No Format" unlocks the min/max length fields but does not clear their values', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'PAN Card');
      const lockedSnapshot = await configPage.readFieldConfigFresh(TEXT_FIELD_INTERNAL_NAME);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'No Regex');
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        {
          minDisabled: false,
          maxDisabled: false,
          min: lockedSnapshot.min,
          max: lockedSnapshot.max,
        },
        'Text field (No Regex, after PAN Card)'
      );
      logger.success('FFL51 passed');
    });

    // WHY FFL56-64 added 2026-09-23 (final cleanup pass, explicit
    // instruction): backfills Lead's Regex coverage to full 5-format parity
    // — PAN Card already had valid+invalid × create+edit coverage (FFL33/34/
    // 47/48, moved to the RBAC file's restricted-role block plus FFL48
    // here); Email/Driver Licence/Voting Card/Passport each only had
    // partial coverage until now. Email's own "valid value accepted" test
    // was previously omitted out of caution (a load-dependent create-POST
    // timeout was once traced to a random-domain email value) — included
    // here using the already-hardened generator (a fixed, real
    // `example.com` domain, never a random one), matching the same
    // reasoning already applied when this exact gap was closed for Company
    // onward.
    test('@regression FFL56 admin should confirm a valid Email value is accepted when creating a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(leadsPage, leadId, LEAD_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFL56 passed');
    });

    test('@regression FFL57 admin should confirm a valid Email value is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateValidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Email');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(leadsPage, leadId, LEAD_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFL57 passed');
    });

    test('@regression FFL58 admin should confirm an invalid Email value is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Email');
      const value = generateInvalidEmailFormatValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Email');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL58 Edit Lead — invalid Email');
      logger.success('FFL58 passed');
    });

    test('@regression FFL59 admin should confirm a valid Driver Licence value is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateValidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Driver Licence');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(leadsPage, leadId, LEAD_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFL59 passed');
    });

    test('@regression FFL60 admin should confirm an invalid Driver Licence value is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Driver Licence');
      const value = generateInvalidDriverLicenceValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Driver Licence');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL60 Edit Lead — invalid Driver Licence');
      logger.success('FFL60 passed');
    });

    test('@regression FFL61 admin should confirm a valid Voting Card value is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateValidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Voting Card');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(leadsPage, leadId, LEAD_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFL61 passed');
    });

    test('@regression FFL62 admin should confirm an invalid Voting Card value is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Voting Card');
      const value = generateInvalidVotingCardValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Voting Card');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL62 Edit Lead — invalid Voting Card');
      logger.success('FFL62 passed');
    });

    test('@regression FFL63 admin should confirm a valid Passport value is accepted when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateValidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, true, 'Passport');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await updateLeadExpectingAccept(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(leadsPage, leadId, LEAD_FORM_FIELD_LIMIT_NAMES.textField, value, 'Text field');
      logger.success('FFL63 passed');
    });

    test('@regression FFL64 admin should confirm an invalid Passport value is rejected when editing a lead', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldRegex(TEXT_FIELD_INTERNAL_NAME, 'Passport');
      const value = generateInvalidPassportValue();
      await assertGeneratedValueMatchesLivePattern(configPage, TEXT_FIELD_INTERNAL_NAME, value, false, 'Passport');
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      const lastName = faker.person.lastName();
      const leadId = await createBareLead(leadsPage, lastName);
      await openEditLeadFormExpectingRejection(leadsPage, leadId, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertInlineErrorPresent(leadsPage, 'FFL64 Edit Lead — invalid Passport');
      logger.success('FFL64 passed');
    });
  }); // end describe('Text field format rules (Regex)')

  // ─── Cache behavior ────────────────────────────────────────────────────
  // WHY its own serial block, separate from "Number field limits" above,
  // even though both mutate cfNumber: narrower failure blast radius (see
  // this file's top-of-file comment) — safe because formFieldsTestLock.ts's
  // lock, not block grouping, is what actually prevents these two blocks'
  // tests from ever executing concurrently against the same field.

  test.describe('Cache behavior', () => {

    // WHY two deliberately non-overlapping digit-count ranges, not the same
    // range reused from the main Number-field test block above: a value
    // needs to be genuinely valid under ONE configuration and genuinely
    // invalid under the OTHER for this test to prove staleness specifically
    // — reusing the same range for both configurations would leave no value
    // capable of discriminating "which configuration is actually active."
    const CACHE_TEST_STALE_MIN = 3;
    const CACHE_TEST_STALE_MAX = 6;
    const CACHE_TEST_FRESH_MIN = 8;
    const CACHE_TEST_FRESH_MAX = 12;
    // WHY CACHE_TEST_FRESH_MIN itself, not CACHE_TEST_STALE_MAX + 1 (real,
    // confirmed bug, found 2026-09-21 — this exact constant, not backend
    // load, was FFL53's true root cause): the original value (7) genuinely
    // satisfies "invalid under stale" (7 > 6) but was WRONGLY assumed to
    // also satisfy "valid under fresh" — 7 is actually BELOW
    // CACHE_TEST_FRESH_MIN (8), so it's invalid under BOTH configs, not
    // discriminating at all. Confirmed live: with 7 digits, the app's own
    // client-side inline validation correctly rejects it under the fresh
    // 8–12 config too, so Save never fires a network request — the create-
    // POST FFL53 waits for was never going to arrive, misclassified by
    // saveLead() as a transient backend error and retried 3x, each attempt
    // burning a full 60s wait, reproducing 100% deterministically regardless
    // of real backend load (confirmed via 3x isolated --workers=1 re-runs
    // after a cooldown period). CACHE_TEST_FRESH_MIN (8) is the smallest
    // value that is simultaneously invalid under stale (8 > 6) AND valid
    // under fresh (8 is within [8, 12]) — the correct discriminating value.
    const CACHE_TEST_DISCRIMINATING_DIGITS = CACHE_TEST_FRESH_MIN;

    test('@regression FFL52 a new limit is not applied on the lead form until the cache is cleared', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_STALE_MIN),
        String(CACHE_TEST_STALE_MAX)
      );
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      // WHY this one open-and-close is needed before reconfiguring: it's
      // what actually populates the cache with the stale (3–6) config in the
      // first place — confirmed live (follow-up doc §1.6) the layout is
      // fetched lazily, on first need, not eagerly on page load.
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_STALE_MIN),
      });
      await leadsPage.assertNoFormErrors('FFL52 seed Add Lead');
      // WHY NOT clearing the cache here: this is the exact behavior under
      // test — the cache is deliberately left stale after this
      // reconfiguration.
      await configPage.configureFieldLimit(
        NUMBER_FIELD_INTERNAL_NAME,
        String(CACHE_TEST_FRESH_MIN),
        String(CACHE_TEST_FRESH_MAX)
      );
      await leadsPage.goToLeadsList();
      await openLeadFormExpectingRejection(leadsPage, faker.person.lastName(), {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.number,
        value: repeatChar(NUMBER_REPEAT_CHAR, CACHE_TEST_DISCRIMINATING_DIGITS),
      });
      await assertInlineErrorPresent(
        leadsPage,
        'FFL52 Add Lead — stale cache should still enforce the old 3–6 digit range'
      );
      logger.success('FFL52 passed');
    });


  }); // end describe('Cache behavior')

  // ─── Cleanup ────────────────────────────────────────────────────────
  // WHY its own serial block even though it mutates all 3 shared fields
  // (Text/Number/Paragraph, touching every other block's own field): safe
  // for the same reason as every other split above — formFieldsTestLock.ts's
  // lock provides real mutual exclusion regardless of which describe block
  // a test sits in, so Cleanup racing a DIFFERENT block's test is
  // structurally prevented by the lock, not by shared .serial grouping.

  test.describe('Cleanup', () => {

    test('@regression FFL54 after the test run, all field settings are reset back to blank', async ({
      adminPage,
    }) => {
      // WHY: see FFL1's own WHY comment — every lock-participating test needs
      // this same extended timeout, regardless of what it does internally.
      // This specific test is the one that was actually caught hanging for
      // the full local-default 480000ms ceiling (2026-09-21, real
      // --workers=2 run) while holding the lock with no explicit timeout of
      // its own — the direct trigger for this sweep.
      test.setTimeout(480000);
      await clearAllFieldConfigurations(adminPage);
      const configPage = new FormFieldsConfigPage(adminPage, LEAD_ENTITY);
      await configPage.assertFieldConfigMatches(
        TEXT_FIELD_INTERNAL_NAME,
        { min: '', max: '', regexLabel: 'No Regex' },
        'Text field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        NUMBER_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Number field (post-cleanup)'
      );
      await configPage.assertFieldConfigMatches(
        PARAGRAPH_FIELD_INTERNAL_NAME,
        { min: '', max: '' },
        'Paragraph field (post-cleanup)'
      );
      logger.success('FFL54 passed');
    });

    test('@regression FFL55 after cleanup, a value that was previously rejected is now accepted again, confirming the limit is truly gone', async ({
      adminPage,
    }) => {
      test.setTimeout(480000);
      // WHY this test doesn't depend on FFL54 having already run (test
      // independence): it re-runs the same clear itself rather than trusting
      // declaration order, even though serial mode happens to guarantee that
      // order today.
      await clearAllFieldConfigurations(adminPage);
      await clearLeadApplicationCache(adminPage);
      const leadsPage = new LeadsPage(adminPage);
      await leadsPage.goToLeadsList();
      // WHY this exact value: TEXT_MAX + 5 characters was confirmed
      // rejected earlier in this file (FFL8) while that limit was active —
      // using the same construction here, now against a genuinely blank
      // configuration, directly proves the earlier rejection was caused by
      // the limit and nothing else.
      const value = repeatChar(TEXT_REPEAT_CHAR, TEXT_MAX + 5);
      const lastName = faker.person.lastName();
      const leadId = await createLeadExpectingAccept(leadsPage, lastName, {
        fieldName: LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
      });
      await assertCustomFieldPersistedOnDetail(
        leadsPage,
        leadId,
        LEAD_FORM_FIELD_LIMIT_NAMES.textField,
        value,
        'Text field'
      );
      logger.success('FFL55 passed');
    });
  }); // end describe('Cleanup')
});
