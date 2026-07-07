/**
 * UPDATED NotificationService.ts
 * Reads misc-errors.json and passes it to the email template.
 */

import { ReportParser } from './ReportParser';
import { EmailTemplate, EmailContext } from './EmailTemplate';
import { EmailAdapter } from './adapters/EmailAdapter';
import { notificationConfig, getRecipients } from './config/notificationConfig';
import * as fs from 'fs';
import * as path from 'path';

export interface NotificationInput {
  jsonReportPath: string;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
  runSource: 'local' | 'github-actions' | 'jenkins';
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

// WHY: written by scripts/syncHistory.ts (P2 of the 2026-07-07 reporting
// overhaul), read here the same optional/graceful way misc-errors.json already
// is — if the sync step wasn't run, failed, or this is the very first run for
// an environment, this file is simply absent or contains nulls, and the email
// renders without a delta/recurring-flaky section rather than erroring.
function getHistoryDeltaPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'history-delta.json');
}

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
    let miscErrors: any = null;
    try {
      if (fs.existsSync(miscErrorsPath)) {
        miscErrors = JSON.parse(fs.readFileSync(miscErrorsPath, 'utf-8'));
        if (miscErrors.totalErrors > 0) {
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

    // WHY: Read the run-history delta — if not found (sync step never ran) or
    // its `delta` field is null (first-ever run for this environment, or the
    // sync itself failed after exhausting retries), gracefully render without it.
    const historyDeltaPath = getHistoryDeltaPath(input.env);
    let historyDelta: any = null;
    let recurringFlaky: any[] = [];
    try {
      if (fs.existsSync(historyDeltaPath)) {
        const parsed = JSON.parse(fs.readFileSync(historyDeltaPath, 'utf-8'));
        historyDelta = parsed.delta || null;
        recurringFlaky = parsed.recurringFlaky || [];
        if (historyDelta) {
          console.log(
            `[Notification] Run history delta found — vs previous run: ${historyDelta.passedDelta >= 0 ? '+' : ''}${historyDelta.passedDelta} passed`
          );
        }
      }
    } catch {
      console.warn('[Notification] Could not read history-delta.json — skipping trend section');
    }

    const ctx: EmailContext = {
      report,
      env: input.env,
      branch: input.branch,
      buildNumber: input.buildNumber,
      buildUrl: input.buildUrl,
      gitCommit: input.gitCommit,
      triggeredBy: input.triggeredBy,
      runSource: input.runSource,
      miscErrors,
      historyDelta,
      recurringFlaky,
    };

    const recipients = getRecipients(input.env, input.branch);
    const subject = this.template.subject(ctx);
    const html = this.template.html(ctx);

    console.log(`[Notification] Sending email — Subject: ${subject}`);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html });
      console.log('[Notification] ✅ Email sent successfully');
    } catch (err) {
      console.error('[Notification] ❌ Failed to send email:', err);
    }
  }
}
