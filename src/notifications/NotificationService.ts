/**
 * UPDATED NotificationService.ts
 * Reads misc-errors.json and history-delta.json and passes them, plus
 * derived health/failure-cluster analysis, to the email template.
 */

import { ReportParser, ParsedReport } from './ReportParser';
import { EmailTemplate, EmailContext, ReportFreshness } from './EmailTemplate';
import { loadFieldConfigReset } from './FieldConfigReset';
import { loadShardCompleteness, isIncompleteRun, ShardCompleteness } from './ShardCompleteness';
import { RenewalFailure, describeRenewalFailure, loadRenewalFailure } from '../auth/renewalFailure';
import { loadRerunSummary } from './RerunSummary';
import { EmailAdapter } from './adapters/EmailAdapter';
import { notificationConfig, getRecipients } from './config/notificationConfig';
import { writeBackgroundErrorsPage } from './BackgroundErrors';
import { computeHealthScore, computeOverallVerdict, healthNotApplicableReason } from './AutomationHealth';
import { clusterFailures } from './FailureAnalyzer';
import { RunDelta, RecurringIssue, ModuleTrend, ModuleStabilityTrend, SlowTestTrend, SuiteDrift, PassRatePoint } from './RunHistory';
import { JobStats } from './JobStats';
import { MiscErrorReport } from '../error-collector/ErrorCollector';
import { loadSessionInfo } from '../auth/sessionInfo';
import { loadKnownIssuesIndex, locateKnownIssues } from './KnownIssuesIndex';
import { enrichClusters, buildFlakyFailureDetails, EnrichmentContext } from './FailureDetailBuilder';
import { assessCauses, summarizeCauses, CauseSummary } from './FailureClassifier';
import { loadSignatureRegistry } from './FailureSignatureLoader';
import { normalizeTestTitle } from './FailureAnalyzer';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import * as os from 'os';
import * as crypto from 'crypto';
import { nounFor } from './wording';
import { isMergeCommit, mergeTargetBranch, parseCommitFacts } from './CommitInfo';

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

/** The incomplete-run banner reads the cause from the completeness record; renew-session-failed.json says it in words. */
export function withRenewalCause(c: ShardCompleteness | null, failure: RenewalFailure | null): ShardCompleteness | null {
  if (!c || !failure || !isIncompleteRun(c)) return c;
  return { ...c, cause: `renew-session: ${describeRenewalFailure(failure)}` };
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
  // WHY: added 2026-09-29 (Phase 3 items #1/#6) — real per-job CI timing
  // data, fetched by notify.ts via JobStats.loadJobStats() ONLY when
  // runSource === 'github-actions' (Jenkins has no equivalent concept
  // queryable this way — see JobStats.ts's own WHY comment). Undefined for
  // every Jenkins/local run, and also whenever the GitHub Jobs API call
  // itself failed for any reason (missing token, network error, non-2xx) —
  // loadJobStats() already degrades to null in every failure case, matching
  // allureUrl's own graceful-omission precedent directly above.
  jobStats?: JobStats;
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
  flakiestTests: RecurringIssue[];
  recurringFailures: RecurringIssue[];
  moduleTrend: ModuleTrend[];
  moduleStabilityTrend: ModuleStabilityTrend[];
  slowTestTrend: SlowTestTrend[];
  suiteDrift: SuiteDrift | null;
  passRateSeries: PassRatePoint[];
}

