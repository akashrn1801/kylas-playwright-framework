/**
 * The run's own clock, for the email's "Run" line (2026-11-26, build #240: the email said Started 7:38:52 pm and Ended 10:02:18 pm,
 * which are the SHARDS' window (merged report stats.startTime + stats.duration), while the workflow started minutes earlier (detect and
 * renew-session jobs) and ended after the merge, when the email went out at 10:06 pm).
 *
 *  - Run start: GitHub's own `run_started_at` for the workflow run; if that call fails, the earliest job start of the same run; on
 *    Jenkins the build's own start (`RUN_STARTED_AT_MS`, set from `currentBuild.startTimeInMillis` in the Jenkinsfiles). Nothing else
 *    is guessed: without one the email says "start unavailable" instead of showing the test window as the run.
 *  - Run end: the moment the email is generated. The merge job that builds it is still running, so no later real end exists; the line
 *    says so.
 */
export type RunStartSource = 'github-run' | 'github-first-job' | 'jenkins-build';

export interface RunStart {
  iso: string;
  source: RunStartSource;
}

export interface RunTimes {
  /** null when no source answered (CI) or the run is local (no workflow exists). */
  runStart: RunStart | null;
  /** ISO time the email was generated: the run's end as far as the email can know. */
  runEnd: string;
}

/** Jenkins: epoch milliseconds in RUN_STARTED_AT_MS (currentBuild.startTimeInMillis); null when absent or not a number. */
export function jenkinsRunStart(env: { RUN_STARTED_AT_MS?: string }): RunStart | null {
  const ms = Number(env.RUN_STARTED_AT_MS);
  return Number.isFinite(ms) && ms > 0 ? { iso: new Date(ms).toISOString(), source: 'jenkins-build' } : null;
}

/**
 * The invariant every email must hold: run start <= tests start <= tests end <= run end. Returns what is violated, or [] (also when the
 * run start is unknown: nothing to compare). Times are ISO strings.
 */
export function runTimesViolations(times: RunTimes | undefined, testsStart: string, testsEnd: string): string[] {
  const out: string[] = [];
  const t0 = Date.parse(testsStart);
  const t1 = Date.parse(testsEnd);
  if (!(t0 <= t1)) out.push(`tests start ${testsStart} is after tests end ${testsEnd}`);
  if (!times) return out;
  const end = Date.parse(times.runEnd);
  if (times.runStart && !(Date.parse(times.runStart.iso) <= t0)) out.push(`run start ${times.runStart.iso} is after tests start ${testsStart}`);
  if (!(t1 <= end)) out.push(`tests end ${testsEnd} is after run end ${times.runEnd}`);
  return out;
}
