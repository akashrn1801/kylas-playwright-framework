/**
 * Result of the rerun shard (failed + flaky tests run once more), written by
 * scripts/combine-rerun.ts into reports/<env>/rerun-summary.json and read by
 * history sync and the email (ADR 0015).
 *
 * WHY a file in reports/<env>/, read the same optional/graceful way
 * shard-completeness.json and field-config-reset.json are: a run without a
 * rerun (kill switch off, old run, manual run of an old build) simply has no
 * file, and then `loadRerunSummary()` returns null and every consumer behaves
 * exactly as before this feature. A garbled file also means "no information".
 */
import * as fs from 'fs';
import * as path from 'path';

/** What the first run (all in-job retries used) made of a test. */
export type RerunFirstStatus = 'failed' | 'flaky' | 'not-run';
/** What the rerun made of it ('not-rerun' = it was selected but produced no result). */
export type RerunOutcome = 'passed' | 'failed' | 'not-rerun';
/** Final status: 'passed' on a row whose first status is 'not-run' = it ran only on the rerun (never failed, so not flaky). 'recovered' = failed on every first-run attempt, passed on the rerun (counts as FLAKY, never as clean). */
export type RerunFinalStatus = 'passed' | 'recovered' | 'flaky' | 'failed' | 'not-run';

export interface RerunTestRow {
  key: string;
  file: string;
  line: number;
  title: string;
  first: RerunFirstStatus;
  rerun: RerunOutcome;
  final: RerunFinalStatus;
  // First-run failure kind ('timedOut', 'failed', 'interrupted') or 'did not run'.
  reason?: string;
}

export interface RerunCounts {
  passed: number;
  // Failed = failed on every attempt, including timeouts. A test that never ran is counted in didNotRun, not here.
  failed: number;
  flaky: number;
  // skipped = deliberate skips only; didNotRun = serial dependents after a failure, tests of a cut-off shard.
  // Optional with `total`: older summaries lack them. passed + failed + flaky + skipped + didNotRun = total.
  skipped?: number;
  didNotRun?: number;
  total?: number;
}

export interface RerunSummary {
  version: 1;
  ran: boolean;
  // Why nothing ran: 'none' (no failed/flaky tests), 'cap' (more than maxTests), 'no-blobs', 'no-results'.
  reason?: string;
  runId?: string;
  runAttempt?: number;
  maxTests: number;
  retries: number;
  includeFlaky: boolean;
  candidates: number;
  recovered: number;
  stillFailing: number;
  durationMs?: number;
  // First run = what Playwright reported before any rerun; afterRerun = the combined report (ReportParser counts).
  firstRun: RerunCounts;
  afterRerun: RerunCounts;
  rows: RerunTestRow[];
  // Failed/flaky tests that were NOT rerun (shared-config suites, flaky when include_flaky is off).
  excluded: { file: string; title: string; reason: string }[];
  rerunOf?: { runId: string; runNumber?: string };
}

export function getRerunSummaryPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'rerun-summary.json');
}

const isCounts = (c: unknown): c is RerunCounts =>
  !!c &&
  typeof c === 'object' &&
  ['passed', 'failed', 'flaky'].every((k) => Number.isInteger((c as Record<string, unknown>)[k]));

export function parseRerunSummary(raw: string): RerunSummary | null {
  try {
    const p = JSON.parse(raw) as Partial<RerunSummary>;
    if (p.version !== 1 || typeof p.ran !== 'boolean' || !isCounts(p.firstRun) || !isCounts(p.afterRerun) || !Array.isArray(p.rows)) {
      return null;
    }
    return {
      excluded: [],
      candidates: 0,
      recovered: 0,
      stillFailing: 0,
      maxTests: 0,
      retries: 0,
      includeFlaky: true,
      ...p,
    } as RerunSummary;
  } catch {
    return null;
  }
}

export function loadRerunSummary(env: string): RerunSummary | null {
  try {
    const file = getRerunSummaryPath(env);
    if (!fs.existsSync(file)) return null;
    return parseRerunSummary(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export const FIRST_LABEL: Record<RerunFirstStatus, string> = { failed: 'Failed', flaky: 'Flaky', 'not-run': 'Did not run' };
export const RERUN_LABEL: Record<RerunOutcome, string> = { passed: 'Passed', failed: 'Failed', 'not-rerun': 'Not rerun' };
export const FINAL_LABEL: Record<RerunFinalStatus, string> = {
  passed: 'Passed',
  recovered: 'Flaky - recovered on rerun',
  flaky: 'Flaky',
  failed: 'Failed',
  'not-run': 'Did not run',
};

/** First-run flaky test that passed again on the rerun: still flaky (history, trends, list) but resolved. */
export const isFlakyPassedOnRerun = (r: { first: RerunFirstStatus; rerun: RerunOutcome; final: RerunFinalStatus }): boolean =>
  r.first === 'flaky' && r.rerun === 'passed' && r.final === 'flaky';

/** Row lookup key used by the email: the title as ReportParser shows it, plus its file. */
export const rerunRowKey = (file: string, title: string): string => `${file}::${title}`;
