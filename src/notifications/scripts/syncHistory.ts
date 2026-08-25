/**
 * Syncs the current run's result into the rolling run-history ledger (P2 of the
 * 2026-07-07 reporting overhaul, extended 2026-07-14 with deeper multi-run
 * trending) and writes a small delta/trend summary that NotificationService.ts
 * optionally reads, the same way it already optionally reads misc-errors.json.
 *
 * WHY a dedicated git branch, not an artifact or an external store — see the
 * WHY comment on HISTORY_BRANCH_NAME below for the full tradeoff writeup.
 *
 * WHY this step must NEVER fail the build: history tracking is a nice-to-have
 * layered on top of the actual test results, not a build gate. Any failure here
 * (no push permission configured yet, network issue, merge race that exhausts
 * its retries) is caught, logged, and degrades to "no delta available" — the
 * same graceful-absence pattern already used for misc-errors.json in
 * NotificationService.ts. This script must exit 0 in every case.
 */
import { execSync, ExecException } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadDotEnv } from './loadDotEnv';
import { ReportParser } from '../ReportParser';
import {
  appendAndPrune,
  parseHistory,
  computeDelta,
  computeRecurringFlaky,
  computeRecurringFailures,
  computeModuleTrend,
  computeSlowTestTrend,
  detectSuiteDrift,
  buildPassRateSeries,
  RunHistoryRecord,
  RunDelta,
  RecurringIssue,
  ModuleTrend,
  SlowTestTrend,
  SuiteDrift,
  PassRatePoint,
} from '../RunHistory';

// WHY: must load before reading process.env.ENV below — see loadDotEnv.ts for
// why this matters specifically for Jenkinsfile (main)'s pipeline.
loadDotEnv();

// WHY: a dedicated, never-merged branch — NOT main/dev/qa/stage/prod — so this
// ledger's commits (a) can never trip branch-protection rules configured on
// deployment branches, (b) never show up in a code PR's diff, and (c) isolate
// the one real risk of this mechanism (two pipelines racing to push at once) to
// a branch where a rebase-retry is the ONLY thing that can conflict, never a
// real code change.
const HISTORY_BRANCH_NAME = process.env.HISTORY_BRANCH_NAME || 'ci/reporting-history';
// WHY: Confirmed live (2026-07-07) — `git clone` needs an actual URL/path, it
// cannot resolve a remote NAME the way `git pull origin main` can, since a
// fresh clone target has no `.git/config` yet to look "origin" up in. The
// original version of this passed the literal string "origin" straight to
// `git clone`, which fails with "repository 'origin' does not exist" every
// single time — caught gracefully by the try/catch (so it never broke the
// build), but it meant the whole history feature silently never persisted
// anything, defeating its purpose. Resolve the real URL from the ALREADY-
// checked-out repo's own configured "origin" remote (present in real CI via
// `checkout scm` / actions/checkout) instead of assuming the name resolves on
// its own. HISTORY_GIT_REMOTE remains a full override (a URL or local path)
// for verification against a throwaway repo without ever touching the real one.
function resolveGitRemoteUrl(): string {
  if (process.env.HISTORY_GIT_REMOTE) return process.env.HISTORY_GIT_REMOTE;
  try {
    return execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim();
  } catch {
    throw new Error(
      'Could not resolve origin remote URL — set HISTORY_GIT_REMOTE explicitly or ensure this runs inside a checked-out git repo with an "origin" remote configured'
    );
  }
}
const MAX_PUSH_RETRIES = 3;

