/**
 * Pure logic of the rerun shard (ADR 0015): which tests of a first run to run
 * once more, and how the rerun's results are laid over the first run's JSON
 * report. No fs, no network, no clock: scripts/rerun-select.ts and
 * scripts/combine-rerun.ts do the file work, scripts/check-rerun.ts tests this.
 *
 * Facts this relies on (Playwright 1.60.0, checked 2026-11-03 with a throwaway
 * project, see ADR 0015):
 *  - `.last-run.json` lists only hard failures, so it is NOT used: flaky tests
 *    and serial dependents that "did not run" are missing from it.
 *  - A serial dependent that did not run is `status: skipped`, with
 *    `expectedStatus` other than 'skipped' and no skip/fixme annotation; a
 *    deliberate `test.skip()` has `expectedStatus: 'skipped'` or the annotation.
 *  - `file:line` runs exactly one test, even inside a serial block, so a serial
 *    file is rerun whole.
 *  - Feeding the first-run and the rerun blobs to one `merge-reports` DUPLICATES
 *    the test rows, so the rerun is overlaid here instead.
 */
import {
  RerunCounts,
  RerunFinalStatus,
  RerunFirstStatus,
  RerunOutcome,
  RerunSummary,
  RerunTestRow,
} from './RerunSummary';

