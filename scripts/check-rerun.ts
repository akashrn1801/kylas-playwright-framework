/**
 * Offline tests for the rerun shard's logic (ADR 0015): selection (src/notifications/RerunResults.ts selectRerun),
 * combination (combineRerun), the summary file reader and the real ReportParser on a combined report.
 *
 *   npm run check:rerun
 *
 * No network, no browser, no clock. Fixtures are built here in the shape Playwright 1.60.0's JSON reporter writes
 * (verified 2026-11-03 with a throwaway project, see ADR 0015). Exit 1 on any failed check.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportParser } from '../src/notifications/ReportParser';
import {
  JsonReport,
  JsonResult,
  JsonTest,
  RerunList,
  SelectOptions,
  classifyTest,
  combineRerun,
  selectRerun,
  walkTests,
} from '../src/notifications/RerunResults';
import { parseRerunSummary, rerunRowKey } from '../src/notifications/RerunSummary';

let failures = 0;
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const check = (ok: boolean, what: string, detail = ''): void => {
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────
const pass = (): JsonResult => ({ status: 'passed', duration: 100 });
const fail = (status = 'failed'): JsonResult => ({ status, duration: 100, error: { message: 'boom' }, errors: [{ message: 'boom' }] });
const skipped = (): JsonResult => ({ status: 'skipped', duration: 0 });

type Kind = 'passed' | 'flaky' | 'failed' | 'timedOut' | 'did-not-run' | 'skip-annotated' | 'declared-skip' | 'interrupted';
function test(kind: Kind): JsonTest {
  switch (kind) {
    case 'passed': return { projectName: 'chromium', status: 'expected', expectedStatus: 'passed', annotations: [], results: [pass()] };
    case 'flaky': return { projectName: 'chromium', status: 'flaky', expectedStatus: 'passed', annotations: [], results: [fail(), pass()] };
    case 'failed': return { projectName: 'chromium', status: 'unexpected', expectedStatus: 'passed', annotations: [], results: [fail(), fail()] };
    case 'timedOut': return { projectName: 'chromium', status: 'unexpected', expectedStatus: 'passed', annotations: [], results: [fail('timedOut'), fail('timedOut')] };
    case 'did-not-run': return { projectName: 'chromium', status: 'skipped', expectedStatus: 'passed', annotations: [], results: [skipped(), skipped()] };
    case 'skip-annotated': return { projectName: 'chromium', status: 'skipped', expectedStatus: 'passed', annotations: [{ type: 'skip', description: 'no custom field here' }], results: [skipped()] };
    case 'declared-skip': return { projectName: 'chromium', status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip' }], results: [skipped()] };
    case 'interrupted': return { projectName: 'chromium', status: 'skipped', expectedStatus: 'passed', annotations: [], results: [{ status: 'interrupted', duration: 50 }] };
  }
}

interface Def { file: string; title: string; line: number; kind: Kind }
function report(defs: Def[], duration = 600000): JsonReport {
  const byFile = new Map<string, Def[]>();
  for (const d of defs) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  return {
    config: { version: '1.60.0' },
    stats: { startTime: '2026-11-03T06:00:00.000Z', duration },
    suites: [...byFile].map(([file, ds]) => ({
      title: file,
      file,
      specs: ds.map((d) => ({ title: `@regression ${d.title}`, file, line: d.line, ok: d.kind === 'passed' || d.kind === 'flaky', tests: [test(d.kind)] })),
    })),
  };
}

const OPTS: SelectOptions = {
  maxTests: 60,
  includeFlaky: true,
  excludePrefixes: ['tests/ui/formFields', 'tests/rbac/formFields'],
  testDir: 'tests',
  isSerialFile: (f) => f === 'ui/quotations/quotations.spec.ts',
};
const META = { retries: 0, runId: '100', runAttempt: 1 };
const FIRST: Def[] = [
  { file: 'ui/leads/leads.spec.ts', title: 'ok', line: 10, kind: 'passed' },
  { file: 'ui/leads/leads.spec.ts', title: 'flaky one', line: 20, kind: 'flaky' },
  { file: 'ui/leads/leads.spec.ts', title: 'hard fail', line: 30, kind: 'failed' },
  { file: 'ui/leads/leads.spec.ts', title: 'times out', line: 40, kind: 'timedOut' },
  { file: 'ui/quotations/quotations.spec.ts', title: 'q1 fails', line: 5, kind: 'failed' },
  { file: 'ui/quotations/quotations.spec.ts', title: 'q2 did not run', line: 6, kind: 'did-not-run' },
  { file: 'ui/quotations/quotations.spec.ts', title: 'q3 did not run', line: 7, kind: 'did-not-run' },
  { file: 'ui/deals/deals.spec.ts', title: 'skipped by annotation', line: 9, kind: 'skip-annotated' },
  { file: 'ui/deals/deals.spec.ts', title: 'declared skip', line: 12, kind: 'declared-skip' },
  { file: 'ui/deals/deals.spec.ts', title: 'cut off', line: 15, kind: 'interrupted' },
  { file: 'ui/formFields/leadFieldLimits.spec.ts', title: 'ff fails', line: 3, kind: 'failed' },
];

function main(): void {
  // ── classification ──
  check(classifyTest(test('passed')).cls === 'passed', 'classify: clean pass');
  check(classifyTest(test('flaky')).cls === 'flaky', 'classify: passed on in-job retry = flaky');
  check(classifyTest(test('timedOut')).cls === 'failed' && classifyTest(test('timedOut')).reason === 'timedOut', 'classify: test timeout = failed, reason timedOut');
  check(classifyTest(test('did-not-run')).cls === 'not-run', 'classify: serial dependent that did not run = not-run');
  check(classifyTest(test('skip-annotated')).cls === 'skipped', 'classify: skip annotation = deliberate skip, not a candidate');
  check(classifyTest(test('declared-skip')).cls === 'skipped', 'classify: expectedStatus skipped = deliberate skip');
  check(classifyTest(test('interrupted')).cls === 'not-run' && classifyTest(test('interrupted')).reason === 'cut off', 'classify: interrupted (cut off) = did not run (never failed)');

  // ── selection ──
  const list = selectRerun(report(FIRST), OPTS, META);
  const titles = list.candidates.map((c) => c.title).sort();
  check(list.decision === 'run', 'select: decision run');
  check(JSON.stringify(titles) === JSON.stringify(['cut off', 'hard fail', 'q1 fails', 'q2 did not run', 'q3 did not run', 'times out']), 'select: failed, timeout, cut-off and did-not-run are candidates, flaky ones are NOT (the run has failed tests); passed, annotated and declared skips are not', titles.join(' | '));
  check(!list.candidates.some((c) => c.file.includes('formFields')) && list.excluded.some((e) => e.file.includes('formFields')), 'select: formFields tests are excluded (and listed as excluded), never rerun');
  check(list.targets.includes('tests/ui/leads/leads.spec.ts:30') && list.targets.includes('tests/ui/leads/leads.spec.ts:40'), 'select: a normal file is targeted as file:line');
  check(list.targets.includes('tests/ui/quotations/quotations.spec.ts') && !list.targets.some((t) => t.startsWith('tests/ui/quotations/quotations.spec.ts:')), 'select: a serial file is targeted whole (file only, no file:line)');
  check(new Set(list.targets).size === list.targets.length, 'select: targets are unique');
  check(list.maxTests === 60 && list.retries === 0 && list.runId === '100' && list.runAttempt === 1, 'select: list carries cap, retries, run id and attempt');

  const flakyOnly: Def[] = [{ file: 'ui/a.spec.ts', title: 'ok', line: 1, kind: 'passed' }, { file: 'ui/a.spec.ts', title: 'flaky x', line: 2, kind: 'flaky' }, { file: 'ui/a.spec.ts', title: 'flaky y', line: 3, kind: 'flaky' }];
  const fo = selectRerun(report(flakyOnly), OPTS, META);
  check(fo.decision === 'run' && fo.candidates.length === 2 && fo.candidates.every((c) => c.first === 'flaky'), 'select: no failed/timed-out/did-not-run test in the run = the flaky tests are rerun');
  check(list.excluded.some((e) => e.title === 'flaky one' && /failed tests/.test(e.reason)), 'select: with failed tests the flaky ones are listed as excluded, with the reason');
  const noFlaky = selectRerun(report(flakyOnly), { ...OPTS, includeFlaky: false }, META);
  check(!noFlaky.candidates.some((c) => c.title === 'flaky x') && noFlaky.excluded.some((e) => e.title === 'flaky x'), 'select: includeFlaky off leaves flaky tests out and says so');
  const capped = selectRerun(report(FIRST), { ...OPTS, maxTests: 3 }, META);
  check(capped.decision === 'cap' && capped.targets.length === 0 && capped.candidates.length === 6, 'select: more candidates than the cap = decision cap, no targets');
  const atCap = selectRerun(report(FIRST), { ...OPTS, maxTests: 6 }, META);
  check(atCap.decision === 'run', 'select: exactly the cap still runs');
  const clean = selectRerun(report([{ file: 'ui/a.spec.ts', title: 'ok', line: 1, kind: 'passed' }, { file: 'ui/a.spec.ts', title: 'skip', line: 2, kind: 'declared-skip' }]), OPTS, META);
  check(clean.decision === 'none' && clean.candidates.length === 0 && clean.targets.length === 0, 'select: nothing failed or flaky = decision none');
  const params = report([
    { file: 'ui/p.spec.ts', title: 'param A', line: 8, kind: 'failed' },
    { file: 'ui/p.spec.ts', title: 'param B', line: 8, kind: 'passed' },
    { file: 'ui/p.spec.ts', title: 'param C', line: 8, kind: 'failed' },
  ]);
  const pl = selectRerun(params, OPTS, META);
  check(pl.candidates.length === 2 && pl.targets.length === 1 && pl.targets[0] === 'tests/ui/p.spec.ts:8', 'select: tests generated on one line = one file:line target, only the failing ones are candidates');
  const keys = new Set<string>();
  walkTests(params, (t) => keys.add(t.key));
  check(keys.size === 3, 'keys: parameterised tests on one line still get distinct keys');

  // ── combination ──
  const firstReport = report(FIRST);
  const frozen = JSON.stringify(firstReport);
  const rerunDefs: Def[] = [
    { file: 'ui/leads/leads.spec.ts', title: 'flaky one', line: 20, kind: 'passed' },
    { file: 'ui/leads/leads.spec.ts', title: 'hard fail', line: 30, kind: 'passed' },
    { file: 'ui/leads/leads.spec.ts', title: 'times out', line: 40, kind: 'failed' },
    { file: 'ui/quotations/quotations.spec.ts', title: 'q1 fails', line: 5, kind: 'passed' },
    { file: 'ui/quotations/quotations.spec.ts', title: 'q2 did not run', line: 6, kind: 'passed' },
    { file: 'ui/quotations/quotations.spec.ts', title: 'q3 did not run', line: 7, kind: 'failed' },
    { file: 'ui/deals/deals.spec.ts', title: 'cut off', line: 15, kind: 'passed' },
  ];
  const rerunReport = report(rerunDefs, 90000);
  const { combined, summary } = combineRerun(firstReport, rerunReport, list, { runId: '100', runAttempt: 1 });
  check(JSON.stringify(firstReport) === frozen, 'combine: the first-run report object is not mutated');
  const row = (t: string) => summary.rows.find((r) => r.title === t);
  const stat = (t: string): string => { let s = ''; walkTests(combined, (x) => { if (x.title === t) s = x.test.status; }); return s; };
  check(row('hard fail')?.first === 'failed' && row('hard fail')?.rerun === 'passed' && row('hard fail')?.final === 'recovered' && stat('hard fail') === 'flaky', 'combine: failed first, passed on rerun = recovered, test status flaky (never a clean pass)');
  check(row('times out')?.final === 'failed' && stat('times out') === 'unexpected', 'combine: failed first, failed on rerun = failed');
  check(!row('flaky one') && stat('flaky one') === 'flaky', 'combine: a flaky test of a run with failures is not rerun (no row, stays flaky even if the rerun report has it)');
  const fl = selectRerun(report(flakyOnly), OPTS, META);
  const flc = combineRerun(report(flakyOnly), report([{ file: 'ui/a.spec.ts', title: 'flaky x', line: 2, kind: 'passed' }, { file: 'ui/a.spec.ts', title: 'flaky y', line: 3, kind: 'failed' }], 100), fl, {});
  check(flc.summary.rows.find((r) => r.title === 'flaky x')?.final === 'flaky' && flc.summary.rows.find((r) => r.title === 'flaky y')?.final === 'flaky' && flc.summary.afterRerun.flaky === 2, 'combine: flaky first stays flaky whatever the rerun does (passed or failed)');
  check(row('q1 fails')?.final === 'recovered' && row('q2 did not run')?.first === 'not-run' && row('q2 did not run')?.final === 'passed' && stat('q2 did not run') === 'expected', 'combine: serial dependent that did not run never failed: passing on rerun = Passed (ran only on rerun), not flaky');
  check(row('q3 did not run')?.final === 'failed' && stat('q3 did not run') === 'unexpected', 'combine: a dependent that did not run and fails on rerun = failed');
  check(row('cut off')?.first === 'not-run' && row('cut off')?.final === 'passed', 'combine: cut-off (interrupted) test that passes on rerun = Passed (it never failed)');
  let hardResults = 0; walkTests(combined, (x) => { if (x.title === 'hard fail') hardResults = x.test.results.length; });
  check(hardResults === 3, 'combine: the rerun result is appended to the first run results (2 attempts + 1 rerun)', String(hardResults));
  let q2Results = 0; walkTests(combined, (x) => { if (x.title === 'q2 did not run') q2Results = x.test.results.length; });
  check(q2Results === 1, 'combine: "did not run" placeholders are replaced by the rerun result');
  check(summary.recovered === 2 && summary.stillFailing === 2 && summary.rows.length === 6 && summary.ran, 'combine: recovered 2 (hard fail, q1; q2 and cut off ran only on rerun), still failing 2 (times out, q3)', `${summary.recovered}/${summary.stillFailing}/${summary.rows.length}`);
  check(JSON.stringify(summary.firstRun) === JSON.stringify({ passed: 1, failed: 4, flaky: 1, skipped: 2, didNotRun: 3, total: 11 }), 'combine: first-run counts come from the report before the rerun (did-not-run counted apart from failed)', JSON.stringify(summary.firstRun));
  check(JSON.stringify(summary.afterRerun) === JSON.stringify({ passed: 3, failed: 3, flaky: 3, skipped: 2, didNotRun: 0, total: 11 }), 'combine: after-rerun counts: recovered tests count as flaky; q2 and cut off count as passed; failed = times out, q3 and the excluded formFields test', JSON.stringify(summary.afterRerun));
  check(combined.stats?.duration === 690000, 'combine: rerun wall-clock time is added to the run duration', String(combined.stats?.duration));
  check(!summary.rows.some((r) => r.title === 'ff fails') && summary.excluded.length === 2, 'combine: excluded tests (formFields, flaky of a failing run) stay untouched and are listed');

  // a test that fails in the rerun but was NOT selected (serial file rerun whole) must be ignored
  const wholeFileRerun = report([...rerunDefs, { file: 'ui/quotations/quotations.spec.ts', title: 'q0 passed first', line: 4, kind: 'failed' }], 1000);
  const firstWithQ0 = report([...FIRST, { file: 'ui/quotations/quotations.spec.ts', title: 'q0 passed first', line: 4, kind: 'passed' }]);
  const listQ0 = selectRerun(firstWithQ0, OPTS, META);
  const r2 = combineRerun(firstWithQ0, wholeFileRerun, listQ0, {});
  let q0 = ''; walkTests(r2.combined, (x) => { if (x.title === 'q0 passed first') q0 = x.test.status; });
  check(q0 === 'expected' && !r2.summary.rows.some((r) => r.title === 'q0 passed first'), 'combine: a test that passed first but fails inside a whole-file rerun is ignored (extra executions never hurt)');

  // a selected test the rerun produced no result for
  const partial = combineRerun(firstReport, report(rerunDefs.slice(0, 2), 10), list, {});
  check(partial.summary.rows.find((r) => r.title === 'q1 fails')?.rerun === 'not-rerun' && partial.summary.rows.find((r) => r.title === 'q1 fails')?.final === 'failed', 'combine: selected but not rerun = rerun "not-rerun", final failed');

  // decisions without a rerun leave the report byte-identical
  for (const [name, l] of [['none', clean], ['cap', capped]] as const) {
    const r = combineRerun(firstReport, null, l as RerunList, {});
    check(JSON.stringify(r.combined) === frozen && !r.summary.ran && r.summary.reason === name && r.summary.rows.length === 0, `combine: decision ${name}: report unchanged, summary says why`);
  }
  const noResults = combineRerun(firstReport, null, list, {});
  check(JSON.stringify(noResults.combined) === frozen && noResults.summary.reason === 'no-results', 'combine: decision run but no rerun results: report unchanged, reason no-results');

  // stacking: a manual rerun of a run that already had an automatic rerun keeps the ORIGINAL first-run view
  const second = selectRerun(combined, OPTS, META);
  const secondRerun = report([
    { file: 'ui/leads/leads.spec.ts', title: 'times out', line: 40, kind: 'passed' },
    { file: 'ui/quotations/quotations.spec.ts', title: 'q3 did not run', line: 7, kind: 'failed' },
    { file: 'ui/leads/leads.spec.ts', title: 'hard fail', line: 30, kind: 'failed' },
  ], 5000);
  const stacked = combineRerun(combined, secondRerun, second, { previous: summary, rerunOf: { runId: '99', runNumber: '12' } });
  const srow = (t: string) => stacked.summary.rows.find((r) => r.title === t);
  check(JSON.stringify(stacked.summary.firstRun) === JSON.stringify(summary.firstRun), 'stacked: first-run counts stay those of the original run');
  check(srow('times out')?.first === 'failed' && srow('times out')?.final === 'recovered', 'stacked: failed -> failed -> passed is recovered (first stays "failed")');
  check(stacked.summary.rerunOf?.runNumber === '12', 'stacked: rerunOf is recorded');

  // ── the real ReportParser on a combined report ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-rerun-'));
  const parse = (r: JsonReport) => { const f = path.join(tmp, `r${Math.random()}.json`); fs.writeFileSync(f, JSON.stringify(r)); return new ReportParser().parse(f); };
  const only: Def[] = [{ file: 'ui/a.spec.ts', title: 'ok', line: 1, kind: 'passed' }, { file: 'ui/a.spec.ts', title: 'was failing', line: 2, kind: 'failed' }];
  const firstOnly = parse(report(only));
  check(firstOnly.status === 'failed' && firstOnly.failed === 1, 'parser: first run alone is failed');
  const l1 = selectRerun(report(only), OPTS, META);
  const rec = combineRerun(report(only), report([{ file: 'ui/a.spec.ts', title: 'was failing', line: 2, kind: 'passed' }]), l1, {});
  const parsedRec = parse(rec.combined);
  check(parsedRec.status === 'unstable' && parsedRec.failed === 0 && parsedRec.flaky === 1 && parsedRec.passed === 1, 'parser: a run whose only failure recovered on rerun is "unstable" (never "passed"), recovered counts as flaky', `${parsedRec.status} ${parsedRec.failed}/${parsedRec.flaky}/${parsedRec.passed}`);
  check(parsedRec.flakyTests[0]?.title === 'was failing' && parsedRec.flakyTests[0].retries === 2, 'parser: the recovered test is listed as flaky with its failed attempts and the rerun');
  const key = rerunRowKey(parsedRec.flakyTests[0].file, parsedRec.flakyTests[0].title);
  check(rec.summary.rows.some((r) => rerunRowKey(r.file, r.title) === key), 'summary rows are found by the file and title the email gets from ReportParser');
  fs.rmSync(tmp, { recursive: true, force: true });

  // ── summary reader ──
  check(parseRerunSummary('{ nope') === null && parseRerunSummary('{"version":2}') === null && parseRerunSummary('{"version":1,"ran":true}') === null, 'summary reader: garbage, wrong version or missing parts = null (email behaves as before)');
  const back = parseRerunSummary(JSON.stringify(summary));
  check(!!back && back.rows.length === summary.rows.length && back.firstRun.failed === 4, 'summary reader: a written summary reads back');

  out(failures === 0 ? '\ncheck:rerun — all checks passed' : `\ncheck:rerun — ${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
