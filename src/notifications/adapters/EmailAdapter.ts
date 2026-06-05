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
    const { smtp } = notificationConfig;
    this.transporter = nodemailer.createTransport({
      host:   smtp.host,
      port:   smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.password,
      },
    });
  }

  async send(payload: EmailPayload): Promise<void> {
    const { smtp } = notificationConfig;
    const info = await this.transporter.sendMail({
      from:    smtp.from,
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