const EMPTY_HISTORY_DELTA: HistoryDeltaFile = {
  delta: null,
  recurringFlaky: [],
  flakiestTests: [],
  recurringFailures: [],
  moduleTrend: [],
  moduleStabilityTrend: [],
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
  const raw = [input.env, input.branch, input.buildNumber, report.startTime, report.total, report.passed, report.failed, report.flaky].join('|');
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

  /**
   * Everything the email needs besides the parsed report: misc errors, history delta, causes, rerun, verdict.
   * Extracted from notify() (2026-11-24, no behaviour change) so scripts/render-build235.ts and the check scripts
   * render through the same code the pipeline uses. Reads reports/<env>/ and docs/ under the current directory;
   * `now` is only the clock for the report-freshness check (a replay of an old run passes the run's own time).
   */
  buildContext(input: NotificationInput, report: ParsedReport, now: number = Date.now()): EmailContext {
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
          flakiestTests: parsed.flakiestTests ?? [],
          recurringFailures: parsed.recurringFailures ?? [],
          moduleTrend: parsed.moduleTrend ?? [],
          moduleStabilityTrend: parsed.moduleStabilityTrend ?? [],
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
    const freshness = checkReportFreshness(report.endTime, now);
    if (freshness.isStale) {
      logger.warn(
        `[Notification] STALE REPORT — this report's data is ${Math.round(freshness.ageMs / 3_600_000)}h old (threshold: ${freshness.thresholdHours}h). This may not reflect a fresh run.`
      );
    }
    // WHY (2026-11-24, sandbox 45420781016): a failed renew-session job skips every test job; the verdict and the incomplete-run
    // banner name that cause instead of "Incomplete run".
    const renewalFailure = loadRenewalFailure(input.env);
    const shardCompleteness = withRenewalCause(loadShardCompleteness(input.env), renewalFailure);
    const computedHealth = computeHealthScore(
      report,
      historyDeltaFile.delta,
      miscErrors,
      historyDeltaFile.suiteDrift,
      historyDeltaFile.recurringFailures,
      historyDeltaFile.recurringFlaky,
      freshness.isStale
    );
    // A run that verified nothing (blocked, incomplete, nothing selected) has no health score: "n/a" and why (2026-11-25).
    const notApplicable = healthNotApplicableReason(report, shardCompleteness, renewalFailure);
    const health = notApplicable ? { ...computedHealth, notApplicable } : computedHealth;
    const verdict = computeOverallVerdict(report, health, historyDeltaFile.suiteDrift, shardCompleteness, renewalFailure, input.branch);

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
      knownIssuesIndex: loadKnownIssuesIndex(process.cwd()),
      runSource: input.runSource ?? 'local',
      buildUrl: input.buildUrl,
    };
    const usedAnchorIds = new Set<string>();
    const enrichedClusters = enrichClusters(clusters, enrichmentCtx, usedAnchorIds);
    const flakyFailureDetails = buildFlakyFailureDetails(report.flakyTests, enrichmentCtx, usedAnchorIds);
    // Tests that passed on the rerun shard are Passed now, but their first-run failure is still evidence (ADR 0015 amendment).
    const rerunPassedDetails = buildFlakyFailureDetails(report.passedOnRerunTests, enrichmentCtx, usedAnchorIds);

    // WHY a try/catch that only logs: suspected-cause labels are a reader hint (FailureClassifier.ts) and must never
    // be able to stop or alter the email — no label, summary or banner is rendered if this fails.
    let causeSummary: CauseSummary | undefined;
    try {
      const { registry, error } = loadSignatureRegistry();
      if (error) logger.warn(`[Notification] Failure signature registry unusable (${error}) — causes stay unclassified`);
      const allDetails = [...enrichedClusters.flatMap((c) => c.details), ...flakyFailureDetails, ...rerunPassedDetails];
      const miscList = miscErrors?.errors ?? [];
      const assessed = assessCauses(
        allDetails.map((d) => ({
          test: d.test,
          related: miscList.filter((e) => e.testTitle !== undefined && normalizeTestTitle(e.testTitle) === normalizeTestTitle(d.test.title)),
          knownIssue: d.knownIssue,
        })),
        registry,
        {
          previousRunFailedTitles: enrichmentCtx.previousRunFailedTitles,
          recurringFailures: enrichmentCtx.recurringFailures,
          shardCompleteness,
        }
      );
      for (const d of allDetails) d.cause = assessed.get(d.test);
      causeSummary = summarizeCauses(assessed.values(), registry, shardCompleteness);
    } catch (err) {
      logger.warn(`[Notification] Could not compute suspected causes — omitting them: ${String(err)}`);
    }

    const ctx: EmailContext = {
      report,
      env: input.env,
      branch: input.branch,
      buildNumber: input.buildNumber,
      buildUrl: input.buildUrl,
      gitCommit: input.gitCommit,
      triggeredBy: input.triggeredBy,
      sessionInfo: loadSessionInfo(input.env),
      runSource: input.runSource,
      allureUrl: input.allureUrl,
      jobStats: input.jobStats,
      fieldConfigReset: loadFieldConfigReset(input.env),
      shardCompleteness,
      rerun: loadRerunSummary(input.env),
      miscErrors,
      historyDelta: historyDeltaFile.delta,
      recurringFlaky: historyDeltaFile.recurringFlaky,
      flakiestTests: historyDeltaFile.flakiestTests,
      recurringFailures: historyDeltaFile.recurringFailures,
      moduleTrend: historyDeltaFile.moduleTrend,
      moduleStabilityTrend: historyDeltaFile.moduleStabilityTrend,
      slowTestTrend: historyDeltaFile.slowTestTrend,
      suiteDrift: historyDeltaFile.suiteDrift,
      passRateSeries: historyDeltaFile.passRateSeries,
      health,
      verdict,
      clusters: enrichedClusters,
      flakyFailureDetails,
      rerunPassedDetails,
      causeSummary,
      hasHistoryEverExisted: historyDeltaFile.delta?.previousRun != null,
      knownIssuesUrl,
      commit: this.resolveCommitInfo(input.gitCommit),
      kiLocations: locateKnownIssues(process.cwd()),
      reportFreshness: freshness,
      nodeVersion: process.version,
      osInfo: `${os.platform()} ${os.release()}`,
      reportsDir,
      historyBranchUrl,
    };
    return ctx;
  }

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
    let report: ParsedReport;
    try {
      report = this.parser.parse(input.jsonReportPath);
    } catch (err) {
      // WHY (2026-09-09, sandbox Build #167 investigation): a killed/crashed
      // CI job (e.g. GitHub Actions' hard 6-hour job ceiling — see
      // docs/known-issues/sharding-and-locks.md's 6-hour-ceiling entry) can leave NO results.json at
      // all, which used to throw here uncaught — main()'s only catch just
      // logged to the raw CI console and exited, so nobody watching only the
      // email inbox (not raw CI logs) was ever told the run had a problem.
      // This is the "silent failure" counterpart to the separate false-
      // "PASSED" bug found in the same investigation (see ReportParser.ts's
      // own WHY comment on 'no-tests-executed') — that one reported a WRONG
      // status; this one reported NOTHING. Both are fixed together: this
      // path now still sends a real, unambiguous alert email instead of
      // dying silently, explicitly stating this is neither a pass nor a
      // fail rather than staying quiet.
      logger.error(
        '[Notification] Could not parse test report — sending a failure alert instead of a full report',
        err
      );
      await this.sendReportUnavailableAlert(input, err);
      return;
    }
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

    const ctx = this.buildContext(input, report);

    const recipients = getRecipients(input.env, input.branch);
    const subject = this.template.subject(ctx);
    const html = this.template.html(ctx);
    const text = this.template.text(ctx);
    const chart = this.template.chartAttachment(ctx); // null when the image could not be made: the email goes out without it
    // the full background-error list, next to the HTML report (it goes into the report artifact); the email carries only the top groups
    writeBackgroundErrorsPage(path.dirname(input.jsonReportPath), ctx.miscErrors, { env: input.env, branch: input.branch, buildNumber: input.buildNumber });

    logger.info(`[Notification] Sending email — Subject: ${subject}`);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html, text, ...(chart ? { attachments: [chart] } : {}), env: input.env });
      logger.success('[Notification] Email sent successfully');
      // WHY only marked "sent" here, after a confirmed-successful send: see
      // markNotified()'s own WHY comment — a failed attempt must remain
      // retriable.
      markNotified(input.env, dedupKey);
    } catch (err) {
      logger.error('[Notification] Failed to send email:', err);
    }
  }

  // WHY a minimal, hand-built email rather than routing through
  // EmailTemplate/computeOverallVerdict (2026-09-09): both require a real
  // ParsedReport, which by definition doesn't exist in this failure mode —
  // fabricating a fake one just to satisfy the type would risk exactly the
  // kind of made-up-status bug this whole investigation (sandbox Build
  // #167's false "PASSED") was about. This alert is deliberately simple and
  // unambiguous instead: state plainly that no report could be parsed, why,
  // and where to look — never implying a pass or a fail either way.
  /**
   * The "no report available" message (subject and HTML) without sending it: extracted from sendReportUnavailableAlert()
   * (2026-11-24, no behaviour change) so the scenario matrix can render it. Reads reports/<env>/ under the current directory.
   */
  buildReportUnavailableMessage(input: NotificationInput, err: unknown): { subject: string; html: string } {
    const reason = err instanceof Error ? err.message : String(err);
    const renewalFailure = loadRenewalFailure(input.env);
    const completeness = withRenewalCause(loadShardCompleteness(input.env), renewalFailure);
    const shardNote = isIncompleteRun(completeness)
      ? `<p><strong>Shards:</strong> ${completeness.reported} of ${completeness.expected} shard reports were available to merge.${
          completeness.cause?.startsWith('renew-session') ? ` <strong>No test job started:</strong> ${this.escapeHtml(completeness.cause.replace(/^renew-session:\s*/, 'the renew-session job did not succeed: '))}` : ''
        }</p>`
      : '';
    const subject = `🚫 ${input.env.toUpperCase()} ${input.branch} #${input.buildNumber}: REPORT NOT AVAILABLE`;
    // a complete document (charset, viewport, light colour scheme) like the run email: without a charset the emoji and dashes can garble in a client
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"></head><body style="margin:0;">
<div style="font-family:sans-serif;max-width:640px;margin:0 auto;">
  <div style="background:#B3261E;padding:16px 24px;">
    <span style="color:#ffffff;font-weight:700;font-size:14px;letter-spacing:0.05em;text-transform:uppercase;">No Test Report Available — Not A Pass Or Fail</span>
  </div>
  <div style="padding:20px 24px;color:#1A1A1A;font-size:14px;line-height:1.6;">
    <p>This run's own report file could not be found or parsed, so <strong>no pass/fail status can be reported</strong> — this is not a "passed" run and must not be treated as one.</p>
    <p><strong>Reason:</strong> ${this.escapeHtml(reason)}</p>
    ${shardNote}
    <p>
      <strong>Environment:</strong> ${this.escapeHtml(input.env)}<br/>
      <strong>Branch:</strong> ${this.escapeHtml(input.branch)}<br/>
      <strong>Build:</strong> #${this.escapeHtml(input.buildNumber)}<br/>
      <strong>Commit:</strong> ${this.escapeHtml(input.gitCommit)}
    </p>
    ${
      input.buildUrl
        ? `<p><a href="${this.escapeHtml(input.buildUrl)}">View the raw CI run directly</a> to see what actually happened.</p>`
        : '<p>Check the raw CI run directly (no build URL was available to this script) to see what actually happened.</p>'
    }
    <p>Common causes: the job was cancelled or killed before finishing (e.g. a platform timeout), or a real infrastructure failure prevented tests from running at all.</p>
  </div>
</div></body></html>`;
    return { subject, html };
  }

  private async sendReportUnavailableAlert(input: NotificationInput, err: unknown): Promise<void> {
    const recipients = getRecipients(input.env, input.branch);
    const { subject, html } = this.buildReportUnavailableMessage(input, err);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html, env: input.env });
      logger.info(`[Notification] Report-unavailable alert sent to ${recipients.to.length} ${nounFor(recipients.to.length, 'recipient')}`);
    } catch (sendErr) {
      logger.error('[Notification] Failed to send even the report-unavailable alert:', sendErr);
    }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  // drifts the moment the known-issues docs change on that branch after this run
  // — linking to the exact commit under test means the link always shows
  // precisely the content that existed for THIS build, immutable, never
  // subject to later edits. GitHub's blob view accepts a short SHA.
  // The commit this run tested, as a link with its subject line and author (item 18, 2026-11-25). The link needs only the GitHub remote;
  // the subject and author come from the checkout the notify step runs in (CI has it) and are null when git cannot answer (a scenario's
  // temporary directory, a shallow clone without the commit): the email then shows the link alone, never a guess.
  private resolveCommitInfo(gitCommit: string): EmailContext['commit'] {
    if (!gitCommit || gitCommit === 'unknown') return undefined;
    const ownerRepo = resolveGithubOwnerRepo();
    const urlOf = (sha: string): string | null => (ownerRepo ? `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/commit/${sha}` : null);
    const git = (args: string[]): string | undefined => {
      try {
        return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
      } catch {
        return undefined; // not a git checkout, or the commit is not in it
      }
    };
    const FORMAT = '--format=%H%x1f%an%x1f%s%x1f%P';
    const pushedRaw = git(['show', '-s', FORMAT, gitCommit]);
    const pushed = pushedRaw ? parseCommitFacts(pushedRaw) : undefined;
    if (!pushed) return { sha: gitCommit, url: urlOf(gitCommit), message: null, author: null };
    // A merge into the run's branch (sandbox merges the feature branch): show the feature's own head commit, newest non-merge commit of the
    // second parent, and keep the merge as a note.
    if (isMergeCommit(pushed)) {
      const headRaw = git(['log', '-1', '--no-merges', FORMAT, pushed.parents[1]]);
      const head = headRaw ? parseCommitFacts(headRaw) : undefined;
      if (head) {
        return {
          sha: head.sha,
          url: urlOf(head.sha),
          message: head.subject || null,
          author: head.author || null,
          merge: { sha: pushed.sha, url: urlOf(pushed.sha), into: mergeTargetBranch(pushed.subject) ?? null },
        };
      }
    }
    return { sha: pushed.sha, url: urlOf(pushed.sha), message: pushed.subject || null, author: pushed.author || null };
  }

  private resolveKnownIssuesUrl(gitCommit: string): string | null {
    const ownerRepo = resolveGithubOwnerRepo();
    if (!ownerRepo || !gitCommit || gitCommit === 'unknown') return null;
    // Base blob URL only (no file): each known-issues match carries its own
    // `file` (docs/known-issues/<topic>.md etc.), appended at render time.
    return `https://github.com/${ownerRepo.owner}/${ownerRepo.repo}/blob/${gitCommit}`;
  }
}
