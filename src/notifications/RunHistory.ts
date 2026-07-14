/**
 * Pure logic for the rolling run-history ledger (P2 of the 2026-07-07 reporting
 * overhaul, extended 2026-07-14 with deeper multi-run trending). Deliberately
 * has NO git/filesystem/network dependency in this file — everything here
 * operates on plain strings/objects so it can be unit-verified without
 * touching a real repo. See scripts/syncHistory.ts for the git-facing wrapper
 * that actually persists this to the dedicated `ci/reporting-history` branch.
 *
 * WHY a dedicated branch instead of an artifact or an external store (S3 etc.):
 * see the WHY comment on HISTORY_BRANCH_NAME in scripts/syncHistory.ts for the
 * full tradeoff analysis. Short version — this repo already has a proven,
 * working CI-bot-commit pattern (staging.yml's promote-to-prod job), an external
 * store would be new infrastructure for a dataset that's only tens/hundreds of
 * KB, and an artifact-only approach silently loses history between runs since
 * CI runners don't share disk and artifacts aren't fetchable by a later run
 * without extra plumbing this repo doesn't have.
 */

export interface ModuleHistoryStats {
  name: string;
  // WHY: added 2026-07-14 — ReportParser keys modules by `${type}:${name}`
  // (e.g. distinct "UI:Leads" and "RBAC:Leads" entries both named "Leads"),
  // but this record previously stored only `name`. Two same-named modules of
  // different type would silently collide when looking up "the Leads module"
  // in history. Fixed by carrying `type` through and keying all trend lookups
  // on `${type}:${name}`, never bare `name`.
  type: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  duration: number;
}

export interface RunHistoryRecord {
  timestamp: string; // ISO 8601
  env: string;
  branch: string;
  buildNumber: string;
  runSource: 'local' | 'github-actions' | 'jenkins';
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  duration: number;
  // WHY: titles only, not full TestResult objects — this ledger exists to answer
  // "has this test been flaky before," not to duplicate the full JSON report.
  // Keeping records small is what makes the record cap stay in the low-hundreds-
  // of-KB range (see MAX_RECORDS_PER_ENV's WHY for the real, measured numbers).
  flakyTestTitles: string[];
  // WHY: added 2026-07-14 — mirrors flakyTestTitles exactly. Without this,
  // "has this test failed before (not just flaked)" was structurally
  // impossible to answer — only flaky tests were ever persisted per-title.
  failedTestTitles: string[];
  // WHY: added 2026-07-14 — top-20 (not top-5; top-5 is the email's own
  // display limit) slow-test durations, needed for computeSlowTestTrend()'s
  // "was this test in a recent slow list, and is it getting slower" signal.
  // Top-20 was chosen over "all tests" as a cost/value tradeoff — see the
  // real size comparison in MAX_RECORDS_PER_ENV's WHY comment: storing every
  // test's duration every run cost ~13x a single run's record size for a
  // feature that only ever needs the tests that are actually slow.
  slowestTests: Array<{ title: string; duration: number }>;
  modules: ModuleHistoryStats[];
}

export interface RunDelta {
  previousRun: RunHistoryRecord | null;
  totalDelta: number;
  passedDelta: number;
  failedDelta: number;
  flakyDelta: number;
  durationDeltaMs: number;
}

// WHY: Originally estimated at "~40-60KB per env file" — that estimate was
// confirmed WRONG during the 2026-07-14 design review, before any of the
// schema growth below was added. Real measurement using this suite's actual
// 263 test titles (avg 87 chars) and its actual 16 module/type combinations:
// the CURRENT (pre-2026-07-14) schema alone is already ~196KB/100 records on
// a typical run (10 flaky titles) and ~439KB/100 records on a bad run (40
// flaky titles) — the growth was already outpacing the original estimate as
// the suite grew, and nobody had revisited the comment. The schema extension
// below (failedTestTitles + top-20 slowestTests + real per-module duration)
// was measured and approved at ~448KB/100 records typical, ~975KB worst-case,
// per environment — roughly 2.3x the current size, ~1.35MB across all 3 env
// files (qa/staging/prod) at the full 100-record cap. This was an explicit,
// informed tradeoff, not a default — see the reporting-overhaul design
// history for the full numbers. Git's own zlib compression on this highly
// repetitive JSONL text will keep the REAL on-disk/network cost meaningfully
// below these raw-byte figures; the numbers above are a conservative ceiling,
// not the actual branch-size outcome.
export const MAX_RECORDS_PER_ENV = 100;

// WHY: bumped from 5 to 10 (2026-07-14) — "flaky/failed in N of the last 5
// runs" wasn't deep enough a signal; the user specifically wanted "4 of the
// last 10" style depth. No schema change was needed for this — the ledger
// already stores up to MAX_RECORDS_PER_ENV runs; only the lookback WINDOW
// used when computing recurring issues needed to grow. Kept as an overridable
// default (not hardcoded into the function bodies) so a caller can widen/
// narrow the window without a code change.
export const RECURRING_FLAKY_LOOKBACK = 10;
export const RECURRING_FLAKY_THRESHOLD = 2;

