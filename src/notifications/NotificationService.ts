import { ReportParser } from './ReportParser';
import { EmailTemplate, EmailContext } from './EmailTemplate';
import { EmailAdapter } from './adapters/EmailAdapter';
import { notificationConfig, getRecipients } from './config/notificationConfig';

export interface NotificationInput {
  jsonReportPath: string;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
}

export class NotificationService {
  private parser   = new ReportParser();
  private template = new EmailTemplate();
  private email    = new EmailAdapter();

  async notify(input: NotificationInput): Promise<void> {
    if (!notificationConfig.enabled) {
      console.log('[Notification] Notifications disabled — skipping');
      return;
    }
    if (!notificationConfig.smtp.password) {
      console.warn('[Notification] ZOHO_APP_PASSWORD not set — skipping email');
      return;
    }
    console.log('[Notification] Parsing test report...');
    const report = this.parser.parse(input.jsonReportPath);
    console.log(`[Notification] Results — Total: ${report.total}, Passed: ${report.passed}, Failed: ${report.failed}, Flaky: ${report.flaky}`);
    const ctx: EmailContext = {
      report,
      env:         input.env,
      branch:      input.branch,
      buildNumber: input.buildNumber,
      buildUrl:    input.buildUrl,
      gitCommit:   input.gitCommit,
      triggeredBy: input.triggeredBy,
    };
    const recipients = getRecipients(input.env, input.branch);
    const subject    = this.template.subject(ctx);
    const html       = this.template.html(ctx);
    console.log(`[Notification] Sending email — Subject: ${subject}`);
    try {
      await this.email.send({ to: recipients.to, cc: recipients.cc, subject, html });
      console.log('[Notification] ✅ Email sent successfully');
    } catch (err) {
      console.error('[Notification] ❌ Failed to send email:', err);
    }
  }
}
