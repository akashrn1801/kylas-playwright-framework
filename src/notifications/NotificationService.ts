/**
 * UPDATED NotificationService.ts
 * Reads misc-errors.json and history-delta.json and passes them, plus
 * derived health/failure-cluster analysis, to the email template.
 */

import { ReportParser } from './ReportParser';
import { EmailTemplate, EmailContext, ReportFreshness } from './EmailTemplate';
import { EmailAdapter } from './adapters/EmailAdapter';
import { notificationConfig, getRecipients } from './config/notificationConfig';
import { computeHealthScore } from './AutomationHealth';
import { clusterFailures } from './FailureAnalyzer';
import { RunDelta, RecurringIssue, ModuleTrend, SlowTestTrend, SuiteDrift, PassRatePoint } from './RunHistory';
import { MiscErrorReport } from '../error-collector/ErrorCollector';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as os from 'os';

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

export class NotificationService {
  private parser = new ReportParser();
  private template = new EmailTemplate();
  private email = new EmailAdapter();

  async notify(input: NotificationInput): Promise<void> {
    if (!notificationConfig.enabled) {
      console.log('[Notification] Notifications disabled — skipping');
      return;
    }
    const password = process.env.GMAIL_APP_PASSWORD || process.env.ZOHO_APP_PASSWORD || '';
    if (!password) {
      console.warn('[Notification] Email password not set — skipping email');
      return;
    }
    notificationConfig.smtp.password = password;
    notificationConfig.smtp.user =
      process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user;

    console.log('[Notification] Parsing test report...');
    const report = this.parser.parse(input.jsonReportPath);
    console.log(
      `[Notification] Results — Total: ${report.total}, Passed: ${report.passed}, Failed: ${report.failed}, Flaky: ${report.flaky}`
    );

    // WHY: Read misc-errors.json — if not found or empty, gracefully skip
    const miscErrorsPath = getMiscErrorsPath(input.env);
    let miscErrors: MiscErrorReport | null = null;
    try {
      if (fs.existsSync(miscErrorsPath)) {
        miscErrors = JSON.parse(fs.readFileSync(miscErrorsPath, 'utf-8'));
        if (miscErrors && miscErrors.totalErrors > 0) {
          console.log(
            `[Notification] Background errors found: ${miscErrors.totalErrors} — will include in email`
          );
        } else {
          console.log('[Notification] No background errors captured');
        }
      }
    } catch {
      console.warn('[Notification] Could not read misc-errors.json — skipping misc errors section');
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
          console.log(
            `[Notification] Run history delta found — vs previous run: ${historyDeltaFile.delta.passedDelta >= 0 ? '+' : ''}${historyDeltaFile.delta.passedDelta} passed`
          );
        }
      }
    } catch {
      console.warn('[Notification] Could not read history-delta.json — skipping trend section');
    }

    const clusters = clusterFailures(report.failedTests, miscErrors?.errors ?? null);
    const freshness = checkReportFreshness(report.endTime);
    if (freshness.isStale) {
      console.warn(
        `[Notification] ⚠️  STALE REPORT — this report's data is ${Math.round(freshness.ageMs / 3_600_000)}h old (threshold: ${freshness.thresholdHours}h). This may not reflect a fresh run.`
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

    const reportsDir = path.relative(process.cwd(), path.dirname(input.jsonReportPath)).split(path.sep).join('/');
    const historyBranchUrl = this.resolveHistoryBranchUrl(input.env);

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
      clusters,
      reportFreshness: freshness,
      nodeVersion: process.version,
      osInfo: `${os.platform()} ${os.release()}`,
      reportsDir,
      historyBranchUrl,
    };

    const recipients = getRecipients(input.env, input.branch);
    const subject = this.template.subject(ctx);
    const html = this.template.html(ctx);

    console.log(`[Notification] Sending email — Subject: ${subject}`);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html, env: input.env });
      console.log('[Notification] ✅ Email sent successfully');
    } catch (err) {
      console.error('[Notification] ❌ Failed to send email:', err);
    }
  }

  // WHY: resolves a real GitHub blob link to the ci/reporting-history ledger
  // for this env, mirroring the exact git-remote-resolution technique already
  // used in scripts/syncHistory.ts's resolveGitRemoteUrl() — never fabricated:
  // returns null (and the CI/CD block simply omits the link) if the remote
  // can't be resolved or isn't a github.com remote. Single call site, small
  // (~15 lines) — not worth extracting to a shared file alongside
  // syncHistory.ts's near-identical logic, which runs in a separate script
  // process anyway.
  private resolveHistoryBranchUrl(env: string): string | null {
    try {
      const remoteUrl = execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim();
      // Matches both git@github.com:owner/repo.git and https://github.com/owner/repo.git
      const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
      if (!match) return null;
      const [, owner, repo] = match;
      return `https://github.com/${owner}/${repo}/blob/ci/reporting-history/history/${env}.jsonl`;
    } catch {
      return null;
    }
  }
}