/**
 * Parses a JSONL history file's content into records, skipping any line that
 * fails to parse (a partially-written line from a crashed previous append
 * should not take down every future run).
 */
export function parseHistory(jsonl: string): RunHistoryRecord[] {
  if (!jsonl.trim()) return [];
  const records: RunHistoryRecord[] = [];
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // WHY: skip, don't throw — a single corrupt line must not lose the rest
      // of the ledger.
    }
  }
  return records;
}

export function serializeHistory(records: RunHistoryRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

/**
 * Appends a new record and prunes to MAX_RECORDS_PER_ENV, oldest first. The
 * caller is responsible for ensuring `existingJsonl` is scoped to a single
 * environment (one file per env, per the storage-strategy decision) — this
 * function does not itself filter by record.env.
 */
export function appendAndPrune(existingJsonl: string, record: RunHistoryRecord): string {
  const records = parseHistory(existingJsonl);
  records.push(record);
  const pruned = records.slice(-MAX_RECORDS_PER_ENV);
  return serializeHistory(pruned);
}

/**
 * Delta against the single most recent prior record (before the current run
 * was appended). Returns previousRun: null on the very first run for an
 * environment — callers must render "no prior run to compare" in that case,
 * not a misleading "+N from 0."
 */
export function computeDelta(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord
): RunDelta {
  const previousRun =
    historyBeforeAppend.length > 0 ? historyBeforeAppend[historyBeforeAppend.length - 1] : null;
  if (!previousRun) {
    return {
      previousRun: null,
      totalDelta: 0,
      passedDelta: 0,
      failedDelta: 0,
      flakyDelta: 0,
      durationDeltaMs: 0,
    };
  }
  return {
    previousRun,
    totalDelta: current.total - previousRun.total,
    passedDelta: current.passed - previousRun.passed,
    failedDelta: current.failed - previousRun.failed,
    flakyDelta: current.flaky - previousRun.flaky,
    durationDeltaMs: current.duration - previousRun.duration,
  };
}

export interface RecurringIssue {
  title: string;
  countInLastNRuns: number;
  ofLastNRuns: number;
}

// WHY: shared implementation for both computeRecurringFlaky and
// computeRecurringFailures (added 2026-07-14) — the two are identical except
// for which per-run title list they read, so one generic function avoids
// duplicating the counting/threshold/sort logic twice.
function computeRecurringByField(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord,
  field: 'flakyTestTitles' | 'failedTestTitles',
  lookback: number,
  threshold: number
): RecurringIssue[] {
  const recentRuns = [...historyBeforeAppend.slice(-(lookback - 1)), current];
  const counts = new Map<string, number>();
  for (const run of recentRuns) {
    for (const title of run[field] || []) {
      counts.set(title, (counts.get(title) || 0) + 1);
    }
  }
  const result: RecurringIssue[] = [];
  for (const [title, count] of counts.entries()) {
    if (count > threshold) {
      result.push({ title, countInLastNRuns: count, ofLastNRuns: recentRuns.length });
    }
  }
  // WHY: most-frequently-recurring first — that's the one most worth acting on.
  return result.sort((a, b) => b.countInLastNRuns - a.countInLastNRuns);
}

/**
 * Flags tests that have been flaky in more than `threshold` of the last
 * `lookback` runs (including the current one), for a given environment.
 * Deliberately returns just titles + counts — not a full history dashboard
 * per test, per the standing instruction to keep this signal-dense.
 */
export function computeRecurringFlaky(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord,
  lookback: number = RECURRING_FLAKY_LOOKBACK,
  threshold: number = RECURRING_FLAKY_THRESHOLD
): RecurringIssue[] {
  return computeRecurringByField(
    historyBeforeAppend,
    current,
    'flakyTestTitles',
    lookback,
    threshold
  );
}

// WHY: added 2026-07-14 — mirrors computeRecurringFlaky exactly, but for
// FAILED tests specifically. Answers "this test has failed in N of the last
// M runs" — a genuinely different question from flakiness (a test that fails
// every single run is not flaky, it's just broken, and recurring-flaky alone
// would never surface it since it never passes-on-retry).
export function computeRecurringFailures(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord,
  lookback: number = RECURRING_FLAKY_LOOKBACK,
  threshold: number = RECURRING_FLAKY_THRESHOLD
): RecurringIssue[] {
  return computeRecurringByField(
    historyBeforeAppend,
    current,
    'failedTestTitles',
    lookback,
    threshold
  );
}

export interface ModuleTrend {
  name: string;
  type: string;
  direction: 'improving' | 'worsening' | 'stable';
  failedDelta: number;
  flakyDelta: number;
  durationDeltaMs: number;
}

/**
 * Per-module trend vs. the single most recent prior run (same granularity as
 * computeDelta — this is not a deep multi-run lookback, it's "did this module
 * get better or worse since last time"). Modules with no match in the prior
 * run (new module, or a module that had zero tests last run) are skipped
 * entirely rather than defaulted to a fake baseline — "no trend data yet" is
 * the honest answer, not "stable."
 */
export function computeModuleTrend(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord
): ModuleTrend[] {
  const previousRun =
    historyBeforeAppend.length > 0 ? historyBeforeAppend[historyBeforeAppend.length - 1] : null;
  if (!previousRun) return [];
  const prevByKey = new Map(previousRun.modules.map((m) => [`${m.type}:${m.name}`, m]));
  const trends: ModuleTrend[] = [];
  for (const m of current.modules) {
    const prev = prevByKey.get(`${m.type}:${m.name}`);
    if (!prev) continue;
    const failedDelta = m.failed - prev.failed;
    const flakyDelta = m.flaky - prev.flaky;
    const durationDeltaMs = m.duration - prev.duration;
    const direction: ModuleTrend['direction'] =
      failedDelta > 0 || flakyDelta > 0
        ? 'worsening'
        : failedDelta < 0 || flakyDelta < 0
          ? 'improving'
          : 'stable';
    trends.push({ name: m.name, type: m.type, direction, failedDelta, flakyDelta, durationDeltaMs });
  }
  return trends;
}

export interface SlowTestTrend {
  title: string;
  duration: number;
  previousDuration: number | null;
  diffMs: number | null;
  regression: boolean;
}

// WHY: 20% chosen as a regression threshold noticeably above ordinary CI-
// runner run-to-run jitter, while still catching a real regression early
// rather than waiting for it to double. This is a starting heuristic, not a
// statistically-derived constant — revisit once real slow-test history has
// accumulated across enough runs to measure actual jitter in this suite.
export const SLOW_TEST_REGRESSION_THRESHOLD = 0.2;

/**
 * For each of the current run's slow tests, finds the most recent prior run
 * in which that same test also appeared in the slow-test list and compares
 * durations. A test with no prior appearance in any stored run's slow-test
 * list gets previousDuration: null — that's a "no history yet" state, not an
 * error, and must render as such rather than a false 0/0 comparison.
 */
export function computeSlowTestTrend(
  historyBeforeAppend: RunHistoryRecord[],
  currentSlowest: Array<{ title: string; duration: number }>
): SlowTestTrend[] {
  return currentSlowest.map((t) => {
    let previousDuration: number | null = null;
    for (let i = historyBeforeAppend.length - 1; i >= 0 && previousDuration === null; i--) {
      const match = historyBeforeAppend[i].slowestTests?.find((s) => s.title === t.title);
      if (match) previousDuration = match.duration;
    }
    if (previousDuration === null) {
      return { title: t.title, duration: t.duration, previousDuration: null, diffMs: null, regression: false };
    }
    const diffMs = t.duration - previousDuration;
    const regression = previousDuration > 0 && diffMs > previousDuration * SLOW_TEST_REGRESSION_THRESHOLD;
    return { title: t.title, duration: t.duration, previousDuration, diffMs, regression };
  });
}

export interface SuiteDrift {
  occurred: boolean;
  decreaseBy: number;
}

/**
 * Flags ANY decrease in total test count vs. the previous run — no percentage
 * floor. WHY: a dropped test is never an "acceptable cost" the way a small
 * pass-rate wobble is; it's frequently a silently-broken test file, an
 * accidentally-skipped describe block, or deleted tests rather than genuine
 * improvement. The cost of a false positive here (someone deliberately
 * removed 2 obsolete tests) is one visible "confirm this was intentional"
 * line; the cost of a false negative (a broken file silently drops 40 tests)
 * is much worse. Increases are never flagged as drift — this suite grows
 * constantly as normal development, and that growth deserves a neutral note,
 * not an alarm.
 */
export function detectSuiteDrift(delta: RunDelta): SuiteDrift {
  const occurred = delta.previousRun !== null && delta.totalDelta < 0;
  return { occurred, decreaseBy: occurred ? Math.abs(delta.totalDelta) : 0 };
}

export interface PassRatePoint {
  buildNumber: string;
  passRate: number;
  timestamp: string;
}

/**
 * Last-n (default 10) pass-rate points, oldest first, including the current
 * run — for the email's pass-rate sparkline. Reuses fields every
 * RunHistoryRecord already stores (passed/total); no new per-record data was
 * needed for this feature.
 */
export function buildPassRateSeries(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord,
  n = 10
): PassRatePoint[] {
  const toPoint = (r: RunHistoryRecord): PassRatePoint => ({
    buildNumber: r.buildNumber,
    passRate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0,
    timestamp: r.timestamp,
  });
  return [...historyBeforeAppend.slice(-(n - 1)), current].map(toPoint);
}
