/**
 * Small pure checks for the helpers behind the run email (piece 3, 2026-11-26): outcome classification, module grouping, verdict and colour
 * rules, branch advice, capacity colour rules, run-time lines, wording helpers. No rendering, no files, no network.
 * Run: npm run check:email-units
 */
import { classifyTest, JsonTest } from '../src/notifications/RerunResults';
import { deriveModuleFromFile, FLAKY_BUDGET, ParsedReport } from '../src/notifications/ReportParser';
import { moduleBaseline } from '../src/notifications/SuiteBaseline';
import { branchAdvice, computeOverallVerdict, HealthScore } from '../src/notifications/AutomationHealth';
import { capacityColour } from '../src/modules/billing/capacity';
import { jenkinsRunStart, runTimesViolations } from '../src/notifications/RunTimes';
import { be, hasHave, nounFor, plural, wasWere } from '../src/notifications/wording';

let failed = 0;
let total = 0;
const eq = (what: string, got: unknown, want: unknown): void => {
  total += 1;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed += 1;
    process.stdout.write(`FAIL  ${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}\n`);
  }
};

// ── outcome classification (what a test's results mean) ──
const t = (status: string, results: string[], extra: Partial<JsonTest> = {}): JsonTest =>
  ({ projectName: 'chromium', expectedStatus: 'passed', annotations: [], status, results: results.map((r) => ({ status: r, duration: 1 })), ...extra } as unknown as JsonTest);
eq('classify: expected = passed', classifyTest(t('expected', ['passed'])).cls, 'passed');
eq('classify: flaky', classifyTest(t('flaky', ['failed', 'passed'])).cls, 'flaky');
eq('classify: unexpected = failed', classifyTest(t('unexpected', ['failed', 'failed'])).cls, 'failed');
eq('classify: timed out keeps its reason', classifyTest(t('unexpected', ['timedOut', 'timedOut'])), { cls: 'failed', reason: 'timedOut' });
eq('classify: deliberate skip', classifyTest(t('skipped', ['skipped'], { expectedStatus: 'skipped' })).cls, 'skipped');
eq('classify: skip annotation', classifyTest(t('skipped', ['skipped'], { annotations: [{ type: 'skip' }] } as Partial<JsonTest>)).cls, 'skipped');
eq('classify: serial dependent that did not run', classifyTest(t('skipped', ['skipped', 'skipped'])).cls, 'not-run');
eq('classify: cut off (interrupted)', classifyTest(t('skipped', ['interrupted'])), { cls: 'not-run', reason: 'cut off' });

// ── module grouping ──
eq('module: ui folder', deriveModuleFromFile('ui/leads/leads.spec.ts'), { name: 'Leads', type: 'UI' });
eq('module: rbac file', deriveModuleFromFile('rbac/leads.rbac.spec.ts'), { name: 'Leads', type: 'RBAC' });
eq('module: with the tests/ prefix', deriveModuleFromFile('tests/rbac/billing/billing.rbac.spec.ts'), { name: 'Billing', type: 'RBAC' });
eq('module: formFields entity file', deriveModuleFromFile('ui/formFields/leadFieldLimits.spec.ts'), { name: 'Leads — Field Limits', type: 'UI' });
eq('module: formFields rbac file', deriveModuleFromFile('rbac/formFields/companyFormFields.rbac.spec.ts'), { name: 'Companies — Field Limits', type: 'RBAC' });
eq('module: hyphenated folder', deriveModuleFromFile('ui/call-logs/call-logs.spec.ts').name, 'Call-logs');
eq('module: login lives under Dashboard', deriveModuleFromFile('ui/dashboard/login.spec.ts').name, 'Dashboard');
eq('baseline: files add up per module and side', moduleBaseline({ 'ui/billing/billing.spec.ts': 6, 'rbac/billing/billing.rbac.spec.ts': 2, 'ui/formFields/leadFieldLimits.spec.ts': 3, 'ui/leads/leads.spec.ts': 40, 'ui/leads/more.spec.ts': 2 }), { 'UI:Billing': 6, 'RBAC:Billing': 2, 'UI:Leads — Field Limits': 3, 'UI:Leads': 42 });

// ── verdict and colour rules ──
const report = (o: Record<string, unknown> = {}): ParsedReport =>
  ({ total: 30, passed: 30, failed: 0, flaky: 0, skipped: 0, didNotRun: 0, ranOnlyOnRerun: 0, recoveredOnRerun: 0, finalPassed: 30, status: 'passed', firstRun: { passed: 30, failed: 0, flaky: 0 }, ...o } as unknown as ParsedReport);
