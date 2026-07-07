/**
 * Syncs the current run's result into the rolling run-history ledger (P2 of the
 * 2026-07-07 reporting overhaul) and writes a small delta/recurring-flaky
 * summary that NotificationService.ts optionally reads, the same way it already
 * optionally reads misc-errors.json.
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
import { execSync } from 'child_process';
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
  RunHistoryRecord,
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

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function shSafe(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: sh(cmd, cwd) };
  } catch (err: any) {
    return { ok: false, output: err?.stderr?.toString() || err?.message || String(err) };
  }
}

function buildCurrentRecord(env: string, branch: string, buildNumber: string, runSource: RunHistoryRecord['runSource'], jsonReportPath: string): RunHistoryRecord {
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
    modules: report.modules.map((m) => ({
      name: m.name,
      passed: m.passed,
      failed: m.failed,
      flaky: m.flaky,
      duration: 0, // WHY: ReportParser's ModuleStats doesn't track per-module duration today —
      // left as 0 rather than guessed; a future enhancement could thread this
      // through if per-module duration trend becomes a priority.
    })),
  };
}

async function main() {
  const env = process.env.ENV || 'qa';
  const branch = process.env.BRANCH_NAME || process.env.GITHUB_REF_NAME || 'unknown';
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
  const writeEmptyDelta = () => {
    try {
      fs.mkdirSync(path.dirname(deltaOutputPath), { recursive: true });
      fs.writeFileSync(deltaOutputPath, JSON.stringify({ delta: null, recurringFlaky: [] }, null, 2));
    } catch {
      /* best-effort */
    }
  };
  writeEmptyDelta();

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
    let delta: ReturnType<typeof computeDelta> | null = null;
    let recurringFlaky: ReturnType<typeof computeRecurringFlaky> = [];
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
      if (attempt > 1) {
        console.log(`[syncHistory] Attempt ${attempt}/${MAX_PUSH_RETRIES} — fetching latest and recomputing fresh`);
        sh(`git fetch origin ${HISTORY_BRANCH_NAME}`, repoDir);
        sh(`git reset --hard origin/${HISTORY_BRANCH_NAME}`, repoDir);
      }

      const historyFilePath = path.join(repoDir, historyFileRelPath);
      const existingJsonl = fs.existsSync(historyFilePath) ? fs.readFileSync(historyFilePath, 'utf-8') : '';
      const historyBeforeAppend = parseHistory(existingJsonl);

      delta = computeDelta(historyBeforeAppend, current);
      recurringFlaky = computeRecurringFlaky(historyBeforeAppend, current);

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

    // WHY: write delta/recurring-flaky AFTER the loop, from whichever attempt
    // actually succeeded — an earlier attempt's delta could be stale (computed
    // against a tip that a concurrent run has since moved past).
    try {
      fs.mkdirSync(path.dirname(deltaOutputPath), { recursive: true });
      fs.writeFileSync(deltaOutputPath, JSON.stringify({ delta, recurringFlaky }, null, 2));
    } catch (err) {
      console.warn('[syncHistory] Failed to write delta output:', err);
    }

    if (!pushed) {
      console.warn(
        `[syncHistory] Could not push history after ${MAX_PUSH_RETRIES} attempts — this run's own record was not persisted to the ledger this time. The delta/recurring-flaky output above is still the best available (from the last attempt), but treat it as approximate.`
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

main().catch((err) => {
  console.warn('[syncHistory] Fatal error — history sync skipped, build continues:', err);
  process.exit(0);
});
