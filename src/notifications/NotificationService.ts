/**
 * UPDATED NotificationService.ts
 * Reads misc-errors.json and history-delta.json and passes them, plus
 * derived health/failure-cluster analysis, to the email template.
 */

import { ReportParser, ParsedReport } from './ReportParser';
import { EmailTemplate, EmailContext, ReportFreshness } from './EmailTemplate';
import { EmailAdapter } from './adapters/EmailAdapter';
import { notificationConfig, getRecipients } from './config/notificationConfig';
import { computeHealthScore, computeOverallVerdict } from './AutomationHealth';
import { clusterFailures } from './FailureAnalyzer';
import { RunDelta, RecurringIssue, ModuleTrend, SlowTestTrend, SuiteDrift, PassRatePoint } from './RunHistory';
import { MiscErrorReport } from '../error-collector/ErrorCollector';
import { loadKnownIssuesIndex } from './KnownIssuesIndex';
import { enrichClusters, buildFlakyFailureDetails, EnrichmentContext } from './FailureDetailBuilder';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';

// WHY: added 2026-07-14 — confirmed live via two real sends that this
// pipeline had zero freshness checking anywhere: it unconditionally trusted
// whatever sat at the resolved report path, indefinitely. 4 hours chosen as a
// starting threshold — generous for CI queue/retry delays and a same-day
// local test-then-notify gap, while still catching "this is yesterday's (or
// worse) data." A starting heuristic, not a precision-tuned constant — same
// convention as SLOW_TEST_REGRESSION_THRESHOLD in RunHistory.ts — flagged
// explicitly for review, not silently finalized. Overridable via env var so
// a real deployment can tune it without a code change.
export const STALE_REPORT_THRESHOLD_HOURS = Number(process.env.STALE_REPORT_THRESHOLD_HOURS) || 4;

// WHY: takes `now` as an explicit parameter (default Date.now()) rather than
// calling it internally — keeps this function pure/testable, matching the
// no-hidden-time-dependency convention of RunHistory.ts/AutomationHealth.ts,
// while still defaulting sensibly for real callers.
export function checkReportFreshness(reportEndTime: string, now: number = Date.now()): ReportFreshness {
  const ageMs = now - new Date(reportEndTime).getTime();
  return {
    isStale: ageMs > STALE_REPORT_THRESHOLD_HOURS * 60 * 60 * 1000,
    ageMs,
    thresholdHours: STALE_REPORT_THRESHOLD_HOURS,
  };
}

export interface NotificationInput {
  jsonReportPath: string;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
  runSource: 'local' | 'github-actions' | 'jenkins';
  // WHY: added 2026-07-14 — derived in notify.ts from a real, standard URL
  // pattern (Jenkins' `allure(...)` step publishes at `${buildUrl}allure/`),
  // not fabricated here. Undefined when no real Allure publish location
  // exists for this run (GitHub Actions, local) — see notify.ts's WHY comment.
  allureUrl?: string;
}

// WHY: Confirmed live (2026-07-07 reporting audit) — MiscErrorReporter.ts writes
// the merged report to reports/{ENV}/misc-errors.json (namespaced per-environment
// since the 2026-07-07 concurrent-run fix), but this path was never updated to
// match when that change landed. Compute it from the same env value notify.ts
// already resolves, instead of a stale hardcoded path, so the two halves of this
// pipeline (writer and reader) can never drift apart again silently.
function getMiscErrorsPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'misc-errors.json');
}

// WHY: written by scripts/syncHistory.ts, read here the same optional/graceful
// way misc-errors.json already is — if the sync step wasn't run, failed, or
// this is the very first run for an environment, this file is simply absent
// or contains nulls/empty-arrays, and the email renders without those
// sections rather than erroring.
function getHistoryDeltaPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'history-delta.json');
}