const health = { label: 'Excellent', score: 100 } as unknown as HealthScore;
const verdictOf = (o: Record<string, unknown>, branch = 'sandbox'): string => { const v = computeOverallVerdict(report(o), health, null, null, null, branch); return `${v.verdict}/${v.bannerTone}`; };
eq('verdict: clean = clear green', verdictOf({}), 'clear/success');
eq('verdict: a failure = blocked red', verdictOf({ failed: 1 }), 'blocked/danger');
eq(`verdict: flaky at the budget (${FLAKY_BUDGET}) stays green`, verdictOf({ firstRun: { passed: 27, failed: 0, flaky: FLAKY_BUDGET } }), 'clear/success');
eq('verdict: flaky above the budget = amber', verdictOf({ firstRun: { passed: 26, failed: 0, flaky: FLAKY_BUDGET + 1 } }), 'caution/warning');
eq('verdict: a test that passed only on the rerun = amber', verdictOf({ recoveredOnRerun: 1 }), 'caution/warning');
eq('verdict: a test that did not run = amber', verdictOf({ didNotRun: 1 }), 'caution/warning');
eq('verdict: nothing selected = amber, never green', verdictOf({ total: 0, passed: 0, finalPassed: 0, firstRun: { passed: 0, failed: 0, flaky: 0 } }), 'caution/warning');
eq('verdict: nothing executed = blocked', verdictOf({ status: 'no-tests-executed' }), 'blocked/danger');
eq('verdict: capacity stop = blocked', computeOverallVerdict(report(), health, null, null, null, 'sandbox', { kind: 'no-records', message: 'x' }).verdict, 'blocked');
eq('verdict: renewal failure = blocked', computeOverallVerdict(report(), health, null, null, { cause: 'renew-session:failure' } as never, 'sandbox').verdict, 'blocked');

// ── branch advice ──
eq('advice: sandbox and feature branches go to a PR to dev', [branchAdvice('sandbox').next, branchAdvice('feature/x').next], ['PR to dev', 'PR to dev']);
eq('advice: the promotion chain', ['dev', 'qa', 'stage', 'prod'].map((b) => branchAdvice(b).next), ['promote to qa', 'promote to stage', 'promote to prod', 'promote to main']);
eq('advice: main and any other branch say deployment', [branchAdvice('main').next, branchAdvice('release/9').next, branchAdvice(undefined).next], ['Deployment', 'Deployment', 'Deployment']);
eq('advice: wording per state', [branchAdvice('dev').ready, branchAdvice('dev').notReady], ['Ready to promote to qa', 'Not ready to promote to qa']);

// ── capacity colour rules ──
eq('capacity: none left is red', capacityColour(0, 10000), 'red');
eq('capacity: below zero is red', capacityColour(-5, 10000), 'red');
eq('capacity: under the threshold is yellow', capacityColour(9999, 10000), 'yellow');
eq('capacity: at the threshold is green', capacityColour(10000, 10000), 'green');
eq('capacity: plenty is green', capacityColour(221689, 10000), 'green');

// ── run-time lines ──
eq('times: in order = no violation', runTimesViolations({ runStart: { iso: '2026-11-25T14:05:00Z', source: 'github-run' }, runEnd: '2026-11-25T16:36:00Z' }, '2026-11-25T14:08:52Z', '2026-11-25T16:32:18Z'), []);
eq('times: run start after tests start is reported', runTimesViolations({ runStart: { iso: '2026-11-25T14:20:00Z', source: 'github-run' }, runEnd: '2026-11-25T16:36:00Z' }, '2026-11-25T14:08:52Z', '2026-11-25T16:32:18Z').length, 1);
eq('times: unknown run start compares only the tests', runTimesViolations({ runStart: null, runEnd: '2026-11-25T16:36:00Z' }, '2026-11-25T14:08:52Z', '2026-11-25T16:32:18Z'), []);
eq('jenkins start: a number of milliseconds', jenkinsRunStart({ RUN_STARTED_AT_MS: '1764079500000' })?.source, 'jenkins-build');
eq('jenkins start: absent or not a number = null', [jenkinsRunStart({}), jenkinsRunStart({ RUN_STARTED_AT_MS: 'abc' }), jenkinsRunStart({ RUN_STARTED_AT_MS: '0' })], [null, null, null]);

// ── wording and plural helpers ──
eq('plural: 1 / 0 / 2', [plural(1, 'test'), plural(0, 'test'), plural(2, 'test')], ['1 test', '0 tests', '2 tests']);
eq('plural: irregular', [plural(1, 'retry', 'retries'), plural(3, 'retry', 'retries')], ['1 retry', '3 retries']);
eq('nounFor', [nounFor(1, 'test'), nounFor(2, 'test')], ['test', 'tests']);
eq('be / wasWere / hasHave', [be(1), be(2), wasWere(1), wasWere(0), hasHave(1), hasHave(3)], ['is', 'are', 'was', 'were', 'has', 'have']);

process.stdout.write(failed === 0 ? `check:email-units — all ${total} checks pass\n` : `check:email-units — ${failed} of ${total} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
