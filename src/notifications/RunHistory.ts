/**
 * Pure logic for the rolling run-history ledger (P2 of the 2026-07-07 reporting
 * overhaul). Deliberately has NO git/filesystem/network dependency in this file —
 * everything here operates on plain strings/objects so it can be unit-verified
 * without touching a real repo. See scripts/syncHistory.ts for the git-facing
 * wrapper that actually persists this to the dedicated `ci/reporting-history`
 * branch.
 *
 * WHY a dedicated branch instead of an artifact or an external store (S3 etc.):
 * see the WHY comment on HISTORY_BRANCH_NAME in scripts/syncHistory.ts for the
 * full tradeoff analysis. Short version — this repo already has a proven,
 * working CI-bot-commit pattern (staging.yml's promote-to-prod job), an external
 * store would be new infrastructure for a dataset that's only tens of KB, and an
 * artifact-only approach silently loses history between runs since CI runners
 * don't share disk and artifacts aren't fetchable by a later run without extra
 * plumbing this repo doesn't have.
 */

export interface ModuleHistoryStats {
  name: string;
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
  // Keeping records small is what makes a 100-run cap stay in the tens-of-KB range.
  flakyTestTitles: string[];
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

// WHY: 100 chosen as a cap that (a) comfortably covers 1-3+ months of history for
// even the busiest branches (qa/dev run multiple times a day; prod's @prodSafe
// runs far less often, hence per-env files below so prod's history isn't crowded
// out by qa's volume), (b) is enough runs for a "flaky in >1 of last N" signal to
// mean something statistically, and (c) keeps each per-env JSONL file bounded to
// roughly 40-60KB (a compact one-line record, no per-test detail) — cheap to
// fetch on every CI run regardless of how long the project lives.
export const MAX_RECORDS_PER_ENV = 100;

// WHY: how many of the most recent runs to look back across when flagging a
// "recurring" flaky test, and how many of those it must appear flaky in before
// it's worth a callout. Deliberately small and fixed rather than configurable —
// per the standing instruction to keep this signal-dense, not a tunable knob
// nobody will revisit.
export const RECURRING_FLAKY_LOOKBACK = 5;
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
export function computeDelta(historyBeforeAppend: RunHistoryRecord[], current: RunHistoryRecord): RunDelta {
  const previousRun = historyBeforeAppend.length > 0 ? historyBeforeAppend[historyBeforeAppend.length - 1] : null;
  if (!previousRun) {
    return { previousRun: null, totalDelta: 0, passedDelta: 0, failedDelta: 0, flakyDelta: 0, durationDeltaMs: 0 };
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

/**
 * Flags tests that have been flaky in more than RECURRING_FLAKY_THRESHOLD of the
 * last RECURRING_FLAKY_LOOKBACK runs (including the current one), for a given
 * environment. Deliberately returns just titles + counts — not a full history
 * dashboard per test, per the standing instruction to keep this signal-dense.
 */
export function computeRecurringFlaky(
  historyBeforeAppend: RunHistoryRecord[],
  current: RunHistoryRecord
): Array<{ title: string; flakyInLastNRuns: number; ofLastNRuns: number }> {
  const recentRuns = [...historyBeforeAppend.slice(-(RECURRING_FLAKY_LOOKBACK - 1)), current];
  const counts = new Map<string, number>();
  for (const run of recentRuns) {
    for (const title of run.flakyTestTitles) {
      counts.set(title, (counts.get(title) || 0) + 1);
    }
  }
  const result: Array<{ title: string; flakyInLastNRuns: number; ofLastNRuns: number }> = [];
  for (const [title, count] of counts.entries()) {
    if (count > RECURRING_FLAKY_THRESHOLD) {
      result.push({ title, flakyInLastNRuns: count, ofLastNRuns: recentRuns.length });
    }
  }
  // WHY: most-frequently-flaky first — that's the one most worth acting on.
  return result.sort((a, b) => b.flakyInLastNRuns - a.flakyInLastNRuns);
}