// WHY: the on-disk shape written by scripts/syncHistory.ts, extended
// 2026-07-14 with recurringFailures/moduleTrend/slowTestTrend/suiteDrift/
// passRateSeries alongside the original delta/recurringFlaky. Typed here
// (previously read as `any`) so a shape drift between the writer and this
// reader is caught by the compiler instead of silently producing `undefined`
// fields deep inside EmailTemplate.
interface HistoryDeltaFile {
  delta: RunDelta | null;
  recurringFlaky: RecurringIssue[];
  recurringFailures: RecurringIssue[];
  moduleTrend: ModuleTrend[];
  slowTestTrend: SlowTestTrend[];
  suiteDrift: SuiteDrift | null;
  passRateSeries: PassRatePoint[];
}

const EMPTY_HISTORY_DELTA: HistoryDeltaFile = {
  delta: null,
  recurringFlaky: [],
  recurringFailures: [],
  moduleTrend: [],
  slowTestTrend: [],
  suiteDrift: null,
  passRateSeries: [],
};

// WHY added 2026-08-24: NotificationService.resolveHistoryBranchUrl() and the
// new known-issues cross-reference link (§7 of the redesign) both need the
// same "parse owner/repo out of the real git remote" logic — extracted once
// so a future change to the parsing regex can't drift between the two
// call sites, mirroring this file's own existing single-purpose-helper style.
function resolveGithubOwnerRepo(): { owner: string; repo: string } | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim();
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

// WHY exported (2026-08-24): same testability precedent already established
// by notify.ts's resolveNotificationInput() — these three pure/fs-only
// helpers can be exercised directly in a verification context (confirm the
// dedup key is stable, confirm hasAlreadyNotified/markNotified actually
// gate each other) WITHOUT ever reaching EmailAdapter.send(), so idempotency
// can be proven without risking a real duplicate send to the real QA team.
export function getNotifiedMarkerDir(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, '.notified');
}

// WHY a hash of real run-identifying fields, not just buildNumber: a local
// run's buildNumber is always the literal string "local" (see notify.ts's
// resolveNotificationInput()) — keying on buildNumber alone would treat
// every local run for an env as "the same run" and permanently suppress
// email after the first. Including branch/startTime/pass-fail counts means
// two genuinely different reports (even sharing a buildNumber) get different
// keys, while two identical invocations against the exact same report
// produce the identical key — which is exactly the idempotency property
// needed, nothing broader.
export function computeNotificationDedupKey(input: NotificationInput, report: ParsedReport): string {
  const raw = [input.env, input.branch, input.buildNumber, report.startTime, report.total, report.passed, report.failed].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex');
}

export function hasAlreadyNotified(env: string, key: string): boolean {
  return fs.existsSync(path.join(getNotifiedMarkerDir(env), `${key}.sent`));
}

