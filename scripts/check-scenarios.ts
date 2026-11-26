/**
 * Scenario matrix for the reporting logic (2026-11-24): about 40 described runs go through the REAL pipeline (selection, combine, parser,
 * history, verdict, health, subject, HTML), and the same invariants are asserted on every one, from a reader's point of view: the numbers
 * agree everywhere, a failure is never green, flaky tests stay visible, a run where nothing ran never claims a pass rate, and the email
 * stays small enough for Gmail. Each scenario is also rendered to HTML so it can be read in a browser.
 *
 *   npm run check:scenarios                       checks, prints the matrix
 *   npx ts-node scripts/check-scenarios.ts --out ~/build235-render/scenarios     also writes <name>.html, index.html, matrix.md
 *
 * An invariant that fails on something this suite has already found and the maintainer has not decided on yet is listed as KNOWN (with
 * the reason) and does not fail the run; every other violation fails it. Remove an entry from KNOWN when its fix lands.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTimesViolations } from '../src/notifications/RunTimes';
import { buildCapacityView, capacityBlock } from '../src/notifications/AccountCapacity';
import { capacityColour } from '../src/modules/billing/capacity';
import { RenewalFailure } from '../src/auth/renewalFailure';
import { DONUT_CID, EmailTemplate } from '../src/notifications/EmailTemplate';
import { FLAKY_BUDGET } from '../src/notifications/AutomationHealth';
import { RETRY, infoSwatch } from '../src/notifications/EmailPalette';
import { Def, SKIP_REASON_TEXT, ScenarioResult, ScenarioSpec, def, many, runScenario } from './lib/scenarioKit';
import { replayBuild235 } from './lib/build235Fixture';

// ── the matrix ─────────────────────────────────────────────────────────────────────────────────────────────────
const base = (n: number): Def[] => many(n, 'passed', 'base check', 'ui/base/base.spec.ts', 10);
const Q = 'ui/quotations/quotations.spec.ts';
const FF = 'ui/formFields/leadFieldLimits.spec.ts';
const renewal: RenewalFailure = {
  version: 1, role: 'admin', kind: 'not-renewed-after-logout', minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240,
  sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z',
};
const dec = (failing: string[]) => (title: string): 'passed' | 'failed' => (failing.includes(title) ? 'failed' : 'passed');

export const SCENARIOS: ScenarioSpec[] = [
  { name: '01-all-pass-first-time', title: 'All tests pass first time', expect: 'green PASSED, nothing else to say', first: base(30), rerun: true },
  { name: '02-flaky-only-rerun-passes', title: 'Only flaky tests; the rerun passes them', expect: 'no failure; flaky stay visible; see the green-or-amber question in the report', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true },
  { name: '03-flaky-only-rerun-fails-one', title: 'Only flaky tests; one fails on the rerun', expect: 'still no failure (it passed on its in-job retry); amber', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true, rerunResult: dec(['flaky 02']) },
  { name: '04-flaky-only-no-rerun', title: 'Only flaky tests; no rerun (kill switch / other branch)', expect: 'amber, flaky visible', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: false },
  { name: '05-failures-pass-on-rerun', title: 'Two failures; both pass on the rerun', expect: 'no failure left, but amber (they failed every first attempt)', first: [...base(25), ...many(2, 'failed', 'broken')], rerun: true },
  { name: '06-failures-fail-again', title: 'Two failures; both fail on the rerun', expect: 'red FAILED, 2 failed', first: [...base(25), ...many(2, 'failed', 'broken')], rerun: true, rerunResult: () => 'failed' },
  { name: '07-failures-mixed', title: 'Three failures; one passes on the rerun, two fail', expect: 'red, 2 failed, 1 passed on rerun', first: [...base(25), ...many(3, 'failed', 'broken')], rerun: true, rerunResult: dec(['broken 02', 'broken 03']) },
  { name: '08-failures-plus-flaky', title: 'Failures plus flaky tests (flaky not rerun because failures exist, like build #235)', expect: 'red; flaky inside Passed', first: [...base(25), ...many(2, 'failed', 'broken'), ...many(3, 'flaky', 'flaky')], rerun: true, rerunResult: dec(['broken 02']) },
  { name: '09-serial-file-failure', title: 'A failed test inside a serial file (the whole file is rerun)', expect: 'dependents did not run, then ran only on the rerun', first: [...base(20), def(Q, 'q0 passes', 4, 'passed'), def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run'), def(Q, 'q3 dependent', 7, 'did-not-run')], rerun: true },
  { name: '10-serial-file-failure-fails-again', title: 'A failed test inside a serial file; it fails again', expect: 'red; dependents fail too', first: [...base(20), def(Q, 'q0 passes', 4, 'passed'), def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run')], rerun: true, rerunResult: () => 'failed' },
  { name: '11-formfields-failure-never-rerun', title: 'A formFields failure (never rerun)', expect: 'red; the table says it was not rerun', first: [...base(25), def(FF, 'ff limit rejected', 3, 'failed')], rerun: true },
  { name: '12-skipped-with-reason', title: 'Skipped tests with a reason', expect: 'green; the reason is shown', first: [...base(25), ...many(2, 'skip-reason', 'skipped with reason', 'ui/skips/skips.spec.ts', 10)], rerun: true },
  { name: '13-skipped-without-reason', title: 'Skipped tests without a reason', expect: 'green; "No reason given"', first: [...base(25), ...many(2, 'skip-no-reason', 'skipped bare', 'ui/skips/skips.spec.ts', 10)], rerun: true },
  { name: '14-did-not-run-no-rerun', title: 'Tests that did not run (cut-off shard), no rerun', expect: 'amber, never green', first: [...base(20), ...many(3, 'cut-off', 'cut off')], rerun: false },
  { name: '15-did-not-run-rerun-passes', title: 'Tests that did not run; they pass on the rerun', expect: 'amber ("ran only on rerun")', first: [...base(20), ...many(3, 'cut-off', 'cut off')], rerun: true },
  { name: '16-incomplete-shard-crashed', title: 'Incomplete run: one of five shards crashed', expect: 'red INCOMPLETE; no pass-rate claim', first: [...base(18), ...many(2, 'failed', 'broken')], rerun: false, completeness: { expected: 5, reported: 4 } },
  { name: '17-incomplete-shard-timed-out', title: 'Incomplete run: three of five shards reported (two timed out)', expect: 'red INCOMPLETE; no pass-rate claim', first: base(12), rerun: false, completeness: { expected: 5, reported: 3 } },
  { name: '18-blocked-by-renew-session', title: 'Blocked by renew-session: no test job started', expect: 'red BLOCKED naming renew-session; no pass-rate claim', first: [], rerun: false, completeness: { expected: 5, reported: 0, cause: 'renew-session:failure' }, renewalFailure: renewal },
  { name: '19-infra-failure-no-report', title: 'Infra failure (browser install): no results file, no test ran', expect: 'report-unavailable alert, never a pass', first: [], noResults: true, unavailableReason: 'Report not found: reports/playwright-report/results.json', completeness: { expected: 5, reported: 0 } },
  { name: '20-zero-tests-selected', title: '0 tests selected (an empty sandbox selection)', expect: 'must not read as a pass', first: [], rerun: false },
  { name: '22-flaky-above-budget', title: 'Four flaky tests (budget is 3); the rerun is off', expect: 'amber: flaky above the budget; the subject names 4 flaky', first: [...base(25), ...many(4, 'flaky', 'flaky')], rerun: false },
  { name: '23-flaky-at-budget-plus-rerun-recovery', title: 'Three flaky tests plus one that failed every attempt and passed on the rerun (D2)', expect: 'amber because of the D2 test, not because of the flaky ones', first: [...base(25), ...many(3, 'flaky', 'flaky'), def('ui/d2/d2.spec.ts', 'd2 failing test', 5, 'failed')], rerun: true },
  { name: '24-flaky-at-budget-not-rerun-by-default', title: 'Three flaky tests; the flaky rerun is off by default (RERUN_INCLUDE_FLAKY=false)', expect: 'green, "(3 flaky)" in the subject; no rerun table', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true, includeFlaky: false },
  { name: '25-many-flaky-over-the-card-cap', title: 'Fourteen flaky tests and ten background-error groups; no rerun', expect: 'amber (above the flaky budget); a full card for every flaky test; background errors grouped', first: [...base(30), ...many(14, 'flaky', 'flaky', 'ui/flk/flk.spec.ts', 10)], rerun: false, unexpectedErrors: 60 },
  { name: '26-big-failure-cluster', title: 'Twenty failures with the same error message (one cluster)', expect: 'red; one full card for the cluster, the others one line each ("same cause")', first: [...base(30), ...many(20, 'failed', 'same cause', 'ui/same/same.spec.ts', 10)], rerun: true, rerunResult: () => 'failed' },
  { name: '21-very-bad-run', title: 'A very bad run: many failures, flaky tests and background errors (size)', expect: 'red; nothing is capped, so the size is only reported (it may pass Gmail\'s clip)', first: [...base(400), ...many(120, 'failed', 'broken', 'ui/bad/bad.spec.ts', 10), ...many(80, 'flaky', 'flaky', 'ui/flk/flk.spec.ts', 10)], rerun: true, maxTests: 60, unexpectedErrors: 790 },
  { name: '42-known-bug-tests', title: 'Three known-bug tests (test.fail()) fail as expected, one flaky test', expect: 'green or amber by the flaky budget; the 3 expected failures are Passed first time, never "failed first"', first: [...base(25), ...many(3, 'known-bug', 'known bug', 'rbac/known.rbac.spec.ts', 50), ...many(1, 'flaky', 'flaky')], rerun: true },
  { name: '43-run-and-test-times', title: 'Run and Tests lines: the attempts have their own start times, the workflow started 6 minutes before the first test', expect: 'Run: workflow start to the moment the email was generated; Tests: first attempt start to last attempt end (45 s after the shard process start); run start <= tests start <= tests end <= run end', first: [...base(30), ...many(2, 'flaky', 'flaky')], rerun: false, attemptTimes: true },
  { name: '44-run-start-first-job-fallback', title: 'The run endpoint could not be read: the run start falls back to the first job of the run', expect: 'the Run line says the start is the first job\'s and why', first: base(30), rerun: false, attemptTimes: true, runStart: { minutesBeforeTests: 5, source: 'github-first-job' } },
  { name: '45-run-start-unavailable-in-ci', title: 'CI run where no start time could be read', expect: 'the Run line says "start unavailable" instead of showing the tests window as the run; the Tests line is unchanged', first: base(30), rerun: false, attemptTimes: true, runStart: 'none' },
  { name: '46-jenkins-build-start', title: 'A Jenkins run: the build\'s own start', expect: 'Run starts at the Jenkins build start (RUN_STARTED_AT_MS), 12 minutes before the first test', first: base(30), rerun: false, attemptTimes: true, runSource: 'jenkins', branch: 'qa', env: 'qa', runStart: { minutesBeforeTests: 12 } },
  { name: '47-local-run-no-run-line', title: 'A local run has no workflow', expect: 'no Run line at all (nothing to show), only Tests', first: base(30), rerun: false, attemptTimes: true, runSource: 'local' },
  { name: '48-capacity-plenty', title: 'Account capacity: plenty left, three shards (the earliest pre-run snapshot and the latest post-run reading are used)', expect: 'green bars; records 78,311 of 300,000; +1,240 this run, labelled as possibly including other activity; Elevate green; no warning banner', first: base(30), rerun: false, capacity: { shards: 3, pre: {}, post: { recordsUsed: 79551, entityCounts: { LEAD: 16000, DEAL: 12496, CONTACT: 11365, COMPANY: 10026, TASK: 7811, CALL: 7590, QUOTATION: 7498, MEETING: 5582, NOTE: 561 } } } },
  { name: '49-capacity-under-threshold', title: 'Account capacity: under the threshold (3,800 records left of 300,000)', expect: 'records bar yellow "low", a yellow warning near the top; the run is not blocked', first: base(30), rerun: false, capacity: { pre: { recordsUsed: 295000 }, post: { recordsUsed: 296200 } } },
  { name: '50-capacity-at-zero-with-report', title: 'Account capacity: 0 records left, the gate stopped the run, a report still exists', expect: 'BLOCKED — NO RECORDS LEFT banner and subject; records bar red; no health score', first: base(30), rerun: false, capacity: { pre: { recordsUsed: 300000 } } },
  { name: '51-capacity-at-zero-no-report', title: 'Account capacity: 0 records left, no report at all (every shard stopped in globalSetup)', expect: 'the report-unavailable alert says BLOCKED — NO RECORDS LEFT and why', first: base(30), noResults: true, capacity: { pre: { recordsUsed: 300000 } } },
  { name: '52-capacity-read-only-at-zero', title: 'Account capacity: 0 records left but the run only reads (--grep @prodSafe)', expect: 'NOT blocked; a red warning "none left, but the run only reads"; records bar red', first: base(30), rerun: false, env: 'prod', branch: 'prod', capacity: { readOnlyRun: true, pre: { recordsUsed: 300000 }, post: { recordsUsed: 300000 } } },
  { name: '53-capacity-embark-found', title: 'Account capacity: the account is on Embark (1,000 records) instead of Elevate', expect: 'plan header red "expected plan Elevate, found Embark"; a red warning; no renewal ("none")', first: base(30), rerun: false, capacity: { pre: { plan: 'Embark', recordsTotal: 1000, recordsUsed: 400, customFieldsTotal: 5, customFieldsUsed: 1, renewalInDays: null, period: null } } },
  { name: '54-capacity-renewal-in-9-days', title: 'Account capacity: renewal within 14 days (9 days left)', expect: 'plan header yellow "renews in 9 days", a yellow RENEWAL warning', first: base(30), rerun: false, capacity: { pre: { renewalInDays: 9 }, post: {} } },
  { name: '55-capacity-renewal-passed', title: 'Account capacity: the renewal date has passed (3 days ago)', expect: 'plan header red "renewal date passed 3 days ago", a red RENEWAL warning', first: base(30), rerun: false, capacity: { pre: { renewalInDays: -3 }, post: {} } },
  { name: '56-capacity-unavailable', title: 'Account capacity: no snapshot reached the report', expect: 'one short line "Account capacity: data unavailable"; nothing else changes', first: base(30), rerun: false },
  { name: '57-capacity-no-post-run-reading', title: 'Account capacity: a pre-run snapshot but no post-run reading', expect: 'the bars show the account at the start; the change cells say n/a and the note says why', first: base(30), rerun: false, capacity: { pre: {} } },
  { name: '58-capacity-unreadable-stopped', title: 'Account capacity: the usage call failed and the run was stopped', expect: 'BLOCKED — ACCOUNT CAPACITY UNREADABLE; "unavailable" in the section with the reason', first: base(30), rerun: false, capacity: { error: { message: 'GET /v1/tenants/usage failed: HTTP 403 {"code":"001019"}', readOnlyRun: false } } },
  { name: '59-capacity-custom-fields-low', title: 'Account capacity: 5 custom fields left', expect: 'Custom Fields bar yellow, a yellow warning, never blocked', first: base(30), rerun: false, capacity: { pre: { customFieldsUsed: 120 }, post: { customFieldsUsed: 120 } } },
  { name: '60-every-module-incl-billing', title: 'Every kind of module in one run: Billing, Dashboard, Reports and formFields, UI and RBAC', expect: 'one row per module in Module Analytics, each on its own UI or RBAC side with its own test count (Billing UI 6 + RBAC 2, Dashboard UI 3 + RBAC 2, Reports UI 2 + RBAC 2, "Leads — Field Limits" UI 2 + RBAC 2)', first: [...many(6, 'passed', 'billing ui', 'ui/billing/billing.spec.ts'), ...many(2, 'passed', 'billing rbac', 'rbac/billing/billing.rbac.spec.ts', 200), ...many(3, 'passed', 'dashboard ui', 'ui/dashboard/dashboard.spec.ts', 300), ...many(2, 'passed', 'dashboard rbac', 'rbac/dashboard.rbac.spec.ts', 400), ...many(2, 'passed', 'reports ui', 'ui/reports/reports.spec.ts', 500), ...many(2, 'passed', 'reports rbac', 'rbac/reports.rbac.spec.ts', 600), ...many(2, 'passed', 'leads field limits ui', 'ui/formFields/leadFieldLimits.spec.ts', 700), ...many(2, 'passed', 'leads field limits rbac', 'rbac/formFields/leadFieldLimits.rbac.spec.ts', 800)], rerun: false, expectModules: [{ name: 'Billing', type: 'UI', total: 6 }, { name: 'Billing', type: 'RBAC', total: 2 }, { name: 'Dashboard', type: 'UI', total: 3 }, { name: 'Dashboard', type: 'RBAC', total: 2 }, { name: 'Reports', type: 'UI', total: 2 }, { name: 'Reports', type: 'RBAC', total: 2 }, { name: 'Leads — Field Limits', type: 'UI', total: 2 }, { name: 'Leads — Field Limits', type: 'RBAC', total: 2 }] },
];

// every branch with its environment (the deployment/PR advice differs by branch)
const BRANCHES: Array<{ branch: string; env: 'staging' | 'qa' | 'prod' }> = [
  { branch: 'sandbox', env: 'staging' }, { branch: 'dev', env: 'qa' }, { branch: 'qa', env: 'qa' },
  { branch: 'stage', env: 'staging' }, { branch: 'prod', env: 'prod' }, { branch: 'main', env: 'prod' },
  { branch: 'feature/ui-polish', env: 'staging' },
];
// one scenario per environment, with every colour in play (failures, retries, a rerun, a skip), and an environment the palette does not know (neutral slate)
const mixed = (): Def[] => [...base(20), ...many(2, 'failed', 'broken'), ...many(2, 'flaky', 'flaky'), ...many(1, 'skip-reason', 'skipped with reason', 'ui/skips/skips.spec.ts', 10)];
SCENARIOS.push(
  { name: '33-env-qa', title: 'QA: failures, retries, a rerun and a skip: the info colour is QA sky blue', expect: 'QA sky blue info tiles and ENV badge; yellow retry; green / red / slate status colours', env: 'qa', branch: 'dev', first: mixed(), rerun: true },
  { name: '34-env-staging', title: 'STAGING: the same run: the info colour is lavender', expect: 'lavender info tiles and ENV badge; the status colours are the same as in QA', env: 'staging', branch: 'sandbox', first: mixed(), rerun: true },
  { name: '35-env-prod', title: 'PROD: the same run: the info colour is a deeper blue', expect: 'deeper blue info tiles and ENV badge (white text); the status colours are the same as in QA', env: 'prod', branch: 'prod', first: mixed(), rerun: true },
  { name: '36-env-unknown', title: 'An environment the palette does not know: neutral slate', expect: 'slate info tiles and ENV badge; nothing breaks', env: 'local', branch: 'sandbox', first: mixed(), rerun: true },
);
for (const b of BRANCHES) {
  const id = b.branch.replace(/\//g, '-');
  SCENARIOS.push(
    { name: `32-${id}-needs-a-look`, title: `Branch ${b.branch} (${b.env}): 4 flaky tests, above the budget`, expect: 'amber; "likely ready" advice names the next step of this branch', env: b.env, branch: b.branch, first: [...base(26), ...many(4, 'flaky', 'flaky')], rerun: false },
    { name: `30-${id}-clean`, title: `Branch ${b.branch} (${b.env}): all pass`, expect: 'green; advice fits the branch', env: b.env, branch: b.branch, first: base(30), rerun: false },
    { name: `31-${id}-failures`, title: `Branch ${b.branch} (${b.env}): 2 failed, 2 flaky`, expect: 'red; advice fits the branch', env: b.env, branch: b.branch, first: [...base(26), ...many(2, 'failed', 'broken'), ...many(2, 'flaky', 'flaky')], rerun: false }
  );
}

// ── reading an email ────────────────────────────────────────────────────────────────────────────────────────────
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&rarr;/g, '->').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export interface Tile { value: string; sub: string }
export function tiles(html: string): Record<string, Tile> {
  const out: Record<string, Tile> = {};
  for (const chunk of html.split('<td style="width:').slice(1)) {
    const m = /^(\S+)\s+(Passed first time|Did not run|Total|Passed|Failed|Skipped|Flaky|Duration|Modules|Retries)\b\s*(.*)$/.exec(text(chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</td>'))));
    if (m && !out[m[2]]) out[m[2]] = { value: m[1], sub: m[3] };
  }
  return out;
}
export function execFirstLine(html: string): string {
  const m = /<div style="font-size:12\.5px;color:#424A53;line-height:1\.55;margin-top:4px;">([^<]*)<\/div>/.exec(html);
  return m ? text(m[1]) : '';
}
/** The Rerun Summary tiles (under the Run Summary tiles; only when a rerun ran): label -> { value, sub }. Null when the email has none. */
export function rerunTiles(html: string): Record<string, Tile> | null {
  const i = html.indexOf('id="section-rerun-summary"');
  if (i < 0) return null;
  const end = html.indexOf('</table>', i);
  const out: Record<string, Tile> = {};
  for (const chunk of html.slice(i, end).split('<td style="width:').slice(1)) {
    const m = /^(.+?)\s+(Rerun duration|Passed on rerun|Still failing|Not rerun|Rerun)\b\s*(.*)$/.exec(text(chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</td>'))));
    if (m) out[m[2]] = { value: m[1], sub: m[3] };
  }
  return out;
}
/** The per-test rows of the Rerun table: [title, first run, rerun, final]. */
export function rerunTestRows(html: string): string[][] {
  const i = html.indexOf('id="section-rerun"');
  if (i < 0) return [];
  const end = html.indexOf('\n<tr><td', i);
  const section = html.slice(i, end < 0 ? undefined : end);
  return [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])))
    .filter((c) => c.length === 4 && c[0] !== 'Test');
}
/** The outcome chart block: legend numbers, the image's alt text numbers (null when the image is absent), the bar's numbers and the "N% first time" figure. */
export interface ChartRead { legend: Record<string, number>; alt: number[] | null; bar: Record<string, number>; figure: number | null }
export function outcomeChart(html: string): ChartRead | null {
  const i = html.indexOf('id="section-outcome-chart"');
  if (i < 0) return null;
  const end = html.indexOf('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px', i);
  const block = html.slice(i, end < 0 ? undefined : end);
  const legend: Record<string, number> = {};
  for (const m of block.matchAll(/<span class="sw"[^>]*><\/span>(?:&nbsp;|\s)+([^<]+)<\/td><td[^>]*>(\d+)<\/td>/g)) legend[text(m[1])] = parseInt(m[2], 10);
  const alt = /alt="Outcome of (\d+) tests: (\d+) passed first time, (\d+) passed on retry, (\d+) passed on rerun, (\d+) failed, (\d+) skipped\. ([\d.]+)% passed first time\./.exec(block);
  const bar: Record<string, number> = {};
  const barHtml = end < 0 ? '' : html.slice(end, html.indexOf('</table>', end));
  for (const m of barHtml.matchAll(/title="([^":]+): (\d+)"/g)) bar[m[1]] = parseInt(m[2], 10);
  const fig = /font-weight:700;line-height:1;color:#[0-9A-Fa-f]{6};(?:margin-top:\d+px;)?">([\d.]+)%<\/div>/.exec(block);
  return { legend, alt: alt ? alt.slice(1, 7).map(Number) : null, bar, figure: fig ? parseFloat(fig[1]) : null };
}
/** The Background Errors tiles (Unexpected, Expected RBAC, Known noise) and the bar under them. */
export function errorTiles(html: string): { tiles: Record<string, number>; bar: Record<string, number> } | null {
  const i = html.indexOf('id="section-background-errors"');
  if (i < 0 || html.indexOf('<div class="tl"', i) < 0) return null;
  const end = html.indexOf('\n<tr><td', i + 10);
  const section = html.slice(i, end < 0 ? undefined : end);
  const tiles: Record<string, number> = {};
  for (const chunk of section.split('<td style="width:').slice(1)) {
    const m = /^(\d+)\s+(Unexpected|Expected RBAC|Known noise)\b/.exec(text(chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</td>'))));
    if (m) tiles[m[2]] = parseInt(m[1], 10);
  }
  const bar: Record<string, number> = {};
  for (const m of section.matchAll(/title="([^":]+): (\d+)"/g)) bar[m[1]] = parseInt(m[2], 10);
  return { tiles, bar };
}
/** The fill and text colour of each Run Summary / Rerun Summary / error tile, from its inline style (first occurrence of a label wins). */
export function tileStyles(html: string): Record<string, { fill: string; text: string }> {
  const out: Record<string, { fill: string; text: string }> = {};
  for (const chunk of html.split('<td style="width:').slice(1)) {
    const style = chunk.slice(0, chunk.indexOf('"'));
    const label = />([^<]+)<\/div>\s*(?:<div class="ts"|<\/td>|$)/.exec(chunk.slice(0, chunk.indexOf('</td>')))?.[1];
    const fill = /background:(#[0-9A-Fa-f]{6})/.exec(style)?.[1];
    const textc = /;color:(#[0-9A-Fa-f]{6});?$/.exec(style)?.[1] ?? /color:(#[0-9A-Fa-f]{6});?$/.exec(style)?.[1];
    if (label && fill && textc && !out[label.trim()]) out[label.trim()] = { fill: fill.toUpperCase(), text: textc.toUpperCase() };
  }
  return out;
}
/** Every tag with its attributes sorted (and class tokens sorted): two HTML strings that differ only in attribute order compare equal. */
export function normalizeTags(html: string): string {
  return html.replace(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>/g, (_m, tag: string, attrs: string) => {
    const list = [...attrs.matchAll(/\s+([a-zA-Z-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[0].includes('=') ? a[2] : null] as const);
    const norm = list.map(([k, v]) => (k === 'class' && v ? `class="${v.split(/\s+/).sort().join(' ')}"` : v === null ? k : k === 'style' ? `style="${v.replace(/;\s*$/, '')}"` : `${k}="${v}"`)).sort();
    return `<${tag}${norm.length ? ' ' + norm.join(' ') : ''}>`;
  });
}

/** The all-modules table: per entity, the UI and RBAC cells as numbers (null for a missing side), and each cell's background. */
export interface ModuleRow { name: string; UI: number[] | null; RBAC: number[] | null; bgs: string[] }
export function allModulesTable(html: string): ModuleRow[] | null {
  const i = html.indexOf('id="all-modules"');
  if (i < 0) return null;
  const end = html.indexOf('</table>', html.indexOf('<table', i));
  const rows: ModuleRow[] = [];
  for (const tr of html.slice(i, end).split('<tr style="border-bottom').slice(1)) {
    const cells = [...tr.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/g)].map((c) => ({ attrs: c[1], t: text(c[2]) }));
    const name = cells[0].t;
    const rest = cells.slice(1);
    const side = (): number[] | null => {
      if (rest[0] && /colspan="7"/.test(rest[0].attrs)) { rest.shift(); return null; }
      const seven = rest.splice(0, 7); // tests, first, retry, rerun, failed, skipped, then the stability text
      return seven.slice(0, 6).map((c) => parseInt(c.t, 10));
    };
    const bgs: string[] = [];
    for (const c of cells.slice(1)) bgs.push(/background:(#[0-9A-Fa-f]{6})/.exec(c.attrs)?.[1]?.toUpperCase() ?? '');
    rows.push({ name, UI: side(), RBAC: side(), bgs });
  }
  return rows;
}
export interface ExpectedModule { name: string; type: 'UI' | 'RBAC'; total: number }
/**
 * The modules a run's spec files belong to, from the file paths alone (independent of ReportParser.deriveModuleFromFile, so a parser that
 * drops or misnames a module cannot hide behind itself). formFields files are not derived (their module is the entity in the file name):
 * list them explicitly in the scenario's `expectModules`.
 */
export function expectedModulesFromDefs(defs: Def[]): ExpectedModule[] {
  const out = new Map<string, ExpectedModule>();
  for (const d of defs) {
    const m = /^(?:tests\/)?(ui|rbac)\/([^/]+)/.exec(d.file);
    if (!m) continue;
    const seg = m[2].replace(/\.(rbac\.)?spec\.ts$/, '');
    if (seg.toLowerCase() === 'formfields') continue;
    const type = m[1] === 'ui' ? 'UI' : 'RBAC';
    const key = `${type}:${seg.toLowerCase()}`;
    const cur = out.get(key) ?? { name: seg, type: type as 'UI' | 'RBAC', total: 0 };
    cur.total += 1;
    out.set(key, cur);
  }
  return [...out.values()];
}
/**
 * Every module present in a run's results is a row of the Module Analytics "all modules" table, on the right side (UI or RBAC), with the run's own
 * test count for that side, and no row appears that the run does not have (unless `allowExtra`). Returns what is wrong; [] when it holds.
 */
export function moduleCoverageViolations(html: string, expected: ExpectedModule[], opts: { allowExtra?: boolean } = {}): string[] {
  const rows = allModulesTable(html);
  if (!rows) return ['the all-modules table is missing'];
  const out: string[] = [];
  const lower = (n: string): string => n.toLowerCase();
  for (const e of expected) {
    const row = rows.find((x) => lower(x.name) === lower(e.name));
    if (!row) { out.push(`${e.type} ${e.name} is in the results but has no row`); continue; }
    const side = row[e.type];
    if (!side) out.push(`${e.name}: the ${e.type} side is missing from its row`);
    else if (side[0] !== e.total) out.push(`${e.name} ${e.type}: the row says ${side[0]} tests, the results have ${e.total}`);
  }
  if (!opts.allowExtra) for (const row of rows) if (!expected.some((e) => lower(e.name) === lower(row.name))) out.push(`the row "${row.name}" is not in the results`);
  return out;
}
export interface RerunRow { first: number; final: number; note: string }
export function rerunTable(html: string): Record<string, RerunRow> | null {
  const i = html.indexOf('id="section-rerun"');
  if (i < 0) return null;
  const end = html.indexOf('\n<tr><td', i);
  const section = html.slice(i, end < 0 ? undefined : end);
  const rows: Record<string, RerunRow> = {};
  for (const m of section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
    if (cells.length === 3 && /^(Passed|Failed|Flaky|Skipped|Did not run|Total)$/.test(cells[0])) {
      const fin = /^(\d+)\s*(.*)$/.exec(cells[2]);
      rows[cells[0]] = { first: parseInt(cells[1], 10), final: fin ? parseInt(fin[1], 10) : NaN, note: fin?.[2] ?? '' };
    }
  }
  return Object.keys(rows).length > 0 ? rows : null;
}
export function rerunNotes(html: string): string {
  const t = rerunTable(html);
  const notRerun = /(\d+) failed\/flaky test\(s\) were not rerun[^:]*:/.exec(text(html));
  const notes = t ? Object.entries(t).filter(([, r]) => r.note).map(([k, r]) => `${k}: ${r.note}`) : [];
  if (notRerun) notes.push(`not rerun: ${notRerun[1]}`);
  if (/Not rerun:/.test(text(html))) notes.push(/Not rerun: ([^.]*)\./.exec(text(html))?.[1] ?? 'not rerun');
  return notes.join('; ');
}

// ── the matrix row ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Row {
  name: string; first: string; final: string; tiles: string; subject: string; exec: string; verdict: string; health: string; history: string; rerun: string; sizeKiB: string;
}
const toneWord = (t: string): string => (t === 'success' ? 'green' : t === 'warning' ? 'amber' : 'red');
export function row(s: ScenarioResult): Row {
  const kib = `${(Buffer.byteLength(s.html) / 1024).toFixed(1)} KiB`;
  if (!s.report || !s.ctx) return { name: s.spec.name, first: '-', final: '-', tiles: '-', subject: s.subject, exec: '(report-unavailable alert)', verdict: 'red (no report)', health: '-', history: '(none written)', rerun: '-', sizeKiB: kib };
  const r = s.report;
  const t = tiles(s.html);
  const tr = (l: string): string => t[l]?.value ?? '-';
  const h = s.record;
  return {
    name: s.spec.name,
    first: `${r.firstRun.passed}/${r.firstRun.failed}/${r.firstRun.flaky}/${r.firstRun.skipped}/${r.firstRun.didNotRun}`,
    final: `${r.finalPassed}/${r.failed}/-/${r.skipped - r.didNotRun}/${r.didNotRun}`,
    tiles: `${tr('Passed')}·${tr('Flaky')}·${tr('Failed')}·${tr('Skipped')}`,
    subject: s.subject,
    exec: execFirstLine(s.html),
    verdict: `${s.ctx.verdict?.verdict} ${toneWord(s.ctx.verdict?.bannerTone ?? '')} "${s.ctx.verdict?.bannerLabel}"`,
    health: s.ctx.health ? `${s.ctx.health.score} ${s.ctx.health.label}` : '-',
    history: h ? `${h.passed}/${h.failed}/${h.flaky}/${h.skipped}${h.afterRerun ? ` after ${h.afterRerun.passed}/${h.afterRerun.failed}/${h.afterRerun.flaky}` : ''}` : '-',
    rerun: rerunNotes(s.html) || '-',
    sizeKiB: kib,
  };
}

// ── invariants ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface Violation { scenario: string; id: string; message: string }
const noTestRan = (s: ScenarioResult): boolean =>
  s.kind === 'unavailable' || !!s.spec.noResults || (s.spec.completeness !== undefined && s.spec.completeness.reported === 0) || (s.report?.total ?? 0) === 0 || capacityBlock(s.ctx?.capacity) !== null;
const incomplete = (s: ScenarioResult): boolean => !!s.spec.completeness && s.spec.completeness.reported < s.spec.completeness.expected;

export function invariants(s: ScenarioResult): Violation[] {
  const v: Violation[] = [];
  const bad = (id: string, message: string): void => void v.push({ scenario: s.spec.name, id, message });
  const sizeBytes = Buffer.byteLength(s.sent);
  if (sizeBytes > 100 * 1024 && s.spec.name !== '21-very-bad-run') bad('size', `the email is ${(sizeBytes / 1024).toFixed(1)} KiB, over Gmail's 100 KiB clipping limit`);
  if (s.kind === 'unavailable') {
    if (/passed|✅/i.test(s.subject)) bad('no-pass-claim', `a run with no report claims a pass: ${s.subject}`);
    if (s.spec.capacity?.pre && (s.spec.capacity.pre.recordsUsed ?? 0) >= (s.spec.capacity.pre.recordsTotal ?? 300000) && !s.spec.capacity.readOnlyRun && !/BLOCKED — NO RECORDS LEFT/.test(s.subject)) bad('capacity-blocked', `the gate stopped the run but the alert does not say so: ${s.subject}`);
    if (!/REPORT NOT AVAILABLE/.test(s.subject)) bad('says-what-it-is', `the subject does not say the report is unavailable: ${s.subject}`);
    if (!/^[^\w]*\S* ?STAGING sandbox #\d+: /.test(s.subject) && !new RegExp(`${s.env.toUpperCase()} ${s.branch} #\\d+: `).test(s.subject)) bad('alert-subject-format', `the report-unavailable subject uses another format than every other email: ${s.subject}`);
    return v;
  }
  const r = s.report!;
  const ctx = s.ctx!;
  const verdict = ctx.verdict!;
  const t = tiles(s.html);
  const table = rerunTable(s.html);
  const subjectIcon = s.subject.includes('✅') ? 'green' : s.subject.includes('❌') ? 'red' : 'amber';
  const blockedLike = noTestRan(s) || incomplete(s) || r.status === 'no-tests-executed';

  // The two clocks (2026-11-26, build #240): run start <= tests start <= tests end <= run end, and both lines are shown, labelled, and say what they measure
  // A report without per-attempt times (the replays of builds #235 and #240 and the synthetic ones) falls back to the stats window, which with a rerun
  // ADDS the rerun's duration on top (build #235: start + 2h 40m 24s = 08:55:16, three minutes after the email was generated at 08:52:10). That window
  // cannot be compared with the email's generation time, so "tests end <= run end" is asserted only when the attempts' own times were read.
  for (const violation of runTimesViolations(ctx.runTimes, r.testsStart, r.testsEnd)) {
    if (r.testsWindowSource === 'stats' && /is after run end/.test(violation)) continue;
    bad('run-times-order', violation);
  }
  const rowText = (label: string): string | null => {
    const m = new RegExp(`<td[^>]*>${label}</td>\\s*<td[^>]*>([^<]*)</td>`).exec(s.html);
    return m ? m[1] : null;
  };
  const testsRow = rowText('Tests');
  const runRow = rowText('Run');
  const parseDur = (text: string): number | null => {
    const m = /\((?:(\d+)h )?(?:(\d+)m )?(\d+)s[;)]/.exec(text);
    return m ? (((+(m[1] ?? 0) * 60 + +(m[2] ?? 0)) * 60) + +m[3]) * 1000 : null;
  };
  if (!testsRow || !/ IST to .* IST \(/.test(testsRow)) bad('tests-line', `the Tests line is missing or not "<start> IST to <end> IST (<duration>)": ${testsRow}`);
  else if (Math.abs((parseDur(testsRow) ?? -1e9) - (Date.parse(r.testsEnd) - Date.parse(r.testsStart))) > 1000) bad('tests-line-duration', `the Tests duration does not match its own start and end: ${testsRow}`);
  if (ctx.runTimes?.runStart) {
    if (!runRow || !/ IST to .* IST \(/.test(runRow) || !/the end is when this email was generated/.test(runRow)) bad('run-line', `the Run line is missing, not "<start> IST to <end> IST (<total>)" or does not say its end is the email's generation time: ${runRow}`);
    else if (Math.abs((parseDur(runRow) ?? -1e9) - (Date.parse(ctx.runTimes.runEnd) - Date.parse(ctx.runTimes.runStart.iso))) > 1000) bad('run-line-duration', `the Run total does not match its own start and end: ${runRow}`);
    else if (Date.parse(ctx.runTimes.runStart.iso) < Date.parse(r.testsStart) && parseDur(runRow)! < parseDur(testsRow ?? '')!) bad('run-longer-than-tests', 'the Run total is shorter than the Tests duration although it starts earlier');
  } else if (ctx.runSource && ctx.runSource !== 'local' && !(runRow ?? '').includes('start unavailable')) bad('run-line-unavailable', `no run start was read but the Run line does not say so: ${runRow}`);
  else if (ctx.runSource === 'local' && runRow) bad('run-line-local', `a local run has no workflow but shows a Run line: ${runRow}`);

  // Account capacity (2026-11-26, ADR 0019): the section, the warnings, the colours and a gate stop all follow from the data
  {
    const view = buildCapacityView(ctx.capacity, ctx.runTimes?.runEnd ?? Date.now());
    const block = capacityBlock(ctx.capacity);
    const hasSection = s.html.includes('id="section-account-capacity"');
    if (!hasSection) bad('capacity-section', 'the Account capacity section (or its "data unavailable" line) is missing');
    if (s.spec.capacity?.pre && !view.available) bad('capacity-read', 'the scenario wrote capacity snapshots but the report reads none of them');
    if (!view.available && !/Account capacity: data unavailable/.test(s.html)) bad('capacity-unavailable', 'no capacity data but the section does not say "data unavailable"');
    if (view.available && /Account capacity: data unavailable/.test(s.html)) bad('capacity-unavailable', 'capacity data exists but the section says "data unavailable"');
    if ((view.warnings.length > 0) !== s.html.includes('id="section-capacity-warnings"')) bad('capacity-warnings', `${view.warnings.length} warning(s) in the data but the warnings banner is ${s.html.includes('id="section-capacity-warnings"') ? 'shown' : 'missing'}`);
    if (!!block !== (verdict.verdict === 'blocked' && /BLOCKED — (NO RECORDS LEFT|ACCOUNT CAPACITY UNREADABLE)/.test(s.subject))) bad('capacity-blocked', `a gate stop (${!!block}) and the BLOCKED subject disagree: ${s.subject}`);
    if (block && !(ctx.health?.notApplicable ?? '').includes('capacity gate')) bad('capacity-no-score', 'a gate-stopped run shows a health score');
    if (view.available) {
      const redOrder = { records: 'records', customFields: 'customFields', storage: 'storage' };
      void redOrder;
      const bars = [...s.html.matchAll(/<td style="width:(\d+)%;background:(#[0-9A-Fa-f]{6});height:10px/g)].filter((m) => m[2].toUpperCase() !== '#EAEEF2').map((m) => m[2].toUpperCase());
      const expected = view.rows.filter((r) => r.usedPct > 0).map((r) => ({ green: '#1A7F37', yellow: RETRY.bg.toUpperCase(), red: '#CF222E' })[r.colour]);
      if (JSON.stringify(bars) !== JSON.stringify(expected)) bad('capacity-bar-colours', `bar colours ${bars.join(',')} vs the rule ${expected.join(',')}`);
      for (const r of view.rows) {
        if (r.total !== null && r.remaining !== null && Math.abs(r.used + r.remaining - r.total) > 0.0005) bad('capacity-adds-up', `${r.label}: used ${r.used} + left ${r.remaining} != total ${r.total}`);
        if (r.remaining !== null && r.key === 'records' && r.colour !== capacityColour(r.remaining, ctx.capacity!.pre!.thresholds.recordsWarnBelow)) bad('capacity-colour-rule', `records: ${r.remaining} left is ${r.colour}`);
        if (r.remaining !== null && r.remaining <= 0 && r.colour !== 'red') bad('capacity-red-at-zero', `${r.label}: 0 left but ${r.colour}`);
      }
      const sum = view.entities.reduce((n, e) => n + e.used, 0);
      const pool = view.rows[0];
      if (sum !== pool.used) bad('capacity-entities-sum', `per-entity used ${sum} != the pool's used ${pool.used}`);
      for (const e of view.entities) {
        const pre = ctx.capacity!.pre!.entityCounts[e.entity] ?? 0;
        const post = ctx.capacity!.post?.entityCounts[e.entity];
        if (post !== undefined && e.change !== post - pre) bad('capacity-change', `${e.entity}: change ${e.change} != post ${post} - pre ${pre}`);
        if (post === undefined && e.change !== null) bad('capacity-change', `${e.entity}: a change without a post-run reading`);
      }
      if (view.postMissing !== !ctx.capacity!.post) bad('capacity-post-missing', 'postMissing does not match the data');
      if (ctx.capacity!.pre!.capturedAt !== [...(ctx.capacity!.pre ? [ctx.capacity!.pre.capturedAt] : [])][0]) bad('capacity-earliest', 'internal');
      if (view.preCount !== (s.spec.capacity?.shards ?? 1)) bad('capacity-shard-count', `${view.preCount} pre-run snapshots read, ${s.spec.capacity?.shards ?? 1} written`);
      // the plan header: red for a passed renewal or an unexpected plan, yellow within 14 days, green otherwise
      const plan = view.plan!;
      const want = !plan.planIsExpected || (plan.daysLeft !== null && plan.daysLeft < 0) ? 'red' : plan.daysLeft !== null && plan.daysLeft <= 14 ? 'yellow' : 'green';
      if (plan.colour !== want) bad('capacity-plan-colour', `plan header is ${plan.colour}, the rule says ${want} (days left ${plan.daysLeft}, expected plan ${plan.expectedPlan}, found ${plan.name})`);
      if (!/Billing period/.test(s.html) || /INR\s?\d/.test(s.html.slice(s.html.indexOf('id="section-account-capacity"'), s.html.indexOf('id="section-account-capacity"') + 4000))) bad('capacity-no-price', 'the plan header must show the billing period and never a price');
      if (!/can include records created by other activity/.test(s.html) && !view.postMissing) bad('capacity-label', 'the change is not labelled as possibly including other activity');
    }
  }

  // 1-3: the numbers add up and only move in the allowed directions
  if (r.finalPassed + r.failed + r.skipped !== r.total) bad('outcomes-add-up', `Final passed ${r.finalPassed} + failed ${r.failed} + skipped/did-not-run ${r.skipped} = ${r.finalPassed + r.failed + r.skipped}, total ${r.total}`);
  if (r.firstRun.passed + r.firstRun.failed + r.firstRun.flaky + r.firstRun.skipped + r.firstRun.didNotRun !== r.total) bad('first-run-adds-up', `first run does not add up to ${r.total}: ${JSON.stringify(r.firstRun)}`);
  if (s.record && (s.record.passed !== r.firstRun.passed || s.record.failed !== r.firstRun.failed)) bad('record-equals-first-run', `the history record says ${s.record.passed} passed / ${s.record.failed} failed first, the report ${r.firstRun.passed} / ${r.firstRun.failed}`);
  // The email's own wording only: the error text of a card is the test's own message and may say "result(s)".
  const ownWording = s.html.replace(/\b(?:result|attempt|request|element)\(s\)/g, ' '); // the page objects' own error messages (MeetingsPage "result(s)", "attempt(s)")
  if (/\(s\)/.test(ownWording) || /\b1 (?:tests|errors|failures|shards|hours|days)\b/.test(ownWording.replace(/<[^>]*>/g, ' '))) bad('count-wording', 'a count-based sentence says "(s)" or "1 tests"');
  // verb agreement (E3, 2026-11-25: "8 flaky tests is above the budget"): a plural count with "is / has / was", a "1 ..." with "are / were / have"
  const agreement = ownWording.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const wrongVerb = /\b(?:[2-9]|\d{2,})\s+(?:[\w/-]+\s+){0,3}(?:tests|errors|failures|shards|modules|jobs|retries|groups|attempts)\s+(?:is|has|was)\b|\b1\s+(?:[\w/-]+\s+){0,3}(?:test|error|failure|shard|module|job|retry|group|attempt)\s+(?:are|were|have)\b/.exec(agreement);
  if (wrongVerb) bad('count-agreement', `the verb does not agree with the count: "${wrongVerb[0]}"`);
  if (r.finalPassed < r.firstRun.passed) bad('final-passed-ge-first', `Final passed ${r.finalPassed} < first-run passed ${r.firstRun.passed}`);
  if (r.failed > r.firstRun.failed + r.firstRun.didNotRun) bad('final-failed-le-first', `Final failed ${r.failed} > first-run failed ${r.firstRun.failed} + did-not-run ${r.firstRun.didNotRun}`);
  if (table) {
    const sum = (i: 'first' | 'final'): number => (['Passed', 'Failed', 'Flaky', 'Skipped', 'Did not run'] as const).reduce((n, k) => n + (table[k]?.[i] ?? 0), 0);
    if (sum('first') !== table.Total.first || sum('final') !== table.Total.final) bad('table-adds-up', `the rerun table columns do not add up: first ${sum('first')}/${table.Total.first}, final ${sum('final')}/${table.Total.final}`);
    if (table.Passed.final !== r.finalPassed || table.Failed.final !== r.failed) bad('table-equals-report', `Final result Passed/Failed ${table.Passed.final}/${table.Failed.final} vs the report ${r.finalPassed}/${r.failed}`);
    const note = table.Passed.note;
    const noteSum = [...note.matchAll(/(\d+) (?:after a retry|after the rerun|ran only on rerun)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (table.Passed.first + noteSum !== table.Passed.final) bad('table-note-adds-up', `Final Passed ${table.Passed.final} = first-run Passed ${table.Passed.first} + the note's parts ${noteSum} ("${note}")`);
    if (table.Flaky.final !== 0) bad('final-flaky-zero', `the Final result column shows ${table.Flaky.final} Flaky (a flaky test ends as Passed)`);
    if (table.Passed.first !== r.firstRun.passed || table.Flaky.first !== r.firstRun.flaky || table.Failed.first !== r.firstRun.failed) bad('table-first-run', `the First run column does not match the parsed first run`);
  }

  // The Rerun Summary tiles (2026-11-25): shown only when a rerun ran, and their numbers are the Rerun table's own rows
  const rt = rerunTiles(s.html);
  if (!!rt !== !!(s.summary && s.summary.ran)) bad('rerun-tiles-presence', `the Rerun Summary tiles are ${rt ? 'shown' : 'missing'} but the rerun ${s.summary?.ran ? 'ran' : 'did not run'}`);
  if (rt && s.summary) {
    const shown = rerunTestRows(s.html); // the table lists at most 8 tests; the tiles count them all
    const all = s.summary.rows;
    const passedAll = all.filter((x) => x.rerun === 'passed').length;
    const failedAll = all.filter((x) => x.rerun === 'failed').length;
    const n = (l: string): number => parseInt(rt[l]?.value ?? 'NaN', 10);
    if (n('Rerun') !== all.length || n('Passed on rerun') !== passedAll || n('Still failing') !== failedAll) bad('rerun-tiles-match-summary', `Rerun Summary tiles ${n('Rerun')}/${n('Passed on rerun')}/${n('Still failing')} vs the rerun summary's rows ${all.length}/${passedAll}/${failedAll}`);
    const shownPassed = shown.filter((c) => c[2] === 'Passed').length;
    const shownFailed = shown.filter((c) => c[2] === 'Failed').length;
    if (shown.length > all.length || shownPassed > passedAll || shownFailed > failedAll || (all.length <= 8 && (shown.length !== all.length || shownPassed !== passedAll || shownFailed !== failedAll))) bad('rerun-tiles-match-table', `the Rerun table lists ${shown.length}/${shownPassed}/${shownFailed} (rows/passed/failed) of the tiles' ${all.length}/${passedAll}/${failedAll} (it lists up to 8)`);
    if (n('Not rerun') !== s.summary.excluded.length) bad('rerun-tiles-not-rerun', `the Not rerun tile shows ${n('Not rerun')}, the rerun summary excluded ${s.summary.excluded.length}`);
  }

  // 4: subject, tiles, table and executive summary quote the same numbers
  if (Object.keys(t).length > 0) {
    const n = (l: string): number => parseInt(t[l]?.value ?? 'NaN', 10);
    if (n('Total') !== r.total || n('Passed') !== r.finalPassed || n('Failed') !== r.failed) bad('tiles-quote-report', `tiles Total/Passed/Failed ${n('Total')}/${n('Passed')}/${n('Failed')} vs report ${r.total}/${r.finalPassed}/${r.failed}`);
    if (n('Flaky') !== r.firstRun.flaky) bad('tiles-flaky', `the Flaky tile shows ${n('Flaky')}, the first run had ${r.firstRun.flaky} flaky tests`);
    // the breakdown under Passed adds up to Passed: clean + after a retry + after the rerun + ran only on the rerun
    const sub = t['Passed']?.sub ?? '';
    const subSum = [...sub.matchAll(/(\d+) (?:after a retry|after the rerun|ran only on rerun)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (r.firstRun.passed + subSum !== r.finalPassed) bad('tile-parts-add-up', `Passed ${r.finalPassed} = clean ${r.firstRun.passed} + the tile's breakdown ${subSum} ("${sub}")`);
    // the subject says what the tiles say (one source of truth: the parsed report)
    const sp2 = /(\d+) passed/.exec(s.subject);
    const sf2 = /(\d+) failed/.exec(s.subject);
    if (!/BLOCKED|INCOMPLETE|NO TESTS|DRIFT/i.test(s.subject) && (!sp2 || parseInt(sp2[1], 10) !== n('Passed') || (sf2 ? parseInt(sf2[1], 10) : 0) !== n('Failed'))) bad('subject-matches-tiles', `subject "${s.subject}" vs tiles Passed ${n('Passed')} / Failed ${n('Failed')}`);
    const tileSum = n('Passed') + n('Failed') + n('Skipped') + (t['Did not run'] ? n('Did not run') : 0);
    if (tileSum !== n('Total')) bad('tiles-add-up', `Passed + Failed + Skipped + Did not run = ${tileSum}, Total ${n('Total')}`);
  } else if (!blockedLike) bad('tiles-present', 'no Run Summary tiles found');

  // Piece B (2026-11-25): the donut's legend, alt text and the segmented bar are the tiles' numbers; the Background Errors tiles and bar are the error counts
  const ch = outcomeChart(s.html);
  const chartExpected = !blockedLike && r.total > 0 && !ctx.health?.notApplicable;
  if (!!ch !== chartExpected) bad('chart-presence', `the outcome chart is ${ch ? 'shown' : 'missing'} but ${chartExpected ? 'tests ran' : 'nothing is verified (blocked, incomplete or empty run)'}`);
  if (ch) {
    const tv = (l: string): number => parseInt(t[l]?.value ?? '0', 10);
    const L = ch.legend;
    const parts = [L['Passed first time'], L['Passed on retry'], L['Passed on rerun'], L['Failed'], L['Skipped']];
    if (parts.some((x) => typeof x !== 'number')) bad('chart-legend', `the chart legend is incomplete: ${JSON.stringify(L)}`);
    else {
      const [first, retry, rerun, failedN, skippedN] = parts;
      if (first + retry + rerun + failedN + skippedN !== r.total) bad('chart-adds-up', `the chart's five outcomes add up to ${first + retry + rerun + failedN + skippedN}, total ${r.total}`);
      if (first + retry + rerun !== tv('Passed') || failedN !== tv('Failed') || retry !== tv('Flaky') || skippedN !== tv('Skipped') + tv('Did not run')) bad('chart-matches-tiles', `chart ${JSON.stringify(L)} vs tiles Passed ${tv('Passed')} / Failed ${tv('Failed')} / Flaky ${tv('Flaky')} / Skipped + Did not run ${tv('Skipped') + tv('Did not run')}`);
      if (ch.figure !== r.passRate || `${r.passRate}%` !== t['Passed first time']?.value) bad('chart-figure', `the chart says ${ch.figure}% first time, the tile ${t['Passed first time']?.value}, the report ${r.passRate}%`);
      if (ch.alt && ch.alt.join() !== [r.total, first, retry, rerun, failedN, skippedN].join()) bad('chart-alt-matches', `the image's alt text says ${ch.alt.join('/')} but the tiles say ${[r.total, first, retry, rerun, failedN, skippedN].join('/')}`);
      const live = Object.entries(L).filter(([, v]) => v > 0);
      if (JSON.stringify(live.map(([k, v]) => [k, v])) !== JSON.stringify(Object.entries(ch.bar))) bad('bar-matches-chart', `the segmented bar ${JSON.stringify(ch.bar)} differs from the legend's non-zero parts ${JSON.stringify(live)}`);
    }
  }
  const et = errorTiles(s.html);
  const mc = ctx.miscErrors;
  if (mc && mc.totalErrors > 0) {
    if (!et) bad('error-tiles-present', 'background errors were captured but the Background Errors tiles are missing');
    else {
      const noise = mc.errors.filter((e) => e.expectedReason === 'background-noise').length;
      if (et.tiles['Unexpected'] !== mc.unexpectedErrors || et.tiles['Expected RBAC'] !== mc.expectedRbacErrors || et.tiles['Known noise'] !== noise || mc.unexpectedErrors + mc.expectedRbacErrors + noise !== mc.totalErrors) bad('error-tiles-match', `error tiles ${JSON.stringify(et.tiles)} vs the captured ${mc.unexpectedErrors} / ${mc.expectedRbacErrors} / ${noise} of ${mc.totalErrors}`);
      const want = [['Unexpected', mc.unexpectedErrors], ['Expected RBAC', mc.expectedRbacErrors], ['Known noise', noise]].filter(([, v]) => (v as number) > 0);
      if (JSON.stringify(want) !== JSON.stringify(Object.entries(et.bar))) bad('error-bar-matches-tiles', `the error bar ${JSON.stringify(et.bar)} differs from the tiles ${JSON.stringify(want)}`);
    }
  }
  const exec = execFirstLine(s.html);
  const countBased = !/BLOCKED|INCOMPLETE|NO TESTS|DRIFT/i.test(s.subject);
  if (countBased) {
    const sf = /(\d+) failed/.exec(s.subject);
    const sp = /(\d+) passed/.exec(s.subject);
    const so = /of (\d+)$/.exec(s.subject);
    if ((sf ? parseInt(sf[1], 10) : 0) !== r.failed || !sp || parseInt(sp[1], 10) !== r.finalPassed || !so || parseInt(so[1], 10) !== r.total) bad('subject-quotes-report', `subject numbers differ from the report (${r.failed} failed, ${r.finalPassed} passed, ${r.total} total): ${s.subject}`);
    const flakyInSubject = /(\d+) flaky/.exec(s.subject);
    if (r.firstRun.flaky > 0 && !(flakyInSubject && parseInt(flakyInSubject[1], 10) === r.firstRun.flaky)) bad('subject-shows-flaky', `${r.firstRun.flaky} flaky tests are not named in the subject: ${s.subject}`);
    const onRerunInSubject = /(\d+) on rerun/.exec(s.subject);
    if (r.recoveredOnRerun > 0 && !(onRerunInSubject && parseInt(onRerunInSubject[1], 10) === r.recoveredOnRerun)) bad('subject-shows-rerun', `${r.recoveredOnRerun} tests that passed only on the rerun are not named in the subject: ${s.subject}`);
    if (r.ranOnlyOnRerun > 0 && !/only on rerun/.test(s.subject)) bad('subject-shows-ran-only-on-rerun', `${r.ranOnlyOnRerun} tests that ran only on the rerun are not named in the subject (the verdict is amber because of them): ${s.subject}`);
    if (r.skipped - r.didNotRun > 0 && !/skipped/.test(s.subject)) bad('subject-accounts-for-skipped', `${r.skipped - r.didNotRun} skipped tests are in "of ${r.total}" but not named: failed + passed < total and the reader cannot see why: ${s.subject}`);
    if (r.failed > 0 ? !new RegExp(`^${r.failed} tests? failed`).test(exec) : !/^(No test failures this run|No test failed in the end|Nothing was verified)/.test(exec)) bad('exec-first-line', `the executive summary's first sentence does not state ${r.failed} failures: "${exec.slice(0, 80)}"`);
  }
  const execText = text(s.html);
  const execSentence = /(\d+) of (\d+) tests passed in the end: ([^—]*)—/.exec(execText);
  if (execSentence) {
    const parts = [...execSentence[3].matchAll(/(\d+) (?:passed on (?:its|their) retry|passed only on the rerun|only on the rerun|that did not run)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (r.firstRun.passed + parts !== r.finalPassed) bad('exec-parts-add-up', `the executive summary's breakdown does not add up: clean ${r.firstRun.passed} + ${parts} != ${r.finalPassed} ("${execSentence[3].trim()}")`);
  }
  const passedInEnd = /(\d+) of (\d+) tests passed in the end/.exec(text(s.html));
  if (passedInEnd && (parseInt(passedInEnd[1], 10) !== r.finalPassed || parseInt(passedInEnd[2], 10) !== r.total)) bad('exec-quotes-report', `"N of M passed in the end" is ${passedInEnd[1]} of ${passedInEnd[2]}, report ${r.finalPassed} of ${r.total}`);

  // Colours (2026-11-25): information tiles and the ENV badge take the environment's colour; flaky / retry is yellow everywhere; status colours never change
  if (!blockedLike) {
    const ts = tileStyles(s.html);
    const info = infoSwatch(s.env);
    const same = (a: { fill: string; text: string } | undefined, b: { bg: string; text: string }): boolean => !!a && a.fill === b.bg.toUpperCase() && a.text === b.text.toUpperCase();
    for (const label of ['Duration', 'Modules', 'Total', 'Rerun', 'Not rerun', 'Rerun duration']) {
      const t = ts[label];
      if (t && t.fill !== '#6E7781' && !same(t, info)) bad('info-colour-per-env', `the ${label} tile is ${t.fill}/${t.text}, ${s.env} uses ${info.bg}/${info.text}`);
    }
    const chip = /<span style="display:inline-block;font-size:11px;color:(#[0-9A-Fa-f]{6});background:(#[0-9A-Fa-f]{6});[^"]*">ENV <b/.exec(s.html);
    if (!chip || chip[2].toUpperCase() !== info.bg.toUpperCase() || chip[1].toUpperCase() !== info.text.toUpperCase()) bad('env-badge-colour', `the ENV badge is ${chip?.[2]}/${chip?.[1]}, ${s.env} uses ${info.bg}/${info.text}`);
    for (const label of ['Flaky', 'Retries', 'Did not run']) {
      const t = ts[label];
      if (t && t.fill !== '#6E7781' && !same(t, RETRY)) bad('retry-yellow', `the ${label} tile is ${t.fill}/${t.text}, retry is ${RETRY.bg}/${RETRY.text}`);
    }
    const status: Array<[string, string]> = [['Passed', '#1A7F37'], ['Failed', '#CF222E']];
    for (const [label, color] of status) {
      const t = ts[label];
      if (t && t.fill !== '#6E7781' && (t.fill !== color || t.text !== '#FFFFFF')) bad('status-colour-constant', `the ${label} tile is ${t.fill}/${t.text} in ${s.env}: status colours do not change with the environment`);
    }
    if (ts['Skipped'] && (ts['Skipped'].fill !== '#6E7781' || ts['Skipped'].text !== '#FFFFFF')) bad('status-colour-constant', `the Skipped tile is ${ts['Skipped'].fill}, skipped is slate grey in every environment`);
    // pills are green (passed), red (failed), retry yellow, or neutral: nothing else
    for (const m of s.html.matchAll(/<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:(#[0-9A-Fa-f]{6});color:(#[0-9A-Fa-f]{6});/g)) {
      const pair = `${m[1].toUpperCase()}/${m[2].toUpperCase()}`;
      const okPairs = [`#DAFBE1/#1A7F37`.toUpperCase(), `#FFEBE9/#CF222E`.toUpperCase(), `${RETRY.bg}/${RETRY.text}`.toUpperCase()];
      if (!okPairs.includes(pair) && m[1].toUpperCase() !== '#F6F8FA') bad('pill-palette', `a pill is ${pair}`);
    }
    const bar = /title="Passed on retry: \d+" style="background:(#[0-9A-Fa-f]{6})/.exec(s.html);
    const dot = /<span class="sw"[^>]*background:(#[0-9A-Fa-f]{6});[^>]*><\/span>(?:&nbsp;|\s)+Passed on retry/.exec(s.html);
    if ((bar && bar[1].toUpperCase() !== RETRY.bg.toUpperCase()) || (dot && dot[1].toUpperCase() !== RETRY.bg.toUpperCase())) bad('retry-yellow', `the Passed on retry bar / legend dot is not ${RETRY.bg}`);
  }

  // Every module in the results is a row of Module Analytics, on its own side, with the run's own count (2026-11-26): the expected list comes from the
  // scenario's spec files (or its explicit `expectModules`), NOT from the parsed report, which the older all-modules-complete check below reads
  if (s.spec.first && s.spec.first.length > 0 && r.total > 0 && !blockedLike) {
    const expected = s.spec.expectModules ?? expectedModulesFromDefs(s.spec.first);
    const hasFormFields = s.spec.first.some((d) => /formfields/i.test(d.file.split('/')[1] ?? ''));
    for (const msg of moduleCoverageViolations(s.html, expected, { allowExtra: hasFormFields && !s.spec.expectModules })) bad('modules-in-results', msg);
  }
  // E6 (2026-11-25): every module, UI and RBAC side by side; per side the five outcomes add up to Tests; the totals are the run's; problems are highlighted
  const modRows = allModulesTable(s.html);
  if (!blockedLike || r.modules.length > 0) {
    const names = [...new Set(r.modules.map((m) => m.name))];
    if (!modRows) bad('all-modules-present', 'the all-modules table is missing');
    else {
      if (modRows.length !== names.length || !names.every((n) => modRows.some((x) => x.name === n))) bad('all-modules-complete', `the table has ${modRows.length} rows, the run has ${names.length} modules: every module must be shown`);
      let totalTests = 0;
      for (const row of modRows) {
        for (const side of [row.UI, row.RBAC]) {
          if (!side) continue;
          totalTests += side[0];
          if (side[1] + side[2] + side[3] + side[4] + side[5] !== side[0]) bad('all-modules-adds-up', `${row.name}: first ${side[1]} + retry ${side[2]} + rerun ${side[3]} + failed ${side[4]} + skipped ${side[5]} != tests ${side[0]}`);
        }
      }
      if (totalTests !== r.total) bad('all-modules-total', `the table's tests add up to ${totalTests}, the run has ${r.total}`);
      const fails = modRows.reduce((n, x) => n + (x.UI?.[4] ?? 0) + (x.RBAC?.[4] ?? 0), 0);
      const retries = modRows.reduce((n, x) => n + (x.UI?.[2] ?? 0) + (x.RBAC?.[2] ?? 0), 0);
      if (fails !== r.failed || retries !== r.firstRun.flaky) bad('all-modules-match-run', `table failed ${fails} / retry ${retries} vs the run ${r.failed} / ${r.firstRun.flaky}`);
      const firstProblem = modRows.findIndex((x) => [x.UI, x.RBAC].every((sd) => !sd || (sd[2] + sd[3] + sd[4] === 0)));
      const lastProblem = modRows.map((x) => [x.UI, x.RBAC].some((sd) => sd && sd[2] + sd[3] + sd[4] > 0)).lastIndexOf(true);
      if (firstProblem >= 0 && lastProblem > firstProblem) bad('all-modules-problems-first', 'a module with a problem comes after one without');
      for (const row of modRows) if ((row.UI?.[4] ?? 0) + (row.RBAC?.[4] ?? 0) > 0 && !row.bgs.includes('#FFEBE9')) bad('all-modules-highlight', `${row.name} has failed tests but no red cell`);
    }
  }
  // E7: moving the repeated styles into classes loses nothing: the sent email, with its classes expanded, is the readable one
  if (s.kind === 'email' && normalizeTags(EmailTemplate.expandStyles(s.sent)) !== normalizeTags(s.html)) bad('styles-roundtrip', 'the sent email (classes expanded) differs from the readable one: the style compaction lost or changed something');

  // 5-6: verdict, colour and icon
  if (r.failed > 0 && (verdict.verdict === 'clear' || verdict.bannerTone === 'success' || subjectIcon === 'green')) bad('failure-never-green', `a run with ${r.failed} failed tests is shown green (${verdict.bannerLabel})`);
  if (subjectIcon === 'green' && verdict.verdict !== 'clear') bad('icon-matches-verdict', `the subject is green but the verdict is ${verdict.verdict}`);
  if (r.failed === 0 && !blockedLike && (verdict.bannerTone === 'danger' || /failed/i.test(s.subject) || s.subject.includes('❌'))) bad('flaky-only-not-failed', `a run without failures is shown as failed: ${s.subject} / ${verdict.bannerLabel}`);
  // the colour rule (2026-11-25): by results only, whatever the CI setup
  const notVerified = r.didNotRun + r.ranOnlyOnRerun;
  const mustBeAmber = r.firstRun.flaky > FLAKY_BUDGET || r.recoveredOnRerun > 0 || notVerified > 0;
  if (!blockedLike && r.failed === 0 && !ctx.suiteDrift?.occurred && ctx.health!.label !== 'Needs Attention' && ctx.health!.label !== 'Critical') {
    if (mustBeAmber && verdict.verdict === 'clear') bad('instability-not-clean', `${r.firstRun.flaky} flaky (budget ${FLAKY_BUDGET}), ${r.recoveredOnRerun} passed-only-on-rerun, ${notVerified} not run but the verdict is clear`);
    if (!mustBeAmber && verdict.verdict !== 'clear') bad('colour-by-results', `flaky ${r.firstRun.flaky} <= ${FLAKY_BUDGET}, nothing failed every attempt, everything ran, yet the verdict is ${verdict.verdict}: ${verdict.bannerLabel}`);
  }
  if (blockedLike && verdict.verdict !== 'blocked' && !(r.total === 0)) bad('blocked-is-blocked', `an incomplete or blocked run has verdict ${verdict.verdict}`);
  if (r.total === 0 && verdict.verdict === 'clear') bad('zero-tests-never-green', `0 tests ran and the verdict is clear (${verdict.bannerLabel}, "${verdict.headline}")`);

  // 7: a blocked, incomplete or empty run never claims a pass rate
  if (blockedLike) {
    if (/\d+ passed|✅/.test(s.subject)) bad('no-pass-claim-subject', `the subject of a run where tests did not run claims passes: ${s.subject}`);
    if (t['Passed first time'] && t['Passed first time'].value !== 'n/a') bad('no-pass-rate-tile', `a run where tests did not run still shows "Passed first time ${t['Passed first time'].value}"`);
  }

  // 8: flaky tests stay visible somewhere
  if (r.firstRun.flaky > 0) {
    if (r.passRate >= 100) bad('flaky-visible-passrate', `${r.firstRun.flaky} flaky tests but "Passed first time" reads ${r.passRate}%`);
    if (r.flaky > 0 && !s.html.includes('id="section-flaky-tests"')) bad('flaky-visible-section', 'flaky tests but no Flaky Tests section');
    if (r.flaky === 0 && r.passedOnRerunTests.length > 0 && !s.html.includes('id="section-passed-on-rerun"')) bad('flaky-visible-rerun-section', 'flaky tests resolved on the rerun but no "Passed on rerun" section');
    if (table && table.Flaky.first !== r.firstRun.flaky) bad('flaky-visible-first-run', 'the First run column does not show the flaky count');
  }
  if (r.recoveredOnRerun > 0 && !s.html.includes('id="section-passed-on-rerun"')) bad('recovered-visible', 'tests that passed only on the rerun have no section');

  if (s.summary && !s.summary.ran && s.summary.reason === 'none' && s.summary.excluded.length > 0 && /no test failed or was flaky/.test(text(s.html))) bad('not-rerun-reason', 'the rerun section says "no test failed or was flaky" although failed tests could not be rerun');

  // reader-confusion checks (findings, see KNOWN): wording that contradicts the verdict or hides why a run is amber or red
  if (ctx.health && !ctx.health.notApplicable && r.failed > 0) {
    const severe = r.failed >= 3 || r.failed >= (r.total - r.skipped) * 0.05;
    if (ctx.health.label === 'Excellent' || (severe && ctx.health.label === 'Good')) bad('health-with-failures', `health says "${ctx.health.label}" (${ctx.health.score}) next to ${r.failed} failed tests of ${r.total - r.skipped}`);
  }
  if (ctx.health?.notApplicable && !/Health: n\/a|Automation Health: n\/a/.test(text(s.html))) bad('health-na-shown', 'health is not applicable but the email does not say "n/a"');
  if (countBased && verdict.verdict === 'caution' && r.failed === 0 && /Automation health is (Excellent|Good)/.test(exec)) bad('exec-health-sentence', `the executive summary explains an amber run with "${/Automation health is [^.]*\./.exec(exec)?.[0]}": health is fine, the real reason is not stated`);
  if (blockedLike && /^No test failures/.test(exec)) bad('exec-no-failures-when-nothing-ran', `the executive summary says "No test failures this run." for a run where ${noTestRan(s) ? 'no test ran' : 'shards are missing'}`);
  if (r.total === 0 && (/Passed/.test(verdict.bannerLabel) || /0 passed of 0/.test(s.subject))) bad('zero-tests-label', `0 tests ran and the email says "${verdict.bannerLabel}" / "${s.subject}"`);
  const labelFlaky = /Unstable — (\d+) flaky/.exec(verdict.bannerLabel);
  if (labelFlaky && parseInt(labelFlaky[1], 10) !== r.firstRun.flaky) bad('verdict-label-vs-tile', `the verdict label counts ${r.flaky} flaky, the Flaky tile ${r.firstRun.flaky} (the label counts only those the rerun did not confirm)`);
  if (r.recoveredOnRerun > 0 && r.failed === 0 && /^No test failures this run/.test(exec)) bad('exec-no-failures-after-rerun', `"No test failures this run." although ${r.recoveredOnRerun} tests failed every first attempt (they passed on the rerun)`);

  // 9: history
  const h = s.record;
  if (h) {
    if (h.passed + h.failed + h.flaky + h.skipped !== h.total) bad('history-adds-up', `history first-run counts ${h.passed}+${h.failed}+${h.flaky}+${h.skipped} != ${h.total}`);
    if (h.passed !== r.firstRun.passed || h.failed !== r.firstRun.failed || h.flaky !== r.firstRun.flaky) bad('history-first-run', 'history does not hold the first-run counts');
    if (h.afterRerun && (h.afterRerun.passed !== r.finalPassed || h.afterRerun.failed !== r.failed || h.afterRerun.flaky !== 0)) bad('history-after', `history afterRerun ${JSON.stringify(h.afterRerun)} vs final ${r.finalPassed}/${r.failed}/0`);
    if (r.flaky > 0 && h.flakyTestTitles.length < r.flaky) bad('history-flaky-titles', 'history lost flaky test titles');
  }

  // 10: skipped tests
  const skippedSpec = s.spec.first.filter((d) => d.kind === 'skip-reason' || d.kind === 'skip-no-reason');
  if (skippedSpec.length > 0) {
    if (!s.html.includes('Skipped Tests (')) bad('skipped-listed', 'skipped tests but no Skipped Tests section');
    if (skippedSpec.some((d) => d.kind === 'skip-reason') && !text(s.html).includes(SKIP_REASON_TEXT)) bad('skip-reason-shown', 'a skip reason is not shown');
    if (skippedSpec.some((d) => d.kind === 'skip-no-reason') && !text(s.html).includes('No reason given')) bad('skip-no-reason-said', 'a skip without a reason does not say so');
  }

  // 11: health
  if (blockedLike && ctx.health && !ctx.health.notApplicable) bad('health-of-blocked-run', `a run where tests did not run has health ${ctx.health.score} ${ctx.health.label}`);

  // 13: structure and size rules of commit 2 (items 7-10, 13, 14, 24)
  const plain = new EmailTemplate().text(ctx);
  const flat = s.html.replace(/\s+/g, ' ');
  const iResult = s.html.indexOf('>Result<');
  const iExec = s.html.indexOf('Executive Summary');
  if (iResult < 0 || !s.html.includes('>Action<') || !s.html.includes('>Run<') || (iExec >= 0 && iResult > iExec)) bad('top-summary', 'the Result / Action / Run lines are missing or come after the Executive Summary');
  if (!plain.startsWith(s.subject) || /<[a-z][^>]*>/i.test(plain) || !/\nResult: /.test(plain)) bad('text-part', 'the plain-text part does not start with the subject, has HTML in it or has no Result line');
  if (Buffer.byteLength(plain) > 12 * 1024 && s.spec.name !== '21-very-bad-run') bad('text-part-size', `the plain-text part is ${(Buffer.byteLength(plain) / 1024).toFixed(1)} KiB`);
  const cardCount = (s.html.match(/<div id="test-/g) ?? []).length;
  if (/more, not shown in full|more failed tests?, not shown in full|shorter jobs \(each|more rerun tests|more modules? with failures/.test(s.html)) bad('no-size-cap', 'a size cap is still in the email: nothing is capped for size');
  void cardCount;
  if (/all-blob-reports\/resources|blob-report\/resources|error-context\.md|test-results\/[^"<\s]*\.zip/.test(flat)) bad('no-runner-paths', 'a runner-relative trace/snapshot path is in the email');
  if (!/Result<\/strong>/.test(s.html.replace(/\s+/g, ' ')) && s.html.includes('>Result<')) bad('top-summary-shape', 'the Result line is not in the expected markup');
  if (ctx.miscErrors && ctx.miscErrors.totalErrors > 0 && !s.html.includes('Top errors, grouped by request')) bad('background-errors-grouped', 'background errors are not shown as grouped');

  // 14: commit 3 (items 19-21): one labelled time zone, readable durations, words with every arrow
  const plainText = s.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  if (/\bUTC\b/.test(plainText)) bad('one-time-zone', 'the email shows a UTC time next to IST ones');
  if (/\b\d{3,}s\b/.test(plainText) || /\b\d{3,}m\b/.test(plainText)) bad('duration-format', `a duration is not "6m 10s": ${(plainText.match(/\b\d{3,}[sm]\b/g) ?? []).join(', ')}`);
  const bareArrows = [...plainText.matchAll(/[▲▼]([^▲▼]{0,90})/g)].map((m) => m[1]).filter((a) => !/(than last|than the last|slower than|worse|better)/.test(a));
  if (bareArrows.length > 0) bad('arrows-have-words', `an arrow without words: ${bareArrows[0].slice(0, 60)}`);

  // reader-facing text never says "in-job retry" (it is "retry"); nor "rerun shard" outside the technical rerun-summary file names
  const readerText = s.html.replace(/<[^>]*>/g, ' ');
  if (/in-job/i.test(readerText)) bad('no-in-job-wording', `the email says "in-job": ${(/.{30}in-job.{20}/i.exec(readerText) ?? [''])[0]}`);
  if (/rerun[- ]shard/i.test(readerText)) bad('no-rerun-shard-wording', `the email says "rerun shard": ${(/.{30}rerun[- ]shard.{20}/i.exec(readerText) ?? [''])[0]}`);

  // 12: environment and branch
  if (!s.subject.includes(s.branch) || !s.subject.toUpperCase().includes(s.env.toUpperCase())) bad('subject-names-env-branch', `the subject does not name ${s.env} and ${s.branch}: ${s.subject}`);
  // the advice follows the promotion chain: each branch names its own next step (2026-11-25; dev used to say "PR to dev")
  const NEXT: Record<string, string> = { sandbox: 'PR to dev', dev: 'promote to qa', qa: 'promote to stage', stage: 'promote to prod', prod: 'promote to main', main: 'Deployment' };
  const nextStep = s.branch.startsWith('feature/') ? 'PR to dev' : NEXT[s.branch] ?? 'Deployment';
  const adviceIn = (txt: string): string | undefined => /(PR to dev|promote to (?:qa|stage|prod|main)|Deployment)/.exec(txt)?.[1];
  const adviceSeen = adviceIn(verdict.headline);
  const needsAdvice = !blockedLike && (verdict.verdict === 'clear' || verdict.verdict === 'caution' || r.failed > 0);
  if (needsAdvice && adviceSeen !== nextStep) bad('branch-next-step', `the ${s.branch} email says "${verdict.headline}" but this branch's next step is "${nextStep}"`);
  if (adviceSeen && adviceSeen !== nextStep) bad('branch-wrong-step', `the ${s.branch} email names "${adviceSeen}" instead of "${nextStep}"`);
  // "review it" / "review them" agrees with how many tests the reasons are about (A5-style singular/plural)
  const reviewWord = /; review (it|them)$/.exec(verdict.headline)?.[1];
  if (reviewWord) {
    const involved = (r.firstRun.flaky > FLAKY_BUDGET ? r.firstRun.flaky : 0) + r.recoveredOnRerun + r.didNotRun + r.ranOnlyOnRerun;
    if ((involved === 1) !== (reviewWord === 'it')) bad('review-singular-plural', `"${verdict.headline}" says "review ${reviewWord}" for ${involved} test(s)`);
  }
  const wrongSteps = ['PR to dev', 'promote to qa', 'promote to stage', 'promote to prod', 'promote to main', 'Deployment'].filter((x) => x !== nextStep);
  const action = text(s.html).match(/Recommended — review before [^.<]*/)?.[0] ?? '';
  if (action && !(nextStep === 'PR to dev' ? /opening the PR/ : nextStep === 'Deployment' ? /next release/ : new RegExp(`promoting to ${nextStep.replace('promote to ', '')}`)).test(action)) bad('branch-review-line', `the review line "${action}" does not name the next step "${nextStep}" of ${s.branch}`);
  void wrongSteps;
  return v;
}

// ── things this suite found that are not decided yet (listed, not failing) ──────────────────────────────────────
export const KNOWN: Array<{ id: string; scenarios?: RegExp; reason: string }> = [
];
const isKnown = (v: Violation): string | null => KNOWN.find((k) => k.id === v.id && (!k.scenarios || k.scenarios.test(v.scenario)))?.reason ?? null;

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function main(): void {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > 0 ? process.argv[outIdx + 1].replace(/^~(?=$|\/)/, os.homedir()) : null;
  const results: ScenarioResult[] = SCENARIOS.map((spec) => runScenario(spec));
  // the real build #235 and its blocked-by-renew-session replay (fixture), as two more scenarios
  for (const [name, title, expect, blocked] of [
    ['40-build-235', 'The real build #235 (replayed from the fixture)', 'red; 940 passed (6 flaky, 2 on rerun); too big (commit 2)', false],
    ['41-build-235-blocked', 'Build #235 data with the renew-session failure injected', 'BLOCKED naming renew-session', true],
  ] as const) {
    const rp = replayBuild235({ blockedBySession: blocked ? { renewalFailure: renewal, cause: 'renew-session:failure' } : undefined });
    results.push({ spec: { name, title, expect, first: [], completeness: blocked ? { expected: 11, reported: 0, cause: 'renew-session:failure' } : undefined }, env: 'staging', branch: 'sandbox', html: rp.html, sent: rp.sent, subject: rp.subject, report: rp.report, ctx: rp.ctx, summary: rp.summary, list: rp.list, record: rp.record, kind: 'email' });
  }

  const rows = results.map(row);
  const violations = results.flatMap(invariants);
  // Red samples for the module-coverage invariant: a run's email that drops a module (or one side, or miscounts it) must be reported
  {
    const every = results.find((x) => x.spec.name === '60-every-module-incl-billing')!;
    const exp = every.spec.expectModules!;
    const dropRow = (html: string, name: string): string => {
      const at = html.indexOf(`>${name}</td>`, html.indexOf('id="all-modules"'));
      const start = html.lastIndexOf('<tr style="border-bottom', at);
      const next = html.indexOf('<tr style="border-bottom', at);
      const end = next > 0 ? next : html.indexOf('</table>', at);
      return html.slice(0, start) + html.slice(end);
    };
    const samples: Array<[string, string[], boolean]> = [
      ['the full email: every module has its row', moduleCoverageViolations(every.html, exp), false],
      ['the Billing row dropped', moduleCoverageViolations(dropRow(every.html, 'Billing'), exp), true],
      ['the Dashboard row dropped', moduleCoverageViolations(dropRow(every.html, 'Dashboard'), exp), true],
      ['a module the run does not have (extra row)', moduleCoverageViolations(every.html, exp.filter((e) => e.name !== 'Reports')), true],
      ['a miscounted side (Billing UI expected 7, the row says 6)', moduleCoverageViolations(every.html, exp.map((e) => (e.name === 'Billing' && e.type === 'UI' ? { ...e, total: 7 } : e))), true],
    ];
    for (const [what, found, shouldFail] of samples) {
      if ((found.length > 0) !== shouldFail) violations.push({ scenario: 'module-coverage-red-samples', id: 'invariant-self-test', message: `${what}: expected ${shouldFail ? 'a violation' : 'none'}, got ${JSON.stringify(found)}` });
    }
  }
  // Red samples for the run-times invariant (2026-11-26): each of these orderings must be reported, and the good one must not
  const T = { s: '2026-11-25T14:08:52.000Z', e: '2026-11-25T16:32:18.000Z' };
  const good = { runStart: { iso: '2026-11-25T14:05:00.000Z', source: 'github-run' as const }, runEnd: '2026-11-25T16:36:00.000Z' };
  const redSamples: Array<[string, ReturnType<typeof runTimesViolations>, boolean]> = [
    ['run start before tests start before tests end before run end: holds', runTimesViolations(good, T.s, T.e), false],
    ['run start unknown: only the tests are compared', runTimesViolations({ runStart: null, runEnd: good.runEnd }, T.s, T.e), false],
    ['run start after tests start (the old "Started" was the shards\' start)', runTimesViolations({ ...good, runStart: { iso: '2026-11-25T14:20:00.000Z', source: 'github-run' } }, T.s, T.e), true],
    ['tests end after run end (an "Ended" later than the email)', runTimesViolations({ ...good, runEnd: '2026-11-25T16:00:00.000Z' }, T.s, T.e), true],
    ['tests end before tests start', runTimesViolations(good, T.e, T.s), true],
  ];
  for (const [what, found, shouldFail] of redSamples) {
    if ((found.length > 0) !== shouldFail) violations.push({ scenario: 'run-times-red-samples', id: 'invariant-self-test', message: `${what}: expected ${shouldFail ? 'a violation' : 'none'}, got ${JSON.stringify(found)}` });
  }
  const failing = violations.filter((x) => !isKnown(x));
  const known = violations.filter((x) => isKnown(x));

  const header = '| scenario | first run P/F/Fl/S/DNR | Final result P/F/-/S/DNR | tiles Passed·Flaky·Failed·Skipped | subject | executive summary, first line | verdict | health | history (first run; after) | rerun table notes | size |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const md = [header, ...rows.map((r) => `| ${r.name} | ${r.first} | ${r.final} | ${r.tiles} | ${r.subject} | ${r.exec} | ${r.verdict} | ${r.health} | ${r.history} | ${r.rerun} | ${r.sizeKiB} |`)].join('\n');

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    // the real message refers to the donut as cid:<id> (an inline attachment); a browser cannot, so the review files carry the same PNG as a data URI
    const review = (r: ScenarioResult): string => {
      const png = r.ctx ? new EmailTemplate().chartAttachment(r.ctx) : null;
      return png ? r.sent.split(`cid:${DONUT_CID}`).join(`data:image/png;base64,${png.content.toString('base64')}`) : r.sent;
    };
    for (const s of results) fs.writeFileSync(path.join(outDir, `${s.spec.name}.html`), review(s));
    fs.writeFileSync(path.join(outDir, 'matrix.md'), `${md}\n\n## Findings (known, not failing)\n${known.map((k) => `- ${k.scenario}: [${k.id}] ${k.message}`).join('\n')}\n`);
    const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const items = results
      .map((s, i) => {
        const vs = violations.filter((x) => x.scenario === s.spec.name);
        const flags = vs.map((x) => `<span class="${isKnown(x) ? 'k' : 'f'}" title="${esc(x.message)}">${x.id}${isKnown(x) ? ' (known)' : ''}</span>`).join(' ');
        return `<tr><td><a href="${s.spec.name}.html">${esc(s.spec.name)}</a></td><td>${esc(s.spec.title)}<br><small>${esc(s.spec.expect)}</small></td><td>${esc(s.subject)}</td><td>${rows[i].sizeKiB}</td><td>${flags || '<span class="ok">all invariants hold</span>'}</td></tr>`;
      })
      .join('\n');
    fs.writeFileSync(
      path.join(outDir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Reporting scenarios</title><style>body{font:13px system-ui;margin:20px;background:#f6f8fa}table{border-collapse:collapse;background:#fff}td,th{border:1px solid #d0d7de;padding:6px 10px;vertical-align:top}th{background:#eef1f5;text-align:left}small{color:#57606a}.ok{color:#1a7f37}.f{background:#ffebe9;color:#cf222e;padding:1px 5px;border-radius:4px}.k{background:#fff8c5;color:#7d4e00;padding:1px 5px;border-radius:4px}</style><h2>Reporting scenarios (${results.length})</h2><p>Each row is one run replayed through the real pipeline. Yellow tags are findings that are listed but not decided yet; hover for the explanation. <a href="matrix.md">matrix.md</a></p><table><tr><th>scenario</th><th>what it is, and what a reader should conclude</th><th>subject</th><th>size</th><th>invariants</th></tr>\n${items}</table>`
    );
  }

  process.stdout.write(`${md}\n\n`);
  for (const x of failing) process.stdout.write(`FAIL  ${x.scenario}: [${x.id}] ${x.message}\n`);
  const byId = new Map<string, Violation[]>();
  for (const k of known) byId.set(k.id, [...(byId.get(k.id) ?? []), k]);
  for (const [id, list] of byId) process.stdout.write(`KNOWN [${id}] ${list.length} scenario(s): ${list.map((l) => l.scenario).join(', ')}\n        ${KNOWN.find((k) => k.id === id)?.reason}\n`);
  const checksRun = results.length * 30;
  process.stdout.write(failing.length === 0 ? `\ncheck:scenarios — ${results.length} scenarios, invariants hold (${known.length} known finding(s) listed above)${outDir ? `; rendered to ${outDir}` : ''}\n` : `\ncheck:scenarios — ${failing.length} invariant violation(s) in ${new Set(failing.map((x) => x.scenario)).size} scenario(s) (of about ${checksRun} checks)\n`);
  process.exitCode = failing.length === 0 ? 0 : 1;
}

if (require.main === module) main();