// ── minimal shapes of Playwright's JSON report (only what is read or written) ─────────────────────────────────
export interface JsonResult {
  status: string;
  duration?: number;
  retry?: number;
  // Set on results appended from the rerun.
  rerun?: boolean;
  [k: string]: unknown;
}
export interface JsonTest {
  projectName?: string;
  status: string;
  expectedStatus?: string;
  annotations?: { type: string; description?: string }[];
  results: JsonResult[];
  [k: string]: unknown;
}
export interface JsonSpec {
  title: string;
  file: string;
  line: number;
  ok?: boolean;
  tests: JsonTest[];
  [k: string]: unknown;
}
export interface JsonSuite {
  title?: string;
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}
export interface JsonReport {
  suites?: JsonSuite[];
  stats?: { startTime?: string; duration?: number; expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  [k: string]: unknown;
}

export interface TestRef {
  key: string;
  file: string;
  line: number;
  // Title as ReportParser shows it (leading @tag removed).
  title: string;
  project: string;
  spec: JsonSpec;
  test: JsonTest;
}

export const stripTag = (title: string): string => title.replace(/^@\w+\s*/g, '');

/** Visits every test once, with a key that is the same in every report of the same commit. */
export function walkTests(report: JsonReport, visit: (t: TestRef) => void): void {
  const walk = (suite: JsonSuite, titles: string[]): void => {
    const path = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const project = test.projectName ?? '';
        visit({
          key: `${project}|${spec.file}:${spec.line}|${[...path, spec.title].join(' > ')}`,
          file: spec.file,
          line: spec.line,
          title: stripTag(spec.title),
          project,
          spec,
          test,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const s of report.suites ?? []) walk(s, []);
}

export type FirstClass = RerunFirstStatus | 'passed' | 'skipped';

export interface Classified {
  cls: FirstClass;
  reason?: string;
}

/** What a test's results mean for the rerun. Order matters: a hard result beats the test's own status. */
export function classifyTest(t: JsonTest): Classified {
  const last = t.results[t.results.length - 1];
  if (t.status === 'unexpected') return { cls: 'failed', reason: last?.status ?? 'failed' };
  if (t.status === 'flaky') return { cls: 'flaky' };
  if (t.status === 'expected') return { cls: 'passed' };
  // A run cut off by a signal leaves the test `skipped` with an interrupted result: it never finished, so rerun it.
  if (t.results.some((r) => r.status === 'interrupted')) return { cls: 'failed', reason: 'interrupted' };
  if (t.status === 'skipped') {
    const deliberate =
      t.expectedStatus === 'skipped' || (t.annotations ?? []).some((a) => a.type === 'skip' || a.type === 'fixme');
    return deliberate ? { cls: 'skipped' } : { cls: 'not-run', reason: 'did not run' };
  }
  return { cls: 'failed', reason: last?.status ?? t.status };
}

// ── selection ────────────────────────────────────────────────────────────────────────────────────────────────
export interface SelectOptions {
  maxTests: number;
  includeFlaky: boolean;
  // Repo-relative directory prefixes whose tests are never rerun (config/sharedConfigSuites.json uiDir/rbacDir).
  excludePrefixes: string[];
  // Spec paths in the JSON are relative to Playwright's testDir.
  testDir: string;
  // True when the file configures serial mode: a single test of it cannot be rerun alone.
  isSerialFile: (fileUnderTestDir: string) => boolean;
}

export interface RerunCandidate {
  key: string;
  file: string;
  line: number;
  title: string;
  project: string;
  first: RerunFirstStatus;
  reason?: string;
  target: string;
}

export interface RerunList {
  version: 1;
  runId?: string;
  runAttempt?: number;
  decision: 'run' | 'none' | 'cap';
  maxTests: number;
  retries: number;
  includeFlaky: boolean;
  candidates: RerunCandidate[];
  excluded: { file: string; title: string; reason: string }[];
  // Playwright CLI arguments: `tests/<file>:<line>`, or `tests/<file>` for serial files. Empty unless decision is 'run'.
  targets: string[];
}

export function selectRerun(report: JsonReport, opts: SelectOptions, meta: { retries: number; runId?: string; runAttempt?: number }): RerunList {
  const candidates: RerunCandidate[] = [];
  const excluded: RerunList['excluded'] = [];
  walkTests(report, (t) => {
    const c = classifyTest(t.test);
    if (c.cls === 'passed' || c.cls === 'skipped') return;
    const repoPath = `${opts.testDir}/${t.file}`;
    if (opts.excludePrefixes.some((p) => repoPath === p || repoPath.startsWith(`${p}/`))) {
      excluded.push({ file: t.file, title: t.title, reason: 'shared-config suite (formFields): never rerun in v1' });
      return;
    }
    if (c.cls === 'flaky' && !opts.includeFlaky) {
      excluded.push({ file: t.file, title: t.title, reason: 'flaky tests are not rerun (RERUN_INCLUDE_FLAKY off)' });
      return;
    }
    candidates.push({
      key: t.key,
      file: t.file,
      line: t.line,
      title: t.title,
      project: t.project,
      first: c.cls,
      reason: c.reason,
      target: opts.isSerialFile(t.file) ? repoPath : `${repoPath}:${t.line}`,
    });
  });
  const base = { version: 1 as const, runId: meta.runId, runAttempt: meta.runAttempt, maxTests: opts.maxTests, retries: meta.retries, includeFlaky: opts.includeFlaky, excluded };
  if (candidates.length === 0) return { ...base, decision: 'none', candidates, targets: [] };
  if (candidates.length > opts.maxTests) return { ...base, decision: 'cap', candidates, targets: [] };
  return { ...base, decision: 'run', candidates, targets: [...new Set(candidates.map((c) => c.target))].sort() };
}

// ── combination ──────────────────────────────────────────────────────────────────────────────────────────────
const isPass = (t: JsonTest): boolean => t.status === 'expected' || t.status === 'flaky';

function rerunOutcome(t: JsonTest | undefined): RerunOutcome {
  if (!t) return 'not-rerun';
  if (t.status === 'skipped') return 'not-rerun';
  return isPass(t) ? 'passed' : 'failed';
}

function finalStatus(first: RerunFirstStatus, rerun: RerunOutcome): RerunFinalStatus {
  if (first === 'flaky') return 'flaky'; // it passed once in the first run: extra executions never turn it into a failure
  if (first === 'failed') return rerun === 'passed' ? 'recovered' : 'failed';
  return rerun === 'passed' ? 'passed' : rerun === 'failed' ? 'failed' : 'not-run';
}

export function countStatuses(report: JsonReport): RerunCounts {
  const counts: RerunCounts = { passed: 0, failed: 0, flaky: 0 };
  walkTests(report, (t) => {
    const c = classifyTest(t.test).cls;
    if (c === 'passed') counts.passed += 1;
    else if (c === 'failed') counts.failed += 1;
    else if (c === 'flaky') counts.flaky += 1;
  });
  return counts;
}

function recomputeStats(report: JsonReport, rerunDurationMs: number): void {
  const stats = report.stats ?? {};
  const s = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  walkTests(report, (t) => {
    if (t.test.status === 'expected') s.expected += 1;
    else if (t.test.status === 'unexpected') s.unexpected += 1;
    else if (t.test.status === 'flaky') s.flaky += 1;
    else s.skipped += 1;
  });
  // The rerun job runs after the shards, so its wall-clock time adds to the run's.
  report.stats = { ...stats, ...s, duration: (stats.duration ?? 0) + rerunDurationMs };
}

export interface CombineMeta {
  runId?: string;
  runAttempt?: number;
  rerunOf?: { runId: string; runNumber?: string };
  // Summary of an earlier combine of the same report (manual rerun of a run that already had an automatic rerun):
  // the FIRST run's status of each test and the first-run counts stay those of the original run.
  previous?: RerunSummary | null;
}

export function combineRerun(
  first: JsonReport,
  rerun: JsonReport | null,
  list: RerunList,
  meta: CombineMeta
): { combined: JsonReport; summary: RerunSummary } {
  const combined = JSON.parse(JSON.stringify(first)) as JsonReport;
  const prevRows = new Map((meta.previous?.rows ?? []).map((r) => [r.key, r]));
  const firstRun = meta.previous ? meta.previous.firstRun : countStatuses(first);
  const base: Omit<RerunSummary, 'ran' | 'afterRerun' | 'rows' | 'recovered' | 'stillFailing'> = {
    version: 1,
    runId: meta.runId,
    runAttempt: meta.runAttempt,
    maxTests: list.maxTests,
    retries: list.retries,
    includeFlaky: list.includeFlaky,
    candidates: list.candidates.length,
    firstRun,
    excluded: list.excluded,
    ...(meta.rerunOf ? { rerunOf: meta.rerunOf } : {}),
  };
  const noRun = (reason: string): { combined: JsonReport; summary: RerunSummary } => ({
    combined,
    summary: { ...base, ran: false, reason, afterRerun: countStatuses(combined), rows: [], recovered: 0, stillFailing: 0 },
  });
  if (list.decision !== 'run') return noRun(list.decision);
  if (!rerun) return noRun('no-results');

  const rerunTests = new Map<string, JsonTest>();
  walkTests(rerun, (t) => rerunTests.set(t.key, t.test));
  const wanted = new Map(list.candidates.map((c) => [c.key, c]));
  const rows: RerunTestRow[] = [];

  walkTests(combined, (t) => {
    const cand = wanted.get(t.key);
    if (!cand) return;
    const prev = prevRows.get(t.key);
    const firstStatus: RerunFirstStatus = prev ? prev.first : cand.first;
    const rt = rerunTests.get(t.key);
    const outcome = rerunOutcome(rt);
    if (rt && outcome !== 'not-rerun') {
      const tagged = rt.results.map((r) => ({ ...r, rerun: true }));
      if (firstStatus === 'not-run' && cand.first === 'not-run') {
        // Nothing real happened in the first run: the rerun result replaces the "skipped" placeholders.
        t.test.results = tagged;
        t.test.status = rt.status === 'flaky' ? 'flaky' : isPass(rt) ? 'expected' : 'unexpected';
      } else {
        t.test.results = [...t.test.results, ...tagged];
        if (firstStatus === 'failed') t.test.status = outcome === 'passed' ? 'flaky' : 'unexpected';
        else t.test.status = 'flaky';
      }
      t.spec.ok = t.spec.tests.every((x) => x.status === 'expected' || x.status === 'flaky' || x.status === 'skipped');
    }
    rows.push({
      key: t.key,
      file: t.file,
      line: t.line,
      title: t.title,
      first: firstStatus,
      rerun: outcome,
      final: finalStatus(firstStatus, outcome),
      ...(cand.reason ? { reason: cand.reason } : {}),
    });
  });

  recomputeStats(combined, rerun.stats?.duration ?? 0);
  return {
    combined,
    summary: {
      ...base,
      ran: true,
      durationMs: rerun.stats?.duration,
      afterRerun: countStatuses(combined),
      rows,
      recovered: rows.filter((r) => r.final === 'recovered').length,
      stillFailing: rows.filter((r) => r.final === 'failed').length,
    },
  };
}
