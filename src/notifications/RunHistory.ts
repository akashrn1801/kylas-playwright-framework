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
  // WHY gitCommit + isDevEquivalentRun added 2026-09-03 (fixes a real false
  // "Suite Drift Detected" alarm — see the dated known-issues.md entry): a
  // `sandbox:reset` run (scripts/reset-sandbox.sh does `git reset --hard
  // origin/dev` then force-pushes) always has a commit BYTE-IDENTICAL to
  // dev's own HEAD — a hard reset moves the branch pointer to the same
  // commit object, it never creates a new one. `isDevEquivalentRun` is
  // computed once, at record-build time, by comparing this run's own
  // `gitCommit` against dev's HEAD SHA at that moment (see
  // scripts/syncHistory.ts's `detectDevEquivalentRun()`) — persisted here so
  // a FUTURE dev-equivalent run can find the most recent PAST one and
  // compare suite size against that genuine baseline, not "whatever ran
  // last" (which is frequently an unrelated, larger feature-branch run in
  // the same env-keyed history file). gitCommit itself was already computed
  // at notify-time (notify.ts's resolveNotificationInput(), used for
  // resolveKnownIssuesUrl()) but never persisted into history before this.
  gitCommit: string;
  isDevEquivalentRun: boolean;
  // WHY optional, added 2026-09-04 (dynamic CI duration-estimate feature —
  // see .claude/known-issues.md's dated entry for the full design): no
  // existing record has this populated, and it must stay optional forever
  // for backward compatibility — parseHistory()/serializeHistory() and every
  // existing consumer (computeDelta, computeModuleTrend, EmailTemplate.ts,
  // etc.) already tolerate unknown fields being absent, confirmed by
  // reading each one rather than assumed. The real per-run `--workers=N`
  // value, threaded through from the workflow/Jenkinsfile that produced
  // this run (see syncHistory.ts's buildCurrentRecord()) — required for
  // computeDurationEstimate() below to only ever average runs under the
  // SAME concurrency configuration. A useful, deliberate side effect: right
  // after this field is introduced, every historical record lacks it, so
  // computeDurationEstimate() correctly reports "insufficient history" for
  // every branch until enough new-schema runs accumulate — the same safe
  // behavior a real worker-count change (like stage.yml's 2→1 mitigation)
  // needs, for free, with no special-casing.
  workers?: number;
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
  // WHY added 2026-09-03 (fixes a real false-alarm, see the dated
  // known-issues.md entry): tells the email WHICH comparison actually
  // produced this verdict, so it can render an honest, specific note
  // instead of a one-size-fits-all message.
  // - 'previous-run': the original, unqualified comparison — whatever ran
  //   immediately before this one in the same env-keyed history file,
  //   regardless of branch/commit. Unchanged default behavior.
  // - 'previous-reset-run': this run's commit matched dev's HEAD (a
  //   sandbox:reset run) AND a prior dev-equivalent run exists in history —
  //   compared against THAT run's count instead, a genuine baseline-vs-
  //   baseline comparison that still catches a real regression across
  //   resets.
  // - 'no-reset-baseline-yet': this run's commit matched dev's HEAD but no
  //   prior dev-equivalent run exists yet to compare against — occurred is
  //   always false here by construction; never an alarm, but the email
  //   still says so explicitly rather than rendering identically to "no
  //   drift found" (same "silence is ambiguous" concern already fixed once
  //   for Module Analytics' own trend glyph — see that code's own comment).
  basis: 'previous-run' | 'previous-reset-run' | 'no-reset-baseline-yet';
  // Present only when basis === 'previous-reset-run' — lets the email cite
  // exactly which prior run was used as the baseline.
  baselineBuildNumber?: string;
  baselineTotal?: number;
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
 *
 * WHY this is no longer the only entry point (2026-09-03): kept exactly as
 * it was — still used as-is by computeSuiteDrift() below for the normal
 * (non-dev-equivalent) case — but callers computing the email's actual
 * suiteDrift signal should call computeSuiteDrift() instead, which adds the
 * dev-equivalent-run branch on top without changing this function's own
 * behavior or its other caller's (none currently) expectations.
 */