// WHY written only AFTER EmailAdapter.send() resolves successfully (see the
// call site in notify() below), never before: a genuinely failed first
// attempt (SMTP down, bad credentials) must still be retriable — marking
// "sent" before confirming success would permanently and incorrectly
// suppress every future legitimate retry for that exact report.
export function markNotified(env: string, key: string): void {
  try {
    const dir = getNotifiedMarkerDir(env);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key}.sent`), new Date().toISOString());
  } catch {
    /* best-effort — a failure to write the marker must never fail the whole notify() call */
  }
}

export class NotificationService {
  private parser = new ReportParser();
  private template = new EmailTemplate();
  private email = new EmailAdapter();

  async notify(input: NotificationInput): Promise<void> {
    if (!notificationConfig.enabled) {
      logger.info('[Notification] Notifications disabled — skipping');
      return;
    }
    const password = process.env.GMAIL_APP_PASSWORD || process.env.ZOHO_APP_PASSWORD || '';
    if (!password) {
      logger.warn('[Notification] Email password not set — skipping email');
      return;
    }
    notificationConfig.smtp.password = password;
    notificationConfig.smtp.user =
      process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user;

    logger.info('[Notification] Parsing test report...');
    const report = this.parser.parse(input.jsonReportPath);
    logger.info(
      `[Notification] Results — Total: ${report.total}, Passed: ${report.passed}, Failed: ${report.failed}, Flaky: ${report.flaky}`
    );

    // WHY checked before any other work (2026-08-24): confirmed live via grep
    // that nothing in this pipeline previously prevented a second real email
    // for the exact same run (e.g. a manual re-run of just the notify step,
    // or a wrapper retrying after an SMTP timeout that actually succeeded
    // server-side). The dedup key is a hash of real run-identifying fields —
    // see computeNotificationDedupKey's own WHY comment for why buildNumber
    // alone isn't enough (a local run's buildNumber is always "local").
    const dedupKey = computeNotificationDedupKey(input, report);
    if (hasAlreadyNotified(input.env, dedupKey)) {
      logger.info(`[Notification] Already sent for this exact run (key ${dedupKey.slice(0, 12)}…) — skipping duplicate send`);
      return;
    }

    // WHY: Read misc-errors.json — if not found or empty, gracefully skip
    const miscErrorsPath = getMiscErrorsPath(input.env);
    let miscErrors: MiscErrorReport | null = null;
    try {
      if (fs.existsSync(miscErrorsPath)) {
        miscErrors = JSON.parse(fs.readFileSync(miscErrorsPath, 'utf-8'));
        if (miscErrors && miscErrors.totalErrors > 0) {
          logger.info(
            `[Notification] Background errors found: ${miscErrors.totalErrors} — will include in email`
          );
        } else {
          logger.info('[Notification] No background errors captured');
        }
      }
    } catch {
      logger.warn('[Notification] Could not read misc-errors.json — skipping misc errors section');
    }

    // WHY: Read the extended run-history delta/trend output — if not found
    // (sync step never ran) or malformed, gracefully render without any of
    // it, same degrade-gracefully pattern as miscErrors above.
    const historyDeltaPath = getHistoryDeltaPath(input.env);
    let historyDeltaFile: HistoryDeltaFile = EMPTY_HISTORY_DELTA;
    try {
      if (fs.existsSync(historyDeltaPath)) {
        const parsed = JSON.parse(fs.readFileSync(historyDeltaPath, 'utf-8'));
        historyDeltaFile = {
          delta: parsed.delta ?? null,
          recurringFlaky: parsed.recurringFlaky ?? [],
          recurringFailures: parsed.recurringFailures ?? [],
          moduleTrend: parsed.moduleTrend ?? [],
          slowTestTrend: parsed.slowTestTrend ?? [],
          suiteDrift: parsed.suiteDrift ?? null,
          passRateSeries: parsed.passRateSeries ?? [],
        };
        if (historyDeltaFile.delta) {
          logger.info(
            `[Notification] Run history delta found — vs previous run: ${historyDeltaFile.delta.passedDelta >= 0 ? '+' : ''}${historyDeltaFile.delta.passedDelta} passed`
          );
        }
      }
    } catch {
      logger.warn('[Notification] Could not read history-delta.json — skipping trend section');
    }

    const clusters = clusterFailures(report.failedTests, miscErrors?.errors ?? null);
    const freshness = checkReportFreshness(report.endTime);
    if (freshness.isStale) {
      logger.warn(
        `[Notification] STALE REPORT — this report's data is ${Math.round(freshness.ageMs / 3_600_000)}h old (threshold: ${freshness.thresholdHours}h). This may not reflect a fresh run.`
      );
    }
    const health = computeHealthScore(
      report,
      historyDeltaFile.delta,
      miscErrors,
      historyDeltaFile.suiteDrift,
      historyDeltaFile.recurringFailures,
      historyDeltaFile.recurringFlaky,
      freshness.isStale
    );
    const verdict = computeOverallVerdict(report, health, historyDeltaFile.suiteDrift);

    const reportsDir = path.relative(process.cwd(), path.dirname(input.jsonReportPath)).split(path.sep).join('/');
    const historyBranchUrl = this.resolveHistoryBranchUrl(input.env);
    const knownIssuesUrl = this.resolveKnownIssuesUrl(input.gitCommit);

    // WHY previousRunFailedTitles is null (not []) whenever there is no prior
    // run: distinguishes "compared against real history, found nothing" from
    // "no history exists to compare against yet" — see FailureDetailBuilder's
    // RegressionStatus.unclassified for how this degrades honestly rather
    // than fabricating a "new regression"/"chronic" verdict with no basis.
    const enrichmentCtx: EnrichmentContext = {
      miscErrors: miscErrors?.errors ?? null,
      previousRunFailedTitles: historyDeltaFile.delta?.previousRun?.failedTestTitles ?? null,
      recurringFailures: historyDeltaFile.recurringFailures,
      knownIssuesIndex: loadKnownIssuesIndex(path.resolve(process.cwd(), '.claude', 'known-issues.md')),
      runSource: input.runSource ?? 'local',
      buildUrl: input.buildUrl,
    };
    const usedAnchorIds = new Set<string>();
    const enrichedClusters = enrichClusters(clusters, enrichmentCtx, usedAnchorIds);
    const flakyFailureDetails = buildFlakyFailureDetails(report.flakyTests, enrichmentCtx, usedAnchorIds);

    const ctx: EmailContext = {
      report,
      env: input.env,
      branch: input.branch,
      buildNumber: input.buildNumber,
      buildUrl: input.buildUrl,
      gitCommit: input.gitCommit,
      triggeredBy: input.triggeredBy,
      runSource: input.runSource,
      allureUrl: input.allureUrl,
      miscErrors,
      historyDelta: historyDeltaFile.delta,
      recurringFlaky: historyDeltaFile.recurringFlaky,
      recurringFailures: historyDeltaFile.recurringFailures,
      moduleTrend: historyDeltaFile.moduleTrend,
      slowTestTrend: historyDeltaFile.slowTestTrend,
      suiteDrift: historyDeltaFile.suiteDrift,
      passRateSeries: historyDeltaFile.passRateSeries,
      health,
      verdict,
      clusters: enrichedClusters,
      flakyFailureDetails,
      hasHistoryEverExisted: historyDeltaFile.delta?.previousRun != null,
      knownIssuesUrl,
      reportFreshness: freshness,
      nodeVersion: process.version,
      osInfo: `${os.platform()} ${os.release()}`,
      reportsDir,
      historyBranchUrl,
    };

    const recipients = getRecipients(input.env, input.branch);
    const subject = this.template.subject(ctx);
    const html = this.template.html(ctx);

    logger.info(`[Notification] Sending email — Subject: ${subject}`);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html, env: input.env });
      logger.success('[Notification] Email sent successfully');
      // WHY only marked "sent" here, after a confirmed-successful send: see
      // markNotified()'s own WHY comment — a failed attempt must remain
      // retriable.
      markNotified(input.env, dedupKey);
    } catch (err) {
      logger.error('[Notification] Failed to send email:', err);
    }
  }

  // WHY: resolves a real GitHub blob link to the ci/reporting-history ledger
  // for this env, mirroring the exact git-remote-resolution technique already
  // used in scripts/syncHistory.ts's resolveGitRemoteUrl() — never fabricated:
  // returns null (and the CI/CD block simply omits the link) if the remote
  // can't be resolved or isn't a github.com remote.
  private resolveHistoryBranchUrl(env: string): string | null {
    const ownerRepo = resolveGithubOwnerRepo();
    if (!ownerRepo) return null;
    return `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/blob/ci/reporting-history/history/${env}.jsonl`;
  }

  // WHY the commit SHA, not a branch name (2026-08-24): a branch-based link
  // drifts the moment known-issues.md changes on that branch after this run
  // — linking to the exact commit under test means the link always shows
  // precisely the content that existed for THIS build, immutable, never
  // subject to later edits. GitHub's blob view accepts a short SHA.
  private resolveKnownIssuesUrl(gitCommit: string): string | null {
    const ownerRepo = resolveGithubOwnerRepo();
    if (!ownerRepo || !gitCommit || gitCommit === 'unknown') return null;
    return `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/blob/${gitCommit}/.claude/known-issues.md`;
  }
}