// WHY: confirmed real via sandbox.yml run 32748451285 (2026-08-24) — see the
// dated 2026-08-25 entry in .claude/known-issues.md's "CI reporting-history
// ledger" section for the full captured log and root-cause writeup. A push
// REJECTION on HISTORY_BRANCH_NAME (below) proves the branch already exists
// on GitHub's primary (a competing run's push landed first) — but the very
// next `git fetch` of that same ref, fired with zero delay, can still fail
// with "couldn't find remote ref" if it lands on a GitHub backend replica
// that hasn't yet caught up with the ref JUST created moments earlier. This
// is a narrow, transient replication-lag window specific to the instant a
// ref is first created under concurrent competition — NOT the same as the
// ref genuinely, permanently not existing (that case is handled separately,
// by the initial cloneAttempt/orphan-branch-creation path above, which must
// stay untouched by this).
const MISSING_REMOTE_REF_PATTERN = /couldn't find remote ref/i;
const FETCH_RETRY_BACKOFF_MS = [300, 800, 1500];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WHY: a bounded retry-with-backoff on the fetch itself, not a blind sleep
// before it — this only ever activates for the one specific, transient error
// signature confirmed above; any other fetch failure (auth, network, a
// genuinely absent branch) fails fast on the first attempt, unchanged from
// before. Retrying via the outer MAX_PUSH_RETRIES loop alone does not fix
// this, since that loop introduces no delay between attempts — all of its
// attempts could fire within milliseconds of each other, well inside the
// replication-lag window this is working around.
async function fetchHistoryBranchWithBackoff(repoDir: string, branch: string): Promise<void> {
  for (let attempt = 1; attempt <= FETCH_RETRY_BACKOFF_MS.length + 1; attempt++) {
    const result = shSafe(`git fetch origin ${branch}`, repoDir);
    if (result.ok) return;

    const delayMs = FETCH_RETRY_BACKOFF_MS[attempt - 1];
    if (!MISSING_REMOTE_REF_PATTERN.test(result.output) || delayMs === undefined) {
      throw new Error(`git fetch origin ${branch} failed: ${result.output}`);
    }
    console.log(
      `[syncHistory] Fetch of ${branch} returned "couldn't find remote ref" right after a push ` +
        `rejection — likely GitHub replication lag on a just-created ref, not a real absence. ` +
        `Retrying in ${delayMs}ms (attempt ${attempt}/${FETCH_RETRY_BACKOFF_MS.length + 1})`
    );
    await delay(delayMs);
  }
}

// WHY: added 2026-07-14 — this file had its own, separate, older branch-name
// derivation that never received the local-git fallback fix applied to the
// email-facing code (notify.ts's resolveNotificationInput()). A bare local
// sync (no BRANCH_NAME/GITHUB_REF_NAME) wrote a literal "unknown" into the
// history ledger's own branch field, even though the real branch is one
// command away in any real git checkout. Mirrors notify.ts's identical
// helper exactly — same reasoning, same graceful degrade to null on error
// (e.g. a stripped checkout with no git metadata) rather than throwing,
// since this script must never fail the build.
function localGitFallback(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function shSafe(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: sh(cmd, cwd) };
  } catch (err) {
    const e = err as ExecException;
    return { ok: false, output: e?.stderr?.toString() || e?.message || String(err) };
  }
}

function buildCurrentRecord(
  env: string,
  branch: string,
  buildNumber: string,
  runSource: RunHistoryRecord['runSource'],
  jsonReportPath: string
): RunHistoryRecord {
  const parser = new ReportParser();
  const report = parser.parse(jsonReportPath);
  return {
    timestamp: new Date(report.startTime).toISOString(),
    env,
    branch,
    buildNumber,
    runSource,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    flaky: report.flaky,
    skipped: report.skipped,
    duration: report.duration,
    flakyTestTitles: report.flakyTests.map((t) => t.title),
    // WHY: added 2026-07-14 — mirrors flakyTestTitles; without this, "has this
    // test failed before" was structurally unanswerable from history.
    failedTestTitles: report.failedTests.map((t) => t.title),
    // WHY: added 2026-07-14 — top-20 (report.slowestTestsTop20), not the
    // email's top-5 display list — see ReportParser.ts's WHY comment on that
    // field for why 20 was chosen over "every test."
    slowestTests: report.slowestTestsTop20.map((t) => ({ title: t.title, duration: t.duration })),
    modules: report.modules.map((m) => ({
      name: m.name,
      // WHY: `type` and `total` added 2026-07-14 — see ModuleHistoryStats's
      // WHY comment in RunHistory.ts; without `type`, a same-named UI/RBAC
      // module pair collides on lookup.
      type: m.type,
      total: m.total,
      passed: m.passed,
      failed: m.failed,
      flaky: m.flaky,
      // WHY: previously hardcoded to 0 — "ReportParser's ModuleStats doesn't
      // track per-module duration today." Fixed 2026-07-14: ReportParser now
      // sums each result's duration into its module bucket.
      duration: m.duration,
    })),
  };
}

interface HistoryDeltaOutput {
  delta: RunDelta | null;
  recurringFlaky: RecurringIssue[];
  recurringFailures: RecurringIssue[];
  moduleTrend: ModuleTrend[];
  slowTestTrend: SlowTestTrend[];
  suiteDrift: SuiteDrift | null;
  passRateSeries: PassRatePoint[];
}

