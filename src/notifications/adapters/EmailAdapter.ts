import * as nodemailer from 'nodemailer';
import { notificationConfig, getSenderDisplayName } from '../config/notificationConfig';

export interface EmailPayload {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  env: string;
}

export class EmailAdapter {
  private transporter: nodemailer.Transporter;

  constructor() {
    const user =
      process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user;
    const pass =
      process.env.GMAIL_APP_PASSWORD ||
      process.env.ZOHO_APP_PASSWORD ||
      notificationConfig.smtp.password;
    const host =
      process.env.GMAIL_SMTP_HOST || process.env.ZOHO_SMTP_HOST || notificationConfig.smtp.host;
    const port = parseInt(
      process.env.GMAIL_SMTP_PORT ||
        process.env.ZOHO_SMTP_PORT ||
        String(notificationConfig.smtp.port)
    );
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(payload: EmailPayload): Promise<void> {
    // smtp config accessed via notificationConfig.smtp directly
    const info = await this.transporter.sendMail({
      from: `"${getSenderDisplayName(`Kylas ${payload.env.toUpperCase()} Automation`)}" <${process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user}>`,
      to: payload.to.join(', '),
      cc: payload.cc?.join(', '),
      subject: payload.subject,
      html: payload.html,
    });
    console.log(
      // WHY a count, not the addresses: recipients are CI secrets, and GitHub masks only the exact secret
      // string, so a re-joined list would print unmasked in a public log.
      `[Notification] Email sent to ${payload.to.length} recipient(s), cc ${payload.cc?.length ?? 0} — MessageID: ${info.messageId}`
    );
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (err) {
      console.error('[Notification] SMTP verification failed:', err);
      return false;
    }
  }
}