export function detectSuiteDrift(delta: RunDelta): SuiteDrift {
  const occurred = delta.previousRun !== null && delta.totalDelta < 0;
  return { occurred, decreaseBy: occurred ? Math.abs(delta.totalDelta) : 0, basis: 'previous-run' };
}

/**
 * The real entry point for the email's suite-drift signal (2026-09-03) — see
 * SuiteDrift's own WHY comment for the full false-alarm history this fixes.
 * Delegates to the original detectSuiteDrift()/computeDelta() unchanged for
 * a normal run; only a confirmed dev-equivalent run (current.isDevEquivalentRun)
 * takes the new path, comparing against the most recent PRIOR dev-equivalent
 * run in history instead of whatever ran last, regardless of branch.
 */
export function computeSuiteDrift(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord
): SuiteDrift {
  if (!current.isDevEquivalentRun) {
    return detectSuiteDrift(computeDelta(historyBeforeAppend, current));
  }
  const lastReset = [...historyBeforeAppend].reverse().find((r) => r.isDevEquivalentRun);
  if (!lastReset) {
    return { occurred: false, decreaseBy: 0, basis: 'no-reset-baseline-yet' };
  }
  const decreaseBy = lastReset.total - current.total;
  return {
    occurred: decreaseBy > 0,
    decreaseBy: Math.max(decreaseBy, 0),
    basis: 'previous-reset-run',
    baselineBuildNumber: lastReset.buildNumber,
    baselineTotal: lastReset.total,
  };
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

export interface DurationEstimate {
  available: boolean;
  avgMs?: number;
  minMs?: number;
  maxMs?: number;
  sampleSize: number;
  // WHY present only when available: false — mirrors PassRatePoint/SuiteDrift's
  // own "explicit reason over silent absence" convention elsewhere in this
  // file, so a caller never has to guess why no number was produced.
  reason?: string;
}

// WHY 3, not 1 or 2: a single matching run is not a trustworthy average (it
// IS the number, with zero variance information) — 3 was chosen as the
// smallest sample that can show a real min/max spread, not a statistically
// derived constant. Revisit if real accumulated history ever suggests
// otherwise, matching this file's own precedent for SLOW_TEST_REGRESSION_THRESHOLD's
// "starting heuristic, not derived" framing.
export const DURATION_ESTIMATE_MIN_SAMPLES = 3;
export const DURATION_ESTIMATE_LOOKBACK = 10;

/**
 * Computes a duration estimate from REAL historical runs, scoped to the
 * exact same branch (workflow identity — see syncHistory.ts's own branch-
 * derivation WHY comment) AND the exact same worker count (concurrency
 * configuration) as the caller's current run — never blended across a
 * config change, per this feature's own design requirement. Returns
 * available: false with an honest reason (never a misleading/guessed
 * number) when fewer than `minSamples` matching runs exist in the last
 * `lookback` records for that branch — this is the ONLY thing that makes a
 * worker-count or test-count change (like stage.yml's 2→1 mitigation) safe:
 * the very first runs under a new configuration have zero matching prior
 * history by construction, so this correctly reports "insufficient
 * history" instead of confidently stating a number computed under the OLD
 * configuration.
 */
export function computeDurationEstimate(
  records: RunHistoryRecord[],
  branch: string,
  workers: number,
  minSamples: number = DURATION_ESTIMATE_MIN_SAMPLES,
  lookback: number = DURATION_ESTIMATE_LOOKBACK
): DurationEstimate {
  const matching = records.filter((r) => r.branch === branch && r.workers === workers);
  const recent = matching.slice(-lookback);
  if (recent.length < minSamples) {
    return {
      available: false,
      sampleSize: recent.length,
      reason: `insufficient history for branch="${branch}" at workers=${workers}: ${recent.length}/${minSamples} matching runs found (of ${matching.length} total matching, ${records.length} in file)`,
    };
  }
  const durations = recent.map((r) => r.duration);
  const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
  return {
    available: true,
    avgMs,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    sampleSize: recent.length,
  };
}
