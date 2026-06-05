import * as nodemailer from 'nodemailer';
import { notificationConfig } from '../config/notificationConfig';

export interface EmailPayload {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}

export class EmailAdapter {
  private transporter: nodemailer.Transporter;

  constructor() {
    const user = process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user;
    const pass = process.env.GMAIL_APP_PASSWORD || process.env.ZOHO_APP_PASSWORD || notificationConfig.smtp.password;
    const host = process.env.GMAIL_SMTP_HOST || process.env.ZOHO_SMTP_HOST || notificationConfig.smtp.host;
    const port = parseInt(process.env.GMAIL_SMTP_PORT || process.env.ZOHO_SMTP_PORT || String(notificationConfig.smtp.port));
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  async send(payload: EmailPayload): Promise<void> {
    const { smtp } = notificationConfig;
    const info = await this.transporter.sendMail({
      from:    `"Kylas QA Automation" <${process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user}>`,
      to:      payload.to.join(', '),
      cc:      payload.cc?.join(', '),
      subject: payload.subject,
      html:    payload.html,
    });
    console.log(`[Notification] Email sent to: ${payload.to.join(', ')} — MessageID: ${info.messageId}`);
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
