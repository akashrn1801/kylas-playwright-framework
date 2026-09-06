/**
 * Prints a REAL, historical-data-derived CI duration estimate for the
 * current workflow/Jenkinsfile invocation — replacing the hardcoded
 * "Estimated duration: ~N min" echo lines every workflow used to carry
 * (one of which, stage.yml's "~44 min," was found wrong by ~6x — see the
 * dated .claude/known-issues.md entry for the full incident and design).
 *
 * WHY a separate script from syncHistory.ts, not folded into it: this is a
 * READ-ONLY companion (fetch + inspect the ci/reporting-history branch,
 * never write to it) that must run BEFORE the test run whose duration it's
 * estimating — syncHistory.ts runs AFTER, with the opposite (write) access
 * pattern and its own heavier clone-based flow. Deliberately duplicates
 * gitAuthEnv()/resolveGitRemoteUrl() (small, ~15 lines total) rather than
 * exporting them from syncHistory.ts — that file already carries a real
 * production-incident history (see its own credential-redaction WHY
 * comment) and does not need a second caller's requirements threaded
 * through it for a read-only companion this much smaller in scope.
 *
 * WHY this must NEVER fail the build, matching every other script in this
 * pipeline (syncHistory.ts, notify.ts): an estimate is informational only.
 * Every failure path below (missing branch, network issue, corrupt data,
 * insufficient history) prints a safe, honest fallback line and exits 0.
 */
import { execSync } from 'child_process';
import { loadDotEnv } from './loadDotEnv';
import { parseHistory, computeDurationEstimate } from '../RunHistory';

// WHY loaded here too, same reasoning as syncHistory.ts's own top-of-file
// call: Jenkinsfile (main)/Jenkinsfile.sandbox write ENV into a real .env
// file during their test-setup stage, and this script runs as a separate
// `sh` invocation with no shared shell environment — this is the only thing
// carrying that value forward for those two pipelines.
loadDotEnv();

function gitAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.PIPELINE_TOKEN;
  if (!token) return process.env;
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
  };
}

function resolveGitRemoteUrl(): string {
  if (process.env.HISTORY_GIT_REMOTE) return process.env.HISTORY_GIT_REMOTE;
  return execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim();
}

const HISTORY_BRANCH_NAME = process.env.HISTORY_BRANCH_NAME || 'ci/reporting-history';

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
}

function main(): void {
  const PREFIX = '🕐  Estimated duration:';
  try {
    const env = process.env.ENV || 'qa';
    const branch = process.env.BRANCH_NAME || process.env.GITHUB_REF_NAME || 'unknown';
    const workersRaw = process.env.WORKERS;
    const workers = workersRaw !== undefined ? Number(workersRaw) : NaN;

    if (branch === 'unknown' || Number.isNaN(workers)) {
      console.log(
        `${PREFIX} unavailable (missing BRANCH_NAME/GITHUB_REF_NAME or WORKERS — this script requires both explicitly)`
      );
      return;
    }

    const remoteUrl = resolveGitRemoteUrl();
    let jsonl = '';
    try {
      execSync(`git fetch --depth=1 ${remoteUrl} ${HISTORY_BRANCH_NAME}`, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gitAuthEnv(),
      });
      jsonl = execSync(`git show FETCH_HEAD:history/${env}.jsonl`, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: gitAuthEnv(),
      }).toString();
    } catch {
      // WHY treated as "no history yet," not an error: a brand-new env file,
      // an unreachable remote, or a not-yet-created history branch are all
      // real, expected states this script must degrade through gracefully —
      // never the reason a build step fails.
      console.log(`${PREFIX} insufficient history (no history data available for env="${env}" yet)`);
      return;
    }

    const records = parseHistory(jsonl);
    const estimate = computeDurationEstimate(records, branch, workers);

    if (!estimate.available) {
      console.log(`${PREFIX} insufficient history — ${estimate.reason}`);
      return;
    }

    const { avgMs, minMs, maxMs, sampleSize } = estimate;
    console.log(
      `${PREFIX} ~${formatDuration(avgMs!)} (avg of last ${sampleSize} runs at workers=${workers} on branch="${branch}"; range ${formatDuration(minMs!)}-${formatDuration(maxMs!)})`
    );
  } catch (err) {
    // WHY a bare catch-all at the very top level, on top of the narrower
    // ones above: this script's output is echoed directly into a CI log a
    // human reads — an uncaught exception here must never look like the
    // actual test run failed. Matches syncHistory.ts's/notify.ts's own
    // "this must exit 0 in every case" convention.
    console.log(
      `🕐  Estimated duration: unavailable (estimate script error: ${err instanceof Error ? err.message : String(err)})`
    );
  }
}

if (require.main === module) {
  main();
}
