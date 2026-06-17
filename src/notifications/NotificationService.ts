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

const MISC_ERRORS_PATH = path.resolve(process.cwd(), 'reports', 'misc-errors.json');

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
    let miscErrors: any = null;
    try {
      if (fs.existsSync(MISC_ERRORS_PATH)) {
        miscErrors = JSON.parse(fs.readFileSync(MISC_ERRORS_PATH, 'utf-8'));
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