const EMPTY_DELTA_OUTPUT: HistoryDeltaOutput = {
  delta: null,
  recurringFlaky: [],
  recurringFailures: [],
  moduleTrend: [],
  slowTestTrend: [],
  // WHY: null, not {occurred:false,...} — a genuinely-computed "no drift"
  // and "sync never ran / failed before computing" are different states, and
  // NotificationService should be able to tell "no signal available" apart
  // from "computed, and there is no drift" if it ever needs to (today both
  // render identically — no drift banner — but the distinction is cheap to
  // keep and costs nothing to preserve).
  suiteDrift: null,
  passRateSeries: [],
};

async function main() {
  const env = process.env.ENV || 'qa';
  const branch =
    process.env.BRANCH_NAME ||
    process.env.GITHUB_REF_NAME ||
    localGitFallback('git branch --show-current') ||
    'unknown';
  const buildNumber = process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local';
  const runSource: RunHistoryRecord['runSource'] = process.env.JENKINS_URL
    ? 'jenkins'
    : process.env.GITHUB_ACTIONS
      ? 'github-actions'
      : 'local';
  const jsonReportPath = path.resolve(
    process.env.REPORT_PATH ||
      (process.env.CI
        ? path.join(process.cwd(), 'reports', 'playwright-report', 'results.json')
        : path.join(process.cwd(), 'reports', env, 'latest', 'playwright-report', 'results.json'))
  );
  const deltaOutputPath = path.resolve(process.cwd(), 'reports', env, 'history-delta.json');

  // WHY: write a "no delta available" placeholder FIRST — if anything below
  // throws, notify.ts still finds a well-formed (empty) file instead of a
  // missing one, and the two failure modes ("sync never ran" vs "sync failed
  // partway") don't need to be distinguished by a downstream reader.
  const writeDeltaOutput = (output: HistoryDeltaOutput) => {
    try {
      fs.mkdirSync(path.dirname(deltaOutputPath), { recursive: true });
      fs.writeFileSync(deltaOutputPath, JSON.stringify(output, null, 2));
    } catch {
      /* best-effort */
    }
  };
  writeDeltaOutput(EMPTY_DELTA_OUTPUT);

  if (!fs.existsSync(jsonReportPath)) {
    console.warn(`[syncHistory] No results.json at ${jsonReportPath} — skipping history sync`);
    return;
  }

  let current: RunHistoryRecord;
  try {
    current = buildCurrentRecord(env, branch, buildNumber, runSource, jsonReportPath);
  } catch (err) {
    console.warn('[syncHistory] Failed to parse current run for history — skipping:', err);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-history-'));
  const historyFileRelPath = `history/${env}.jsonl`;

  try {
    const gitRemoteUrl = resolveGitRemoteUrl();
    // WHY: shallow, single-branch clone — this branch only ever needs its tip,
    // never full history, and a shallow clone keeps every CI run's sync step
    // fast regardless of how many runs have accumulated over the project's life.
    const cloneAttempt = shSafe(
      `git clone --depth 50 --branch ${HISTORY_BRANCH_NAME} --single-branch ${gitRemoteUrl} "${tempDir}/repo"`,
      tempDir
    );
    const repoDir = path.join(tempDir, 'repo');

    if (!cloneAttempt.ok) {
      // WHY: branch doesn't exist yet (first-ever sync) — create it as an
      // orphan so this ledger never inherits or depends on the code branches'
      // history/size.
      console.log('[syncHistory] History branch not found — creating it as a fresh orphan branch');
      fs.mkdirSync(repoDir, { recursive: true });
      sh(`git clone ${gitRemoteUrl} .`, repoDir);
      sh(`git checkout --orphan ${HISTORY_BRANCH_NAME}`, repoDir);
      sh(`git rm -rf . --quiet || true`, repoDir);
      fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
      sh(`git config user.name "kylas-qa-bot"`, repoDir);
      sh(`git config user.email "qa-bot@kylas.io"`, repoDir);
      sh(`git add .gitkeep`, repoDir);
      sh(`git commit -m "chore: initialize reporting-history branch [skip ci]"`, repoDir);
    } else {
      sh(`git config user.name "kylas-qa-bot"`, repoDir);
      sh(`git config user.email "qa-bot@kylas.io"`, repoDir);
    }

    // WHY: Confirmed live during verification (2026-07-07) — an earlier version
    // of this retry loop used `git rebase` to reapply a stale local commit on
    // top of the freshly-fetched tip. That's WRONG for a plain-text, line-
    // appended JSONL file: two independent appends can land in the same textual
    // region and git's line-based rebase genuinely conflicts on them (reproduced
    // live with two concurrent synthetic runs), which this loop would then treat
    // as "give up" — silently losing that run's history entry, exactly the
    // failure mode this retry exists to prevent. The fix: never replay a diff at
    // all. On every attempt (including the first), re-read whatever the
    // CURRENT remote tip's file content is, recompute the append fresh with
    // appendAndPrune (a pure function of "latest content" + "my record"), and
    // commit that. Two concurrent runs computing "latest + my own record" can
    // never conflict with each other by construction — there is no patch to
    // reconcile, only ordinary lost-update races that a plain retry resolves.
    let pushed = false;
    let deltaOutput: HistoryDeltaOutput = EMPTY_DELTA_OUTPUT;
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
      if (attempt > 1) {
        console.log(`[syncHistory] Attempt ${attempt}/${MAX_PUSH_RETRIES} — fetching latest and recomputing fresh`);
        await fetchHistoryBranchWithBackoff(repoDir, HISTORY_BRANCH_NAME);
        sh(`git reset --hard origin/${HISTORY_BRANCH_NAME}`, repoDir);
      }

      const historyFilePath = path.join(repoDir, historyFileRelPath);
      const existingJsonl = fs.existsSync(historyFilePath) ? fs.readFileSync(historyFilePath, 'utf-8') : '';
      const historyBeforeAppend = parseHistory(existingJsonl);

      const delta = computeDelta(historyBeforeAppend, current);
      deltaOutput = {
        delta,
        recurringFlaky: computeRecurringFlaky(historyBeforeAppend, current),
        recurringFailures: computeRecurringFailures(historyBeforeAppend, current),
        moduleTrend: computeModuleTrend(historyBeforeAppend, current),
        slowTestTrend: computeSlowTestTrend(historyBeforeAppend, current.slowestTests),
        suiteDrift: detectSuiteDrift(delta),
        passRateSeries: buildPassRateSeries(historyBeforeAppend, current),
      };

      const updatedJsonl = appendAndPrune(existingJsonl, current);
      fs.mkdirSync(path.dirname(historyFilePath), { recursive: true });
      fs.writeFileSync(historyFilePath, updatedJsonl);

      sh(`git add ${historyFileRelPath}`, repoDir);
      const commitResult = shSafe(
        `git commit -m "chore: record ${env} run #${buildNumber} [skip ci]"`,
        repoDir
      );
      if (!commitResult.ok) {
        console.log('[syncHistory] Nothing to commit (identical record already present?) — treating as success');
        pushed = true;
        break;
      }

      const pushResult = shSafe(`git push origin ${HISTORY_BRANCH_NAME}`, repoDir);
      if (pushResult.ok) {
        pushed = true;
        break;
      }
      console.log(`[syncHistory] Push attempt ${attempt}/${MAX_PUSH_RETRIES} rejected (concurrent update) — will retry`);
    }

    // WHY: write delta/trend output AFTER the loop, from whichever attempt
    // actually succeeded — an earlier attempt's numbers could be stale
    // (computed against a tip that a concurrent run has since moved past).
    writeDeltaOutput(deltaOutput);

    if (!pushed) {
      console.warn(
        `[syncHistory] Could not push history after ${MAX_PUSH_RETRIES} attempts — this run's own record was not persisted to the ledger this time. The delta/trend output above is still the best available (from the last attempt), but treat it as approximate.`
      );
    } else {
      console.log(`[syncHistory] History updated: ${historyFileRelPath} (${env}, build #${buildNumber})`);
    }
  } catch (err) {
    console.warn('[syncHistory] History sync failed — continuing without it:', err);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// WHY: guarded behind require.main === module (2026-07-14) — added
// preventatively after discovering the identical unguarded pattern in
// notify.ts caused an unintended real email send when something imported
// from that file (see notify.ts's own WHY comment on this same guard for the
// full incident). This file has the same shape (real git push side effects
// on the real ci/reporting-history branch reachable from main()), so it gets
// the same fix even though it wasn't the one that misfired this time.
if (require.main === module) {
  main().catch((err) => {
    console.warn('[syncHistory] Fatal error — history sync skipped, build continues:', err);
    process.exit(0);
  });
}
